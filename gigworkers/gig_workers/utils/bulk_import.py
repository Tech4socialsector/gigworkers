"""
Bulk Gig Worker Import — background job that processes CSV/XLSX files
and inserts records in batches of 500 using frappe.db.bulk_insert,
bypassing slow per-document hooks (email, PDF, user creation).

The same person can work under several aggregators. A row whose PAN,
Driving Licence, Aadhaar or eShram ID matches an existing Gig Worker is
never turned into a second Gig Worker record. Instead, each Gig Worker
has exactly one Worker Partner Mapping parent record (keyed by the Gig
Worker itself), and every aggregator that worker is mapped to becomes
one row in that record's Aggregator Mappings child table (aggregator +
that aggregator's own partner_id for this person) — so a worker's
record shows at a glance how many aggregators they work under.
"""

import re
from datetime import datetime

import frappe
from frappe.model.naming import make_autoname
from frappe.utils import now_datetime, getdate, date_diff, today

from gigworkers.gig_workers.utils.bulk_import_common import (
	parse_file as _shared_parse_file,
	update_progress as _shared_update_progress,
	is_cancelled as _shared_is_cancelled,
)
from gigworkers.gig_workers.doctype.gig_worker_unique_id_settings.gig_worker_unique_id_settings import (
	MissingIDProofValue,
	generate_unique_id,
	mask_aadhar_for_display,
)


BATCH_SIZE = 500
CACHE_KEY = "gw_bulk_import"

# Fields the import sets automatically, or no longer collects via CSV —
# exclude from the required-field check even if the doctype marks them reqd.
_GW_IMPORT_COMPUTED = {"status", "aadhaar_number"}


def _get_required_fields():
    """Read mandatory fields from the Gig Worker doctype meta at runtime."""
    meta = frappe.get_meta("Gig Worker")
    return {f.fieldname for f in meta.fields if f.reqd} - _GW_IMPORT_COMPUTED


# ---------------------------------------------------------------------------
# Entry point (called by frappe.enqueue)
# ---------------------------------------------------------------------------

