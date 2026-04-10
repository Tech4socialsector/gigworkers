// Copyright (c) 2026, Jenifar and contributors
// For license information, please see license.txt

frappe.query_reports["Quarterly Welfare Compliance Report"] = {
	filters: [
		{
			"fieldname": "year",
			"label": __("Year"),
			"fieldtype": "Select",
			"options": "\n2026\n2025\n2024",
			"default": "2026",
		},
		{
			"fieldname": "quarter",
			"label": __("Quarter"),
			"fieldtype": "Select",
			"options": "\nQ1\nQ2\nQ3\nQ4",
			"default": "Q1",
		},
		{
			"fieldname": "gig_worker",
			"label": __("Gig Worker"),
			"fieldtype": "Link",
			"options": "Gig Worker",
		},
		{
			"fieldname": "aggregator",
			"label": __("Aggregator"),
			"fieldtype": "Link",
			"options": "Aggregator",
		},
		{
			"fieldname": "status",
			"label": __("Status"),
			"fieldtype": "Select",
			"options": "\nRegistered\nPayment Pending\nCompleted\nCancelled",
		},
		{
			"fieldname": "settlement_status",
			"label": __("Settlement Status"),
			"fieldtype": "Select",
			"options": "\nPending\nConfirmed\nSettled",
		},
	],
};
