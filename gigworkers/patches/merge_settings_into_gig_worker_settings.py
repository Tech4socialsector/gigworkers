import frappe


def execute():
	"""Copy the two old single-field settings into Gig Worker Settings and drop the old doctypes."""
	frappe.reload_doc("gig_workers", "doctype", "gig_worker_settings")

	def old(doctype, field):
		r = frappe.db.sql("SELECT value FROM `tabSingles` WHERE doctype=%s AND field=%s", (doctype, field))
		return r[0][0] if r else None

	values = {}
	days = old("Aggregator Approval Settings", "auto_approve_days")
	attempts = old("Gig Transaction Settings", "max_adjustment_attempts")
	if days is not None:
		values["auto_approve_days"] = int(days)
	if attempts is not None:
		values["max_adjustment_attempts"] = int(attempts)
	if not frappe.db.get_single_value("Gig Worker Settings", "max_adjustment_attempts"):
		values.setdefault("max_adjustment_attempts", 3)
	if values:
		frappe.db.set_single_value("Gig Worker Settings", values)

	for dt in ("Aggregator Approval Settings", "Gig Transaction Settings"):
		if frappe.db.exists("DocType", dt):
			frappe.delete_doc("DocType", dt, ignore_missing=True, force=True)
		frappe.db.delete("Singles", {"doctype": dt})
