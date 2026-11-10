# Welfare Board Dashboard — /desk/welfare-board-dashboard
#
# Every part of the gig worker welfare scheme in one place — aggregators,
# gig workers, transactions, welfare fees, invoices, the welfare fund and
# benefit withdrawals: filters → headline money flow → a board of cards (one
# section per area) → Timeline tab (one worker or aggregator, start to end)
# → Analytics tab.
#
# Every card is a (source, condition) pair defined once in CARDS; the same
# definition counts the card, drives its drilldown table and its CSV export.
# Admin-only (System Manager): every endpoint calls frappe.only_for().

import csv
import io
import json

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate, nowdate

ADMIN = "System Manager"

# ── sources ───────────────────────────────────────────────────────────────
# Each source is one table aliased `m`, optionally joined to the gig worker `w`.
# Filter expressions are trusted SQL fragments; filter *values* are always bound
# as parameters. `honours` is shown in the card guide.
SOURCES = {
	"agg": {
		"label": "Aggregators",
		"doctype": "Aggregator",
		"from": "`tabAggregator` m",
		"date": "m.creation",
		"agg": "m.name",
		"unit": "m.name",
		"search": ["m.name", "m.aggregator_name", "m.email", "m.name1"],
		"columns": [
			("name", "m.name", "Aggregator ID", "agg_id", True),
			("aggregator_name", "m.aggregator_name", "Aggregator", "agg_person", True),
			("name1", "m.name1", "Authorised person", "text", True),
			("email", "m.email", "Email", "text", True),
			("mobile", "m.mobile", "Mobile", "text", False),
			("status", "m.status", "Status", "status", True),
			("creation", "m.creation", "Registered on", "date", True),
		],
		"sort": "creation",
		"honours": ["Registered date", "Aggregator"],
	},
	"worker": {
		"label": "Gig workers",
		"doctype": "Gig Worker",
		"from": "`tabGig Worker` m",
		"date": "m.creation",
		"agg": "m.name_of_aggregator",
		"unit": "m.name_of_aggregator",
		"gender": "m.gender",
		"wstatus": "m.status",
		"svc": "m.name_of_service",
		"search": ["m.name", "m.worker_name", "m.partner_id", "m.phone"],
		"columns": [
			("name", "m.name", "Worker ID", "worker_id", True),
			("worker_name", "m.worker_name", "Name", "worker", True),
			("partner_id", "m.partner_id", "Partner ID", "text", True),
			("gender", "m.gender", "Gender", "text", True),
			("status", "m.status", "Status", "status", True),
			("aggregator", "m.name_of_aggregator", "Aggregator", "aggregator", True),
			("phone", "m.phone", "Phone", "text", False),
			("creation", "m.creation", "Registered on", "date", True),
		],
		"sort": "creation",
		"honours": ["Registered date", "Aggregator", "Gender", "Worker status", "Service category"],
	},
	"txn": {
		"label": "Gig transactions",
		"doctype": "Gig Transaction",
		"from": "`tabGig Transaction` m LEFT JOIN `tabGig Worker` w ON w.name = m.gig_worker",
		"date": "m.date",
		"agg": "m.aggregator",
		"unit": "m.aggregator",
		"gender": "w.gender",
		"wstatus": "w.status",
		"svc_label": "m.service_category",
		"district": "m.district",
		"search": ["m.name", "m.gig_worker", "w.worker_name", "m.partner_id", "m.external_transaction_id"],
		"columns": [
			("name", "m.name", "Transaction", "id", True),
			("gig_worker", "m.gig_worker", "Worker ID", "worker_id", True),
			("worker_name", "w.worker_name", "Worker", "worker", True),
			("aggregator", "m.aggregator", "Aggregator", "aggregator", True),
			("date", "m.date", "Date", "date", True),
			("service_category", "m.service_category", "Service", "text", True),
			("district", "m.district", "District", "text", True),
			("amount", "m.amount", "Amount", "currency", True),
			("welfare_amount", "m.welfare_amount", "Welfare fee", "currency", True),
			("status", "m.status", "Status", "status", True),
			("settlement_status", "m.settlement_status", "Settlement", "status", True),
		],
		"sort": "date",
		"sum": "m.amount",
		"honours": ["Transaction date", "Aggregator", "Service category", "District", "Gender", "Worker status"],
	},
	"fee": {
		"label": "Welfare fee payments",
		"doctype": "Welfare Fee Payment",
		"from": "`tabWelfare Fee Payment` m LEFT JOIN `tabGig Transaction` t ON t.name = m.transaction"
		" LEFT JOIN `tabGig Worker` w ON w.name = t.gig_worker",
		"date": "m.payment_date",
		"agg": "m.aggregator",
		"unit": "m.aggregator",
		"gender": "w.gender",
		"wstatus": "w.status",
		"svc_label": "t.service_category",
		"district": "t.district",
		"search": ["m.name", "m.transaction", "t.gig_worker", "w.worker_name"],
		"columns": [
			("name", "m.name", "Fee payment", "id", True),
			("transaction", "m.transaction", "Transaction", "txn_id", True),
			("gig_worker", "t.gig_worker", "Worker ID", "worker_id", True),
			("worker_name", "w.worker_name", "Worker", "worker", True),
			("aggregator", "m.aggregator", "Aggregator", "aggregator", True),
			("payment_date", "m.payment_date", "Fee date", "date", True),
			("fee_amount", "m.fee_amount", "Fee", "currency", True),
			("payment_status", "m.payment_status", "Payment", "status", True),
			("settlement_status", "m.settlement_status", "Settlement", "status", True),
		],
		"sort": "payment_date",
		"sum": "m.fee_amount",
		"honours": ["Fee date", "Aggregator", "Service category", "District", "Gender", "Worker status"],
	},
	"invoice": {
		"label": "Welfare fee invoices",
		"doctype": "Welfare Fee Invoice",
		"from": "`tabWelfare Fee Invoice` m",
		"date": "m.from_date",
		"agg": "m.aggregator",
		"unit": "m.aggregator",
		"search": ["m.name", "m.aggregator", "m.aggregator_name"],
		"columns": [
			("name", "m.name", "Invoice", "id", True),
			("aggregator", "m.aggregator", "Aggregator", "aggregator", True),
			("period", "CONCAT(m.quarter, ' ', m.year)", "Quarter", "text", False),
			("from_date", "m.from_date", "Period from", "date", True),
			("due_date", "m.due_date", "Due date", "date", True),
			("invoice_status", "m.invoice_status", "Status", "status", True),
			("total_transactions", "m.total_transactions", "Fees", "int", True),
			("total_due_amount", "m.total_due_amount", "Total due", "currency", True),
			("amount_paid", "m.amount_paid", "Paid", "currency", True),
			("balance_due", "m.balance_due", "Balance", "currency", True),
		],
		"sort": "from_date",
		"sum": "m.total_due_amount",
		"honours": ["Invoice period start", "Aggregator"],
	},
	"fund": {
		"label": "Welfare fund accounts",
		"doctype": "Welfare Fund Account",
		"from": "`tabWelfare Fund Account` m LEFT JOIN `tabGig Worker` w ON w.name = m.gig_worker",
		"agg": "w.name_of_aggregator",
		"unit": "w.name_of_aggregator",
		"gender": "w.gender",
		"wstatus": "w.status",
		"search": ["m.name", "m.gig_worker", "w.worker_name"],
		"columns": [
			("name", "m.name", "Account", "id", True),
			("gig_worker", "m.gig_worker", "Worker ID", "worker_id", True),
			("worker_name", "w.worker_name", "Worker", "worker", True),
			("aggregator", "w.name_of_aggregator", "Aggregator", "aggregator", True),
			("total_collected", "m.total_collected", "Collected", "currency", True),
			("total_withdrawn", "m.total_withdrawn", "Withdrawn", "currency", True),
			("account_balance", "m.account_balance", "Balance", "currency", True),
			("last_updated", "m.last_updated", "Last updated", "datetime", True),
		],
		"sort": "account_balance",
		"sum": "m.account_balance",
		"honours": ["Aggregator", "Gender", "Worker status"],
	},
	"credit": {
		"label": "Welfare fund credits",
		"doctype": "Welfare Fund Account",
		"from": "`tabWelfare Fund Ledger Entry` m"
		" JOIN `tabWelfare Fund Account` a ON a.name = m.parent AND m.parenttype = 'Welfare Fund Account'"
		" LEFT JOIN `tabGig Worker` w ON w.name = a.gig_worker"
		" LEFT JOIN `tabGig Transaction` t ON t.name = m.gig_transaction",
		"where": "m.entry_type = 'Credit'",
		"date": "m.entry_date",
		"agg": "COALESCE(t.aggregator, w.name_of_aggregator)",
		"unit": "COALESCE(t.aggregator, w.name_of_aggregator)",
		"gender": "w.gender",
		"wstatus": "w.status",
		"search": ["a.name", "a.gig_worker", "w.worker_name", "m.reference_name"],
		"columns": [
			("account", "a.name", "Account", "id", True),
			("gig_worker", "a.gig_worker", "Worker ID", "worker_id", True),
			("worker_name", "w.worker_name", "Worker", "worker", True),
			("aggregator", "COALESCE(t.aggregator, w.name_of_aggregator)", "Aggregator", "aggregator", True),
			("entry_date", "m.entry_date", "Credited on", "datetime", True),
			("amount", "m.amount", "Amount", "currency", True),
			("balance_after", "m.balance_after", "Balance after", "currency", True),
			("reference_name", "m.reference_name", "Source", "text", True),
		],
		"id_doctype": "Welfare Fund Account",
		"sort": "entry_date",
		"sum": "m.amount",
		"honours": ["Credit date", "Aggregator", "Gender", "Worker status"],
	},
	"wd": {
		"label": "Benefit withdrawals",
		"doctype": "Welfare Benefit Withdrawal",
		"from": "`tabWelfare Benefit Withdrawal` m LEFT JOIN `tabGig Worker` w ON w.name = m.gig_worker",
		"date": "m.requested_date",
		"agg": "w.name_of_aggregator",
		"unit": "w.name_of_aggregator",
		"gender": "w.gender",
		"wstatus": "w.status",
		"search": ["m.name", "m.gig_worker", "w.worker_name"],
		"columns": [
			("name", "m.name", "Withdrawal", "id", True),
			("gig_worker", "m.gig_worker", "Worker ID", "worker_id", True),
			("worker_name", "w.worker_name", "Worker", "worker", True),
			("withdrawal_type", "m.withdrawal_type", "Type", "text", True),
			("amount", "m.amount", "Amount", "currency", True),
			("requested_date", "m.requested_date", "Requested", "date", True),
			("status", "m.status", "Status", "status", True),
			("payment_date", "m.payment_date", "Paid on", "date", True),
		],
		"sort": "requested_date",
		"sum": "m.amount",
		"honours": ["Requested date", "Aggregator", "Gender", "Worker status"],
	},
	"wimport": {
		"label": "Gig worker imports",
		"doctype": "Gig Worker Import Log",
		"from": "`tabGig Worker Import Log` m",
		"date": "m.import_date",
		"agg": "m.created_by_aggregator",
		"unit": "m.created_by_aggregator",
		"search": ["m.name", "m.file_name", "m.import_id"],
		"columns": [
			("name", "m.name", "Import", "id", True),
			("aggregator", "m.created_by_aggregator", "Aggregator", "aggregator", True),
			("import_date", "m.import_date", "Imported on", "datetime", True),
			("file_name", "m.file_name", "File", "text", True),
			("total_rows", "m.total_rows", "Rows", "int", True),
			("inserted", "m.inserted", "Inserted", "int", True),
			("skipped", "m.skipped", "Skipped", "int", True),
			("error_count", "m.error_count", "Errors", "int", True),
			("status", "m.status", "Status", "status", True),
		],
		"sort": "import_date",
		"sum": "m.inserted",
		"honours": ["Import date", "Aggregator"],
	},
	"timport": {
		"label": "Transaction imports",
		"doctype": "Gig Transaction Import Log",
		"from": "`tabGig Transaction Import Log` m",
		"date": "m.import_date",
		"agg": "m.default_aggregator",
		"unit": "m.default_aggregator",
		"search": ["m.name", "m.file_name", "m.import_id"],
		"columns": [
			("name", "m.name", "Import", "id", True),
			("aggregator", "m.default_aggregator", "Aggregator", "aggregator", True),
			("import_date", "m.import_date", "Imported on", "datetime", True),
			("file_name", "m.file_name", "File", "text", True),
			("total_rows", "m.total_rows", "Rows", "int", True),
			("inserted", "m.inserted", "Inserted", "int", True),
			("skipped", "m.skipped", "Skipped", "int", True),
			("error_count", "m.error_count", "Errors", "int", True),
			("status", "m.status", "Status", "status", True),
		],
		"sort": "import_date",
		"sum": "m.inserted",
		"honours": ["Import date", "Aggregator"],
	},
}

