import frappe


def execute():
	"""Backfill gig_transaction in existing Welfare Fund Ledger Entry rows and
	populate the Gig Transaction Details child table in Welfare Fund Account."""

	# Step 1: Backfill gig_transaction field in existing ledger entry rows
	rows = frappe.db.get_all(
		"Welfare Fund Ledger Entry",
		filters={
			"reference_doctype": "Welfare Fee Payment",
			"gig_transaction": ["in", ["", None]],
		},
		fields=["name", "reference_name"],
	)

	for row in rows:
		if not row.reference_name:
			continue
		gig_transaction = frappe.db.get_value(
			"Welfare Fee Payment", row.reference_name, "transaction"
		)
		if gig_transaction:
			frappe.db.set_value(
				"Welfare Fund Ledger Entry",
				row.name,
				"gig_transaction",
				gig_transaction,
				update_modified=False,
			)

	# Step 2: Populate gig_transaction_details in each Welfare Fund Account
	# Find all unique Gig Transactions referenced in settled ledger entries
	wfa_names = frappe.db.get_all("Welfare Fund Account", pluck="name")

	for wfa_name in wfa_names:
		wfa = frappe.get_doc("Welfare Fund Account", wfa_name)

		# Collect already-listed transaction IDs to avoid duplicates
		existing = {row.transaction_id for row in wfa.get("gig_transaction_details", [])}

		added = False
		for ledger_row in wfa.get("ledger_entries", []):
			gt_name = ledger_row.gig_transaction
			if not gt_name or gt_name in existing:
				continue

			gt = frappe.db.get_value(
				"Gig Transaction",
				gt_name,
				[
					"transaction_id", "date", "aggregator", "service",
					"service_category", "service_type", "status", "status_of_order",
					"settlement_status", "amount", "base_payout", "deducation",
					"incentives", "net_payout_to_worker", "welfare_percentage",
					"welfare_cap", "welfare_amount",
				],
				as_dict=True,
			)
			if not gt:
				continue

			wfa.append("gig_transaction_details", {
				"transaction_id":      gt_name,
				"date":                gt.date,
				"aggregator":          gt.aggregator,
				"service":             gt.service,
				"service_category":    gt.service_category,
				"service_type":        gt.service_type,
				"status":              gt.status,
				"status_of_order":     gt.status_of_order,
				"settlement_status":   gt.settlement_status,
				"amount":              gt.amount,
				"base_payout":         gt.base_payout,
				"deducation":          gt.deducation,
				"incentives":          gt.incentives,
				"net_payout_to_worker":gt.net_payout_to_worker,
				"welfare_percentage":  gt.welfare_percentage,
				"welfare_cap":         gt.welfare_cap,
				"welfare_amount":      gt.welfare_amount,
			})
			existing.add(gt_name)
			added = True

		if added:
			wfa.save(ignore_permissions=True)

	frappe.db.commit()
