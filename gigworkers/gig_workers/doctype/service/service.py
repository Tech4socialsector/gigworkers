# Copyright (c) 2026, Jenifar and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import today


class Service(Document):
	def validate(self):
		if self.effective_end_date and self.effective_start_date:
			if self.effective_end_date < self.effective_start_date:
				frappe.throw("Effective End Date cannot be before Effective Start Date.")

	def before_save(self):
		if self.is_new():
			return

		old = self.get_doc_before_save()
		if not old:
			return

		rate_changed = (
			old.welfare_percentage_ != self.welfare_percentage_
			or old.welfare_cap != self.welfare_cap
			or old.effective_start_date != self.effective_start_date
			or old.effective_end_date != self.effective_end_date
		)

		if rate_changed:
			self.append("rate_log", {
				"welfare_percentage_":  old.welfare_percentage_,
				"welfare_cap":          old.welfare_cap,
				"effective_start_date": old.effective_start_date,
				"effective_end_date":   old.effective_end_date,
				"status":               _compute_status(old.effective_start_date, old.effective_end_date),
			})


def _compute_status(start_date, end_date):
	td = today()
	if end_date and end_date < td:
		return "Expired"
	if start_date and start_date > td:
		return "Scheduled"
	return "Active"
