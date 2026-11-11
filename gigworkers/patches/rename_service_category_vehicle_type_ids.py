import frappe


def execute():
	"""Replace random-hash IDs with SC001… / VT001… (oldest first); links are updated by rename_doc."""
	for doctype, prefix in (("Service Category", "SC"), ("Vehicle Type", "VT")):
		frappe.reload_doc("gig_workers", "doctype", frappe.scrub(doctype))
		names = frappe.get_all(doctype, order_by="creation asc", pluck="name")
		if all(n.startswith(prefix) for n in names):
			continue
		# Two passes so a new ID can never collide with an existing one.
		temp = []
		for i, old in enumerate(names, 1):
			tmp = f"__tmp_{prefix}_{i}"
			frappe.rename_doc(doctype, old, tmp, force=True, show_alert=False)
			temp.append(tmp)
		for i, tmp in enumerate(temp, 1):
			frappe.rename_doc(doctype, tmp, f"{prefix}{i:03d}", force=True, show_alert=False)
		frappe.db.sql("INSERT INTO `tabSeries` (name, current) VALUES (%s, %s) "
			"ON DUPLICATE KEY UPDATE current = GREATEST(current, %s)", (prefix, len(names), len(names)))
		frappe.db.commit()
