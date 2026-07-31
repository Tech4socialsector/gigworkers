# Copyright (c) 2026, Jenifar and contributors
# For license information, please see license.txt

import frappe
from frappe import _


def execute(filters: dict | None = None):
	"""Return columns and data for the Admin Summary Report.

	One row per Aggregator, summarising gig worker counts and transaction
	volumes so the Admin gets a clear, exportable overview of platform
	activity. Welfare fund / money figures live in the separate
	"Welfare Fund Report" to keep both reports readable on one screen.
	"""
	filters = filters or {}
	columns = get_columns()
	data = get_data(filters)
	unattributed_row = get_unattributed_row(filters)
	if unattributed_row and not filters.get("aggregator"):
		data.append(unattributed_row)
	report_summary = get_report_summary(data)
	return columns, data, None, None, report_summary


def get_columns() -> list[dict]:
	return [
		{
			"label": _("Aggregator"),
			"fieldname": "aggregator",
			"fieldtype": "Link",
			"options": "Aggregator",
			"width": 100,
		},
		{
			"label": _("Name"),
			"fieldname": "aggregator_name",
			"fieldtype": "Data",
			"width": 170,
		},
		{
			"label": _("Status"),
			"fieldname": "aggregator_status",
			"fieldtype": "Data",
			"width": 140,
		},
		{
			"label": _("Total Workers"),
			"fieldname": "total_gig_workers",
			"fieldtype": "Int",
			"width": 110,
		},
		{
			"label": _("Active"),
			"fieldname": "active_workers",
			"fieldtype": "Int",
			"width": 90,
		},
		{
			"label": _("Inactive / Deceased"),
			"fieldname": "inactive_workers",
			"fieldtype": "Int",
			"width": 140,
		},
		{
			"label": _("Total Txns"),
			"fieldname": "total_transactions",
			"fieldtype": "Int",
			"width": 100,
		},
		{
			"label": _("Completed"),
			"fieldname": "completed_transactions",
			"fieldtype": "Int",
			"width": 100,
		},
		{
			"label": _("Pending"),
			"fieldname": "pending_transactions",
			"fieldtype": "Int",
			"width": 100,
		},
		{
			"label": _("Suspected Duplicate"),
			"fieldname": "suspected_duplicate_transactions",
			"fieldtype": "Int",
			"width": 140,
		},
		{
			"label": _("Total Transaction Value"),
			"fieldname": "total_transaction_amount",
			"fieldtype": "Currency",
			"options": "INR",
			"width": 170,
		},
	]


def get_data(filters: dict) -> list[dict]:
	"""Fetch one summary row per Aggregator.

	Each metric is computed via its own correlated subquery rather than a
	single multi-table JOIN, because Gig Worker and Gig Transaction are
	both one-to-many from Aggregator — joining them together directly
	would create a cartesian product and silently inflate every count.
	"""
	date_condition, date_values = get_date_conditions(filters)
	agg_condition, agg_values = get_aggregator_conditions(filters)

	values = {**date_values, **agg_values}

	data = frappe.db.sql(
		f"""
		SELECT
			agg.name AS aggregator,
			agg.aggregator_name AS aggregator_name,
			agg.status AS aggregator_status,

			(
				SELECT COUNT(gw.name)
				FROM `tabGig Worker` gw
				WHERE gw.created_by_aggregator = agg.name
			) AS total_gig_workers,

			(
				SELECT COUNT(gw.name)
				FROM `tabGig Worker` gw
				WHERE gw.created_by_aggregator = agg.name AND gw.status = 'Active'
			) AS active_workers,

			(
				SELECT COUNT(gw.name)
				FROM `tabGig Worker` gw
				WHERE gw.created_by_aggregator = agg.name AND gw.status IN ('Inactive', 'Deceased')
			) AS inactive_workers,

			(
				SELECT COUNT(gt.name)
				FROM `tabGig Transaction` gt
				WHERE gt.aggregator = agg.name {date_condition}
			) AS total_transactions,

			(
				SELECT COUNT(gt.name)
				FROM `tabGig Transaction` gt
				WHERE gt.aggregator = agg.name AND gt.status = 'Payment complete' {date_condition}
			) AS completed_transactions,

			(
				SELECT COUNT(gt.name)
				FROM `tabGig Transaction` gt
				WHERE gt.aggregator = agg.name AND gt.status = 'Payment pending' {date_condition}
			) AS pending_transactions,

			(
				SELECT COUNT(gt.name)
				FROM `tabGig Transaction` gt
				WHERE gt.aggregator = agg.name AND gt.status = 'Suspected duplicate' {date_condition}
			) AS suspected_duplicate_transactions,

			(
				SELECT IFNULL(SUM(gt.amount), 0)
				FROM `tabGig Transaction` gt
				WHERE gt.aggregator = agg.name {date_condition}
			) AS total_transaction_amount

		FROM `tabAggregator` agg
		WHERE {agg_condition}
		ORDER BY agg.aggregator_name
		""",
		values,
		as_dict=True,
	)

	return data


