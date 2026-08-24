import frappe


def execute():
	"""Worker Partner Mapping used to be one flat row per (Gig Worker, Aggregator).
	It is now one parent row per Gig Worker, with an Aggregator Mappings child
	table row per aggregator. Regroup the pre-restructure snapshot (captured by
	snapshot_worker_partner_mapping_before_restructure) into that shape."""

	if not frappe.db.sql("SHOW TABLES LIKE '__wpm_pre_restructure_snapshot'"):
		return

	old_rows = frappe.db.sql(
		"SELECT name, gig_worker_id, aggregator, partner_id, worker_name "
		"FROM `__wpm_pre_restructure_snapshot`",
		as_dict=True,
	)

	by_worker = {}
	for row in old_rows:
		if not row.gig_worker_id:
			continue
		by_worker.setdefault(row.gig_worker_id, []).append(row)

	old_names = [row.name for row in old_rows]
	if old_names:
		frappe.db.delete("Worker Partner Mapping", {"name": ["in", old_names]})

	for gig_worker_id, rows in by_worker.items():
		if frappe.db.exists("Worker Partner Mapping", gig_worker_id):
			doc = frappe.get_doc("Worker Partner Mapping", gig_worker_id)
		else:
			gw = frappe.db.get_value(
				"Gig Worker", gig_worker_id, ["unique_id", "worker_name"], as_dict=True
			)
			if not gw:
				continue
			doc = frappe.new_doc("Worker Partner Mapping")
			doc.gig_worker_id = gig_worker_id
			doc.unique_id = gw.unique_id
			doc.worker_name = gw.worker_name

		seen_aggregators = {r.aggregator for r in doc.aggregator_mappings if r.aggregator}
		for row in rows:
			if row.aggregator and row.aggregator in seen_aggregators:
				continue
			doc.append("aggregator_mappings", {
				"aggregator": row.aggregator,
				"partner_id": row.partner_id,
			})
			if row.aggregator:
				seen_aggregators.add(row.aggregator)

		doc.flags.ignore_mandatory = True
		doc.flags.ignore_links = True
		doc.save(ignore_permissions=True)

	frappe.db.commit()
	frappe.db.sql("DROP TABLE `__wpm_pre_restructure_snapshot`")
	frappe.db.commit()