def process_gig_worker_import(import_id, file_url, skip_duplicates=1, skip_email=1,
								created_by_aggregator=None, user="Administrator"):
	frappe.set_user(user)
	_update_progress(import_id, status="Running")

	file_name = frappe.db.get_value("File", {"file_url": file_url}, "file_name") or file_url.split("/")[-1]

	try:
		rows = _parse_file(file_url, user=user)
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Gig Worker Bulk Import Parse Error")
		errors = ["File parse error: could not read the uploaded file. Please check the format and try again."]
		_update_progress(import_id, status="Failed", errors=errors)
		_save_import_log(
			import_id=import_id, file_url=file_url, file_name=file_name,
			status="Failed", total=0, inserted=0, skipped=0, error_count=1,
			created_by_aggregator=created_by_aggregator, user=user, errors=errors,
		)
		return

	total = len(rows)
	_update_progress(import_id, total=total)

	existing_emails  = _get_existing_set("email")                    if skip_duplicates else set()
	existing_phones  = _get_existing_set("phone")                    if skip_duplicates else set()
	existing_aadhaar = _get_existing_map("aadhaar_number")           if skip_duplicates else {}
	existing_pan     = _get_existing_map("pan_number")               if skip_duplicates else {}
	existing_eshram  = _get_existing_map("eshram_id")                if skip_duplicates else {}
	existing_dl      = _get_existing_map("drivers_license_number")   if skip_duplicates else {}

	wpm_parents, agg_by_parent, next_idx = _get_existing_wpm_state()
	aggregator_names = _get_aggregator_names()

	uid_settings = frappe.get_single("Gig Worker Unique ID Settings")
	uid_enabled = bool(uid_settings.get_selected_proof_types())

	processed = 0
	inserted  = 0
	mapped    = 0
	skipped   = 0
	all_errors = []

	now_ts    = now_datetime()
	batch     = []
	user_batch = []       # [(gw_id, phone, email, worker_name)]
	wpm_parent_batch = [] # [(gig_worker_id, unique_id, worker_name)]
	wpm_child_batch  = [] # [(gig_worker_id, aggregator, partner_id, idx)]

	for idx, row in enumerate(rows, start=1):
		# Check cancel signal at each batch boundary
		if idx % BATCH_SIZE == 0:
			if _is_cancelled(import_id):
				if batch or wpm_parent_batch or wpm_child_batch:
					if batch:
						_flush_batch(batch)
						inserted += len(batch)
						_create_users_batch(user_batch, now_ts, user)
					_flush_wpm_batches(wpm_parent_batch, wpm_child_batch, now_ts, user, aggregator_names)
					batch = []; user_batch = []; wpm_parent_batch = []; wpm_child_batch = []
					frappe.db.commit()
				_update_progress(import_id, status="Cancelled",
								processed=processed, inserted=inserted, mapped=mapped,
								skipped=skipped, errors=all_errors[-200:])
				_save_import_log(
					import_id=import_id, file_url=file_url, file_name=file_name,
					status="Cancelled", total=total, inserted=inserted, mapped=mapped,
					skipped=skipped, error_count=len(all_errors),
					created_by_aggregator=created_by_aggregator, user=user, errors=all_errors,
				)
				frappe.publish_realtime(
					"gw_bulk_import_done",
					{"import_id": import_id, "total": total,
					 "inserted": inserted, "skipped": skipped, "status": "Cancelled"},
					user=user,
				)
				return

		validation_errors = _validate_row(row, idx)
		if validation_errors:
			all_errors.extend(validation_errors)
			skipped += 1
			processed += 1
			continue

		# Normalise fields — email/aadhaar_number/pan_number/eshram_id all carry a
		# unique DB index, so blank values must become None (NULL), never "".
		# MySQL's unique index allows any number of NULLs but only one empty
		# string — with "" every row after the first blank one gets silently
		# dropped by bulk_insert's INSERT IGNORE, while still being counted
		# as "inserted".
		email   = row.get("email", "").strip().lower() or None
		phone   = re.sub(r"\s+", "", row.get("phone", ""))
		aadhaar = row.get("aadhaar_number", "").replace(" ", "") or None
		pan     = row.get("pan_number", "").strip().upper() if row.get("pan_number") else None
		eshram  = row.get("eshram_id", "").strip().upper()  if row.get("eshram_id")  else None
		dl_number = row.get("drivers_license", "").strip() or None
		aadhaar_masked = mask_aadhar_for_display(aadhaar) if aadhaar else None
		mapping_aggregator = row.get("name_of_aggregator", "").strip() or created_by_aggregator \
			or row.get("created_by_aggregator") or None

		# Same person may already exist as a Gig Worker under a different
		# aggregator — matched by PAN > Driving Licence > Aadhaar > eShram ID.
		# In that case, don't create a second Gig Worker: just add a row to
		# that worker's Worker Partner Mapping child table for this aggregator.
		if skip_duplicates:
			matched_gw, conflict = _find_matching_worker(
				pan, dl_number, aadhaar, eshram,
				existing_pan, existing_dl, existing_aadhaar, existing_eshram,
			)
			if conflict:
				all_errors.append(
					f"Row {idx}: ID proofs point to different existing Gig Workers — skipped for manual review."
				)
				skipped += 1; processed += 1; continue

			if matched_gw:
				if not mapping_aggregator:
					all_errors.append(
						f"Row {idx}: worker already exists but no aggregator given to map to — skipped."
					)
					skipped += 1; processed += 1; continue
				if mapping_aggregator in agg_by_parent.get(matched_gw, set()):
					all_errors.append(
						f"Row {idx}: worker already mapped to aggregator '{mapping_aggregator}' — skipped."
					)
					skipped += 1; processed += 1; continue

				if matched_gw not in wpm_parents:
					# Rare: an existing Gig Worker from before this parent/child
					# structure existed, with no mapping parent row yet.
					gw_info = frappe.db.get_value(
						"Gig Worker", matched_gw, ["unique_id", "worker_name"], as_dict=True
					) or {}
					wpm_parent_batch.append((matched_gw, gw_info.get("unique_id"), gw_info.get("worker_name")))
					wpm_parents.add(matched_gw)

				partner_id = row.get("partner_id", "").strip() or None
				child_idx = next_idx.get(matched_gw, 0) + 1
				next_idx[matched_gw] = child_idx
				wpm_child_batch.append((matched_gw, mapping_aggregator, partner_id, child_idx, today(), "Active"))
				agg_by_parent.setdefault(matched_gw, set()).add(mapping_aggregator)
				mapped += 1; processed += 1; continue

			if email and email in existing_emails:
				all_errors.append(f"Row {idx}: email '{email}' already exists — skipped.")
				skipped += 1; processed += 1; continue
			if phone and phone in existing_phones:
				all_errors.append(f"Row {idx}: phone '{phone}' already exists — skipped.")
				skipped += 1; processed += 1; continue

		unique_id = None
		if uid_enabled:
			try:
				unique_id = generate_unique_id(
					{
						"pan_number": pan,
						"aadhaar_number": aadhaar,
						"drivers_license_number": dl_number,
					},
					settings=uid_settings,
				)
			except MissingIDProofValue as e:
				all_errors.append(f"Row {idx}: cannot generate Unique ID — {e.proof_type} is missing.")
				skipped += 1; processed += 1; continue

		name        = make_autoname("GW.###", "Gig Worker")
		agg         = created_by_aggregator or row.get("created_by_aggregator") or None
		worker_name = row.get("worker_name", "").strip()
		partner_id  = row.get("partner_id", "").strip() or None

		batch.append((
			name, now_ts, now_ts, user, user, 0,
			worker_name,
			partner_id,
			row.get("gender", "").strip(),
			aadhaar, aadhaar_masked, pan, phone,
			_parse_date(row.get("dob")),
			eshram, email,
			row.get("drivers_license", "").strip()         or None,
			dl_number,
			row.get("location_of_work", "").strip()        or None,
			row.get("operating_bank_account", "").strip()  or None,
			row.get("uan", "").strip()                     or None,
			row.get("name_of_aggregator", "").strip()      or agg or None,
			row.get("name_of_service", "").strip()         or None,
			agg, "Active",
			unique_id,
		))
		user_batch.append((name, phone, email, worker_name))

		wpm_parent_batch.append((name, unique_id, worker_name))
		wpm_parents.add(name)
		if mapping_aggregator:
			wpm_child_batch.append((name, mapping_aggregator, partner_id, 1, today(), "Active"))
			agg_by_parent.setdefault(name, set()).add(mapping_aggregator)
			next_idx[name] = 1

		if skip_duplicates:
			if email:     existing_emails.add(email)
			if phone:     existing_phones.add(phone)
			if aadhaar:   existing_aadhaar[aadhaar] = name
			if pan:       existing_pan[pan.lower()] = name
			if eshram:    existing_eshram[eshram.lower()] = name
			if dl_number: existing_dl[dl_number.lower()] = name

		processed += 1

		if len(batch) >= BATCH_SIZE or len(wpm_child_batch) >= BATCH_SIZE:
			if batch:
				_flush_batch(batch)
				inserted += len(batch)
				_create_users_batch(user_batch, now_ts, user)
			_flush_wpm_batches(wpm_parent_batch, wpm_child_batch, now_ts, user, aggregator_names)
			batch = []; user_batch = []; wpm_parent_batch = []; wpm_child_batch = []
			_update_progress(import_id, processed=processed, inserted=inserted, mapped=mapped,
							skipped=skipped, errors=all_errors[-50:])
			frappe.db.commit()

	# Flush remaining rows
	if batch or wpm_parent_batch or wpm_child_batch:
		if batch:
			_flush_batch(batch)
			inserted += len(batch)
			_create_users_batch(user_batch, now_ts, user)
		_flush_wpm_batches(wpm_parent_batch, wpm_child_batch, now_ts, user, aggregator_names)
		frappe.db.commit()

	_update_progress(import_id, status="Completed", total=total,
					processed=processed, inserted=inserted, mapped=mapped,
					skipped=skipped, errors=all_errors[-200:])

	_save_import_log(
		import_id=import_id, file_url=file_url, file_name=file_name,
		status="Completed", total=total, inserted=inserted, mapped=mapped,
		skipped=skipped, error_count=len(all_errors),
		created_by_aggregator=created_by_aggregator, user=user, errors=all_errors,
	)

	frappe.publish_realtime(
		"gw_bulk_import_done",
		{"import_id": import_id, "total": total,
		 "inserted": inserted, "skipped": skipped, "status": "Completed"},
		user=user,
	)


