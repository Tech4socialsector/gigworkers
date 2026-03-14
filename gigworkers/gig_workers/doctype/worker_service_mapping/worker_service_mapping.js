// Copyright (c) 2026, Jenifar and contributors
// For license information, please see license.txt

frappe.ui.form.on("Worker Service Mapping", {
	refresh(frm) {
		if (frm.is_new()) {
			// Auto-fetch aggregator if the logged-in user is an Aggregator
			frappe.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Aggregator",
					filters: { email: frappe.session.user },
					fields: ["name"],
					limit: 1
				},
				callback: function(r) {
					if (r.message && r.message.length > 0) {
						frm.set_value("aggregator", r.message[0].name);
						frm.set_df_property("aggregator", "read_only", 1);
					}
				}
			});
		}
	}
});