INVOICED = "EXISTS (SELECT 1 FROM `tabWelfare Fee Invoice Item` ii WHERE ii.welfare_fee_payment = m.name)"

# ── cards ────────────────────────────────────────────────────────────────
# key: (source, extra SQL condition, label, tone, guide, flags)
# flags: sum → show ₹ of the source's sum column (or sum_expr) under the count;
#        base → share is shown as % of that card; any_date → ignores dates.
CARDS = {
	# headline: the welfare money flow
	"txn_all": ("txn", None, "Transactions", "info", "Every gig transaction recorded by aggregators in the selected dates.", {"sum": 1}),
	"fee_all": ("fee", None, "Welfare fees raised", "info", "One welfare fee is raised per completed transaction (rate × payout, capped per service).", {"sum": 1}),
	"fee_invoiced": ("fee", INVOICED, "Fees invoiced", "info", "Welfare fees already placed on an aggregator's quarterly invoice.", {"sum": 1, "base": "fee_all"}),
	"fee_paid": ("fee", "m.payment_status = 'Completed'", "Fees paid", "good", "Welfare fees whose invoice the aggregator has paid in full.", {"sum": 1, "base": "fee_all"}),
	"credit_all": ("credit", None, "Credited to workers", "good", "Welfare fund credits — paid fees moved into each worker's welfare fund account.", {"sum": 1}),
	"wd_paid": ("wd", "m.status = 'Paid' AND IFNULL(m.is_refund, 0) = 0", "Paid out to workers", "time", "Benefit withdrawals paid from the welfare fund to workers' bank accounts.", {"sum": 1}),

	# at a glance
	"agg_all": ("agg", None, "Aggregators", "info", "Every aggregator registered in the selected dates.", {}),
	"worker_all": ("worker", None, "Gig workers", "info", "Every gig worker registered in the selected dates.", {}),
	"fund_all": ("fund", None, "Welfare fund accounts", "info", "Workers holding a welfare fund account (any date) — ₹ is the total balance.", {"sum": 1, "any_date": 1}),
	"inv_due": ("invoice", "m.balance_due > 0 AND m.invoice_status != 'Draft'", "Invoices with balance due", "action", "Invoices not yet fully paid — ₹ is the balance still owed on them.", {"sum": 1, "sum_expr": "m.balance_due"}),

	# aggregators
	"agg_submitted": ("agg", "m.status = 'Submitted'", "Submitted", "action", "New registrations waiting for the Board to pick them up.", {}),
	"agg_process": ("agg", "m.status = 'Under Process'", "Under process", "action", "Registrations the Board is reviewing.", {}),
	"agg_clarify": ("agg", "m.status = 'Pending with Clarification'", "Clarification asked", "action", "The Board asked the aggregator for more information.", {}),
	"agg_approved": ("agg", "m.status = 'Approved'", "Approved", "good", "Approved aggregators with portal access.", {}),
	"imp_workers": ("wimport", None, "Worker imports", "info", "Bulk gig worker CSV imports run by aggregators or the Board.", {}),
	"imp_txns": ("timport", None, "Transaction imports", "info", "Bulk transaction CSV imports.", {}),

	# gig workers
	"worker_female": ("worker", "m.gender = 'Female'", "Female", "neutral", "Gig workers recorded as female.", {"base": "worker_all"}),
	"worker_male": ("worker", "m.gender = 'Male'", "Male", "neutral", "Gig workers recorded as male.", {"base": "worker_all"}),
	"worker_active": ("worker", "m.status = 'Active'", "Active", "good", "Gig workers currently active.", {"base": "worker_all"}),
	"worker_inactive": ("worker", "m.status IN ('Inactive', 'Deceased')", "Inactive / deceased", "bad", "Gig workers marked inactive or deceased.", {"base": "worker_all"}),
	"worker_earning": ("worker", "EXISTS (SELECT 1 FROM `tabGig Transaction` x WHERE x.gig_worker = m.name)", "With transactions", "good", "Workers with at least one transaction recorded (any date).", {"base": "worker_all"}),
	"worker_no_login": ("worker", "IFNULL(m.user, '') = ''", "No portal login", "action", "Workers without a portal user — they cannot see their welfare fund yet.", {"base": "worker_all"}),

	# transactions
	"txn_complete": ("txn", "m.status = 'Payment complete'", "Payment complete", "good", "Transactions confirmed as paid to the worker.", {"sum": 1, "base": "txn_all"}),
	"txn_pending": ("txn", "m.status = 'Payment pending'", "Payment pending", "action", "Transactions waiting for confirmation (OTP).", {"sum": 1, "base": "txn_all"}),
	"txn_dup": ("txn", "m.status = 'Suspected duplicate'", "Suspected duplicate", "bad", "Flagged as a possible duplicate — needs an admin decision.", {"base": "txn_all"}),
	"txn_cancel": ("txn", "m.status = 'Payment Cancelled'", "Cancelled", "neutral", "Transactions cancelled after recording.", {"base": "txn_all"}),
	"txn_settled": ("txn", "m.settlement_status = 'Settled'", "Settled", "good", "Welfare fee for this transaction has reached the worker's fund.", {"base": "txn_all"}),
	"txn_unsettled": ("txn", "IFNULL(m.settlement_status, '') != 'Settled'", "Not yet settled", "action", "Welfare fee not yet in the worker's fund.", {"base": "txn_all"}),
	"txn_adjusted": ("txn", "IFNULL(m.adjustment_count, 0) > 0", "Adjusted", "info", "Transactions the aggregator corrected after import.", {"base": "txn_all"}),

	# welfare fees
	"fee_pending": ("fee", "m.payment_status = 'Pending'", "Pending", "action", "Fees raised but not yet paid by the aggregator.", {"sum": 1, "base": "fee_all"}),
	"fee_completed": ("fee", "m.payment_status = 'Completed'", "Completed", "good", "Fees paid and settled to workers.", {"sum": 1, "base": "fee_all"}),
	"fee_uninvoiced": ("fee", "NOT " + INVOICED, "Not yet invoiced", "action", "Fees not on any quarterly invoice yet — they are billed at the next quarter run.", {"sum": 1, "base": "fee_all"}),
	"fee_failed": ("fee", "m.payment_status = 'Failed'", "Failed", "bad", "Fee payments that failed.", {"sum": 1, "base": "fee_all"}),

	# invoices
	"inv_pending": ("invoice", "m.invoice_status = 'Pending'", "Pending", "action", "Invoices issued, nothing paid yet, not past due.", {"sum": 1}),
	"inv_overdue": ("invoice", "m.invoice_status = 'Overdue'", "Overdue", "bad", "Past the due date with a balance outstanding.", {"sum": 1}),
	"inv_partial": ("invoice", "m.invoice_status = 'Partially Paid'", "Partially paid", "action", "Some payment received; balance outstanding.", {"sum": 1}),
	"inv_paid": ("invoice", "m.invoice_status = 'Fully Paid'", "Fully paid", "good", "Paid in full — every fee on it is credited to workers.", {"sum": 1}),

	# fund & withdrawals
	"fund_balance": ("fund", "m.account_balance > 0", "Holding a balance", "good", "Fund accounts with money available to withdraw (any date).", {"sum": 1, "any_date": 1}),
	"wd_requested": ("wd", "m.status = 'Requested'", "Requested", "action", "Withdrawal requests waiting for review.", {"sum": 1}),
	"wd_approved": ("wd", "m.status = 'Approved'", "Approved", "action", "Approved, waiting to be paid out.", {"sum": 1}),
	"wd_paid_all": ("wd", "m.status = 'Paid'", "Paid", "good", "Paid to the worker's bank account.", {"sum": 1}),
	"wd_rejected": ("wd", "m.status = 'Rejected'", "Rejected", "bad", "Requests the Board rejected.", {"sum": 1}),
}

