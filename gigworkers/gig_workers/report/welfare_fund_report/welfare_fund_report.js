// Copyright (c) 2026, Jenifar and contributors
// For license information, please see license.txt

frappe.query_reports["Welfare Fund Report"] = {
	filters: [
		{
			fieldname: "aggregator",
			label: __("Aggregator"),
			fieldtype: "Link",
			options: "Aggregator",
		},
	],

	formatter: function (value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);
		if (!data) return value;

		if (column.fieldname === "aggregator_name" && !data.aggregator) {
			return `<span style="font-style: italic; color: var(--text-muted);">${value}</span>`;
		}
		if (column.fieldname === "fees_outstanding" && data.fees_outstanding > 0) {
			return `<span style="color: var(--red-600, #c0392b); font-weight: 600;">${value}</span>`;
		}
		if (column.fieldname === "pending_withdrawals" && data.pending_withdrawals > 0) {
			return `<span style="color: var(--orange-600, #e67e22); font-weight: 600;">${value}</span>`;
		}
		// Zero amounts recede so the real money stands out
		if (column.fieldtype === "Currency" || column.fieldtype === "Int") {
			if (!Number(data[column.fieldname])) return `<span style="color: var(--text-muted);">${value}</span>`;
		}
		return value;
	},
};
