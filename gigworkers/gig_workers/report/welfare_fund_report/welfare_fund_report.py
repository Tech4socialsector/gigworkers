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
	report_summary = get_report_summary(data, filters)
	return columns, data, None, None, report_summary


def get_columns() -> list[dict]:
	money = lambda label, fieldname, width=150: {
		"label": _(label), "fieldname": fieldname, "fieldtype": "Currency", "options": "INR", "width": width}
	return [
		{"label": _("Aggregator"), "fieldname": "aggregator", "fieldtype": "Link", "options": "Aggregator", "width": 110},
		{"label": _("Name"), "fieldname": "aggregator_name", "fieldtype": "Data", "width": 230},
		money("Welfare Fees Raised", "fees_raised"),
		money("Fees Paid", "fees_paid", 130),
		money("Fees Outstanding", "fees_outstanding"),
		money("Credited to Worker Funds", "credited_to_workers", 190),
		money("Withdrawals Paid", "withdrawals_paid", 150),
		{"label": _("Pending Withdrawals"), "fieldname": "pending_withdrawals", "fieldtype": "Int", "width": 160},
	]


def get_data(filters: dict) -> list[dict]:
	"""One welfare-money row per Aggregator, newest aggregators first.

	Each figure is totalled in its own grouped subquery and joined once per
	aggregator — joining fees, ledger credits and withdrawals directly would
	multiply rows and inflate every SUM.
	  • Fees raised / paid  — Welfare Fee Payment (one per transaction), as on the dashboards
	  • Credited to workers — welfare fund ledger credits, via the credited transaction's aggregator
	  • Withdrawals         — benefit withdrawals of the aggregator's workers
	"""
	agg_condition, values = get_aggregator_conditions(filters)
	return frappe.db.sql(
		f"""
		SELECT
			agg.name AS aggregator,
			agg.aggregator_name,
			IFNULL(fee.raised, 0) AS fees_raised,
			IFNULL(fee.paid, 0) AS fees_paid,
			IFNULL(fee.raised, 0) - IFNULL(fee.paid, 0) AS fees_outstanding,
			IFNULL(cr.credited, 0) AS credited_to_workers,
			IFNULL(wd.paid, 0) AS withdrawals_paid,
			IFNULL(wd.pending, 0) AS pending_withdrawals
		FROM `tabAggregator` agg
		LEFT JOIN (
			SELECT aggregator,
				SUM(fee_amount) AS raised,
				SUM(CASE WHEN payment_status = 'Completed' THEN fee_amount ELSE 0 END) AS paid
			FROM `tabWelfare Fee Payment`
			WHERE IFNULL(payment_status, '') != 'Failed'
			GROUP BY aggregator
		) fee ON fee.aggregator = agg.name
		LEFT JOIN (
			SELECT gt.aggregator, SUM(le.amount) AS credited
			FROM `tabWelfare Fund Ledger Entry` le
			JOIN `tabGig Transaction` gt ON gt.name = le.gig_transaction
			WHERE le.parenttype = 'Welfare Fund Account' AND le.entry_type = 'Credit'
			GROUP BY gt.aggregator
		) cr ON cr.aggregator = agg.name
		LEFT JOIN (
			SELECT gw.created_by_aggregator AS aggregator,
				SUM(CASE WHEN wbw.status = 'Paid' THEN wbw.amount ELSE 0 END) AS paid,
				SUM(CASE WHEN wbw.status = 'Requested' THEN 1 ELSE 0 END) AS pending
			FROM `tabWelfare Benefit Withdrawal` wbw
			JOIN `tabGig Worker` gw ON gw.name = wbw.gig_worker
			GROUP BY gw.created_by_aggregator
		) wd ON wd.aggregator = agg.name
		WHERE {agg_condition}
		ORDER BY agg.creation DESC
		""",
		values,
		as_dict=True,
	)


def get_unattributed_row(filters: dict) -> dict | None:
	"""Credits and withdrawals that cannot be tied to any aggregator row.

	Bulk-imported workers often have no "Created By Aggregator", and some
	credits have no source transaction; they are shown here instead of
	silently vanishing from the totals.
	"""
	if filters.get("aggregator"):
		return None
	row = frappe.db.sql(
		"""
		SELECT
			(SELECT IFNULL(SUM(le.amount), 0) FROM `tabWelfare Fund Ledger Entry` le
				LEFT JOIN `tabGig Transaction` gt ON gt.name = le.gig_transaction
				WHERE le.parenttype = 'Welfare Fund Account' AND le.entry_type = 'Credit'
					AND IFNULL(gt.aggregator, '') = '') AS credited_to_workers,
			(SELECT IFNULL(SUM(wbw.amount), 0) FROM `tabWelfare Benefit Withdrawal` wbw
				JOIN `tabGig Worker` gw ON gw.name = wbw.gig_worker
				WHERE IFNULL(gw.created_by_aggregator, '') = '' AND wbw.status = 'Paid') AS withdrawals_paid,
			(SELECT COUNT(*) FROM `tabWelfare Benefit Withdrawal` wbw
				JOIN `tabGig Worker` gw ON gw.name = wbw.gig_worker
				WHERE IFNULL(gw.created_by_aggregator, '') = '' AND wbw.status = 'Requested') AS pending_withdrawals
		""",
		as_dict=True,
	)[0]
	if not (row.credited_to_workers or row.withdrawals_paid or row.pending_withdrawals):
		return None
	return {"aggregator": None, "aggregator_name": _("Unattributed / Bulk-Imported Workers"),
		"fees_raised": 0, "fees_paid": 0, "fees_outstanding": 0, **row}


def get_aggregator_conditions(filters: dict):
	conditions = ["1=1"]
	values = {}
	if filters.get("aggregator"):
		conditions.append("agg.name = %(aggregator)s")
		values["aggregator"] = filters["aggregator"]
	return " AND ".join(conditions), values


def get_report_summary(data: list[dict], filters: dict) -> list[dict]:
	total = lambda key: sum(row.get(key) or 0 for row in data)
	# Money held in worker funds right now (all accounts, or the chosen aggregator's workers)
	held = frappe.db.sql(
		"""SELECT IFNULL(SUM(wfa.account_balance), 0) FROM `tabWelfare Fund Account` wfa
		LEFT JOIN `tabGig Worker` gw ON gw.name = wfa.gig_worker
		WHERE %(aggregator)s IS NULL OR gw.created_by_aggregator = %(aggregator)s""",
		{"aggregator": filters.get("aggregator")},
	)[0][0]
	return [
		{"value": total("fees_raised"), "label": _("Welfare Fees Raised"), "datatype": "Currency", "indicator": "Blue"},
		{"value": total("fees_paid"), "label": _("Fees Paid by Aggregators"), "datatype": "Currency", "indicator": "Green"},
		{"value": total("fees_outstanding"), "label": _("Fees Outstanding"), "datatype": "Currency",
			"indicator": "Red" if total("fees_outstanding") else "Green"},
		{"value": held, "label": _("Held in Worker Funds"), "datatype": "Currency", "indicator": "Green"},
		{"value": total("withdrawals_paid"), "label": _("Withdrawals Paid"), "datatype": "Currency"},
		{"value": total("pending_withdrawals"), "label": _("Pending Withdrawals"), "datatype": "Int",
			"indicator": "Orange" if total("pending_withdrawals") else "Gray"},
	]
