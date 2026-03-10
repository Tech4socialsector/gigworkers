// Copyright (c) 2026, Jenifar and contributors
// For license information, please see license.txt

// ============================================================
//  gigworkers — Gig Transaction Form Script
// ============================================================

frappe.ui.form.on("Gig Transaction", {

	// ----------------------------------------------------------
	//  gigworkers script — Form Refresh: render trust-level buttons
	// ----------------------------------------------------------

	refresh(frm) {
		frm.clear_custom_buttons();

		if (frm.is_new()) return;

		const trustLevel = frm.doc.trust_level;
		const status     = frm.doc.status;

		// ---- HIGH TRUST: Auto Confirm button ----
		if (trustLevel === "High" && status !== "Completed") {
			frm.add_custom_button(__("Auto Confirm"), function () {
				frappe.confirm(
					"This transaction has <b>High Trust Level</b>.<br>" +
					"It will be auto-confirmed immediately. Proceed?",
					function () {
						frm.save().then(() => {
							frappe.show_alert({
								message: __("✅ Transaction auto-confirmed successfully!"),
								indicator: "green",
							}, 5);
							frm.reload_doc();
						});
					}
				);
			}, __("Trust Level Actions")).addClass("btn-success");
		}

		// ---- LOW TRUST: Single Confirm Transaction button ----
		if (trustLevel === "Low" && status !== "Completed") {
			frm.add_custom_button(__("Confirm Transaction"), function () {
				frappe.confirm(
					`<b>Confirm this transaction?</b><br><br>
					This will:<br>
					✅ Mark the transaction as <b>Completed</b><br>
					📧 Send a confirmation notification to the worker's email<br>
					📋 Record full OTP audit details in the OTP Records table`,
					function () {
						frappe.call({
							// --------------------------------------------------------
							//  gigworkers api code — confirm_transaction (Low Trust)
							// --------------------------------------------------------
							method: "gigworkers.gig_workers.doctype.gig_transaction.gig_transaction.confirm_transaction",
							args: { transaction_name: frm.doc.name },
							freeze: true,
							freeze_message: __("Confirming transaction…"),
							callback(r) {
								if (!r.exc && r.message) {
									const email = r.message.worker_email || "";
									const otp   = r.message.otp_reference || "";
									frappe.show_alert({
										message: __(
											`✅ Confirmed! OTP Ref: <b>${otp}</b> — Notification sent to <b>${email}</b>`
										),
										indicator: "green",
									}, 8);
									frm.reload_doc();
								}
							},
						});
					}
				);
			}, __("Trust Level Actions")).addClass("btn-primary");
		}
	},

	// ----------------------------------------------------------
	//  gigworkers script — trust_level field change handler
	// ----------------------------------------------------------

	trust_level(frm) {
		frm.trigger("refresh");

		if (frm.doc.trust_level === "High") {
			frappe.show_alert({
				message: __("High Trust — transaction will auto-confirm on save."),
				indicator: "green",
			}, 5);
		} else if (frm.doc.trust_level === "Low") {
			frappe.show_alert({
				message: __("Low Trust — use the 'Confirm Transaction' button to confirm."),
				indicator: "orange",
			}, 5);
		}
	},
});