HEADLINE = ["txn_all", "fee_all", "fee_invoiced", "fee_paid", "credit_all", "wd_paid"]

BOARD = [
	{"key": "overview", "title": "At a glance", "tiles": [
		{"title": "Aggregators", "cards": ["agg_all"]},
		{"title": "Gig workers", "cards": ["worker_all"]},
		{"title": "Welfare fund accounts", "cards": ["fund_all"]},
		{"title": "Invoices with balance due", "cards": ["inv_due"]},
	]},
	{"key": "aggregators", "title": "Aggregators", "tiles": [
		{"title": "Registration pipeline", "cards": ["agg_submitted", "agg_process"]},
		{"title": "Decision", "cards": ["agg_clarify", "agg_approved"]},
		{"title": "Bulk imports", "cards": ["imp_workers", "imp_txns"]},
	]},
	{"key": "workers", "title": "Gig workers", "tiles": [
		{"title": "Gender", "cards": ["worker_female", "worker_male"]},
		{"title": "Status", "cards": ["worker_active", "worker_inactive"]},
		{"title": "Activity & access", "cards": ["worker_earning", "worker_no_login"]},
	]},
	{"key": "transactions", "title": "Gig transactions", "tiles": [
		{"title": "Payment", "cards": ["txn_complete", "txn_pending"]},
		{"title": "Exceptions", "cards": ["txn_dup", "txn_cancel"]},
		{"title": "Welfare settlement", "cards": ["txn_settled", "txn_unsettled"]},
		{"title": "Adjusted", "cards": ["txn_adjusted"]},
	]},
	{"key": "fees", "title": "Welfare fees", "tiles": [
		{"title": "Fee payment", "cards": ["fee_pending", "fee_completed"]},
		{"title": "Billing", "cards": ["fee_uninvoiced", "fee_failed"]},
	]},
	{"key": "invoices", "title": "Quarterly invoices", "tiles": [
		{"title": "Awaiting payment", "cards": ["inv_pending", "inv_overdue"]},
		{"title": "Payment received", "cards": ["inv_partial", "inv_paid"]},
	]},
	{"key": "fund", "title": "Welfare fund & withdrawals", "tiles": [
		{"title": "Fund balance", "cards": ["fund_balance"]},
		{"title": "Withdrawal review", "cards": ["wd_requested", "wd_approved"]},
		{"title": "Withdrawal outcome", "cards": ["wd_paid_all", "wd_rejected"]},
	]},
]

CARDS["txn_earned"] = ("txn", "m.status = 'Payment complete'", "Earnings received", "good",
	"Net payout from completed transactions (base + incentives − deductions).", {"sum": 1, "sum_expr": "m.net_payout_to_worker"})

AGG_BOARD = [
	{"key": "overview", "title": "At a glance", "tiles": [
		{"title": "Gig workers", "cards": ["worker_all"]},
		{"title": "Workers' welfare fund accounts", "cards": ["fund_all"]},
		{"title": "Invoices with balance due", "cards": ["inv_due"]},
		{"title": "Fees not yet invoiced", "cards": ["fee_uninvoiced"]},
	]},
	{"key": "workers", "title": "Gig workers", "tiles": [
		{"title": "Gender", "cards": ["worker_female", "worker_male"]},
		{"title": "Status", "cards": ["worker_active", "worker_inactive"]},
		{"title": "Activity & access", "cards": ["worker_earning", "worker_no_login"]},
	]},
	{"key": "transactions", "title": "Gig transactions", "tiles": [
		{"title": "Payment", "cards": ["txn_complete", "txn_pending"]},
		{"title": "Exceptions", "cards": ["txn_dup", "txn_cancel"]},
		{"title": "Welfare settlement", "cards": ["txn_settled", "txn_unsettled"]},
		{"title": "Adjusted", "cards": ["txn_adjusted"]},
	]},
	{"key": "fees", "title": "Welfare fees", "tiles": [
		{"title": "Fee payment", "cards": ["fee_pending", "fee_completed"]},
		{"title": "Billing", "cards": ["fee_uninvoiced", "fee_failed"]},
	]},
	{"key": "invoices", "title": "Quarterly invoices", "tiles": [
		{"title": "Awaiting payment", "cards": ["inv_pending", "inv_overdue"]},
		{"title": "Payment received", "cards": ["inv_partial", "inv_paid"]},
	]},
	{"key": "imports", "title": "Bulk imports", "tiles": [
		{"title": "Imports", "cards": ["imp_workers", "imp_txns"]},
	]},
]

WORKER_BOARD = [
	{"key": "overview", "title": "At a glance", "tiles": [
		{"title": "My welfare fund", "cards": ["fund_all"]},
		{"title": "Earnings received", "cards": ["txn_earned"]},
		{"title": "Fees waiting for payment", "cards": ["fee_pending"]},
		{"title": "Withdrawals in review", "cards": ["wd_requested"]},
	]},
	{"key": "transactions", "title": "My transactions", "tiles": [
		{"title": "Payment", "cards": ["txn_complete", "txn_pending"]},
		{"title": "Welfare settlement", "cards": ["txn_settled", "txn_unsettled"]},
		{"title": "Exceptions", "cards": ["txn_dup", "txn_cancel"]},
	]},
	{"key": "fees", "title": "Welfare fees for me", "tiles": [
		{"title": "Fee payment", "cards": ["fee_pending", "fee_completed"]},
		{"title": "Not yet invoiced", "cards": ["fee_uninvoiced"]},
	]},
	{"key": "withdrawals", "title": "My benefit withdrawals", "tiles": [
		{"title": "Review", "cards": ["wd_requested", "wd_approved"]},
		{"title": "Outcome", "cards": ["wd_paid_all", "wd_rejected"]},
	]},
]

# One dashboard, three audiences. The view is chosen by the page; who the data
# belongs to is resolved on the server from the logged-in user (see _scope).
VIEWS = {
	"admin": {
		"title": "Welfare Board Dashboard",
		"headline": HEADLINE,
		"board": BOARD,
		"filters": ["aggregators", "service_categories", "districts", "genders", "worker_statuses"],
		"kinds": set(SOURCES),
		"people": ["worker", "agg"],
		"analytics": ["flow", "aggs", "trend", "months", "profile", "invoices", "wds"],
		"labels": {},
	},
	"aggregator": {
		"title": "Aggregator Dashboard",
		"headline": ["txn_all", "fee_all", "fee_invoiced", "fee_paid", "credit_all", "inv_due"],
		"board": AGG_BOARD,
		"filters": ["service_categories", "districts", "genders", "worker_statuses"],
		"kinds": {"worker", "txn", "fee", "invoice", "fund", "credit", "wimport", "timport"},
		"people": ["worker"],
		"analytics": ["flow", "trend", "months", "profile", "invoices"],
		"labels": {"credit_all": "Credited to my workers", "fund_all": "Fund accounts", "worker_all": "My gig workers"},
	},
	"worker": {
		"title": "My Dashboard",
		"headline": ["txn_all", "txn_earned", "fee_all", "fee_paid", "credit_all", "wd_paid"],
		"board": WORKER_BOARD,
		"filters": ["aggregators", "service_categories", "districts"],
		"kinds": {"txn", "fee", "fund", "credit", "wd"},
		"people": [],
		"analytics": ["flow", "trend", "months", "work", "wds"],
		"labels": {"txn_all": "My transactions", "fee_all": "Welfare fees for me", "fee_paid": "Fees paid by aggregators",
			"credit_all": "Credited to my fund", "wd_paid": "Paid out to me", "fund_all": "Fund balance"},
	},
}

# Column that ties each source to one gig worker (worker view scoping).
WORKER_COL = {"worker": "m.name", "txn": "m.gig_worker", "fee": "t.gig_worker",
	"fund": "m.gig_worker", "credit": "a.gig_worker", "wd": "m.gig_worker"}

LIST_FILTERS = ["aggregators", "service_categories", "districts", "genders", "worker_statuses"]

# Fields a chart may drill on, per source (whitelist — they go into SQL).
DRILL_FIELDS = {
	"worker": {"gender": "IFNULL(m.gender, '')", "status": "m.status"},
	"txn": {"service_category": "IFNULL(m.service_category, '')", "district": "IFNULL(m.district, '')", "status": "m.status"},
	"invoice": {"invoice_status": "m.invoice_status"},
	"wd": {"withdrawal_type": "m.withdrawal_type", "status": "m.status"},
}


# ── scope: who is asking, and whose data they may see ─────────────────────
def _scope(view, subject=None):
	"""Resolve the view for the logged-in user. Never trusts the client for
	whose data is shown: aggregators always get their own aggregator, gig
	workers their own record; only a System Manager may pick a `subject`."""
	if view not in VIEWS:
		frappe.throw(_("Unknown dashboard"))
	user = frappe.session.user
	roles = frappe.get_roles(user)
	is_admin = ADMIN in roles
	if view == "admin":
		frappe.only_for(ADMIN)
		return frappe._dict(view=view)
	if view == "aggregator":
		if is_admin and subject:
			if not frappe.db.exists("Aggregator", subject):
				frappe.throw(_("Aggregator {0} not found").format(subject))
			return frappe._dict(view=view, agg=subject)
		agg = frappe.db.get_value("Aggregator", {"email": user}, "name") if "Aggregator" in roles else None
		if not agg:
			frappe.throw(_("Select an aggregator to view.") if is_admin else _("No Aggregator profile found for this user."),
				frappe.PermissionError if not is_admin else frappe.ValidationError)
		return frappe._dict(view=view, agg=agg)
	# worker
	if is_admin and subject:
		if not frappe.db.exists("Gig Worker", subject):
			frappe.throw(_("Gig worker {0} not found").format(subject))
		return frappe._dict(view=view, worker=subject)
	from gigworkers.permissions import _get_gig_worker_name
	worker = _get_gig_worker_name(user) if "Gig Worker" in roles else None
	if not worker:
		frappe.throw(_("Select a gig worker to view.") if is_admin else _("No Gig Worker profile found for this user."),
			frappe.PermissionError if not is_admin else frappe.ValidationError)
	return frappe._dict(view=view, worker=worker)