# ---------------------------------------------------------------------------
# Import log persistence
# ---------------------------------------------------------------------------

def _save_import_log(import_id, file_url, file_name, status, total, inserted,
						skipped, error_count, created_by_aggregator, user, errors, mapped=0):
	try:
		doc = frappe.get_doc({
			"doctype": "Gig Worker Import Log",
			"import_id": import_id,
			"import_date": now_datetime(),
			"file_name": file_name,
			"file_url": file_url,
			"status": status,
			"total_rows": total,
			"inserted": inserted,
			"mapped": mapped,
			"skipped": skipped,
			"error_count": error_count,
			"created_by_aggregator": created_by_aggregator,
			"imported_by": user,
			"error_log": "\n".join(errors) if errors else "",
		})
		doc.insert(ignore_permissions=True)
		frappe.db.commit()
	except Exception:
		frappe.log_error(frappe.get_traceback(), "Gig Worker Import Log: save failed")


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def _flush_batch(batch):
	fields = [
		"name", "creation", "modified", "modified_by", "owner", "docstatus",
		"worker_name", "partner_id", "gender", "aadhaar_number", "aadhaar_number_masked", "pan_number", "phone", "dob",
		"eshram_id", "email", "drivers_license", "drivers_license_number", "location_of_work",
		"operating_bank_account", "uan", "name_of_aggregator", "name_of_service",
		"created_by_aggregator", "status", "unique_id",
	]
	frappe.db.bulk_insert("Gig Worker", fields=fields, values=batch, ignore_duplicates=True)


