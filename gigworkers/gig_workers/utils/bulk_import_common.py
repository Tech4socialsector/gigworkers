"""
Shared file-parsing and progress-cache helpers for the Gig Worker and Gig
Transaction bulk import flows. Extracted from bulk_import.py /
bulk_transaction_import.py, which previously carried byte-for-byte copies
of these functions.
"""

import csv

import frappe

MAX_IMPORT_FILE_SIZE_BYTES = 50 * 1024 * 1024  # 50 MB
ALLOWED_IMPORT_EXTENSIONS = (".csv", ".xlsx", ".xls")


def resolve_import_file(file_url, user=None):
	"""Resolve file_url to a File document the caller is actually allowed to use.

	Validates that the File belongs to the given user (or that the user is a
	System Manager), and that its extension and size are within the allowed
	bounds, before any parsing is attempted. Raises frappe.PermissionError /
	frappe.ValidationError on failure.
	"""
	user = user or frappe.session.user
	file_doc = frappe.get_doc("File", {"file_url": file_url})
	file_doc.check_permission("read")

	if file_doc.owner != user and "System Manager" not in frappe.get_roles(user):
		frappe.throw(
			"You are not permitted to import this file.",
			frappe.PermissionError,
		)

	file_path = file_doc.get_full_path()
	lower_path = file_path.lower()
	if not lower_path.endswith(ALLOWED_IMPORT_EXTENSIONS):
		frappe.throw(
			f"Unsupported file type. Allowed formats: {', '.join(ALLOWED_IMPORT_EXTENSIONS)}."
		)

	if file_doc.file_size and file_doc.file_size > MAX_IMPORT_FILE_SIZE_BYTES:
		frappe.throw(
			f"File is too large ({file_doc.file_size // (1024*1024)} MB). "
			f"Maximum allowed size is {MAX_IMPORT_FILE_SIZE_BYTES // (1024*1024)} MB."
		)

	return file_doc


def parse_file(file_url, user=None):
	file_doc = resolve_import_file(file_url, user=user)
	file_path = file_doc.get_full_path()
	if file_path.lower().endswith((".xlsx", ".xls")):
		return parse_excel(file_path)
	return parse_csv(file_path)


def parse_csv(file_path):
	with open(file_path, "r", encoding="utf-8-sig") as f:
		reader = csv.DictReader(f)
		return [clean_row(row) for row in reader if any(row.values())]


def parse_excel(file_path):
	try:
		import openpyxl
	except ImportError:
		frappe.throw("openpyxl is required for XLSX import. Use CSV format instead.")
	wb = openpyxl.load_workbook(file_path, read_only=True, data_only=True)
	ws = wb.active
	rows = list(ws.iter_rows(values_only=True))
	if not rows:
		return []
	headers = [str(h).strip() if h else "" for h in rows[0]]
	return [clean_row(dict(zip(headers, r))) for r in rows[1:] if any(r)]


def clean_row(row):
	return {k.strip(): (str(v).strip() if v is not None else "") for k, v in row.items()}


def update_progress(cache_key, import_id, **kwargs):
	raw = frappe.cache().hget(cache_key, import_id) or "{}"
	data = frappe.parse_json(raw)
	data.update(kwargs)
	frappe.cache().hset(cache_key, import_id, frappe.as_json(data))


def is_cancelled(cache_key, import_id):
	raw = frappe.cache().hget(cache_key, import_id) or "{}"
	return frappe.parse_json(raw).get("cancel_requested", False)
