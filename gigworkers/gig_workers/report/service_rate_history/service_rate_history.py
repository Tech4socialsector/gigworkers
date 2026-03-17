# Copyright (c) 2026, Jenifar and contributors
# For license information, please see license.txt

import frappe


def execute(filters=None):
	filters = filters or {}
	columns = get_columns()
	data    = get_data(filters)
	return columns, data


def get_columns():
	return [
		{
			"fieldname": "service",
			"label":     "Service",
			"fieldtype": "Link",
			"options":   "Service",
			"width":     120,
		},
		{
			"fieldname": "category",
			"label":     "Category",
			"fieldtype": "Link",
			"options":   "Service Category",
			"width":     140,
		},
		{
			"fieldname": "vehicle_type",
			"label":     "Vehicle Type",
			"fieldtype": "Link",
			"options":   "Vehicle Type",
			"width":     120,
		},
		{
			"fieldname": "welfare_percentage_",
			"label":     "Welfare %",
			"fieldtype": "Float",
			"width":     110,
		},
		{
			"fieldname": "welfare_cap",
			"label":     "Welfare Cap (₹)",
			"fieldtype": "Currency",
			"width":     140,
		},
		{
			"fieldname": "effective_start_date",
			"label":     "Start Date",
			"fieldtype": "Date",
			"width":     120,
		},
		{
			"fieldname": "effective_end_date",
			"label":     "End Date",
			"fieldtype": "Date",
			"width":     120,
		},
		{
			"fieldname": "status",
			"label":     "Status",
			"fieldtype": "Data",
			"width":     110,
		},
	]


def get_data(filters):
	conditions = []
	values     = {}

	if filters.get("service"):
		conditions.append("log.parent = %(service)s")
		values["service"] = filters["service"]

	if filters.get("status"):
		conditions.append("log.status = %(status)s")
		values["status"] = filters["status"]

	if filters.get("category"):
		conditions.append("svc.category = %(category)s")
		values["category"] = filters["category"]

	if filters.get("vehicle_type"):
		conditions.append("svc.vehicle_type = %(vehicle_type)s")
		values["vehicle_type"] = filters["vehicle_type"]

	where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

	return frappe.db.sql(f"""
		SELECT
			log.parent             AS service,
			svc.category           AS category,
			svc.vehicle_type       AS vehicle_type,
			log.welfare_percentage_ AS welfare_percentage_,
			log.welfare_cap        AS welfare_cap,
			log.effective_start_date,
			log.effective_end_date,
			log.status
		FROM `tabService Rate Log` log
		JOIN `tabService` svc ON svc.name = log.parent
		{where}
		ORDER BY log.parent, log.creation DESC
	""", values, as_dict=True)