def _flush_wpm_batches(wpm_parent_batch, wpm_child_batch, now_ts, user, aggregator_names):
	"""Bulk-insert Worker Partner Mapping parents (one per Gig Worker) and their
	Aggregator Mapping child rows (one per aggregator that worker is mapped to)."""
	if wpm_parent_batch:
		parent_rows = [
			(gig_worker_id, now_ts, now_ts, user, user, 0, gig_worker_id, unique_id, worker_name)
			for gig_worker_id, unique_id, worker_name in wpm_parent_batch
		]
		frappe.db.bulk_insert(
			"Worker Partner Mapping",
			fields=["name", "creation", "modified", "modified_by", "owner", "docstatus",
					"gig_worker_id", "unique_id", "worker_name"],
			values=parent_rows,
			ignore_duplicates=True,
		)
		wpm_parent_batch.clear()

	if wpm_child_batch:
		child_rows = [
			(frappe.generate_hash(length=10), now_ts, now_ts, user, user, 0,
			 parent, "aggregator_mappings", "Worker Partner Mapping", idx,
			 aggregator, aggregator_names.get(aggregator, aggregator), partner_id,
			 mapped_on, status)
			for parent, aggregator, partner_id, idx, mapped_on, status in wpm_child_batch
		]
		frappe.db.bulk_insert(
			"Worker Aggregator Detail",
			fields=["name", "creation", "modified", "modified_by", "owner", "docstatus",
					"parent", "parentfield", "parenttype", "idx",
					"aggregator", "aggregator_name", "partner_id",
					"mapped_on", "status"],
			values=child_rows,
			ignore_duplicates=True,
		)
		wpm_child_batch.clear()


