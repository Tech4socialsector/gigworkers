// Copyright (c) 2026, Jenifar and contributors
// For license information, please see license.txt

frappe.ui.form.on("Welfare Benefit Withdrawal", {
	onload(frm) {
		if (frm.is_new() && !frm.doc.gig_worker) {
			frappe.db.get_value("Gig Worker", { email: frappe.session.user }, "name")
				.then(r => {
					if (r && r.message && r.message.name) {
						frm.set_value("gig_worker", r.message.name);
					}
				});
		}

		const is_gig_worker = frappe.user_roles.includes("Gig Worker") &&
			!frappe.user_roles.includes("System Manager");

		if (is_gig_worker) {
			["gig_worker", "status", "reviewed_by", "review_date",
				"payment_date", "transaction_id", "refund_date"].forEach(f => {
				frm.set_df_property(f, "read_only", 1);
			});
		}

		frm.trigger("toggle_refund_fields");
	},

	is_refund(frm) {
		frm.trigger("toggle_refund_fields");
	},

	toggle_refund_fields(frm) {
		const is_refund = frm.doc.is_refund;

		// Bank details are not needed for a refund (money goes back to fund, not a bank)
		frm.set_df_property("section_bank_details", "hidden", is_refund ? 1 : 0);

		// Withdrawal type label hint
		if (is_refund) {
			frm.set_df_property("withdrawal_type", "label", "Refund Category");
		} else {
			frm.set_df_property("withdrawal_type", "label", "Withdrawal Type");
		}

		frm.refresh_fields();
	}
});
