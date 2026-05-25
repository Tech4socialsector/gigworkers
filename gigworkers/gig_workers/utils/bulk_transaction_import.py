"""
Bulk Gig Transaction Import — processes CSV/XLSX in batches of 500
using frappe.db.bulk_insert, bypassing per-document hooks
(OTP emails, welfare payment creation, duplicate notifications).
"""

import csv
import re
from datetime import datetime

import frappe
from frappe.utils import now_datetime, getdate, today


BATCH_SIZE = 500
CACHE_KEY  = "gt_bulk_import"

# Fields the import computes automatically — exclude from CSV required check
# even if the doctype marks them reqd.
_GT_IMPORT_COMPUTED = {"status", "service_category", "transaction_date",
                       "incentives", "deduction", "status_of_order"}

VALID_TRUST        = {"High", "Low"}
VALID_STATUS_ORDER = {"", "Order delivered", "Order cancelled"}


def _get_required_fields(default_aggregator=None):
    """Read mandatory fields from the Gig Transaction doctype meta at runtime."""
    meta = frappe.get_meta("Gig Transaction")
    fields = {f.fieldname for f in meta.fields if f.reqd} - _GT_IMPORT_COMPUTED
    # aggregator is required unless a default is provided
    if default_aggregator:
        fields.discard("aggregator")
    return fields


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def process_gig_transaction_import(import_id, file_url, skip_duplicates=1,
									default_aggregator=None, default_trust_level="High",
									user="Administrator"):
	frappe.set_user(user)
	_update_progress(import_id, status="Running")

	file_name = frappe.db.get_value("File", {"file_url": file_url}, "file_name") or file_url.split("/")[-1]

	try:
		rows = _parse_file(file_url)
	except Exception as e:
		errors = [f"File parse error: {e}"]
		_update_progress(import_id, status="Failed", errors=errors)
		_save_log(import_id, file_url, file_name, "Failed", 0, 0, 0, 0,
				default_aggregator, user, errors)
		return

	total = len(rows)
	_update_progress(import_id, total=total)

	# Pre-load lookup tables once to avoid per-row DB queries
	valid_workers    = _get_set("Gig Worker", "name")
	valid_aggregators = _get_set("Aggregator", "name")
	valid_services   = _get_set("Service", "name")
	service_data     = _load_service_data()        # {service_name: {category, type, pct, cap}}

	existing_ext_ids = _get_existing_set("external_transaction_id") if skip_duplicates else set()
	existing_dup_keys = _get_existing_set("duplicate_key") if skip_duplicates else set()

	processed = inserted = skipped = 0
	all_errors = []
	now_ts = now_datetime()
	batch  = []

	for idx, row in enumerate(rows, start=1):
		if idx % BATCH_SIZE == 0:
			if _is_cancelled(import_id):
				if batch:
					_flush_batch(batch); inserted += len(batch); batch = []; frappe.db.commit()
				_update_progress(import_id, status="Cancelled",
								processed=processed, inserted=inserted,
								skipped=skipped, errors=all_errors[-200:])
				_save_log(import_id, file_url, file_name, "Cancelled", total, inserted,
						skipped, len(all_errors), default_aggregator, user, all_errors)
				frappe.publish_realtime(
					"gt_bulk_import_done",
					{"import_id": import_id, "total": total,
					 "inserted": inserted, "skipped": skipped, "status": "Cancelled"},
					user=user,
				)
				return

		errs = _validate_row(row, idx, valid_workers, valid_aggregators,
							valid_services, default_aggregator, default_trust_level)
		if errs:
			all_errors.extend(errs)
			skipped += 1; processed += 1; continue

		gig_worker  = row.get("gig_worker", "").strip() or ""
		aggregator  = row.get("aggregator", "").strip() or default_aggregator or ""
		service     = row.get("service", "").strip()
		amount      = _to_float(row.get("amount"))
		base_payout = _to_float(row.get("base_payout"))
		incentives  = _to_float(row.get("incentives", 0))
		deduction   = _to_float(row.get("deduction", 0))
		date        = _parse_date(row.get("date", ""))
		trust_level = (row.get("trust_level") or default_trust_level or "High").strip()
		ext_id      = row.get("external_transaction_id", "").strip() or None
		role        = row.get("role", "").strip() or None
		status_order = row.get("status_of_order", "").strip() or None

		# Duplicate check
		if skip_duplicates and ext_id and ext_id in existing_ext_ids:
			all_errors.append(f"Row {idx}: external_transaction_id '{ext_id}' already exists — skipped.")
			skipped += 1; processed += 1; continue

		# Compute welfare from pre-loaded service data
		svc = service_data.get(service, {})
		svc_category   = svc.get("category_name") or svc.get("category") or None
		svc_type       = svc.get("vehicle_type_name") or svc.get("vehicle_type") or None
		welfare_pct    = svc.get("welfare_percentage_") or 0.0
		welfare_cap    = svc.get("welfare_cap") or None
		welfare_amount = 0.0
		if welfare_pct and base_payout:
			raw_welfare = (base_payout * welfare_pct) / 100
			welfare_amount = min(raw_welfare, welfare_cap) if welfare_cap else raw_welfare
			welfare_amount = max(welfare_amount, 0.0)

		net_payout = base_payout + incentives - deduction

		dup_key = f"{gig_worker} | {aggregator} | {svc_category or service} | {date} | {amount}"

		if skip_duplicates and dup_key in existing_dup_keys:
			all_errors.append(f"Row {idx}: duplicate transaction (same worker/aggregator/service/date/amount) — skipped.")
			skipped += 1; processed += 1; continue

		# Generate unique name matching the doctype's Format pattern
		name = f"{gig_worker}:{aggregator}:{date}:{frappe.generate_hash(length=6).upper()}"

		status = "Payment complete" if trust_level == "High" else "Payment pending"

		batch.append((
			name, now_ts, now_ts, user, user, 0,
			name,           # transaction_id = name
			gig_worker, aggregator, service,
			svc_category, svc_type,
			amount, base_payout, incentives, deduction,
			welfare_pct, welfare_amount, welfare_cap,
			net_payout,
			date, date,     # date + transaction_date
			trust_level, status,
			ext_id, dup_key,
			role, status_order,
		))

		if skip_duplicates:
			if ext_id: existing_ext_ids.add(ext_id)
			existing_dup_keys.add(dup_key)

		processed += 1

		if len(batch) >= BATCH_SIZE:
			_flush_batch(batch)
			inserted += len(batch)
			batch = []
			_update_progress(import_id, processed=processed, inserted=inserted,
							skipped=skipped, errors=all_errors[-50:])
			frappe.db.commit()

	if batch:
		_flush_batch(batch)
		inserted += len(batch)
		frappe.db.commit()

	_update_progress(import_id, status="Completed", total=total,
					processed=processed, inserted=inserted,
					skipped=skipped, errors=all_errors[-200:])

	_save_log(import_id, file_url, file_name, "Completed", total, inserted,
			skipped, len(all_errors), default_aggregator, user, all_errors)

	frappe.publish_realtime(
		"gt_bulk_import_done",
		{"import_id": import_id, "total": total,
		 "inserted": inserted, "skipped": skipped, "status": "Completed"},
		user=user,
	)


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def _flush_batch(batch):
	fields = [
		"name", "creation", "modified", "modified_by", "owner", "docstatus",
		"transaction_id",
		"gig_worker", "aggregator", "service",
		"service_category", "service_type",
		"amount", "base_payout", "incentives", "deduction",
		"welfare_percentage", "welfare_amount", "welfare_cap",
		"net_payout_to_worker",
		"date", "transaction_date",
		"trust_level", "status",
		"external_transaction_id", "duplicate_key",
		"role", "status_of_order",
	]
	frappe.db.bulk_insert("Gig Transaction", fields=fields, values=batch, ignore_duplicates=True)