def _view_cards(view):
	cfg = VIEWS[view]
	keys = set(cfg["headline"])
	for s in cfg["board"]:
		for t in s["tiles"]:
			keys.update(t["cards"])
	return keys


def _check_kind(scope, kind):
	if kind not in VIEWS[scope.view]["kinds"]:
		frappe.throw(_("Not permitted"), frappe.PermissionError)


# ── helpers ──────────────────────────────────────────────────────────────
def _filters(filters, scope):
	f = frappe._dict(frappe.parse_json(filters) or {}) if filters else frappe._dict()
	allowed = VIEWS[scope.view]["filters"]
	for k in LIST_FILTERS:
		f[k] = [v for v in (f.get(k) or []) if v is not None] if k in allowed else []
	return f


def _where(kind, f, scope, any_date=False):
	"""WHERE clause + params for one source under the page filters and the scope."""
	src = SOURCES[kind]
	conds = [src["where"]] if src.get("where") else []
	params = {}
	if scope.get("agg"):
		conds.append(f"IFNULL({src['agg']}, '') = %(scope_agg)s")
		params["scope_agg"] = scope.agg
	if scope.get("worker"):
		if kind not in WORKER_COL:
			frappe.throw(_("Not permitted"), frappe.PermissionError)
		conds.append(f"{WORKER_COL[kind]} = %(scope_worker)s")
		params["scope_worker"] = scope.worker
	if src.get("date") and not any_date:
		if f.get("from_date"):
			conds.append(f"{src['date']} >= %(from_date)s")
			params["from_date"] = getdate(f.from_date)
		if f.get("to_date"):
			# works for Date and Datetime columns alike
			conds.append(f"{src['date']} < DATE_ADD(%(to_date)s, INTERVAL 1 DAY)")
			params["to_date"] = getdate(f.to_date)

	def in_list(key, expr, values):
		if expr and values:
			conds.append(f"IFNULL({expr}, '') IN %({key})s")
			params[key] = tuple(values)

	in_list("aggregators", src.get("agg"), f.aggregators)
	in_list("genders", src.get("gender"), f.genders)
	in_list("worker_statuses", src.get("wstatus"), f.worker_statuses)
	in_list("districts", src.get("district"), f.districts)
	if f.service_categories:
		if src.get("svc"):
			in_list("service_categories", src["svc"], f.service_categories)
		elif src.get("svc_label"):
			# transactions store the category's display name, not its ID
			labels = frappe.get_all("Service Category", filters={"name": ["in", f.service_categories]},
				pluck="category_name") or ["__none__"]
			in_list("service_labels", src["svc_label"], labels)
	return conds, params


def _card_sql(key, f, scope):
	kind, cond, *_rest = CARDS[key]
	flags = CARDS[key][5]
	conds, params = _where(kind, f, scope, any_date=flags.get("any_date"))
	if cond:
		conds.append(cond)
	return kind, conds, params


def _where_sql(conds):
	return ("WHERE " + " AND ".join(f"({c})" for c in conds)) if conds else ""


def _agg_names():
	return dict(frappe.db.sql("SELECT name, aggregator_name FROM `tabAggregator`"))


# ── meta ─────────────────────────────────────────────────────────────────
@frappe.whitelist()
def get_meta(view="admin", subject=None):
	scope = _scope(view, subject)
	cfg = VIEWS[view]
	labels = cfg["labels"]

	def card(key):
		kind, _cond, label, tone, guide, flags = CARDS[key]
		return {"key": key, "kind": kind, "label": _(labels.get(key, label)), "tone": tone, "guide": _(guide),
			"sum": bool(flags.get("sum")), "base": flags.get("base"), "any_date": bool(flags.get("any_date"))}

	aggs = frappe.get_all("Aggregator", fields=["name", "aggregator_name"], order_by="aggregator_name")
	agg_names = {a.name: a.aggregator_name for a in aggs}
	if scope.get("worker"):
		# a worker only picks between the aggregators they actually work with
		mine = set(frappe.db.sql_list("SELECT DISTINCT aggregator FROM `tabGig Transaction` WHERE gig_worker = %s", scope.worker))
		mine.add(frappe.db.get_value("Gig Worker", scope.worker, "name_of_aggregator"))
		aggs = [a for a in aggs if a.name in mine]
	svcs = frappe.get_all("Service Category", fields=["name", "category_name"], order_by="category_name")
	dist_conds, dist_params = _where("txn", frappe._dict({k: [] for k in LIST_FILTERS}), scope)
	districts = frappe.db.sql_list(f"""SELECT DISTINCT m.district FROM {SOURCES['txn']['from']}
		{_where_sql(dist_conds + ["IFNULL(m.district, '') != ''"])} ORDER BY m.district""", dist_params)
	options = {
		"aggregators": [{"value": a.name, "label": f"{a.aggregator_name} ({a.name})"} for a in aggs],
		"service_categories": [{"value": s.name, "label": s.category_name or s.name} for s in svcs],
		"districts": [{"value": d, "label": d} for d in districts] + [{"value": "", "label": _("Not recorded")}],
		"genders": [{"value": g, "label": g} for g in ("Female", "Male", "Others")] + [{"value": "", "label": _("Not recorded")}],
		"worker_statuses": [{"value": s, "label": s} for s in ("Active", "Inactive", "Deceased")],
	}
	subject_label = None
	if scope.get("agg"):
		subject_label = f"{agg_names.get(scope.agg, scope.agg)} ({scope.agg})"
	elif scope.get("worker"):
		subject_label = f"{frappe.db.get_value('Gig Worker', scope.worker, 'worker_name')} ({scope.worker})"
	return {
		"view": view,
		"title": _(cfg["title"]),
		"subject": scope.get("agg") or scope.get("worker"),
		"subject_label": subject_label,
		"filters": cfg["filters"],
		"people": cfg["people"],
		"analytics": cfg["analytics"],
		"options": {k: v for k, v in options.items() if k in cfg["filters"]},
		"headline": [card(k) for k in cfg["headline"]],
		"board": [{"key": s["key"], "title": _(s["title"]),
			"tiles": [{"title": _(t["title"]), "cards": [card(k) for k in t["cards"]]} for t in s["tiles"]]} for s in cfg["board"]],
		"modules": [{"key": s["key"], "label": _(s["title"])} for s in cfg["board"] if s["key"] != "overview"],
		"sources": {k: {"label": _(v["label"]), "honours": v["honours"]} for k, v in SOURCES.items() if k in cfg["kinds"]},
		"aggregator_names": agg_names,
	}


# ── dashboard ────────────────────────────────────────────────────────────
@frappe.whitelist()
def get_dashboard_data(filters=None, view="admin", subject=None):
	scope = _scope(view, subject)
	f = _filters(filters, scope)
	cards = {}
	for key in _view_cards(view):
		kind, conds, params = _card_sql(key, f, scope)
		src = SOURCES[kind]
		sum_expr = CARDS[key][5].get("sum_expr") or src.get("sum")
		row = frappe.db.sql(f"""SELECT COUNT(*) AS n{', COALESCE(SUM(' + sum_expr + '), 0) AS amount' if sum_expr else ''}
			FROM {src['from']} {_where_sql(conds)}""", params, as_dict=True)[0]
		cards[key] = {"total": cint(row.n), "amount": flt(row.get("amount")) if sum_expr else None}
	alltime_conds, alltime_params = _where("txn", frappe._dict({k: [] for k in LIST_FILTERS}), scope)
	return {
		"cards": cards,
		"alltime_txn": cint(frappe.db.sql(f"SELECT COUNT(*) FROM {SOURCES['txn']['from']} {_where_sql(alltime_conds)}",
			alltime_params)[0][0]),
		"updated": frappe.utils.format_datetime(frappe.utils.now_datetime(), "dd-MM-yyyy HH:mm"),
	}


# ── drilldown tables ─────────────────────────────────────────────────────
def _table_query(kind, f, extra, scope):
	"""conds/params for a table: page filters + scope + the clicked card / chart slice."""
	extra = frappe._dict(extra or {})
	if extra.get("card"):
		if extra.card not in _view_cards(scope.view):
			frappe.throw(_("Unknown card"))
		kind, conds, params = _card_sql(extra.card, f, scope)
	else:
		if kind not in SOURCES:
			frappe.throw(_("Unknown list"))
		_check_kind(scope, kind)
		conds, params = _where(kind, f, scope)
	_check_kind(scope, kind)
	if extra.get("field"):
		expr = DRILL_FIELDS.get(kind, {}).get(extra.field)
		if not expr:
			frappe.throw(_("Cannot filter on {0}").format(extra.field))
		conds.append(f"{expr} = %(drill_value)s")
		params["drill_value"] = extra.get("value") or ""
	if extra.get("week") and SOURCES[kind].get("date"):
		conds.append(f"YEARWEEK({SOURCES[kind]['date']}, 1) = YEARWEEK(%(drill_week)s, 1)")
		params["drill_week"] = getdate(extra.week)
	if extra.get("month") and SOURCES[kind].get("date"):
		conds.append(f"DATE_FORMAT({SOURCES[kind]['date']}, '%%Y-%%m') = %(drill_month)s")
		params["drill_month"] = str(extra.month)[:7]
	if extra.get("unit") and extra.unit != "__all__":
		conds.append(f"IFNULL({SOURCES[kind]['unit']}, '') = %(drill_unit)s")
		params["drill_unit"] = extra.unit
	return kind, conds, params


def _search_sql(kind, search, conds, params):
	if search:
		like = " OR ".join(f"IFNULL({c}, '') LIKE %(search)s" for c in SOURCES[kind]["search"])
		conds.append(f"({like})")
		params["search"] = f"%{search.strip()}%"


