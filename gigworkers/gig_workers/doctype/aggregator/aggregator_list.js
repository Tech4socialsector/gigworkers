// Copyright (c) 2026, Jenifar and contributors
// For license information, please see license.txt

frappe.listview_settings["Aggregator"] = {

	// Mask aadhaar_number column — show only last 4 digits
	formatters: {
		aadhaar_number(value) {
			if (!value) return "";
			return "XXXX-XXXX-" + String(value).slice(-4);
		},
	},
};