def _save_log(import_id, file_url, file_name, status, total, inserted,
				skipped, error_count, default_aggregator, user, errors):
	try:
		frappe.get_doc({
			"doctype": "Gig Transaction Import Log",
			"import_id": import_id,
			"import_date": now_datetime(),
			"file_name": file_name,
			"file_url": file_url,
			"status": status,
			"total_rows": total,
			"inserted": inserted,
			"skipped": skipped,
			"error_count": error_count,
			"default_aggregator": default_aggregator,
			"imported_by": user,
			"error_log": "\n".join(errors) if errors else "",
		}).insert(ignore_permissions=True)
		frappe.db.commit()
	except Exception:
		frappe.log_error(frappe.get_traceback(), "Gig Transaction Import Log: save failed")


def _get_set(doctype, field):
	rows = frappe.db.sql(f"SELECT `{field}` FROM `tab{doctype}` WHERE `{field}` IS NOT NULL", as_list=True)
	return {r[0] for r in rows if r[0]}


def _get_existing_set(field):
	rows = frappe.db.sql(
		f"SELECT `{field}` FROM `tabGig Transaction` WHERE `{field}` IS NOT NULL", as_list=True
	)
	return {r[0] for r in rows if r[0]}


def _load_service_data():
	rows = frappe.db.sql("""
		SELECT s.name, s.category, s.vehicle_type,
		       s.welfare_percentage_, s.welfare_cap,
		       sc.category_name, vt.vehicle_type AS vehicle_type_name
		FROM `tabService` s
		LEFT JOIN `tabService Category` sc ON sc.name = s.category
		LEFT JOIN `tabVehicle Type` vt ON vt.name = s.vehicle_type
	""", as_dict=True)
	return {r.name: r for r in rows}


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def _validate_row(row, idx, valid_workers, valid_aggregators,
				valid_services, default_aggregator, default_trust_level):
	errors = []

	for field in _get_required_fields(default_aggregator):
		val = row.get(field, "").strip()
		if not val:
			errors.append(f"Row {idx}: missing required field '{field}'.")

	if errors:
		return errors

	gig_worker = row.get("gig_worker", "").strip()
	if gig_worker and gig_worker not in valid_workers:
		errors.append(f"Row {idx}: Gig Worker '{gig_worker}' not found.")

	aggregator = row.get("aggregator", "").strip() or default_aggregator or ""
	if aggregator and aggregator not in valid_aggregators:
		errors.append(f"Row {idx}: Aggregator '{aggregator}' not found.")

	service = row.get("service", "").strip()
	if service and service not in valid_services:
		errors.append(f"Row {idx}: Service '{service}' not found.")

	try:
		bp = float(row.get("base_payout", 0))
		if bp <= 0:
			errors.append(f"Row {idx}: base_payout must be greater than zero.")
	except (ValueError, TypeError):
		errors.append(f"Row {idx}: base_payout is not a valid number.")

	try:
		float(row.get("amount", 0))
	except (ValueError, TypeError):
		errors.append(f"Row {idx}: amount is not a valid number.")

	date_str = row.get("date", "").strip()
	parsed = _parse_date(date_str)
	if not parsed:
		errors.append(f"Row {idx}: invalid date '{date_str}'. Use YYYY-MM-DD.")
	elif getdate(parsed) > getdate(today()):
		errors.append(f"Row {idx}: date cannot be in the future.")

	trust = (row.get("trust_level") or default_trust_level or "High").strip()
	if trust not in VALID_TRUST:
		errors.append(f"Row {idx}: trust_level must be 'High' or 'Low'.")

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


def _to_float(val):
	try:
		return float(val or 0)
	except (ValueError, TypeError):
		return 0.0


# ---------------------------------------------------------------------------
# Cache helpers
# ---------------------------------------------------------------------------

def _update_progress(import_id, **kwargs):
	raw  = frappe.cache().hget(CACHE_KEY, import_id) or "{}"
	data = frappe.parse_json(raw)
	data.update(kwargs)
	frappe.cache().hset(CACHE_KEY, import_id, frappe.as_json(data))


def _is_cancelled(import_id):
	raw = frappe.cache().hget(CACHE_KEY, import_id) or "{}"
	return frappe.parse_json(raw).get("cancel_requested", False)


# ---------------------------------------------------------------------------
# File parsing (shared with gig worker import)
# ---------------------------------------------------------------------------

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
	wb   = openpyxl.load_workbook(file_path, read_only=True, data_only=True)
	ws   = wb.active
	rows = list(ws.iter_rows(values_only=True))
	if not rows:
		return []
	headers = [str(h).strip() if h else "" for h in rows[0]]
	return [_clean_row(dict(zip(headers, r))) for r in rows[1:] if any(r)]


def _clean_row(row):
	return {k.strip(): (str(v).strip() if v is not None else "") for k, v in row.items()}