def _order_sql(kind, sort, order):
	cols = {c[0]: c[1] for c in SOURCES[kind]["columns"] if c[4]}
	sort = sort if sort in cols else SOURCES[kind]["sort"]
	order = "ASC" if str(order).lower() == "asc" else "DESC"
	return sort, order, f"ORDER BY {cols[sort]} {order}"


@frappe.whitelist()
def get_table(kind, filters=None, extra=None, search=None, sort=None, order="desc", page=1, page_size=50,
		view="admin", subject=None):
	scope = _scope(view, subject)
	f = _filters(filters, scope)
	extra = frappe.parse_json(extra) if isinstance(extra, str) else (extra or {})
	kind, conds, params = _table_query(kind, f, extra, scope)
	src = SOURCES[kind]

	# Aggregator split for the chips above the table — computed before the unit filter
	units = None
	if cint(extra.get("with_units")):
		_k, base_conds, base_params = _table_query(kind, f, {**extra, "unit": None}, scope)
		units = {(u or ""): cint(n) for u, n in frappe.db.sql(
			f"SELECT {src['unit']} AS u, COUNT(*) FROM {src['from']} {_where_sql(base_conds)} GROUP BY u", base_params)}

	_search_sql(kind, search, conds, params)
	sort, order, order_sql = _order_sql(kind, sort, order)
	page, page_size = max(cint(page), 1), min(max(cint(page_size), 10), 250)
	where = _where_sql(conds)
	total = cint(frappe.db.sql(f"SELECT COUNT(*) FROM {src['from']} {where}", params)[0][0])
	select = ", ".join(f"{expr} AS `{alias}`" for alias, expr, *_ in src["columns"])
	rows = frappe.db.sql(f"SELECT {select} FROM {src['from']} {where} {order_sql} LIMIT %(lim)s OFFSET %(off)s",
		{**params, "lim": page_size, "off": (page - 1) * page_size}, as_dict=True)
	return {
		"kind": kind,
		"doctype": src.get("id_doctype") or src["doctype"],
		"columns": [{"field": a, "label": _(l), "type": t, "sortable": s} for a, _e, l, t, s in src["columns"]],
		"rows": rows, "total": total, "page": page, "page_size": page_size,
		"sort": sort, "order": order.lower(), "units": units,
	}


@frappe.whitelist()
def export_table(kind, filters=None, extra=None, search=None, sort=None, order="desc", name=None,
		view="admin", subject=None):
	scope = _scope(view, subject)
	f = _filters(filters, scope)
	extra = frappe.parse_json(extra) if isinstance(extra, str) else (extra or {})
	kind, conds, params = _table_query(kind, f, extra, scope)
	src = SOURCES[kind]
	_search_sql(kind, search, conds, params)
	_sort, _order, order_sql = _order_sql(kind, sort, order)
	select = ", ".join(f"{expr} AS `{alias}`" for alias, expr, *_ in src["columns"])
	rows = frappe.db.sql(f"SELECT {select} FROM {src['from']} {_where_sql(conds)} {order_sql} LIMIT 100000", params)
	out = io.StringIO()
	w = csv.writer(out)
	w.writerow([c[2] for c in src["columns"]])
	w.writerows(rows)
	frappe.response["type"] = "csv"
	frappe.response["doctype"] = frappe.scrub(name or kind) + "-" + nowdate()
	frappe.response["result"] = out.getvalue()


# ── timelines ────────────────────────────────────────────────────────────
@frappe.whitelist()
def get_timeline(kind, name, view="admin", subject=None):
	scope = _scope(view, subject)
	if kind == "worker":
		if scope.get("worker") and name != scope.worker:
			frappe.throw(_("Not permitted"), frappe.PermissionError)
		if scope.get("agg"):
			own = frappe.db.get_value("Gig Worker", name, ["name_of_aggregator", "created_by_aggregator"], as_dict=True)
			if not own or scope.agg not in (own.name_of_aggregator, own.created_by_aggregator):
				frappe.throw(_("Not permitted"), frappe.PermissionError)
		t = _worker_timeline(name)
		if scope.get("agg"):
			# aggregators cannot read benefit withdrawals — leave them out
			t["events"] = [e for e in t["events"] if e["kind"] not in ("withdrawal", "debit")]
			t["journey"] = [j for j in t["journey"] if j.get("key") != "benefit"]
		return t
	if kind == "agg":
		if scope.view == "worker" or (scope.get("agg") and name != scope.agg):
			frappe.throw(_("Not permitted"), frappe.PermissionError)
		return _aggregator_timeline(name)
	frappe.throw(_("Unknown timeline"))


def _ev(when, kind, title, doctype=None, name=None, meta=None, flow=None, tone=None):
	return {"when": str(when), "kind": kind, "title": title, "doctype": doctype, "name": name,
		"meta": meta, "flow": flow, "tone": tone}


def _money(v):
	return frappe.utils.fmt_money(flt(v), currency="INR")


def _worker_timeline(name):
	w = frappe.db.get_value("Gig Worker", name, ["name", "worker_name", "status", "gender", "phone", "partner_id",
		"name_of_aggregator", "user", "creation"], as_dict=True)
	if not w:
		frappe.throw(_("Gig worker {0} not found").format(name))
	names = _agg_names()
	events = [_ev(w.creation, "registration", _("Registered as a gig worker"), "Gig Worker", w.name,
		meta=" · ".join(x for x in [names.get(w.name_of_aggregator, w.name_of_aggregator), w.partner_id and f"Partner ID {w.partner_id}"] if x))]

	txns = frappe.db.sql("""SELECT name, date, transaction_date, aggregator, service_category, district, amount,
		welfare_amount, status, settlement_status FROM `tabGig Transaction` WHERE gig_worker = %s ORDER BY date""", name, as_dict=True)
	for t in txns:
		events.append(_ev(t.transaction_date or t.date, "transaction",
			_("{0} transaction · {1}").format(names.get(t.aggregator, t.aggregator) or "", _money(t.amount)),
			"Gig Transaction", t.name,
			meta=" · ".join(x for x in [t.service_category, t.district, _("welfare fee {0}").format(_money(t.welfare_amount))] if x),
			flow=[x for x in [t.status, t.settlement_status] if x]))
	adj = frappe.db.sql("""SELECT l.parent, l.adjusted_at, l.adjusted_by, l.old_amount, t.amount
		FROM `tabGig Transaction Adjustment Log` l JOIN `tabGig Transaction` t ON t.name = l.parent
		WHERE t.gig_worker = %s""", name, as_dict=True)
	for a in adj:
		events.append(_ev(a.adjusted_at, "adjustment", _("Transaction adjusted"), "Gig Transaction", a.parent,
			flow=[_money(a.old_amount), _money(a.amount)], meta=a.adjusted_by))

	fees = frappe.db.sql("""SELECT f.name, f.creation, f.payment_date, f.modified, f.fee_amount, f.payment_status, f.transaction
		FROM `tabWelfare Fee Payment` f JOIN `tabGig Transaction` t ON t.name = f.transaction
		WHERE t.gig_worker = %s""", name, as_dict=True)
	for fp in fees:
		events.append(_ev(fp.creation, "fee", _("Welfare fee raised · {0}").format(_money(fp.fee_amount)),
			"Welfare Fee Payment", fp.name, meta=_("for transaction {0}").format(fp.transaction)))
	invs = frappe.db.sql("""SELECT i.name, i.creation, i.quarter, i.year, i.invoice_status, COUNT(*) AS n, SUM(ii.fee_amount) AS amt
		FROM `tabWelfare Fee Invoice Item` ii JOIN `tabWelfare Fee Invoice` i ON i.name = ii.parent
		WHERE ii.gig_worker = %s GROUP BY i.name""", name, as_dict=True)
	for i in invs:
		events.append(_ev(i.creation, "invoice", _("{0} fee(s) invoiced to the aggregator · {1}").format(i.n, _money(i.amt)),
			"Welfare Fee Invoice", i.name, meta=f"{i.quarter} {i.year}", flow=[i.invoice_status]))

	acct = frappe.db.get_value("Welfare Fund Account", {"gig_worker": name},
		["name", "total_collected", "total_withdrawn", "account_balance"], as_dict=True)
	if acct:
		for l in frappe.db.sql("""SELECT entry_type, amount, balance_after, entry_date, reference_doctype, reference_name
			FROM `tabWelfare Fund Ledger Entry` WHERE parent = %s AND parenttype = 'Welfare Fund Account'""", acct.name, as_dict=True):
			credit = l.entry_type == "Credit"
			events.append(_ev(l.entry_date, "credit" if credit else "debit",
				(_("Credited to welfare fund · {0}") if credit else _("Debited from welfare fund · {0}")).format(_money(l.amount)),
				l.reference_doctype or None, l.reference_name or None,
				meta=_("balance after {0}").format(_money(l.balance_after)), tone="good" if credit else "bad"))

	wds = frappe.db.sql("""SELECT name, withdrawal_type, amount, requested_date, status, review_date, payment_date, creation
		FROM `tabWelfare Benefit Withdrawal` WHERE gig_worker = %s""", name, as_dict=True)
	for d in wds:
		events.append(_ev(d.creation, "withdrawal", _("{0} withdrawal requested · {1}").format(d.withdrawal_type or "", _money(d.amount)),
			"Welfare Benefit Withdrawal", d.name, flow=[d.status]))
		if d.review_date and d.status in ("Approved", "Rejected", "Paid"):
			events.append(_ev(d.review_date, "withdrawal", _("Withdrawal {0}").format(_("rejected") if d.status == "Rejected" else _("approved")),
				"Welfare Benefit Withdrawal", d.name, tone="bad" if d.status == "Rejected" else "good"))
		if d.payment_date and d.status == "Paid":
			events.append(_ev(d.payment_date, "withdrawal", _("Withdrawal paid · {0}").format(_money(d.amount)),
				"Welfare Benefit Withdrawal", d.name, tone="good"))

	events.sort(key=lambda e: e["when"])
	paid = [fp for fp in fees if fp.payment_status == "Completed"]
	journey = [
		{"label": _("Registered"), "done": True},
		{"label": _("Portal login"), "done": bool(w.user)},
		{"label": _("First transaction"), "done": bool(txns)},
		{"label": _("Fee raised"), "done": bool(fees)},
		{"label": _("Invoiced"), "done": bool(invs)},
		{"label": _("Fee paid"), "done": bool(paid)},
		{"label": _("Credited to fund"), "done": bool(acct and flt(acct.total_collected) > 0)},
		{"key": "benefit", "label": _("Benefit paid"), "done": any(d.status == "Paid" for d in wds),
			"bad": bool(wds) and all(d.status == "Rejected" for d in wds)},
	]
	return {
		"head": {"kind": "worker", "id": w.name, "name": w.worker_name, "status": w.status, "gender": w.gender,
			"phone": w.phone, "aggregator": w.name_of_aggregator, "since": str(w.creation)[:10]},
		"stats": [
			{"label": _("Registered on"), "value": frappe.utils.formatdate(w.creation), "tone": "time"},
			{"label": _("Transactions"), "value": f"{len(txns)} · {_money(sum(flt(t.amount) for t in txns))}", "tone": "info"},
			{"label": _("Welfare fees raised"), "value": _money(sum(flt(fp.fee_amount) for fp in fees)), "tone": "action"},
			{"label": _("Fund balance"), "value": _money(acct.account_balance if acct else 0), "tone": "good"},
		],
		"journey": journey,
		"events": events,
	}


