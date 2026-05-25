import frappe
from frappe import _


@frappe.whitelist()
def get_import_template():
	headers = [
		"gig_worker", "aggregator", "service",
		"amount", "base_payout", "date",
		"trust_level", "external_transaction_id",
		"incentives", "deduction", "role", "status_of_order",
	]
	sample = [
		"GW001", "AGG-001", "SVC-001",
		"500.00", "450.00", "2026-05-25",
		"High", "EXT-TXN-001",
		"50.00", "0.00", "Driver", "Order delivered",
	]
	csv_content = ",".join(headers) + "\n" + ",".join(sample) + "\n"

	frappe.response["filename"] = "gig_transaction_import_template.csv"
	frappe.response["filecontent"] = csv_content.encode("utf-8")
	frappe.response["type"] = "download"
	frappe.response["content_type"] = "text/csv"


@frappe.whitelist()
def start_import(file_url, skip_duplicates=1, default_aggregator=None, default_trust_level="High"):
	frappe.only_for("System Manager")

	import_id = frappe.generate_hash(length=12)

	frappe.cache().hset("gt_bulk_import", import_id, frappe.as_json({
		"status": "Queued",
		"total": 0, "processed": 0, "inserted": 0, "skipped": 0,
		"errors": [],
		"started_by": frappe.session.user,
		"file_url": file_url,
	}))

	frappe.enqueue(
		"gigworkers.gig_workers.utils.bulk_transaction_import.process_gig_transaction_import",
		queue="long",
		timeout=18000,
		import_id=import_id,
		file_url=file_url,
		skip_duplicates=int(skip_duplicates),
		default_aggregator=default_aggregator,
		default_trust_level=default_trust_level,
		user=frappe.session.user,
	)

	return {"import_id": import_id}


@frappe.whitelist()
def get_import_progress(import_id):
	raw = frappe.cache().hget("gt_bulk_import", import_id)
	if not raw:
		frappe.throw(_("Import job not found. It may have expired."))
	return frappe.parse_json(raw)


@frappe.whitelist()
def cancel_import(import_id):
	frappe.only_for("System Manager")
	raw = frappe.cache().hget("gt_bulk_import", import_id)
	if not raw:
		frappe.throw(_("Import job not found."))
	data = frappe.parse_json(raw)
	data["cancel_requested"] = True
	frappe.cache().hset("gt_bulk_import", import_id, frappe.as_json(data))
	return {"message": "Cancel signal sent."}


@frappe.whitelist()
def get_import_logs():
	frappe.only_for("System Manager")
	return frappe.get_all(
		"Gig Transaction Import Log",
		fields=[
			"name", "import_id", "import_date", "file_name",
			"status", "total_rows", "inserted", "skipped",
			"error_count", "imported_by",
		],
		order_by="import_date desc",
		limit=5,
	)
