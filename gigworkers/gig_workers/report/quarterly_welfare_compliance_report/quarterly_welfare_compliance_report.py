# Copyright (c) 2026, Jenifar and contributors
# For license information, please see license.txt

import frappe
from frappe import _


def execute(filters: dict | None = None):
	"""Return columns and data for the Quarterly Welfare Compliance Report."""
	filters = filters or {}
	columns = get_columns()
	data = get_data(filters)
	return columns, data


def get_columns() -> list[dict]:
	"""Return columns for the Quarterly Welfare Compliance Report."""
	return [
		{
			"label": _("Gig Worker"),
			"fieldname": "gig_worker",
			"fieldtype": "Link",
			"options": "Gig Worker",
			"width": 160,
		},
		{
			"label": _("Aggregator"),
			"fieldname": "aggregator",
			"fieldtype": "Link",
			"options": "Aggregator",
			"width": 160,
		},
		{
			"label": _("Service"),
			"fieldname": "service",
			"fieldtype": "Link",
			"options": "Service",
			"width": 140,
		},
		{
			"label": _("Role"),
			"fieldname": "role",
			"fieldtype": "Data",
			"width": 120,
		},
		{
			"label": _("Total Transactions"),
			"fieldname": "total_transactions",
			"fieldtype": "Int",
			"width": 130,
		},
		{
			"label": _("Total Amount"),
			"fieldname": "total_amount",
			"fieldtype": "Currency",
			"width": 140,
		},
		{
			"label": _("Total Base Payout"),
			"fieldname": "total_base_payout",
			"fieldtype": "Currency",
			"width": 150,
		},
		{
			"label": _("Total Incentives"),
			"fieldname": "total_incentives",
			"fieldtype": "Currency",
			"width": 140,
		},
		{
			"label": _("Total Welfare Amount"),
			"fieldname": "total_welfare_amount",
			"fieldtype": "Currency",
			"width": 160,
		},
		{
			"label": _("Welfare %"),
			"fieldname": "welfare_percentage",
			"fieldtype": "Float",
			"width": 100,
		},
		{
			"label": _("Status"),
			"fieldname": "status",
			"fieldtype": "Data",
			"width": 120,
		},
		{
			"label": _("Settlement Status"),
			"fieldname": "settlement_status",
			"fieldtype": "Data",
			"width": 140,
		},
	]


def get_data(filters: dict) -> list[dict]:
	"""Fetch and return Gig Transaction data for the given quarterly filters."""
	conditions, values = get_conditions(filters)

	data = frappe.db.sql(
		f"""
		SELECT
			gt.gig_worker,
			gt.aggregator,
			gt.service,
			gt.role,
			COUNT(gt.name) AS total_transactions,
			SUM(gt.amount) AS total_amount,
			SUM(gt.base_payout) AS total_base_payout,
			SUM(IFNULL(gt.incentives, 0)) AS total_incentives,
			SUM(IFNULL(gt.welfare_amount, 0)) AS total_welfare_amount,
			AVG(gt.welfare_percentage) AS welfare_percentage,
			gt.status,
			gt.settlement_status
		FROM `tabGig Transaction` gt
		WHERE {conditions}
		GROUP BY
			gt.gig_worker,
			gt.aggregator,
			gt.service,
			gt.role,
			gt.status,
			gt.settlement_status
		ORDER BY
			gt.gig_worker,
			gt.aggregator
		""",
		values,
		as_dict=True,
	)

	return data


def get_conditions(filters: dict):
	"""Build WHERE clause conditions and values from filters."""
	conditions = ["1=1"]
	values = {}

	year = filters.get("year")
	quarter = filters.get("quarter")

	if year and quarter:
		quarter_map = {
			"Q1": ("01-01", "03-31"),
			"Q2": ("04-01", "06-30"),
			"Q3": ("07-01", "09-30"),
			"Q4": ("10-01", "12-31"),
		}
		start_suffix, end_suffix = quarter_map.get(quarter, ("01-01", "12-31"))
		conditions.append("gt.date BETWEEN %(from_date)s AND %(to_date)s")
		values["from_date"] = f"{year}-{start_suffix}"
		values["to_date"] = f"{year}-{end_suffix}"
	elif year:
		conditions.append("YEAR(gt.date) = %(year)s")
		values["year"] = year

	if filters.get("gig_worker"):
		conditions.append("gt.gig_worker = %(gig_worker)s")
		values["gig_worker"] = filters["gig_worker"]

	if filters.get("aggregator"):
		conditions.append("gt.aggregator = %(aggregator)s")
		values["aggregator"] = filters["aggregator"]

	if filters.get("status"):
		conditions.append("gt.status = %(status)s")
		values["status"] = filters["status"]

	if filters.get("settlement_status"):
		conditions.append("gt.settlement_status = %(settlement_status)s")
		values["settlement_status"] = filters["settlement_status"]

	return " AND ".join(conditions), values

