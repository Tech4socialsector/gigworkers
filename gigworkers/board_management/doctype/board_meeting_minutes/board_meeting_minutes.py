# Copyright (c) 2026, Jenifar and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import today


class BoardMeetingMinutes(Document):

	def validate(self):
		if self.status == "Approved":
			if not self.approved_by:
				frappe.throw("Please set 'Approved By' before marking minutes as Approved.", title="Approval Required")
			if not self.approved_date:
				self.approved_date = today()
