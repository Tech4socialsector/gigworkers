"""
Bulk Gig Worker Import — background job that processes CSV/XLSX files
and inserts records in batches of 500 using frappe.db.bulk_insert,
bypassing slow per-document hooks (email, PDF, user creation).
"""

import csv
import re
from datetime import datetime

import frappe
from frappe.model.naming import make_autoname
from frappe.utils import now_datetime, getdate, date_diff, today


BATCH_SIZE = 500
CACHE_KEY = "gw_bulk_import"

# Fields the import sets automatically — exclude from CSV required check
# even if the doctype marks them reqd.
_GW_IMPORT_COMPUTED = {"status"}


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
		rows = _parse_file(file_url)
	except Exception as e:
		errors = [f"File parse error: {e}"]
		_update_progress(import_id, status="Failed", errors=errors)
		_save_import_log(
			import_id=import_id, file_url=file_url, file_name=file_name,
			status="Failed", total=0, inserted=0, skipped=0, error_count=1,
			created_by_aggregator=created_by_aggregator, user=user, errors=errors,
		)
		return

	total = len(rows)
	_update_progress(import_id, total=total)

	existing_emails  = _get_existing_set("email")          if skip_duplicates else set()
	existing_phones  = _get_existing_set("phone")          if skip_duplicates else set()
	existing_aadhaar = _get_existing_set("aadhaar_number") if skip_duplicates else set()
	existing_pan     = _get_existing_set("pan_number")     if skip_duplicates else set()
	existing_eshram  = _get_existing_set("eshram_id")      if skip_duplicates else set()

	processed = 0
	inserted  = 0
	skipped   = 0
	all_errors = []

	now_ts    = now_datetime()
	batch     = []
	user_batch = []   # [(gw_id, phone, email, worker_name)]

	for idx, row in enumerate(rows, start=1):
		# Check cancel signal at each batch boundary
		if idx % BATCH_SIZE == 0:
			if _is_cancelled(import_id):
				if batch:
					_flush_batch(batch)
					inserted += len(batch)
					_create_users_batch(user_batch, now_ts, user)
					batch = []; user_batch = []
					frappe.db.commit()
				_update_progress(import_id, status="Cancelled",
								processed=processed, inserted=inserted,
								skipped=skipped, errors=all_errors[-200:])
				_save_import_log(
					import_id=import_id, file_url=file_url, file_name=file_name,
					status="Cancelled", total=total, inserted=inserted,
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

		# Normalise fields
		email   = row.get("email", "").strip().lower()
		phone   = re.sub(r"\s+", "", row.get("phone", ""))
		aadhaar = row.get("aadhaar_number", "").replace(" ", "")
		pan     = row.get("pan_number", "").strip().upper() if row.get("pan_number") else None
		eshram  = row.get("eshram_id", "").strip().upper()  if row.get("eshram_id")  else None

		# Duplicate check (DB + within-batch)
		if skip_duplicates:
			if email and email in existing_emails:
				all_errors.append(f"Row {idx}: email '{email}' already exists — skipped.")
				skipped += 1; processed += 1; continue
			if phone and phone in existing_phones:
				all_errors.append(f"Row {idx}: phone '{phone}' already exists — skipped.")
				skipped += 1; processed += 1; continue
			if aadhaar and aadhaar in existing_aadhaar:
				_masked = "XXXX-XXXX-" + aadhaar[-4:]
				all_errors.append(f"Row {idx}: aadhaar '{_masked}' already exists — skipped.")
				skipped += 1; processed += 1; continue
			if pan and pan.lower() in existing_pan:
				all_errors.append(f"Row {idx}: PAN '{pan}' already exists — skipped.")
				skipped += 1; processed += 1; continue
			if eshram and eshram.lower() in existing_eshram:
				all_errors.append(f"Row {idx}: eShram ID '{eshram}' already exists — skipped.")
				skipped += 1; processed += 1; continue

		name        = make_autoname("GW.###", "Gig Worker")
		agg         = created_by_aggregator or row.get("created_by_aggregator") or None
		worker_name = row.get("worker_name", "").strip()

		batch.append((
			name, now_ts, now_ts, user, user, 0,
			worker_name,
			row.get("gender", "").strip(),
			aadhaar, pan, phone,
			_parse_date(row.get("dob")),
			eshram, email,
			row.get("drivers_license", "").strip()         or None,
			row.get("location_of_work", "").strip()        or None,
			row.get("operating_bank_account", "").strip()  or None,
			row.get("uan", "").strip()                     or None,
			row.get("name_of_aggregator", "").strip()      or agg or None,
			row.get("name_of_service", "").strip()         or None,
			agg, "Active",
		))
		user_batch.append((name, phone, email, worker_name))

		if skip_duplicates:
			if email:   existing_emails.add(email)
			if phone:   existing_phones.add(phone)
			if aadhaar: existing_aadhaar.add(aadhaar)
			if pan:     existing_pan.add(pan)
			if eshram:  existing_eshram.add(eshram)

		processed += 1

		if len(batch) >= BATCH_SIZE:
			_flush_batch(batch)
			inserted += len(batch)
			_create_users_batch(user_batch, now_ts, user)
			batch = []; user_batch = []
			_update_progress(import_id, processed=processed, inserted=inserted,
							skipped=skipped, errors=all_errors[-50:])
			frappe.db.commit()

	# Flush remaining rows
	if batch:
		_flush_batch(batch)
		inserted += len(batch)
		_create_users_batch(user_batch, now_ts, user)
		frappe.db.commit()

	_update_progress(import_id, status="Completed", total=total,
					processed=processed, inserted=inserted,
					skipped=skipped, errors=all_errors[-200:])

	_save_import_log(
		import_id=import_id, file_url=file_url, file_name=file_name,
		status="Completed", total=total, inserted=inserted,
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
						skipped, error_count, created_by_aggregator, user, errors):
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
		"worker_name", "gender", "aadhaar_number", "pan_number", "phone", "dob",
		"eshram_id", "email", "drivers_license", "location_of_work",
		"operating_bank_account", "uan", "name_of_aggregator", "name_of_service",
		"created_by_aggregator", "status",
	]
	frappe.db.bulk_insert("Gig Worker", fields=fields, values=batch, ignore_duplicates=True)


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
                update_password(login_email, phone)
            except Exception:
                pass  # non-fatal — user exists, password can be reset later


