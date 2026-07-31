// Copyright (c) 2026, Jenifar and contributors
// For license information, please see license.txt

frappe.query_reports["Admin Summary Report"] = {
	filters: [
		{
			fieldname: "aggregator",
			label: __("Aggregator"),
			fieldtype: "Link",
			options: "Aggregator",
		},
		{
			fieldname: "aggregator_status",
			label: __("Aggregator Status"),
			fieldtype: "Select",
			options: "\nSubmitted\nUnder Process\nPending with Clarification\nApproved",
		},
		{
			fieldname: "from_date",
			label: __("Transactions From"),
			fieldtype: "Date",
		},
		{
			fieldname: "to_date",
			label: __("Transactions To"),
			fieldtype: "Date",
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

		if (column.fieldname === "aggregator_status") {
			if (!data.aggregator_status) {
				return "";
			}
			let colors = {
				Approved: "green",
				"Under Process": "orange",
				"Pending with Clarification": "orange",
				Submitted: "blue",
			};
			let color = colors[data.aggregator_status] || "gray";
			value = `<span class="indicator-pill ${color}">${data.aggregator_status}</span>`;
		}

		if (
			["total_gig_workers", "active_workers", "total_transactions", "total_transaction_amount"].includes(
				column.fieldname
			)
		) {
			value = `<strong>${value}</strong>`;
		}

		if (
			column.fieldname === "suspected_duplicate_transactions" &&
			data.suspected_duplicate_transactions > 0
		) {
			value = `<span style="color: #d63031; font-weight: 600;">${value}</span>`;
		}

		const zero_muted_columns = [
			"inactive_workers",
			"pending_transactions",
			"suspected_duplicate_transactions",
		];
		if (zero_muted_columns.includes(column.fieldname) && Number(data[column.fieldname]) === 0) {
			value = `<span style="color: var(--text-muted);">${value}</span>`;
		}

		return value;
	},
};
