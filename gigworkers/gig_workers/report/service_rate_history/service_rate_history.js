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
		if (!data) return value;

		if (column.fieldname === "status") {
			const cfg = {
				Active:    { color: "#155724", bg: "#d4edda", border: "#c3e6cb" },
				Scheduled: { color: "#856404", bg: "#fff3cd", border: "#ffeeba" },
				Expired:   { color: "#721c24", bg: "#f8d7da", border: "#f5c6cb" },
			}[data.status];
			if (cfg) {
				return `<span style="
					background:${cfg.bg};color:${cfg.color};
					border:1px solid ${cfg.border};
					padding:2px 10px;border-radius:12px;
					font-size:12px;font-weight:600;
					display:inline-block;
				">${data.status}</span>`;
			}
		}

		if (column.fieldname === "welfare_percentage_" && data.welfare_percentage_ != null) {
			return `<span style="font-weight:600;">${data.welfare_percentage_}%</span>`;
		}

		return value;
	},

	after_refresh() {
		// Add padding and row height to the report table
		const style = document.getElementById("srhist-style");
		if (style) return;

		const el = document.createElement("style");
		el.id = "srhist-style";
		el.textContent = `
			.dt-cell__content { padding: 8px 12px !important; }
			.dt-row { height: 44px !important; }
			.dt-header .dt-cell__content {
				padding: 10px 12px !important;
				font-weight: 700 !important;
				font-size: 12px !important;
				text-transform: uppercase;
				letter-spacing: .4px;
				color: #555 !important;
				background: #f8f9fa;
			}
			.dt-row:hover .dt-cell { background: #f0f4ff !important; }
		`;
		document.head.appendChild(el);
	},
};
