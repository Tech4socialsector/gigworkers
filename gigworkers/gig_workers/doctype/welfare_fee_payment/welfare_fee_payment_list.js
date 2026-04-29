// Copyright (c) 2026, Jenifar and contributors
// For license information, please see license.txt

frappe.listview_settings["Welfare Fee Payment"] = {

	// ----------------------------------------------------------
	// PER-ROW BUTTON — shows that record's full details in a popup
	// ----------------------------------------------------------
	button: {
		show: function (doc) {
			return true;
		},
		get_label: function (doc) {
			return __("Full Record");
		},
		get_description: function (doc) {
			return __("View full details for {0}", [doc.name]);
		},
		action: function (doc) {
			frappe.db.get_doc("Welfare Fee Payment", doc.name).then(function (record) {
				const fmt_currency = (val) => frappe.format(val || 0, { fieldtype: "Currency" });
				const fmt_date    = (val) => val ? frappe.datetime.str_to_user(val) : "—";

				const badge = (label, color) =>
					`<span style="background:${color.bg};color:${color.text};border-radius:4px;
					             padding:2px 10px;font-size:12px;font-weight:600;">${label || "—"}</span>`;

				const payment_color = {
					"Completed": { bg: "#d1e7dd", text: "#0a3622" },
					"Pending":   { bg: "#fff3cd", text: "#856404" },
					"Failed":    { bg: "#f8d7da", text: "#58151c" }
				}[record.payment_status] || { bg: "#e9ecef", text: "#495057" };

				const settlement_color = {
					"Success":   { bg: "#d1e7dd", text: "#0a3622" },
					"Initiated": { bg: "#cfe2ff", text: "#084298" },
					"Failed":    { bg: "#f8d7da", text: "#58151c" }
				}[record.settlement_status] || { bg: "#e9ecef", text: "#495057" };

				const row = (label, value) => `
					<tr>
						<td style="padding:7px 12px;color:#6c757d;font-size:12px;white-space:nowrap;
						           border-bottom:1px solid #f1f3f5;">${label}</td>
						<td style="padding:7px 12px;font-weight:500;border-bottom:1px solid #f1f3f5;">
							${value || "—"}
						</td>
					</tr>`;

				const html = `
					<div style="font-family:inherit;">

						<div style="display:flex;justify-content:space-between;align-items:center;
						            background:#f4f5f7;border-radius:6px;padding:12px 16px;margin-bottom:16px;">
							<div>
								<div style="font-size:11px;color:#6c757d;text-transform:uppercase;letter-spacing:.5px;">
									Record
								</div>
								<div style="font-size:20px;font-weight:700;">${record.name}</div>
							</div>
							<div style="text-align:right;">
								<div style="font-size:11px;color:#6c757d;text-transform:uppercase;letter-spacing:.5px;">
									Fee Amount
								</div>
								<div style="font-size:20px;font-weight:700;">${fmt_currency(record.fee_amount)}</div>
							</div>
						</div>

						<table style="width:100%;border-collapse:collapse;font-size:13px;">
							${row("Aggregator",      record.aggregator)}
							${row("Transaction",     record.transaction)}
							${row("Payment Mode",    record.payment)}
							${row("Mode of Payment", record.mode_of_payment)}
							${row("Bank Reference",  record.bank_reference)}
							${row("Amount Paid",     record.amount_paid)}
							${row("Payment Date",    fmt_date(record.payment_date))}
							<tr>
								<td style="padding:7px 12px;color:#6c757d;font-size:12px;white-space:nowrap;
								           border-bottom:1px solid #f1f3f5;">Payment Status</td>
								<td style="padding:7px 12px;border-bottom:1px solid #f1f3f5;">
									${badge(record.payment_status, payment_color)}
								</td>
							</tr>
							<tr>
								<td style="padding:7px 12px;color:#6c757d;font-size:12px;white-space:nowrap;">
									Settlement Status
								</td>
								<td style="padding:7px 12px;">
									${badge(record.settlement_status, settlement_color)}
								</td>
							</tr>
						</table>

					</div>`;

				frappe.msgprint({
					title: __("Welfare Fee Payment — {0}", [record.name]),
					message: html,
					wide: true
				});
			});
		}
	},

	refresh(listview) {

		// ----------------------------------------------------------
		// DARK STYLE FOR PER-ROW "Full Record" BUTTON
		// ----------------------------------------------------------
		frappe.dom.set_style(`
			.layout-main-list .btn-action.btn-default {
				background-color: #1a1a2e !important;
				color: #ffffff !important;
				border-color: #1a1a2e !important;
				font-weight: 600;
			}
			.layout-main-list .btn-action.btn-default:hover {
				background-color: #16213e !important;
				border-color: #16213e !important;
			}
		`);

		// ----------------------------------------------------------
		// BULK UPDATE: PAYMENT + SETTLEMENT STATUS
		// ----------------------------------------------------------
		listview.page.add_button(__("Update Status"), function () {

			let selected = listview.get_checked_items();

			if (!selected.length) {
				frappe.msgprint(__("Please select at least one record first."));
				return;
			}

			frappe.prompt([
				{
					label: __("Payment Status"),
					fieldname: "payment_status",
					fieldtype: "Select",
					options: "\nPending\nCompleted\nFailed"
				},
				{
					label: __("Settlement Status"),
					fieldname: "settlement_status",
					fieldtype: "Select",
					options: "\nInitiated\nSuccess\nFailed"
				}
			],
			function (values) {
				let names = selected.map(row => row.name);
				let promises = names.map(name => {
					let updates = {};
					if (values.payment_status)   updates["payment_status"]   = values.payment_status;
					if (values.settlement_status) updates["settlement_status"] = values.settlement_status;
					return frappe.db.set_value("Welfare Fee Payment", name, updates);
				});

				Promise.all(promises).then(() => {
					frappe.show_alert({
						message: __("Updated {0} record(s)", [names.length]),
						indicator: "green"
					});
					listview.refresh();
				});
			},
			__("Bulk Update Status"),
			__("Update"));

		}, __("btn-primary"));

	}
};
