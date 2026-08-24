import frappe


def execute():
	"""Worker Partner Mapping is changing from one flat row per (Gig Worker,
	Aggregator) into one parent row per Gig Worker with an Aggregator Mappings
	child table. Snapshot the old flat rows into a plain table before the
	doctype schema sync alters/drops those columns, so the post-sync patch
	(migrate_worker_partner_mapping_to_child_table) has the old data to
	regroup from."""

	if not frappe.db.table_exists("Worker Partner Mapping"):
		return
	if frappe.db.sql("SHOW TABLES LIKE '__wpm_pre_restructure_snapshot'"):
		return
	if "aggregator" not in frappe.db.get_table_columns("Worker Partner Mapping"):
		# Already on the new schema (e.g. a fresh site) — nothing to snapshot.
		return

	frappe.db.sql(
		"CREATE TABLE `__wpm_pre_restructure_snapshot` AS "
		"SELECT name, gig_worker_id, aggregator, partner_id, worker_name "
		"FROM `tabWorker Partner Mapping`"
	)
	frappe.db.commit()
