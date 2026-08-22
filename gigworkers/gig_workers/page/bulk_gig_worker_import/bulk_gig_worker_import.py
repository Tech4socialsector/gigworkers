import frappe
from frappe import _


# Fields the user may choose to include in the CSV template, in display order.
# (fieldname, label, sample value)
IMPORTABLE_FIELDS = [
	("worker_name", "Name", "Ravi Kumar"),
	("partner_id", "Partner ID", "PTR-001"),
	("phone", "Phone", "9876543210"),
	("email", "Email", "ravi@example.com"),
	("dob", "Date of Birth", "1995-06-15"),
	("gender", "Gender", "Male"),
	("pan_number", "PAN Number", "ABCDE1234F"),
	("eshram_id", "eShram ID", "UW-123456789012"),
	("drivers_license", "Drivers License", "KA1234567890123"),
	("location_of_work", "Location of work", "Bengaluru"),
	("operating_bank_account", "Operating Bank account", "1234567890"),
	("uan", "UAN", "100234567890"),
	("aadhaar_number", "Aadhaar Number", "123456789012"),
	("name_of_aggregator", "Name of aggregator", ""),
	("name_of_service", "Name of Service", ""),
]

# Columns included in the template when the user hasn't customised the field list
DEFAULT_FIELDS = [
	"worker_name", "partner_id", "phone", "email", "dob", "gender",
	"pan_number", "eshram_id", "drivers_license", "location_of_work",
	"operating_bank_account", "uan",
]

# Fields that are always mandatory for import, regardless of Gig Worker Unique ID Settings.
_ALWAYS_REQUIRED_IMPORT_FIELDS = {"worker_name", "partner_id"}

# Maps a Gig Worker fieldname (as returned by get_required_gig_worker_fields) to the
# CSV import column that supplies it, where the two names differ.
_ID_PROOF_IMPORT_FIELD_ALIASES = {"drivers_license_number": "drivers_license"}


def _get_effective_required_fields():
	"""Fields that must be present in the import: the always-required ones, plus
	whichever ID proof columns Gig Worker Unique ID Settings currently requires."""
	from gigworkers.gig_workers.doctype.gig_worker_unique_id_settings.gig_worker_unique_id_settings import (
		get_required_gig_worker_fields,
	)

	dynamic_required = {
		_ID_PROOF_IMPORT_FIELD_ALIASES.get(f, f) for f in get_required_gig_worker_fields()
	}
	return _ALWAYS_REQUIRED_IMPORT_FIELDS | dynamic_required


@frappe.whitelist()
def get_importable_fields():
	"""Return the list of fields the user can choose from for the CSV template."""
	required = _get_effective_required_fields()
	return [
		{"fieldname": f, "label": label, "reqd": f in required}
		for f, label, _sample in IMPORTABLE_FIELDS
	]


@frappe.whitelist()
def get_import_template(fields=None):
	"""Return CSV template as a downloadable response.

	`fields` is an optional JSON-encoded list of fieldnames chosen by the
	user in the "Choose Fields" popup. Required fields are always included
	even if the caller omits them.
	"""
	catalog = {f: (label, sample) for f, label, sample in IMPORTABLE_FIELDS}
	required = _get_effective_required_fields()

	if fields:
		selected = frappe.parse_json(fields) if isinstance(fields, str) else fields
		selected = [f for f in selected if f in catalog]
	else:
		selected = list(DEFAULT_FIELDS)

	for f in required:
		if f not in selected and f in catalog:
			selected.append(f)

	# Keep catalog order regardless of how the selection was passed in
	headers = [f for f, *_ in IMPORTABLE_FIELDS if f in selected]
	sample = [catalog[f][1] for f in headers]

	csv_content = ",".join(headers) + "\n" + ",".join(sample) + "\n"

	frappe.response["filename"] = "gig_worker_import_template.csv"
	frappe.response["filecontent"] = csv_content.encode("utf-8")
	frappe.response["type"] = "download"
	frappe.response["content_type"] = "text/csv"


