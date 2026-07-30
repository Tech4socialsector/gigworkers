import frappe
from frappe import _


# Fields the user may choose to include in the CSV template, in display order.
# (fieldname, label, sample value, required)
# `gig_worker` is intentionally not offered here — the importer resolves the
# Gig Worker record (and its details) from the `partner_id` column instead.
# `aggregator` is also not marked required here — for Aggregator users it is
# resolved automatically from the uploader's own account (see start_import);
# only a System Manager importing on behalf of multiple aggregators needs to
# tick it and supply it per row.
IMPORTABLE_FIELDS = [
	("partner_id", "Partner ID", "PTR-001", True),
	("amount", "Final Payout Amount", "500.00", True),
	("base_payout", "Base Payout to Worker", "450.00", True),
	("date", "Date", "2026-05-25", True),
	("aggregator", "Aggregator", "AG001", False),
	("service", "Service", "SE001", False),
	("incentives", "Incentives", "0.00", False),
	("deduction", "Deduction", "0.00", False),
	("status_of_order", "Status of Order", "Order delivered", False),
	("role", "Role", "", False),
	("external_transaction_id", "External Transaction ID", "", False),
	("district", "District", "", False),
	("city", "City", "", False),
]

# Columns included in the template when the user hasn't customised the field list
DEFAULT_FIELDS = [
	"partner_id", "aggregator", "service", "amount", "base_payout",
	"deduction", "incentives", "date", "status_of_order",
]


@frappe.whitelist()
def get_importable_fields():
	"""Return the list of fields the user can choose from for the CSV template."""
	return [
		{"fieldname": f, "label": label, "reqd": reqd}
		for f, label, _sample, reqd in IMPORTABLE_FIELDS
	]


@frappe.whitelist()
def get_import_template(fields=None):
	"""Return CSV template as a downloadable response.

	`fields` is an optional JSON-encoded list of fieldnames chosen by the
	user in the "Choose Fields" popup. Required fields are always included
	even if the caller omits them.
	"""
	catalog = {f: (label, sample, reqd) for f, label, sample, reqd in IMPORTABLE_FIELDS}
	required = [f for f, _l, _s, reqd in IMPORTABLE_FIELDS if reqd]

	if fields:
		selected = frappe.parse_json(fields) if isinstance(fields, str) else fields
		selected = [f for f in selected if f in catalog]
	else:
		selected = list(DEFAULT_FIELDS)

	for f in required:
		if f not in selected:
			selected.append(f)

	# Keep catalog order regardless of how the selection was passed in
	headers = [f for f, *_ in IMPORTABLE_FIELDS if f in selected]
	sample = [catalog[f][1] for f in headers]

	csv_content = ",".join(headers) + "\n" + ",".join(sample) + "\n"

	frappe.response["filename"] = "gig_transaction_import_template.csv"
	frappe.response["filecontent"] = csv_content.encode("utf-8")
	frappe.response["type"] = "download"
	frappe.response["content_type"] = "text/csv"


@frappe.whitelist()
def get_service_reference():
	"""Return every Service record's ID + category/type/welfare details, so
	uploaders know exactly which Service ID to put in the CSV `service` column."""
	frappe.only_for(["System Manager", "Aggregator"])
	return frappe.db.sql("""
		SELECT s.name AS service_id,
		       sc.category_name AS category,
		       vt.vehicle_type AS vehicle_type,
		       s.welfare_percentage_ AS welfare_percentage,
		       s.welfare_cap AS welfare_cap
		FROM `tabService` s
		LEFT JOIN `tabService Category` sc ON sc.name = s.category
		LEFT JOIN `tabVehicle Type` vt ON vt.name = s.vehicle_type
		ORDER BY s.name
	""", as_dict=True)


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
	"""Only System Manager can see everyone's logs — other users only see
	the imports they themselves ran."""
	frappe.only_for(["System Manager", "Aggregator"])

	filters = {}
	if "System Manager" not in frappe.get_roles():
		filters["imported_by"] = frappe.session.user

	logs = frappe.get_all(
		"Gig Transaction Import Log",
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
	total = frappe.db.count("Gig Transaction Import Log", filters=filters)
	return {"logs": logs, "total": total}
