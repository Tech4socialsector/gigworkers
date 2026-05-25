import frappe
from frappe import _


@frappe.whitelist()
def get_import_template():
	"""Return CSV template as a downloadable response."""
	headers = [
		"worker_name",
		"email",
		"phone",
		"dob",
		"gender",
		"aadhaar_number",
		"pan_number",
		"eshram_id",
		"drivers_license",
		"location_of_work",
		"operating_bank_account",
		"uan",
		"name_of_aggregator",
		"name_of_service",
		"created_by_aggregator",
	]
	sample = [
		"Ravi Kumar",
		"ravi@example.com",
		"9876543210",
		"1995-06-15",
		"Male",
		"123456789012",
		"ABCDE1234F",
		"UW-123456789012",
		"KA1234567890123",
		"Bengaluru",
		"1234567890",
		"100234567890",
		"",
		"",
		"",
	]
	csv_content = ",".join(headers) + "\n" + ",".join(sample) + "\n"

	frappe.response["filename"] = "gig_worker_import_template.csv"
	frappe.response["filecontent"] = csv_content.encode("utf-8")
	frappe.response["type"] = "download"
	frappe.response["content_type"] = "text/csv"


@frappe.whitelist()
def start_import(file_url, skip_duplicates=1, skip_email=1, created_by_aggregator=None):
	"""Enqueue a background job to process the uploaded CSV/XLSX file."""
	frappe.only_for("System Manager")

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
		skip_duplicates=int(skip_duplicates),
		skip_email=int(skip_email),
		created_by_aggregator=created_by_aggregator,
		user=frappe.session.user,
	)

	return {"import_id": import_id}


@frappe.whitelist()
def get_import_progress(import_id):
	"""Return current progress of a running import job."""
	raw = frappe.cache().hget("gw_bulk_import", import_id)
	if not raw:
		frappe.throw(_("Import job not found. It may have expired."))
	return frappe.parse_json(raw)


@frappe.whitelist()
def cancel_import(import_id):
	"""Signal the background job to stop after the current batch."""
	frappe.only_for("System Manager")
	raw = frappe.cache().hget("gw_bulk_import", import_id)
	if not raw:
		frappe.throw(_("Import job not found."))
	data = frappe.parse_json(raw)
	data["cancel_requested"] = True
	frappe.cache().hset("gw_bulk_import", import_id, frappe.as_json(data))
	return {"message": "Cancel signal sent."}


@frappe.whitelist()
def get_import_logs():
	"""Return the 20 most recent import log records for the history table."""
	frappe.only_for("System Manager")
	logs = frappe.get_all(
		"Gig Worker Import Log",
		fields=[
			"name", "import_id", "import_date", "file_name",
			"status", "total_rows", "inserted", "skipped",
			"error_count", "imported_by",
		],
		order_by="import_date desc",
		limit=5,
	)
	return logs
