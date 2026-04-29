# Copyright (c) 2026, Jenifar and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import now


class WelfareFundAccount(Document):

	def credit(self, amount, reference_doctype=None, reference_name=None, remarks=None, gig_transaction=None):
		"""Add welfare fee to the account."""
		self.total_collected  = (self.total_collected or 0) + amount
		self.account_balance  = (self.account_balance or 0) + amount
		self.last_updated     = now()
		self.append("ledger_entries", {
			"entry_type":       "Credit",
			"amount":           amount,
			"balance_after":    self.account_balance,
			"entry_date":       now(),
			"gig_transaction":  gig_transaction or "",
			"reference_doctype":reference_doctype or "",
			"reference_name":   reference_name or "",
			"remarks":          remarks or "Welfare fee credited",
		})
		if gig_transaction:
			self._append_gig_transaction_detail(gig_transaction)
		self.save(ignore_permissions=True)

	def _append_gig_transaction_detail(self, gig_transaction_name):
		"""Append a row to gig_transaction_details from the linked Gig Transaction."""
		gt = frappe.db.get_value(
			"Gig Transaction",
			gig_transaction_name,
			[
				"transaction_id", "date", "aggregator", "service",
				"service_category", "service_type", "status", "status_of_order",
				"settlement_status", "amount", "base_payout", "deducation",
				"incentives", "net_payout_to_worker", "welfare_percentage",
				"welfare_cap", "welfare_amount",
			],
			as_dict=True,
		)
		if not gt:
			return
		self.append("gig_transaction_details", {
			"transaction_id":      gig_transaction_name,
			"date":                gt.date,
			"aggregator":          gt.aggregator,
			"service":             gt.service,
			"service_category":    gt.service_category,
			"service_type":        gt.service_type,
			"status":              gt.status,
			"status_of_order":     gt.status_of_order,
			"settlement_status":   gt.settlement_status,
			"amount":              gt.amount,
			"base_payout":         gt.base_payout,
			"deducation":          gt.deducation,
			"incentives":          gt.incentives,
			"net_payout_to_worker":gt.net_payout_to_worker,
			"welfare_percentage":  gt.welfare_percentage,
			"welfare_cap":         gt.welfare_cap,
			"welfare_amount":      gt.welfare_amount,
		})

	def debit(self, amount, reference_doctype=None, reference_name=None, remarks=None):
		"""Deduct amount from the account."""
		if (self.account_balance or 0) < amount:
			frappe.throw(
				f"Insufficient welfare fund balance. "
				f"Available: &#8377;{self.account_balance or 0:.2f}, Requested: &#8377;{amount:.2f}"
			)
		self.total_withdrawn = (self.total_withdrawn or 0) + amount
		self.account_balance = (self.account_balance or 0) - amount
		self.last_updated    = now()
		self.append("ledger_entries", {
			"entry_type":       "Debit",
			"amount":           amount,
			"balance_after":    self.account_balance,
			"entry_date":       now(),
			"reference_doctype":reference_doctype or "",
			"reference_name":   reference_name or "",
			"remarks":          remarks or "Welfare benefit withdrawal",
		})
		self.save(ignore_permissions=True)

	@staticmethod
	def get_or_create(gig_worker):
		"""Return the welfare fund account for a worker, creating one if absent."""
		name = frappe.db.get_value("Welfare Fund Account", {"gig_worker": gig_worker}, "name")
		if name:
			return frappe.get_doc("Welfare Fund Account", name)

		doc = frappe.get_doc({
			"doctype":        "Welfare Fund Account",
			"gig_worker":     gig_worker,
			"total_collected":0,
			"total_withdrawn":0,
			"account_balance":0,
			"last_updated":   now(),
		})
		doc.insert(ignore_permissions=True)
		return doc


@frappe.whitelist()
def get_list_summary():
	"""Aggregate totals shown as number cards on the Welfare Fund Account list view."""
	row = frappe.db.sql(
		"""
		SELECT
			COALESCE(SUM(account_balance), 0) AS total_account_balance,
			COALESCE(SUM(total_withdrawn),  0) AS total_withdrawn
		FROM `tabWelfare Fund Account`
		""",
		as_dict=True,
	)
	return row[0] if row else {"total_account_balance": 0, "total_withdrawn": 0}