def _aggregator_timeline(name):
	a = frappe.db.get_value("Aggregator", name, ["name", "aggregator_name", "status", "email", "mobile", "name1",
		"creation", "modified"], as_dict=True)
	if not a:
		frappe.throw(_("Aggregator {0} not found").format(name))
	events = [_ev(a.creation, "registration", _("Registration submitted"), "Aggregator", a.name,
		meta=" · ".join(x for x in [a.name1, a.email] if x))]
	if a.status != "Submitted":
		events.append(_ev(a.modified, "status", _("Current status: {0}").format(a.status), "Aggregator", a.name,
			meta=_("date of the last change to the record"), tone="good" if a.status == "Approved" else "action"))
	for r in frappe.db.sql("""SELECT DATE_FORMAT(creation, '%%Y-%%m-01') AS m, COUNT(*) AS n FROM `tabGig Worker`
		WHERE name_of_aggregator = %s GROUP BY m""", name, as_dict=True):
		events.append(_ev(r.m, "workers", _("{0} gig worker(s) registered this month").format(f"{cint(r.n):,}"),
			meta=_("monthly total")))
	for r in frappe.db.sql("""SELECT name, import_date, file_name, inserted, total_rows, status FROM `tabGig Worker Import Log`
		WHERE created_by_aggregator = %s""", name, as_dict=True):
		events.append(_ev(r.import_date, "import", _("Gig worker import · {0} of {1} rows inserted").format(r.inserted, r.total_rows),
			"Gig Worker Import Log", r.name, meta=r.file_name, flow=[r.status]))
	for r in frappe.db.sql("""SELECT name, import_date, file_name, inserted, total_rows, status FROM `tabGig Transaction Import Log`
		WHERE default_aggregator = %s""", name, as_dict=True):
		events.append(_ev(r.import_date, "import", _("Transaction import · {0} of {1} rows inserted").format(r.inserted, r.total_rows),
			"Gig Transaction Import Log", r.name, meta=r.file_name, flow=[r.status]))
	txn_months = frappe.db.sql("""SELECT DATE_FORMAT(date, '%%Y-%%m-01') AS m, COUNT(*) AS n, SUM(amount) AS amt, SUM(welfare_amount) AS wf
		FROM `tabGig Transaction` WHERE aggregator = %s GROUP BY m""", name, as_dict=True)
	for r in txn_months:
		events.append(_ev(r.m, "transaction", _("{0} transaction(s) · {1}").format(r.n, _money(r.amt)),
			meta=_("monthly total · welfare fees {0}").format(_money(r.wf))))
	invs = frappe.db.sql("""SELECT name, creation, quarter, year, total_due_amount, amount_paid, balance_due, invoice_status, due_date
		FROM `tabWelfare Fee Invoice` WHERE aggregator = %s""", name, as_dict=True)
	for i in invs:
		tone = {"Fully Paid": "good", "Overdue": "bad"}.get(i.invoice_status, "action")
		events.append(_ev(i.creation, "invoice", _("Invoice {0} {1} · {2} due").format(i.quarter, i.year, _money(i.total_due_amount)),
			"Welfare Fee Invoice", i.name, meta=_("due {0}").format(frappe.utils.formatdate(i.due_date)), flow=[i.invoice_status], tone=tone))
		for p in frappe.db.sql("""SELECT payment_date, amount, payment_mode, payment_reference FROM `tabWelfare Invoice Payment`
			WHERE parent = %s AND parenttype = 'Welfare Fee Invoice'""", i.name, as_dict=True):
			events.append(_ev(p.payment_date, "payment", _("Invoice payment received · {0}").format(_money(p.amount)),
				"Welfare Fee Invoice", i.name, meta=" · ".join(x for x in [p.payment_mode, p.payment_reference] if x), tone="good"))
	events.sort(key=lambda e: e["when"])
	workers = frappe.db.count("Gig Worker", {"name_of_aggregator": name})
	st = a.status
	journey = [
		{"label": _("Registered"), "done": True},
		{"label": _("Under review"), "done": st in ("Under Process", "Pending with Clarification", "Approved")},
		{"label": _("Approved"), "done": st == "Approved"},
		{"label": _("Workers onboarded"), "done": workers > 0},
		{"label": _("First transaction"), "done": bool(txn_months)},
		{"label": _("Invoiced"), "done": bool(invs)},
		{"label": _("Invoice paid"), "done": any(i.invoice_status == "Fully Paid" for i in invs)},
	]
	return {
		"head": {"kind": "agg", "id": a.name, "name": a.aggregator_name, "status": a.status, "email": a.email,
			"phone": a.mobile, "since": str(a.creation)[:10]},
		"stats": [
			{"label": _("Registered on"), "value": frappe.utils.formatdate(a.creation), "tone": "time"},
			{"label": _("Gig workers"), "value": f"{workers:,}", "tone": "info"},
			{"label": _("Transactions"), "value": f"{sum(cint(r.n) for r in txn_months)} · {_money(sum(flt(r.amt) for r in txn_months))}", "tone": "info"},
			{"label": _("Invoice balance due"), "value": _money(sum(flt(i.balance_due) for i in invs)),
				"tone": "bad" if any(i.invoice_status == "Overdue" for i in invs) else "good"},
		],
		"journey": journey,
		"events": events,
	}


# ── analytics tab ────────────────────────────────────────────────────────
def _scalar(kind, f, scope, select, extra_cond=None):
	conds, params = _where(kind, f, scope)
	if extra_cond:
		conds.append(extra_cond)
	return flt(frappe.db.sql(f"SELECT {select} FROM {SOURCES[kind]['from']} {_where_sql(conds)}", params)[0][0])


def _group(kind, f, scope, expr, value="COUNT(*)", extra_cond=None, order="v DESC", limit=None):
	conds, params = _where(kind, f, scope)
	if extra_cond:
		conds.append(extra_cond)
	sql = f"SELECT {expr} AS k, {value} AS v FROM {SOURCES[kind]['from']} {_where_sql(conds)} GROUP BY k ORDER BY {order}"
	if limit:
		sql += f" LIMIT {cint(limit)}"
	return [{"key": k if k is not None else "", "value": flt(v)} for k, v in frappe.db.sql(sql, params)]


@frappe.whitelist()
def get_analytics(filters=None, view="admin", subject=None):
	scope = _scope(view, subject)
	f = _filters(filters, scope)
	panels = set(VIEWS[view]["analytics"])
	fee_sum = "COALESCE(SUM(m.fee_amount), 0)"
	flow = [
		{"key": "fee_all", "label": _("Welfare fees raised"), "value": _scalar("fee", f, scope, fee_sum)},
		{"key": "fee_invoiced", "label": _("Invoiced to aggregators"), "value": _scalar("fee", f, scope, fee_sum, INVOICED)},
		{"key": "fee_paid", "label": _("Paid by aggregators"), "value": _scalar("fee", f, scope, fee_sum, "m.payment_status = 'Completed'")},
		{"key": "credit_all", "label": _("Credited to worker funds"), "value": _scalar("credit", f, scope, "COALESCE(SUM(m.amount), 0)")},
	]
	if "wd" in VIEWS[view]["kinds"]:
		flow.append({"key": "wd_paid", "label": _("Paid out as benefits"),
			"value": _scalar("wd", f, scope, "COALESCE(SUM(m.amount), 0)", "m.status = 'Paid'")})
	out = {"flow": flow}

	if "aggs" in panels:
		# Per-aggregator summary: one grouped query per source, merged in Python.
		summary = {}

		def merge(rows, field):
			for r in rows:
				summary.setdefault(r["key"] or "", {})[field] = r["value"]

		merge(_group("worker", f, scope, "m.name_of_aggregator"), "workers")
		merge(_group("txn", f, scope, "m.aggregator"), "txns")
		merge(_group("txn", f, scope, "m.aggregator", "COALESCE(SUM(m.amount), 0)"), "txn_amount")
		merge(_group("fee", f, scope, "m.aggregator", fee_sum), "fees")
		merge(_group("fee", f, scope, "m.aggregator", fee_sum, "m.payment_status = 'Completed'"), "fees_paid")
		merge(_group("invoice", f, scope, "m.aggregator", "COALESCE(SUM(m.balance_due), 0)"), "balance_due")
		merge(_group("invoice", f, scope, "m.aggregator", "COUNT(*)", "m.invoice_status = 'Overdue'"), "overdue")
		names = _agg_names()
		agg_rows = [{"aggregator": k, "aggregator_name": names.get(k, k or _("Not set")), **v} for k, v in summary.items()]
		agg_rows.sort(key=lambda r: (-flt(r.get("txn_amount")), -flt(r.get("workers"))))
		out["aggregators"] = agg_rows
	if "trend" in panels:
		out["txn_weeks"] = [{"week": str(r["key"]), "n": r["value"]} for r in
			_group("txn", f, scope, "DATE_SUB(m.date, INTERVAL WEEKDAY(m.date) DAY)", order="k ASC")][-26:]
	if "months" in panels:
		out["fee_months"] = _months(f, scope)
	if "profile" in panels:
		out["worker_gender"] = _group("worker", f, scope, "IFNULL(m.gender, '')")
		out["worker_status"] = _group("worker", f, scope, "m.status")
	if "profile" in panels or "work" in panels:
		out["txn_service"] = _group("txn", f, scope, "IFNULL(m.service_category, '')")
		out["txn_district"] = _group("txn", f, scope, "IFNULL(m.district, '')", limit=12)
	if "work" in panels:
		out["txn_aggregator"] = _group("txn", f, scope, "m.aggregator", "COALESCE(SUM(m.net_payout_to_worker), 0)")
	if "invoices" in panels:
		out["invoice_status"] = _group("invoice", f, scope, "m.invoice_status")
	if "wds" in panels:
		out["wd_type"] = _group("wd", f, scope, "m.withdrawal_type")
	return out


