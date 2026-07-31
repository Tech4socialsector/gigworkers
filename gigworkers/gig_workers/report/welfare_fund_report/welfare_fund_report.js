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

	get_datatable_options: function (options) {
		return Object.assign(options, { layout: "fluid" });
	},

	formatter: function (value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);
		const is_unattributed_row = !data.aggregator;

		if (column.fieldname === "aggregator_name" && is_unattributed_row) {
			value = `<span style="font-style: italic; color: var(--text-muted);">${value}</span>`;
		}

		if (
			["welfare_fund_balance", "total_welfare_collected"].includes(column.fieldname)
		) {
			value = `<strong>${value}</strong>`;
		}

		if (column.fieldname === "pending_withdrawals") {
			if (data.pending_withdrawals > 0) {
				value = `<span style="color: #e67e22; font-weight: 600;">${value}</span>`;
			} else {
				value = `<span style="color: var(--text-muted);">${value}</span>`;
			}
		}

		const zero_muted_columns = ["total_fee_payments", "total_withdrawals_paid"];
		if (zero_muted_columns.includes(column.fieldname) && Number(data[column.fieldname]) === 0) {
			value = `<span style="color: var(--text-muted);">${value}</span>`;
		}

		return value;
	},
};