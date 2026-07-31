# Copyright (c) 2026, Jenifar and contributors
# For license information, please see license.txt

import frappe
from frappe import _


def execute(filters: dict | None = None):
	"""Return columns and data for the Welfare Fund Report.

	One row per Aggregator, summarising welfare collection, fund balances
	and benefit withdrawals so the Admin has a clean, money-only view
	without the worker/transaction columns of the Admin Summary Report.
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
			"label": _("Welfare Collected"),
			"fieldname": "total_welfare_collected",
			"fieldtype": "Currency",
			"options": "INR",
			"width": 160,
		},
		{
			"label": _("Fee Payments Received"),
			"fieldname": "total_fee_payments",
			"fieldtype": "Currency",
			"options": "INR",
			"width": 180,
		},
		{
			"label": _("Fund Balance"),
			"fieldname": "welfare_fund_balance",
			"fieldtype": "Currency",
			"options": "INR",
			"width": 150,
		},
		{
			"label": _("Withdrawals Paid"),
			"fieldname": "total_withdrawals_paid",
			"fieldtype": "Currency",
			"options": "INR",
			"width": 160,
		},
		{
			"label": _("Pending Withdrawal Requests"),
			"fieldname": "pending_withdrawals",
			"fieldtype": "Int",
			"width": 200,
		},
	]


def get_data(filters: dict) -> list[dict]:
	"""Fetch one welfare-fund summary row per Aggregator.

	Each metric is computed via its own correlated subquery rather than a
	single multi-table JOIN, because Welfare Fee Payment / Welfare Fund
	Account / Welfare Benefit Withdrawal are all one-to-many from
	Aggregator (via Gig Worker) — joining them together directly would
	create a cartesian product and silently inflate every SUM/COUNT.
	"""
	agg_condition, agg_values = get_aggregator_conditions(filters)

	data = frappe.db.sql(
		f"""
		SELECT
			agg.name AS aggregator,
			agg.aggregator_name AS aggregator_name,

			(
				SELECT IFNULL(SUM(gt.welfare_amount), 0)
				FROM `tabGig Transaction` gt
				WHERE gt.aggregator = agg.name
			) AS total_welfare_collected,

			(
				SELECT IFNULL(SUM(wfp.fee_amount), 0)
				FROM `tabWelfare Fee Payment` wfp
				WHERE wfp.aggregator = agg.name AND wfp.payment_status = 'Completed'
			) AS total_fee_payments,

			(
				SELECT IFNULL(SUM(wfa.account_balance), 0)
				FROM `tabWelfare Fund Account` wfa
				INNER JOIN `tabGig Worker` gw
					ON gw.name = wfa.gig_worker
				WHERE gw.created_by_aggregator = agg.name
			) AS welfare_fund_balance,

			(
				SELECT IFNULL(SUM(wbw.amount), 0)
				FROM `tabWelfare Benefit Withdrawal` wbw
				INNER JOIN `tabGig Worker` gw
					ON gw.name = wbw.gig_worker
				WHERE gw.created_by_aggregator = agg.name AND wbw.status = 'Paid'
			) AS total_withdrawals_paid,

			(
				SELECT COUNT(wbw.name)
				FROM `tabWelfare Benefit Withdrawal` wbw
				INNER JOIN `tabGig Worker` gw
					ON gw.name = wbw.gig_worker
				WHERE gw.created_by_aggregator = agg.name AND wbw.status = 'Requested'
			) AS pending_withdrawals

		FROM `tabAggregator` agg
		WHERE {agg_condition}
		ORDER BY agg.aggregator_name
		""",
		agg_values,
		as_dict=True,
	)

	return data


def get_unattributed_row(filters: dict) -> dict | None:
	"""Welfare fund balances / withdrawals for workers with no aggregator link.

	Many Gig Worker records have no valid "Created By Aggregator" value
	(bulk-imported without that field). Any welfare fund balance or
	withdrawal tied to those workers cannot be attributed to any
	aggregator row above, so it is surfaced here explicitly instead of
	silently vanishing from the totals.
	"""
	if filters.get("aggregator"):
		return None

	row = frappe.db.sql(
		"""
		SELECT
			(
				SELECT IFNULL(SUM(wfa.account_balance), 0)
				FROM `tabWelfare Fund Account` wfa
				INNER JOIN `tabGig Worker` gw
					ON gw.name = wfa.gig_worker
				WHERE gw.created_by_aggregator IS NULL
			) AS welfare_fund_balance,

			(
				SELECT IFNULL(SUM(wbw.amount), 0)
				FROM `tabWelfare Benefit Withdrawal` wbw
				INNER JOIN `tabGig Worker` gw
					ON gw.name = wbw.gig_worker
				WHERE gw.created_by_aggregator IS NULL AND wbw.status = 'Paid'
			) AS total_withdrawals_paid,

			(
				SELECT COUNT(wbw.name)
				FROM `tabWelfare Benefit Withdrawal` wbw
				INNER JOIN `tabGig Worker` gw
					ON gw.name = wbw.gig_worker
				WHERE gw.created_by_aggregator IS NULL AND wbw.status = 'Requested'
			) AS pending_withdrawals
		""",
		{},
		as_dict=True,
	)[0]

	if not (row["welfare_fund_balance"] or row["total_withdrawals_paid"] or row["pending_withdrawals"]):
		return None

	return {
		"aggregator": None,
		"aggregator_name": _("Unattributed / Bulk-Imported Workers"),
		"total_welfare_collected": 0,
		"total_fee_payments": 0,
		**row,
	}


def get_aggregator_conditions(filters: dict):
	conditions = ["1=1"]
	values = {}

	if filters.get("aggregator"):
		conditions.append("agg.name = %(aggregator)s")
		values["aggregator"] = filters["aggregator"]

	return " AND ".join(conditions), values


def get_report_summary(data: list[dict]) -> list[dict]:
	total_welfare = sum(row["total_welfare_collected"] or 0 for row in data)
	total_fee_payments = sum(row["total_fee_payments"] or 0 for row in data)
	total_fund_balance = sum(row["welfare_fund_balance"] or 0 for row in data)
	total_withdrawals_paid = sum(row["total_withdrawals_paid"] or 0 for row in data)
	total_pending_withdrawals = sum(row["pending_withdrawals"] or 0 for row in data)

	return [
		{"value": total_welfare, "label": _("Total Welfare Collected"), "datatype": "Currency"},
		{"value": total_fee_payments, "label": _("Total Fee Payments"), "datatype": "Currency"},
		{"value": total_fund_balance, "label": _("Total Fund Balance"), "datatype": "Currency"},
		{"value": total_withdrawals_paid, "label": _("Total Withdrawals Paid"), "datatype": "Currency"},
		{"value": total_pending_withdrawals, "label": _("Pending Withdrawal Requests"), "datatype": "Int"},
	]