// Copyright (c) 2026, Jenifar and contributors
// For license information, please see license.txt

// Helper: calculate net payout to worker
function calculate_net_payout(frm) {
	const base = frm.doc.base_payout || 0;
	const inc  = frm.doc.incentives  || 0;
	const ded  = frm.doc.deduction  || 0;
	frm.set_value("net_payout_to_worker", base + inc - ded);
}


frappe.ui.form.on("Gig Transaction", {

	// ----------------------------------------------------------
	// FORM REFRESH
	// ----------------------------------------------------------

	refresh(frm) {

		frm.clear_custom_buttons();

		if (frm.is_new()) return;

		// ── Read-only for Aggregators on saved transactions ──────────────────
		if (!frappe.user.has_role("System Manager") && !frm.is_new()) {
			frm.disable_save();
			[
				"amount", "base_payout", "incentives", "deduction", "date",
				"external_transaction_id", "status_of_order", "gig_worker",
				"aggregator", "service", "role", "transaction_date",
				"settlement_status", "status"
			].forEach(f => frm.set_df_property(f, "read_only", 1));
		}

		const status     = frm.doc.status;
		const isAdmin    = frappe.user.has_role("System Manager");

		// ----------------------------------------------------------
		// DUPLICATE REVIEW ACTIONS (System Manager only)
		// ----------------------------------------------------------

		if (isAdmin && status === "Suspected Duplicate") {

			frm.add_custom_button(__("Mark as Duplicate"), function () {
				frappe.prompt(
					[{
						label: "Duplicate Of (Transaction ID)",
						fieldname: "duplicate_of",
						fieldtype: "Link",
						options: "Gig Transaction",
						default: frm.doc.duplicate_of || "",
						description: "Select the original transaction this is a duplicate of"
					}],
					function (values) {
						frappe.call({
							method: "gigworkers.gig_workers.doctype.gig_transaction.gig_transaction.mark_as_duplicate",
							args: { transaction_name: frm.doc.name, duplicate_of: values.duplicate_of || "" },
							freeze: true,
							freeze_message: __("Marking as Duplicate..."),
							callback(r) {
								if (!r.exc) {
									frappe.show_alert({ message: __(r.message.message), indicator: "red" }, 5);
									frm.reload_doc();
								}
							}
						});
					},
					__("Confirm Duplicate"),
					__("Mark as Duplicate")
				);
			}, __("Duplicate Actions"));

			frm.add_custom_button(__("Dismiss (Not a Duplicate)"), function () {
				frappe.confirm(
					"Clear the suspected duplicate flag? This transaction will be restored to its previous status.",
					function () {
						frappe.call({
							method: "gigworkers.gig_workers.doctype.gig_transaction.gig_transaction.dismiss_suspected_duplicate",
							args: { transaction_name: frm.doc.name },
							freeze: true,
							freeze_message: __("Clearing flag..."),
							callback(r) {
								if (!r.exc) {
									frappe.show_alert({ message: __(r.message.message), indicator: "green" }, 5);
									frm.reload_doc();
								}
							}
						});
					}
				);
			}, __("Duplicate Actions"));

		}

		// ── View Old Data button — shown to Aggregators and System Managers only ─
		const hasHistory = (frm.doc.adjustment_count || 0) > 0
			|| (frm.doc.adjustment_log || []).length > 0;
		const canViewHistory = frappe.user.has_role("System Manager") || frappe.user.has_role("Aggregator");

		if (hasHistory && canViewHistory) {
			frm.add_custom_button(__("View Old Data"), function () {
				_show_adjustment_history(frm);
			}).removeClass("btn-default btn-secondary")
			  .addClass("btn-dark")
			  .css({ color: "#fff", "background-color": "#343a40", "border-color": "#343a40" });
		}

		// ── Apply dark theme to ALL custom button group toggles ──────────────
		// frm.add_custom_button with a group adds a <button class="dropdown-toggle">
		// as the visible header. We target those directly by their data-label attr.
		_style_form_group_buttons_dark(frm);

	},


	// ----------------------------------------------------------
	// SERVICE CHANGE HANDLER
	// ----------------------------------------------------------

	service(frm) {
		if (!frm.doc.service) {
			frm.set_value("service_category", "");
			frm.set_value("service_type", "");
			frm.set_value("welfare_percentage", 0);
			frm.set_value("welfare_cap", 0);
			frm.set_value("welfare_amount", 0);
			return;
		}

		frappe.db.get_value("Service", frm.doc.service,
			["category", "vehicle_type", "welfare_percentage_", "welfare_cap"],
			function (r) {
				if (!r) return;

				if (r.category) {
					frappe.db.get_value("Service Category", r.category, "category_name", function (cat) {
						frm.set_value("service_category", (cat && cat.category_name) || r.category);
					});
				}
				if (r.vehicle_type) {
					frappe.db.get_value("Vehicle Type", r.vehicle_type, "vehicle_type", function (vt) {
						frm.set_value("service_type", (vt && vt.vehicle_type) || r.vehicle_type);
					});
				}

				frm.set_value("welfare_percentage", r.welfare_percentage_ || 0);
				frm.set_value("welfare_cap", r.welfare_cap || 0);

				const base_payout = frm.doc.base_payout || 0;
				if (base_payout && r.welfare_percentage_) {
					const rate_amount  = (base_payout * r.welfare_percentage_) / 100;
					const welfare_amount = r.welfare_cap ? Math.min(rate_amount, r.welfare_cap) : rate_amount;
					frm.set_value("welfare_amount", welfare_amount);
				}
			}
		);
	},

	base_payout(frm) {
		if (frm.doc.service && frm.doc.welfare_percentage && frm.doc.base_payout) {
			const rate_amount  = (frm.doc.base_payout * frm.doc.welfare_percentage) / 100;
			const welfare_amount = frm.doc.welfare_cap ? Math.min(rate_amount, frm.doc.welfare_cap) : rate_amount;
			frm.set_value("welfare_amount", welfare_amount);
		}
		calculate_net_payout(frm);
	},

	incentives(frm) { calculate_net_payout(frm); },

	deduction(frm) { calculate_net_payout(frm); },

	// ----------------------------------------------------------
	// TRUST LEVEL CHANGE HANDLER
	// ----------------------------------------------------------

	trust_level(frm) {

		frm.trigger("refresh");

		if (frm.doc.trust_level === "High") {
			frappe.show_alert({ message: __("High Trust — transaction will auto-confirm on save."), indicator: "green" }, 5);
		}

		if (frm.doc.trust_level === "Low") {
			frappe.show_alert({ message: __("Low Trust — OTP verification required."), indicator: "orange" }, 5);
		}

	}

});


