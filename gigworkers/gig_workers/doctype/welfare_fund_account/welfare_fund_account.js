// Copyright (c) 2026, Jenifar and contributors
// For license information, please see license.txt

frappe.ui.form.on("Welfare Fund Account", {
	refresh(frm) {
		frm.add_custom_button(__("Gig Transactions"), function () {
			// Collect unique Gig Transaction names from ledger entries
			const gt_names = [
				...new Set(
					(frm.doc.ledger_entries || [])
						.map((r) => r.gig_transaction)
						.filter(Boolean)
				),
			];

			if (!gt_names.length) {
				frappe.msgprint(__("No Gig Transactions linked to this account."));
				return;
			}

			frappe.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Gig Transaction",
					filters: [["name", "in", gt_names]],
					fields: [
						"name",
						"transaction_id",
						"date",
						"aggregator",
						"service",
						"service_category",
						"service_type",
						"status",
						"status_of_order",
						"settlement_status",
						"amount",
						"base_payout",
						"deducation",
						"incentives",
						"net_payout_to_worker",
						"welfare_percentage",
						"welfare_cap",
						"welfare_amount",
					],
					limit: 500,
				},
				callback(r) {
					if (!r.message || !r.message.length) {
						frappe.msgprint(__("No Gig Transaction records found."));
						return;
					}

					const fmt_currency = (v) =>
						v != null ? "$ " + parseFloat(v).toFixed(2) : "—";
					const fmt_val = (v) => v || "—";

					const cards = r.message
						.map(
							(gt) => `
						<div style="border:1px solid #d1d8dd; border-radius:6px; padding:16px; margin-bottom:16px;">
							<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
								<a href="/desk#Form/Gig Transaction/${gt.name}" target="_blank"
								   style="font-size:15px; font-weight:600; color:#1a73e8;">
									${gt.name}
								</a>
								<span style="font-size:12px; color:#6c757d;">${fmt_val(gt.date)}</span>
							</div>

							<div style="display:grid; grid-template-columns:1fr 1fr; gap:8px 24px; font-size:13px;">
								<div><span style="color:#6c757d;">Aggregator</span><br><strong>${fmt_val(gt.aggregator)}</strong></div>
								<div><span style="color:#6c757d;">Service</span><br><strong>${fmt_val(gt.service)}</strong></div>
								<div><span style="color:#6c757d;">Service Category</span><br><strong>${fmt_val(gt.service_category)}</strong></div>
								<div><span style="color:#6c757d;">Service Type</span><br><strong>${fmt_val(gt.service_type)}</strong></div>
								<div><span style="color:#6c757d;">Transaction Status</span><br><strong>${fmt_val(gt.status)}</strong></div>
								<div><span style="color:#6c757d;">Order Status</span><br><strong>${fmt_val(gt.status_of_order)}</strong></div>
								<div><span style="color:#6c757d;">Settlement Status</span><br><strong>${fmt_val(gt.settlement_status)}</strong></div>
							</div>

							<hr style="margin:12px 0; border-color:#f0f0f0;">

							<div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px 16px; font-size:13px;">
								<div><span style="color:#6c757d;">Total Bill Amount</span><br><strong>${fmt_currency(gt.amount)}</strong></div>
								<div><span style="color:#6c757d;">Base Payout</span><br><strong>${fmt_currency(gt.base_payout)}</strong></div>
								<div><span style="color:#6c757d;">Deduction</span><br><strong>${fmt_currency(gt.deducation)}</strong></div>
								<div><span style="color:#6c757d;">Incentives</span><br><strong>${fmt_currency(gt.incentives)}</strong></div>
								<div><span style="color:#6c757d;">Net Payout</span><br><strong>${fmt_currency(gt.net_payout_to_worker)}</strong></div>
								<div><span style="color:#6c757d;">Welfare Amount</span><br><strong style="color:#28a745;">${fmt_currency(gt.welfare_amount)}</strong></div>
								<div><span style="color:#6c757d;">Welfare %</span><br><strong>${gt.welfare_percentage != null ? gt.welfare_percentage + "%" : "—"}</strong></div>
								<div><span style="color:#6c757d;">Welfare Cap</span><br><strong>${fmt_currency(gt.welfare_cap)}</strong></div>
							</div>
						</div>`
						)
						.join("");

					const d = new frappe.ui.Dialog({
						title: __("Gig Transactions — {0}", [frm.doc.gig_worker]),
						size: "large",
					});

					d.$body.html(
						`<div style="max-height:65vh; overflow-y:auto; padding:4px 2px;">${cards}</div>`
					);
					d.show();
				},
			});
		}).removeClass("btn-default").addClass("btn-dark");
	},
});
