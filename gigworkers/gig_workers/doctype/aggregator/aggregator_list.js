// Copyright (c) 2026, Jenifar and contributors
// For license information, please see license.txt

frappe.listview_settings["Aggregator"] = {

	onload() {
		// An aggregator only ever sees their own record — "Profile" opens it directly
		if (frappe.user.has_role("Aggregator") && !frappe.user.has_role("System Manager")) {
			frappe.db.get_value("Aggregator", { email: frappe.session.user }, "name").then((r) => {
				const name = r.message && r.message.name;
				if (name) frappe.set_route("Form", "Aggregator", name);
			});
		}
	},

	// Mask aadhaar_number column — show only last 4 digits
	formatters: {
		aadhaar_number(value) {
			if (!value) return "";
			return "XXXX-XXXX-" + String(value).slice(-4);
		},
	},
};