def _create_users_batch(user_data, now_ts, owner):
    """
    user_data: list of (gw_id, phone, email, worker_name)
    Creates User + Has Role records in bulk, then sets phone as password.
    No welcome email is sent.
    """
    if not user_data:
        return

    from frappe.utils.password import update_password  # local import — frappe runtime only

    # Resolve login emails and skip already-existing users
    existing_users = {
        r[0] for r in frappe.db.sql(
            "SELECT email FROM `tabUser` WHERE email IN %(emails)s",
            {"emails": [
                (e.strip().lower() if e else f"{gw.lower()}@gigworker.local")
                for gw, _phone, e, _name in user_data
            ]},
            as_list=True,
        )
    } if user_data else set()

    user_rows = []
    role_rows = []
    to_set_password = []   # [(login_email, phone)]

    for gw_id, phone, email, worker_name in user_data:
        login_email = email.strip().lower() if email else f"{gw_id.lower()}@gigworker.local"
        if login_email in existing_users:
            continue
        existing_users.add(login_email)  # prevent duplicates within this batch
        first_name = worker_name or gw_id
        user_rows.append((
            login_email,        # name (PK)
            now_ts, now_ts,     # creation, modified
            owner, owner,       # modified_by, owner
            0,                  # docstatus
            login_email,        # email
            gw_id,              # username  (e.g. GW001)
            first_name,         # first_name
            1,                  # enabled
            "Website User",     # user_type
            0,                  # send_welcome_email
        ))
        role_rows.append((
            frappe.generate_hash(length=10),  # name (child PK)
            login_email,        # parent
            "User",             # parenttype
            "roles",            # parentfield
            "Gig Worker",       # role
        ))
        to_set_password.append((login_email, phone))

    if user_rows:
        frappe.db.bulk_insert(
            "User",
            fields=["name", "creation", "modified", "modified_by", "owner", "docstatus",
                    "email", "username", "first_name", "enabled", "user_type",
                    "send_welcome_email"],
            values=user_rows,
            ignore_duplicates=True,
        )

    if role_rows:
        frappe.db.bulk_insert(
            "Has Role",
            fields=["name", "parent", "parenttype", "parentfield", "role"],
            values=role_rows,
            ignore_duplicates=True,
        )

    frappe.db.commit()

    for login_email, phone in to_set_password:
        if phone:
            try:
                # Never derive a login credential from the worker's own phone
                # number — set a random one-time password instead.
                update_password(login_email, frappe.generate_hash(length=32))
            except Exception:
                pass  # non-fatal — user exists, password can be reset later


def _parse_file(file_url, user=None):
	return _shared_parse_file(file_url, user=user)


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------