def _months(f, scope):
	month = "DATE_FORMAT(m.payment_date, '%%Y-%%m')"
	raised = {r["key"]: r["value"] for r in _group("fee", f, scope, month, "COALESCE(SUM(m.fee_amount), 0)", order="k ASC")}
	paid = {r["key"]: r["value"] for r in _group("fee", f, scope, month, "COALESCE(SUM(m.fee_amount), 0)",
		"m.payment_status = 'Completed'", order="k ASC")}
	return [{"month": m, "raised": raised.get(m, 0), "paid": paid.get(m, 0)} for m in sorted(set(raised) | set(paid)) if m][-12:]


# ── home page (/desk/welfare-home) ───────────────────────────────────────
def _home_view():
	roles = frappe.get_roles()
	if ADMIN in roles:
		return "admin"
	if "Aggregator" in roles:
		return "aggregator"
	if "Gig Worker" in roles:
		return "worker"
	frappe.throw(_("Not permitted"), frappe.PermissionError)


def _next_invoice_run():
	"""Quarterly invoices are generated at 02:00 on 1 Jan / Apr / Jul / Oct (hooks.py)."""
	today = getdate(nowdate())
	for month in (1, 4, 7, 10):
		run = getdate(f"{today.year}-{month:02d}-01")
		if run > today:
			return run
	return getdate(f"{today.year + 1}-01-01")


def _count(kind, scope, cond=None, sum_expr=None):
	conds, params = _where(kind, frappe._dict({k: [] for k in LIST_FILTERS}), scope)
	if cond:
		conds.append(cond)
	src = SOURCES[kind]
	row = frappe.db.sql(f"SELECT COUNT(*), COALESCE(SUM({sum_expr or '0'}), 0) FROM {src['from']} {_where_sql(conds)}", params)[0]
	return cint(row[0]), flt(row[1])


def _todo(tone, title, sub, label, route):
	return {"tone": tone, "title": title, "sub": sub, "label": label, "route": route}


def _act(when, kind, title, meta=None, doctype=None, name=None):
	return {"when": str(when), "kind": kind, "title": title, "meta": meta, "doctype": doctype, "name": name}


_COLLAPSE = {"credit": "{0} welfare fee credits to your fund", "fee": "{0} welfare fees raised for you",
	"transaction": "{0} transactions recorded", "invoice": "Your fees were placed on {0} invoices"}


def _collapse(acts):
	"""Same-day events of one kind become one line, so a busy day doesn't flood the feed."""
	groups = {}
	for a in acts:
		groups.setdefault((a["when"][:10], a["kind"]), []).append(a)
	out = []
	for (day, kind), items in groups.items():
		if len(items) > 1 and kind in _COLLAPSE:
			out.append(_act(max(i["when"] for i in items), kind, _(_COLLAPSE[kind]).format(len(items))))
		else:
			out.extend(items)
	return out