def get_unattributed_row(filters: dict) -> dict | None:
	"""Gig Workers bulk-imported without a valid Created By Aggregator link.

	A large share of Gig Worker records only have a free-text value in
	"Name of Aggregator" (which may not even match a real Aggregator, e.g.
	"Zomato", "Uber") and no value in "Created By Aggregator" at all. Those
	workers, and any transactions tied to them, cannot be attributed to any
	aggregator row above — they are surfaced here explicitly instead of
	silently vanishing from the totals.
	"""
	if filters.get("aggregator_status"):
		return None

	total = frappe.db.count("Gig Worker", {"created_by_aggregator": ["is", "not set"]})
	if not total:
		return None

	date_condition, date_values = get_date_conditions(filters)

	row = frappe.db.sql(
		f"""
		SELECT
			(
				SELECT COUNT(gw.name)
				FROM `tabGig Worker` gw
				WHERE gw.created_by_aggregator IS NULL AND gw.status = 'Active'
			) AS active_workers,

			(
				SELECT COUNT(gw.name)
				FROM `tabGig Worker` gw
				WHERE gw.created_by_aggregator IS NULL AND gw.status IN ('Inactive', 'Deceased')
			) AS inactive_workers,

			(
				SELECT COUNT(gt.name)
				FROM `tabGig Transaction` gt
				WHERE gt.aggregator IS NULL {date_condition}
			) AS total_transactions,

			(
				SELECT COUNT(gt.name)
				FROM `tabGig Transaction` gt
				WHERE gt.aggregator IS NULL AND gt.status = 'Payment complete' {date_condition}
			) AS completed_transactions,

			(
				SELECT COUNT(gt.name)
				FROM `tabGig Transaction` gt
				WHERE gt.aggregator IS NULL AND gt.status = 'Payment pending' {date_condition}
			) AS pending_transactions,

			(
				SELECT COUNT(gt.name)
				FROM `tabGig Transaction` gt
				WHERE gt.aggregator IS NULL AND gt.status = 'Suspected duplicate' {date_condition}
			) AS suspected_duplicate_transactions,

			(
				SELECT IFNULL(SUM(gt.amount), 0)
				FROM `tabGig Transaction` gt
				WHERE gt.aggregator IS NULL {date_condition}
			) AS total_transaction_amount
		""",
		date_values,
		as_dict=True,
	)[0]

	return {
		"aggregator": None,
		"aggregator_name": _("Unattributed / Bulk-Imported Workers"),
		"aggregator_status": "",
		"total_gig_workers": total,
		**row,
	}


def get_date_conditions(filters: dict):
	"""Build an extra AND clause (for use inside subqueries) plus its values."""
	clause = ""
	values = {}

	if filters.get("from_date"):
		clause += " AND gt.date >= %(from_date)s"
		values["from_date"] = filters["from_date"]

	if filters.get("to_date"):
		clause += " AND gt.date <= %(to_date)s"
		values["to_date"] = filters["to_date"]

	return clause, values


def get_aggregator_conditions(filters: dict):
	conditions = ["1=1"]
	values = {}

	if filters.get("aggregator"):
		conditions.append("agg.name = %(aggregator)s")
		values["aggregator"] = filters["aggregator"]

	if filters.get("aggregator_status"):
		conditions.append("agg.status = %(aggregator_status)s")
		values["aggregator_status"] = filters["aggregator_status"]

	return " AND ".join(conditions), values


def get_report_summary(data: list[dict]) -> list[dict]:
	total_workers = sum(row["total_gig_workers"] or 0 for row in data)
	total_active = sum(row["active_workers"] or 0 for row in data)
	total_transactions = sum(row["total_transactions"] or 0 for row in data)
	total_transaction_amount = sum(row["total_transaction_amount"] or 0 for row in data)

	return [
		{"value": total_workers, "label": _("Total Gig Workers"), "datatype": "Int"},
		{"value": total_active, "label": _("Active Workers"), "datatype": "Int"},
		{"value": total_transactions, "label": _("Total Transactions"), "datatype": "Int"},
		{
			"value": total_transaction_amount,
			"label": _("Total Transaction Value"),
			"datatype": "Currency",
		},
	]
