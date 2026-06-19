import frappe
from frappe import _


@frappe.whitelist()
def get_import_template():
	headers = [
		"gig_worker", "aggregator", "service",
		"amount", "base_payout", "deduction", "incentives",
		"date", "status_of_order",
	]
	sample = [
		"GW001", "AG001", "SE001",
		"500.00", "450.00", "0.00", "0.00",
		"2026-05-25", "Order delivered",
	]
	csv_content = ",".join(headers) + "\n" + ",".join(sample) + "\n"

	frappe.response["filename"] = "gig_transaction_import_template.csv"
	frappe.response["filecontent"] = csv_content.encode("utf-8")
	frappe.response["type"] = "download"
	frappe.response["content_type"] = "text/csv"


@frappe.whitelist()
def start_import(file_url, default_aggregator=None):
	frappe.only_for(["System Manager", "Aggregator"])

	if "System Manager" not in frappe.get_roles():
		own_agg = frappe.db.get_value("Aggregator", {"email": frappe.session.user}, "name")
		if own_agg:
			default_aggregator = own_agg

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
		skip_duplicates=0,
		default_aggregator=default_aggregator,
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
	frappe.only_for(["System Manager", "Aggregator"])
	raw = frappe.cache().hget("gt_bulk_import", import_id)
	if not raw:
		frappe.throw(_("Import job not found."))
	data = frappe.parse_json(raw)
	data["cancel_requested"] = True
	frappe.cache().hset("gt_bulk_import", import_id, frappe.as_json(data))
	return {"message": "Cancel signal sent."}


@frappe.whitelist()
def get_log_detail(log_name):
	"""Return full details of a single import log record."""
	frappe.only_for(["System Manager", "Aggregator"])
	doc = frappe.get_doc("Gig Transaction Import Log", log_name)
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
	frappe.only_for(["System Manager", "Aggregator"])
	logs = frappe.get_all(
		"Gig Transaction Import Log",
		fields=[
			"name", "import_id", "import_date", "file_name",
			"status", "total_rows", "inserted", "skipped",
			"error_count", "imported_by",
		],
		order_by="import_date desc",
		limit=int(limit),
		start=int(offset),
	)
	total = frappe.db.count("Gig Transaction Import Log")
	return {"logs": logs, "total": total}