def _validate_row(row, idx):
	errors = []
	for field in _get_required_fields():
		if not row.get(field, "").strip():
			errors.append(f"Row {idx}: missing required field '{field}'.")
	if errors:
		return errors

	email = row.get("email", "").strip()
	if email and not re.match(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$", email):
		errors.append(f"Row {idx}: invalid email '{email}'.")

	phone = re.sub(r"\s+", "", row.get("phone", ""))
	if phone and not re.fullmatch(r"[6-9]\d{9}", phone):
		errors.append(f"Row {idx}: invalid phone '{phone}'.")

	aadhaar = row.get("aadhaar_number", "").replace(" ", "")
	if aadhaar and not re.fullmatch(r"[0-9]{12}", aadhaar):
		_masked = "XXXX-XXXX-" + aadhaar[-4:] if len(aadhaar) >= 4 else "XXXX-XXXX-XXXX"
		errors.append(f"Row {idx}: invalid aadhaar '{_masked}'.")

	pan = row.get("pan_number", "").strip().upper()
	if pan and not re.fullmatch(r"[A-Z]{5}[0-9]{4}[A-Z]", pan):
		errors.append(f"Row {idx}: invalid PAN '{pan}'.")

	eshram = row.get("eshram_id", "").strip().upper()
	if eshram and not re.fullmatch(r"UW-[0-9]{12}", eshram):
		errors.append(f"Row {idx}: invalid eShram ID '{eshram}'.")

	dob = row.get("dob", "").strip()
	if dob:
		parsed = _parse_date(dob)
		if not parsed:
			errors.append(f"Row {idx}: invalid date of birth '{dob}'. Use YYYY-MM-DD.")
		elif date_diff(getdate(today()), getdate(parsed)) < 18 * 365:
			errors.append(f"Row {idx}: worker must be at least 18 years old.")

	return errors


def _parse_date(val):
	if not val:
		return None
	for fmt in (
		"%Y-%m-%d",   # 1990-06-15
		"%d-%m-%Y",   # 15-06-1990
		"%d/%m/%Y",   # 15/06/1990
		"%m/%d/%Y",   # 06/15/1990
		"%m-%d-%Y",   # 06-15-1990
		"%m-%d-%y",   # 06-15-90  ← 2-digit year
		"%d-%m-%y",   # 15-06-90
		"%m/%d/%y",   # 06/15/90
		"%d/%m/%y",   # 15/06/90
	):
		try:
			return datetime.strptime(str(val).strip(), fmt).strftime("%Y-%m-%d")
		except ValueError:
			continue
	return None


# Only these Gig Worker fields may ever be interpolated as a column name below —
# `field` must never be derived from request/CSV input without checking this set.
_ALLOWED_EXISTING_SET_FIELDS = {"email", "phone"}
_ALLOWED_EXISTING_MAP_FIELDS = {
	"aadhaar_number", "pan_number", "eshram_id", "drivers_license_number",
}


def _get_existing_set(field):
	if field not in _ALLOWED_EXISTING_SET_FIELDS:
		frappe.throw(f"Invalid field for duplicate lookup: {field}")
	rows = frappe.db.sql(
		f"SELECT `{field}` FROM `tabGig Worker` WHERE `{field}` IS NOT NULL", as_list=True
	)
	return {r[0].strip().lower() if isinstance(r[0], str) else r[0] for r in rows if r[0]}


def _get_existing_map(field):
	"""value (lower-cased if text) -> Gig Worker name, for identity fields used to
	detect that an imported row belongs to a person who already has a Gig Worker
	record (possibly onboarded by a different aggregator)."""
	if field not in _ALLOWED_EXISTING_MAP_FIELDS:
		frappe.throw(f"Invalid field for identity lookup: {field}")
	rows = frappe.db.sql(
		f"SELECT `{field}`, `name` FROM `tabGig Worker` WHERE `{field}` IS NOT NULL", as_list=True
	)
	return {
		(value.strip().lower() if isinstance(value, str) else value): gw_name
		for value, gw_name in rows if value
	}


def _get_existing_wpm_state():
	"""Current Worker Partner Mapping state, keyed by Gig Worker:
	- parent_names: Gig Workers that already have a mapping parent record
	- agg_by_parent: gig_worker_id -> set of aggregators already mapped to it
	- next_idx: gig_worker_id -> highest child row idx used so far (for appending)
	"""
	parent_names = set(frappe.db.sql_list("SELECT name FROM `tabWorker Partner Mapping`"))

	rows = frappe.db.sql(
		"SELECT parent, aggregator, idx FROM `tabWorker Aggregator Detail` "
		"WHERE parenttype = 'Worker Partner Mapping'",
		as_list=True,
	)
	agg_by_parent = {}
	next_idx = {}
	for parent, aggregator, row_idx in rows:
		if aggregator:
			agg_by_parent.setdefault(parent, set()).add(aggregator)
		next_idx[parent] = max(next_idx.get(parent, 0), row_idx or 0)

	return parent_names, agg_by_parent, next_idx


def _get_aggregator_names():
	"""Aggregator name -> aggregator_name (display label), for populating the
	child table's display field directly since bulk_insert skips fetch_from."""
	rows = frappe.db.sql("SELECT `name`, `aggregator_name` FROM `tabAggregator`", as_list=True)
	return dict(rows)


def _find_matching_worker(pan, dl_number, aadhaar, eshram, pan_map, dl_map, aadhaar_map, eshram_map):
	"""Match this row against an existing Gig Worker by identity proof, in priority
	order PAN > Driving Licence > Aadhaar > eShram ID. Returns (gig_worker_name, conflict)
	— conflict is True when different proofs on the same row point to different
	existing workers, which needs manual review rather than a silent merge."""
	candidates = []
	if pan and pan.lower() in pan_map:
		candidates.append(pan_map[pan.lower()])
	if dl_number and dl_number.lower() in dl_map:
		candidates.append(dl_map[dl_number.lower()])
	if aadhaar and aadhaar in aadhaar_map:
		candidates.append(aadhaar_map[aadhaar])
	if eshram and eshram.lower() in eshram_map:
		candidates.append(eshram_map[eshram.lower()])

	if not candidates:
		return None, False
	if len(set(candidates)) > 1:
		return None, True
	return candidates[0], False


def _update_progress(import_id, **kwargs):
	_shared_update_progress(CACHE_KEY, import_id, **kwargs)


def _is_cancelled(import_id):
	return _shared_is_cancelled(CACHE_KEY, import_id)
