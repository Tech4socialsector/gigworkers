# Copyright (c) 2026, Jenifar and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class GigWorkerSettings(Document):
	# Aggregator approval (auto_approve_days) and gig transaction (max_adjustment_attempts)
	# settings on one page; replaces Aggregator Approval Settings + Gig Transaction Settings.

	def validate(self):
		if (self.max_adjustment_attempts or 0) < 1:
			frappe.throw("Max Adjustment Attempts must be at least 1.")