@frappe.whitelist()
def start_import(file_url, created_by_aggregator=None):
	"""Enqueue a background job to process the uploaded CSV/XLSX file."""
	frappe.only_for(["System Manager", "Aggregator"])

	# For Aggregator users, always resolve their own aggregator record —
	# never trust UI input, so their workers are always visible to them.
	if "System Manager" not in frappe.get_roles():
		own_agg = frappe.db.get_value("Aggregator", {"email": frappe.session.user}, "name")
		if own_agg:
			created_by_aggregator = own_agg

	import_id = frappe.generate_hash(length=12)

	frappe.cache().hset("gw_bulk_import", import_id, frappe.as_json({
		"status": "Queued",
		"total": 0,
		"processed": 0,
		"inserted": 0,
		"skipped": 0,
		"errors": [],
		"started_by": frappe.session.user,
		"file_url": file_url,
	}))

	frappe.enqueue(
		"gigworkers.gig_workers.utils.bulk_import.process_gig_worker_import",
		queue="long",
		timeout=18000,
		import_id=import_id,
		file_url=file_url,
		skip_duplicates=1,
		skip_email=1,
		created_by_aggregator=created_by_aggregator,
		user=frappe.session.user,
	)

	return {"import_id": import_id}


@frappe.whitelist()
def get_import_progress(import_id):
	"""Return current progress of a running import job."""
	frappe.only_for(["System Manager", "Aggregator"])
	raw = frappe.cache().hget("gw_bulk_import", import_id)
	if not raw:
		frappe.throw(_("Import job not found. It may have expired."))
	data = frappe.parse_json(raw)
	if "System Manager" not in frappe.get_roles() and data.get("started_by") != frappe.session.user:
		frappe.throw(_("Not permitted to access this import job."), frappe.PermissionError)
	return data


@frappe.whitelist()
def cancel_import(import_id):
	"""Signal the background job to stop after the current batch."""
	frappe.only_for(["System Manager", "Aggregator"])
	raw = frappe.cache().hget("gw_bulk_import", import_id)
	if not raw:
		frappe.throw(_("Import job not found."))
	data = frappe.parse_json(raw)
	data["cancel_requested"] = True
	frappe.cache().hset("gw_bulk_import", import_id, frappe.as_json(data))
	return {"message": "Cancel signal sent."}


@frappe.whitelist()
def get_log_detail(log_name):
	"""Return full details of a single import log record."""
	frappe.only_for(["System Manager", "Aggregator"])
	doc = frappe.get_doc("Gig Worker Import Log", log_name)

	if "System Manager" not in frappe.get_roles() and doc.imported_by != frappe.session.user:
		frappe.throw(_("You are not permitted to view this import log."), frappe.PermissionError)

	return {
		"name": doc.name,
		"import_id": doc.import_id,
		"status": doc.status,
		"import_date": doc.import_date,
		"file_name": doc.file_name,
		"imported_by": doc.imported_by,
		"total_rows": doc.total_rows,
		"inserted": doc.inserted,
		"skipped": doc.skipped,
		"error_count": doc.error_count,
		"error_log": doc.error_log or "",
	}


@frappe.whitelist()
def get_import_logs(limit=10, offset=0):
	"""Return paginated import log records for the history table.

	Only System Manager can see everyone's logs — other users only see
	the imports they themselves ran.
	"""
	frappe.only_for(["System Manager", "Aggregator"])

	filters = {}
	if "System Manager" not in frappe.get_roles():
		filters["imported_by"] = frappe.session.user

	logs = frappe.get_all(
		"Gig Worker Import Log",
		filters=filters,
		fields=[
			"name", "import_id", "import_date", "file_name",
			"status", "total_rows", "inserted", "skipped",
			"error_count", "imported_by",
		],
		order_by="import_date desc",
		limit=int(limit),
		start=int(offset),
	)
	total = frappe.db.count("Gig Worker Import Log", filters=filters)
	return {"logs": logs, "total": total}