@frappe.whitelist()
def get_home():
	view = _home_view()
	scope = _scope(view)
	money = _money
	next_run = _next_invoice_run()
	todos, acts = [], []

	if view == "admin":
		pending_apps, _a = _count("agg", scope, "m.status IN ('Submitted', 'Under Process')")
		clarify, _a = _count("agg", scope, "m.status = 'Pending with Clarification'")
		overdue, overdue_amt = _count("invoice", scope, "m.invoice_status = 'Overdue'", "m.balance_due")
		wd_req, wd_req_amt = _count("wd", scope, "m.status = 'Requested'", "m.amount")
		wd_appr, wd_appr_amt = _count("wd", scope, "m.status = 'Approved'", "m.amount")
		dups, _a = _count("txn", scope, "m.status = 'Suspected duplicate'")
		uninvoiced, uninvoiced_amt = _count("fee", scope, "NOT " + INVOICED, "m.fee_amount")
		if pending_apps:
			todos.append(_todo("action", _("{0} aggregator application(s) to review").format(pending_apps),
				_("Submitted or under process"), _("Review"), "/desk/aggregator-approval"))
		if clarify:
			todos.append(_todo("info", _("{0} application(s) waiting on the aggregator's clarification").format(clarify),
				_("Nothing to do until they reply"), _("View"), "/desk/aggregator-approval"))
		if overdue:
			todos.append(_todo("bad", _("{0} invoice(s) overdue · {1} outstanding").format(overdue, money(overdue_amt)),
				_("Follow up with the aggregators"), _("Open"), "/desk/welfare-fee-invoice?invoice_status=Overdue"))
		if wd_req:
			todos.append(_todo("action", _("{0} benefit withdrawal(s) to review · {1}").format(wd_req, money(wd_req_amt)),
				_("Approve or reject"), _("Review"), "/desk/welfare-benefit-withdrawal?status=Requested"))
		if wd_appr:
			todos.append(_todo("action", _("{0} approved withdrawal(s) to pay out · {1}").format(wd_appr, money(wd_appr_amt)),
				_("Mark as paid once transferred"), _("Pay out"), "/desk/welfare-benefit-withdrawal?status=Approved"))
		if dups:
			todos.append(_todo("bad", _("{0} suspected duplicate transaction(s)").format(dups),
				_("Confirm or dismiss"), _("Check"), "/desk/gig-transaction?status=Suspected%20duplicate"))
		if uninvoiced:
			todos.append(_todo("info", _("{0} welfare fee(s) not yet invoiced · {1}").format(uninvoiced, money(uninvoiced_amt)),
				_("Billed automatically on {0}").format(frappe.utils.formatdate(next_run)), _("View"), "/desk/welfare-board-dashboard"))
		approved, _a = _count("agg", scope, "m.status = 'Approved'")
		workers, _a = _count("worker", scope)
		_n, fees = _count("fee", scope, None, "m.fee_amount")
		_n, fund = _count("fund", scope, None, "m.account_balance")
		stats = [
			{"label": _("Approved aggregators"), "value": f"{approved:,}", "tone": "good"},
			{"label": _("Gig workers"), "value": f"{workers:,}", "tone": "info"},
			{"label": _("Welfare fees raised"), "value": money(fees), "tone": "time"},
			{"label": _("Held in worker funds"), "value": money(fund), "tone": "good"},
		]
		actions = [
			{"label": _("Welfare Board Dashboard"), "desc": _("The whole scheme — cards, timelines, analytics"), "route": "/desk/welfare-board-dashboard", "icon": "chart"},
			{"label": _("Aggregator Approval"), "desc": _("Review and approve registrations"), "route": "/desk/aggregator-approval", "icon": "check"},
			{"label": _("Welfare Fee Invoices"), "desc": _("Quarterly invoices and payments"), "route": "/desk/welfare-fee-invoice", "icon": "receipt"},
			{"label": _("Benefit Withdrawals"), "desc": _("Review requests and pay out"), "route": "/desk/welfare-benefit-withdrawal", "icon": "wallet"},
			{"label": _("Import Gig Workers"), "desc": _("Bulk upload workers from CSV"), "route": "/desk/bulk-gig-worker-import", "icon": "users"},
			{"label": _("Quarterly Compliance"), "desc": _("Report of fees and payments per quarter"), "route": "/desk/query-report/Quarterly Welfare Compliance Report", "icon": "file"},
		]
		for r in frappe.db.sql("SELECT name, aggregator_name, status, creation FROM `tabAggregator` ORDER BY creation DESC LIMIT 3", as_dict=True):
			acts.append(_act(r.creation, "registration", _("{0} registered as an aggregator").format(r.aggregator_name), r.status, "Aggregator", r.name))
		for r in frappe.db.sql("""SELECT p.payment_date, p.amount, p.payment_mode, i.name, i.aggregator_name FROM `tabWelfare Invoice Payment` p
			JOIN `tabWelfare Fee Invoice` i ON i.name = p.parent ORDER BY p.payment_date DESC, p.creation DESC LIMIT 3""", as_dict=True):
			acts.append(_act(r.payment_date, "payment", _("{0} paid {1} on an invoice").format(r.aggregator_name, money(r.amount)), r.payment_mode, "Welfare Fee Invoice", r.name))
		for r in frappe.db.sql("SELECT name, import_date, created_by_aggregator AS agg, inserted FROM `tabGig Worker Import Log` WHERE inserted > 0 ORDER BY import_date DESC LIMIT 2", as_dict=True):
			acts.append(_act(r.import_date, "import", (_("{0} gig worker imported") if cint(r.inserted) == 1 else _("{0} gig workers imported")).format(f"{cint(r.inserted):,}"), r.agg, "Gig Worker Import Log", r.name))
		for r in frappe.db.sql("SELECT name, requested_date, amount, status, gig_worker FROM `tabWelfare Benefit Withdrawal` ORDER BY creation DESC LIMIT 2", as_dict=True):
			acts.append(_act(r.requested_date, "withdrawal", _("Withdrawal of {0} requested").format(money(r.amount)), f"{r.gig_worker} · {r.status}", "Welfare Benefit Withdrawal", r.name))
		for r in frappe.db.sql("SELECT name, date, amount, aggregator, gig_worker FROM `tabGig Transaction` ORDER BY creation DESC LIMIT 3", as_dict=True):
			acts.append(_act(r.date, "transaction", _("Transaction {0}").format(money(r.amount)), f"{r.aggregator} · {r.gig_worker}", "Gig Transaction", r.name))
		who = {"name": frappe.utils.get_fullname(), "id": None, "status": None, "role": _("Welfare Board")}

	elif view == "aggregator":
		agg = frappe.db.get_value("Aggregator", scope.agg, ["name", "aggregator_name", "status", "clarification_comments"], as_dict=True)
		overdue, overdue_amt = _count("invoice", scope, "m.invoice_status = 'Overdue'", "m.balance_due")
		open_inv, open_amt = _count("invoice", scope, "m.invoice_status IN ('Pending', 'Partially Paid')", "m.balance_due")
		pending_txn, _a = _count("txn", scope, "m.status = 'Payment pending'")
		dups, _a = _count("txn", scope, "m.status = 'Suspected duplicate'")
		uninvoiced, uninvoiced_amt = _count("fee", scope, "NOT " + INVOICED, "m.fee_amount")
		if agg.status == "Pending with Clarification":
			todos.append(_todo("action", _("The Board asked for clarification on your registration"),
				agg.clarification_comments or _("Open your profile to reply"), _("Reply"), f"/desk/aggregator/{agg.name}"))
		if overdue:
			todos.append(_todo("bad", _("{0} invoice(s) overdue · {1} to pay").format(overdue, money(overdue_amt)),
				_("Pay now so your workers' welfare is credited"), _("Open"), "/desk/welfare-fee-invoice?invoice_status=Overdue"))
		if open_inv:
			todos.append(_todo("action", _("{0} invoice(s) awaiting payment · {1}").format(open_inv, money(open_amt)),
				_("Pending or partially paid"), _("Open"), "/desk/welfare-fee-invoice"))
		if pending_txn:
			todos.append(_todo("action", _("{0} transaction(s) waiting for payment confirmation").format(pending_txn),
				_("Workers confirm by OTP"), _("View"), "/desk/aggregator-dashboard"))
		if dups:
			todos.append(_todo("bad", _("{0} transaction(s) flagged as possible duplicates").format(dups),
				_("The Board will review them"), _("View"), "/desk/aggregator-dashboard"))
		if uninvoiced:
			todos.append(_todo("info", _("{0} welfare fee(s) will be on your next invoice · {1}").format(uninvoiced, money(uninvoiced_amt)),
				_("Generated on {0}").format(frappe.utils.formatdate(next_run)), _("View"), "/desk/aggregator-dashboard"))
		workers, _a = _count("worker", scope)
		txns, txn_amt = _count("txn", scope, None, "m.amount")
		_n, fees = _count("fee", scope, None, "m.fee_amount")
		_n, due = _count("invoice", scope, "m.invoice_status != 'Draft'", "m.balance_due")
		stats = [
			{"label": _("My gig workers"), "value": f"{workers:,}", "tone": "info"},
			{"label": _("Transactions"), "value": f"{txns:,} · {money(txn_amt)}", "tone": "info"},
			{"label": _("Welfare fees raised"), "value": money(fees), "tone": "time"},
			{"label": _("Invoice balance due"), "value": money(due), "tone": "bad" if overdue else "good"},
		]
		actions = [
			{"label": _("Dashboard"), "desc": _("Your workers, fees and invoices in detail"), "route": "/desk/aggregator-dashboard", "icon": "chart"},
			{"label": _("Import Gig Workers"), "desc": _("Upload your workers from CSV"), "route": "/desk/bulk-gig-worker-import", "icon": "users"},
			{"label": _("Import Transactions"), "desc": _("Upload rides / orders from CSV"), "route": "/desk/bulk-gig-transaction-import", "icon": "upload"},
			{"label": _("My Invoices"), "desc": _("Quarterly welfare fee invoices"), "route": "/desk/welfare-fee-invoice", "icon": "receipt"},
			{"label": _("My Gig Workers"), "desc": _("Everyone registered under you"), "route": "/desk/gig-worker", "icon": "users"},
			{"label": _("Company Profile"), "desc": _("Registration details and KYC"), "route": f"/desk/aggregator/{agg.name}", "icon": "building"},
		]
		for r in frappe.db.sql("""SELECT p.payment_date, p.amount, p.payment_mode, i.name, i.quarter, i.year FROM `tabWelfare Invoice Payment` p
			JOIN `tabWelfare Fee Invoice` i ON i.name = p.parent WHERE i.aggregator = %s ORDER BY p.payment_date DESC LIMIT 3""", agg.name, as_dict=True):
			acts.append(_act(r.payment_date, "payment", _("You paid {0} on the {1} {2} invoice").format(money(r.amount), r.quarter, r.year), r.payment_mode, "Welfare Fee Invoice", r.name))
		for r in frappe.db.sql("SELECT name, creation, quarter, year, total_due_amount, invoice_status FROM `tabWelfare Fee Invoice` WHERE aggregator = %s ORDER BY creation DESC LIMIT 3", agg.name, as_dict=True):
			acts.append(_act(r.creation, "invoice", _("{0} {1} invoice · {2}").format(r.quarter, r.year, money(r.total_due_amount)), r.invoice_status, "Welfare Fee Invoice", r.name))
		for r in frappe.db.sql("""(SELECT name, import_date, inserted, 'Gig Worker Import Log' AS dt, 'workers' AS what FROM `tabGig Worker Import Log` WHERE created_by_aggregator = %(a)s AND inserted > 0)
			UNION ALL (SELECT name, import_date, inserted, 'Gig Transaction Import Log', 'transactions' FROM `tabGig Transaction Import Log` WHERE default_aggregator = %(a)s AND inserted > 0)
			ORDER BY import_date DESC LIMIT 3""", {"a": agg.name}, as_dict=True):
			what = r.what[:-1] if cint(r.inserted) == 1 else r.what   # "1 worker", "2 workers"
			acts.append(_act(r.import_date, "import", _("{0} {1} imported").format(f"{cint(r.inserted):,}", _(what)), None, r.dt, r.name))
		for r in frappe.db.sql("""SELECT t.name, t.date, t.amount, w.worker_name FROM `tabGig Transaction` t LEFT JOIN `tabGig Worker` w ON w.name = t.gig_worker
			WHERE t.aggregator = %s ORDER BY t.creation DESC LIMIT 4""", agg.name, as_dict=True):
			acts.append(_act(r.date, "transaction", _("Transaction {0}").format(money(r.amount)), r.worker_name, "Gig Transaction", r.name))
		who = {"name": agg.aggregator_name, "id": agg.name, "status": agg.status, "role": _("Aggregator")}

	else:
		w = frappe.db.get_value("Gig Worker", scope.worker, ["name", "worker_name", "status"], as_dict=True)
		_n, balance = _count("fund", scope, None, "m.account_balance")
		fee_pending, fee_pending_amt = _count("fee", scope, "m.payment_status = 'Pending'", "m.fee_amount")
		wd_req, wd_req_amt = _count("wd", scope, "m.status = 'Requested'", "m.amount")
		wd_appr, wd_appr_amt = _count("wd", scope, "m.status = 'Approved'", "m.amount")
		if wd_appr:
			todos.append(_todo("good", _("Your withdrawal of {0} is approved").format(money(wd_appr_amt)),
				_("It will be paid to your bank account"), _("View"), "/desk/welfare-benefit-withdrawal"))
		if wd_req:
			todos.append(_todo("info", _("{0} withdrawal request(s) in review · {1}").format(wd_req, money(wd_req_amt)),
				_("The Board will review it"), _("View"), "/desk/welfare-benefit-withdrawal"))
		if balance > 0:
			todos.append(_todo("good", _("You have {0} in your welfare fund").format(money(balance)),
				_("Apply for a medical, education, housing or emergency benefit"), _("Apply"), "/desk/welfare-benefit-withdrawal/new"))
		if fee_pending:
			todos.append(_todo("info", _("{0} of welfare fees are on their way to your fund").format(money(fee_pending_amt)),
				_("Credited once your aggregator pays the invoice"), _("View"), "/desk/gig-worker-dashboard"))
		txns, _a = _count("txn", scope)
		_n, earned = _count("txn", scope, "m.status = 'Payment complete'", "m.net_payout_to_worker")
		_n, fees = _count("fee", scope, None, "m.fee_amount")
		stats = [
			{"label": _("My transactions"), "value": f"{txns:,}", "tone": "info"},
			{"label": _("Earnings received"), "value": money(earned), "tone": "good"},
			{"label": _("Welfare fees for me"), "value": money(fees), "tone": "time"},
			{"label": _("Welfare fund balance"), "value": money(balance), "tone": "good"},
		]
		actions = [
			{"label": _("My Dashboard"), "desc": _("Earnings, fees and fund in detail"), "route": "/desk/gig-worker-dashboard", "icon": "chart"},
			{"label": _("My Transactions"), "desc": _("Every ride / order recorded for you"), "route": "/desk/gig-transaction", "icon": "list"},
			{"label": _("My Welfare Fund"), "desc": _("Balance and every credit"), "route": "/desk/welfare-fund-account", "icon": "wallet"},
			{"label": _("Apply for a Benefit"), "desc": _("Withdraw from your welfare fund"), "route": "/desk/welfare-benefit-withdrawal/new", "icon": "hand"},
			{"label": _("My Profile"), "desc": _("Your registration details"), "route": f"/desk/gig-worker/{w.name}", "icon": "user"},
		]
		acts = _collapse([_act(e["when"], e["kind"], e["title"], e.get("meta"), e.get("doctype"), e.get("name"))
			for e in _worker_timeline(w.name)["events"]])
		who = {"name": w.worker_name, "id": w.name, "status": w.status, "role": _("Gig Worker")}

	acts.sort(key=lambda a: a["when"], reverse=True)
	return {
		"view": view,
		"who": who,
		"todos": todos,
		"stats": stats,
		"actions": actions,
		"activity": acts[:8],
		"next_invoice_run": frappe.utils.formatdate(next_run),
	}