def _parse_file(file_url):
	file_doc  = frappe.get_doc("File", {"file_url": file_url})
	file_path = file_doc.get_full_path()
	if file_path.endswith(".xlsx") or file_path.endswith(".xls"):
		return _parse_excel(file_path)
	return _parse_csv(file_path)


def _parse_csv(file_path):
	with open(file_path, "r", encoding="utf-8-sig") as f:
		reader = csv.DictReader(f)
		return [_clean_row(row) for row in reader if any(row.values())]


def _parse_excel(file_path):
	try:
		import openpyxl
	except ImportError:
		frappe.throw("openpyxl is required for XLSX import. Use CSV format instead.")
	wb  = openpyxl.load_workbook(file_path, read_only=True, data_only=True)
	ws  = wb.active
	rows = list(ws.iter_rows(values_only=True))
	if not rows:
		return []
	headers = [str(h).strip() if h else "" for h in rows[0]]
	return [_clean_row(dict(zip(headers, r))) for r in rows[1:] if any(r)]


def _clean_row(row):
	return {k.strip(): (str(v).strip() if v is not None else "") for k, v in row.items()}


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


def _get_existing_set(field):
	rows = frappe.db.sql(
		f"SELECT `{field}` FROM `tabGig Worker` WHERE `{field}` IS NOT NULL", as_list=True
	)
	return {r[0].strip().lower() if isinstance(r[0], str) else r[0] for r in rows if r[0]}


def _update_progress(import_id, **kwargs):
	raw  = frappe.cache().hget(CACHE_KEY, import_id) or "{}"
	data = frappe.parse_json(raw)
	data.update(kwargs)
	frappe.cache().hset(CACHE_KEY, import_id, frappe.as_json(data))


def _is_cancelled(import_id):
	raw = frappe.cache().hget(CACHE_KEY, import_id) or "{}"
	return frappe.parse_json(raw).get("cancel_requested", False)