// ── Dark-theme helper for form group buttons ──────────────────────────────────
// Frappe renders group buttons as:
//   <div class="btn-group" data-label="...">
//     <button class="btn btn-default dropdown-toggle">Group Name</button>
//     <ul class="dropdown-menu">...</ul>
//   </div>
// The visible button is the .dropdown-toggle — that's what we must re-class.

function _style_form_group_buttons_dark(frm) {
	if (!frm.page || !frm.page.inner_toolbar) return;

	frm.page.inner_toolbar
		.find(".btn-group > .btn.dropdown-toggle")
		.each(function () {
			$(this)
				.removeClass("btn-default btn-secondary btn-primary btn-success btn-warning btn-info")
				.addClass("btn-dark")
				.css({ color: "#fff", "background-color": "#343a40", "border-color": "#343a40" });
		});
}


// ── Adjustment history popup ──────────────────────────────────────────────────

function _show_adjustment_history(frm) {

	const logs = (frm.doc.adjustment_log || [])
		.slice()
		.sort((a, b) => a.adjustment_number - b.adjustment_number);

	if (!logs.length) {
		frappe.msgprint({
			title: __("No History"),
			indicator: "blue",
			message: __("No adjustment history found for this transaction.")
		});
		return;
	}

	const fmt_cur = v => `₹ ${(parseFloat(v) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
	const fmt_date = v => v ? frappe.datetime.str_to_user(v) : "—";

	// Current (live) values row
	const current_row = `
		<tr style="background:#e8f5e9;">
			<td style="padding:9px 12px;border:1px solid #dee2e6;font-weight:700;color:#2e7d32;">Current</td>
			<td style="padding:9px 12px;border:1px solid #dee2e6;color:#555;">—</td>
			<td style="padding:9px 12px;border:1px solid #dee2e6;font-weight:700;color:#2e7d32;">${fmt_cur(frm.doc.amount)}</td>
			<td style="padding:9px 12px;border:1px solid #dee2e6;font-weight:700;color:#2e7d32;">${fmt_cur(frm.doc.base_payout)}</td>
			<td style="padding:9px 12px;border:1px solid #dee2e6;font-weight:700;color:#2e7d32;">${fmt_cur(frm.doc.incentives)}</td>
			<td style="padding:9px 12px;border:1px solid #dee2e6;font-weight:700;color:#2e7d32;">${fmt_cur(frm.doc.deduction)}</td>
			<td style="padding:9px 12px;border:1px solid #dee2e6;font-weight:700;color:#2e7d32;">${fmt_cur(frm.doc.net_payout_to_worker)}</td>
			<td style="padding:9px 12px;border:1px solid #dee2e6;font-weight:700;color:#2e7d32;">${fmt_date(frm.doc.date)}</td>
			<td style="padding:9px 12px;border:1px solid #dee2e6;font-weight:700;color:#2e7d32;">${frm.doc.status_of_order || "—"}</td>
		</tr>`;

	// Historical rows (before each adjustment)
	const history_rows = logs.map(log => `
		<tr>
			<td style="padding:9px 12px;border:1px solid #dee2e6;">
				Before Adj. ${log.adjustment_number}
				<br><small style="color:#888;font-size:11px;">${log.adjusted_at ? log.adjusted_at.substring(0, 16) : ""}</small>
			</td>
			<td style="padding:9px 12px;border:1px solid #dee2e6;font-size:12px;color:#555;">${log.adjusted_by || "—"}</td>
			<td style="padding:9px 12px;border:1px solid #dee2e6;">${fmt_cur(log.old_amount)}</td>
			<td style="padding:9px 12px;border:1px solid #dee2e6;">${fmt_cur(log.old_base_payout)}</td>
			<td style="padding:9px 12px;border:1px solid #dee2e6;">${fmt_cur(log.old_incentives)}</td>
			<td style="padding:9px 12px;border:1px solid #dee2e6;">${fmt_cur(log.old_deduction)}</td>
			<td style="padding:9px 12px;border:1px solid #dee2e6;">${fmt_cur(log.old_net_payout)}</td>
			<td style="padding:9px 12px;border:1px solid #dee2e6;">${fmt_date(log.old_date)}</td>
			<td style="padding:9px 12px;border:1px solid #dee2e6;">${log.old_status_of_order || "—"}</td>
		</tr>`).join("");

	const html = `
		<div style="margin-bottom:12px;padding:10px 14px;border-radius:5px;
		            background:#1a1a2e;color:#d0d0d0;font-size:13px;">
		    <b>Adjustment History</b> — ${logs.length} adjustment(s) made.
		    Each row shows the values <b>before</b> that adjustment was applied.
		    The green row is the current live data.
		</div>
		<div style="overflow-x:auto;">
		<table style="width:100%;border-collapse:collapse;font-size:13px;min-width:900px;">
		  <thead>
		    <tr style="background:#343a40;color:#fff;">
		      <th style="padding:10px 12px;text-align:left;white-space:nowrap;">Snapshot</th>
		      <th style="padding:10px 12px;text-align:left;white-space:nowrap;">Adjusted By</th>
		      <th style="padding:10px 12px;text-align:right;white-space:nowrap;">Amount</th>
		      <th style="padding:10px 12px;text-align:right;white-space:nowrap;">Base Payout</th>
		      <th style="padding:10px 12px;text-align:right;white-space:nowrap;">Incentives</th>
		      <th style="padding:10px 12px;text-align:right;white-space:nowrap;">Deduction</th>
		      <th style="padding:10px 12px;text-align:right;white-space:nowrap;">Net Payout</th>
		      <th style="padding:10px 12px;text-align:left;white-space:nowrap;">Date</th>
		      <th style="padding:10px 12px;text-align:left;white-space:nowrap;">Order Status</th>
		    </tr>
		  </thead>
		  <tbody>
		    ${current_row}
		    ${history_rows}
		  </tbody>
		</table>
		</div>
		<p style="margin-top:10px;font-size:12px;color:#888;">
		    Total adjustments used: <b>${logs.length}</b>
		</p>`;

	const d = new frappe.ui.Dialog({
		title: __("Transaction History — ") + frm.doc.name,
		fields: [{ fieldtype: "HTML", options: html }],
		size: "extra-large"
	});
	d.show();
}
