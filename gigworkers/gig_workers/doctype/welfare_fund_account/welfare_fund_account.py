# Copyright (c) 2026, Jenifar and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import now


class WelfareFundAccount(Document):

	def credit(self, amount, reference_doctype=None, reference_name=None, remarks=None):
		"""Add welfare fee to the account."""
		self.total_collected  = (self.total_collected or 0) + amount
		self.account_balance  = (self.account_balance or 0) + amount
		self.last_updated     = now()
		self.append("ledger_entries", {
			"entry_type":       "Credit",
			"amount":           amount,
			"balance_after":    self.account_balance,
			"entry_date":       now(),
			"reference_doctype":reference_doctype or "",
			"reference_name":   reference_name or "",
			"remarks":          remarks or "Welfare fee credited",
		})
		self.save(ignore_permissions=True)

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
