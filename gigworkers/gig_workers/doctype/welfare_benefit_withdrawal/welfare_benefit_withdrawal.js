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
			frm.set_df_property("gig_worker", "read_only", 1);
			frm.set_df_property("status", "read_only", 1);
		}
	}
});
