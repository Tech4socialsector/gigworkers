// Copyright (c) 2026, Jenifar and contributors
// For license information, please see license.txt

frappe.query_reports["Service Rate History"] = {
	filters: [
		{
			fieldname: "service",
			label:     __("Service"),
			fieldtype: "Link",
			options:   "Service",
		},
		{
			fieldname: "category",
			label:     __("Category"),
			fieldtype: "Link",
			options:   "Service Category",
		},
		{
			fieldname: "vehicle_type",
			label:     __("Vehicle Type"),
			fieldtype: "Link",
			options:   "Vehicle Type",
		},
		{
			fieldname: "status",
			label:     __("Status"),
			fieldtype: "Select",
			options:   "\nActive\nScheduled\nExpired",
		},
	],

	formatter(value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);
		if (column.fieldname === "status" && data) {
			const colors = { Active: "#1e8449", Scheduled: "#b7770d", Expired: "#c0392b" };
			const c = colors[data.status];
			if (c) value = `<span style="color:${c};font-weight:600;">${data.status}</span>`;
		}
		return value;
	},
};
