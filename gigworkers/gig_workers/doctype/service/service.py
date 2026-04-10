# Copyright (c) 2026, Jenifar and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import today


class Service(Document):
	def validate(self):
		if self.effective_end_date and self.effective_start_date:
			if str(self.effective_end_date) < str(self.effective_start_date):
				frappe.throw("Effective End Date cannot be before Effective Start Date.")

	def before_save(self):
		if self.is_new():
			return

		old = self.get_doc_before_save()
		if not old:
			return

		rate_changed = (
			str(old.welfare_percentage_ or "") != str(self.welfare_percentage_ or "")
			or str(old.welfare_cap or "")        != str(self.welfare_cap or "")
			or str(old.effective_start_date or "") != str(self.effective_start_date or "")
			or str(old.effective_end_date or "")   != str(self.effective_end_date or "")
		)

		if rate_changed and not _already_logged(self, old):
			self.append("rate_log", {
				"welfare_percentage_":  old.welfare_percentage_,
				"welfare_cap":          old.welfare_cap,
				"effective_start_date": old.effective_start_date,
				"effective_end_date":   old.effective_end_date,
				"status":               _compute_status(old.effective_start_date, old.effective_end_date),
			})


def _already_logged(doc, old):
	"""Return True if the last rate_log row already captures the old values (prevents duplicates)."""
	if not doc.rate_log:
		return False
	last = doc.rate_log[-1]
	return (
		str(last.welfare_percentage_ or "") == str(old.welfare_percentage_ or "")
		and str(last.welfare_cap or "")         == str(old.welfare_cap or "")
		and str(last.effective_start_date or "") == str(old.effective_start_date or "")
		and str(last.effective_end_date or "")   == str(old.effective_end_date or "")
	)


def _compute_status(start_date, end_date):
	td = today()                        # string "YYYY-MM-DD"
	s  = str(start_date) if start_date else None
	e  = str(end_date)   if end_date   else None
	if e and e < td:
		return "Expired"
	if s and s > td:
		return "Scheduled"
	return "Active"


@frappe.whitelist()
def update_rate(docname, close_current_on, new_welfare_percentage,
				new_welfare_cap, new_start_date, new_end_date=None):

	doc = frappe.get_doc("Service", docname)

	# Validate dates
	if str(close_current_on) < str(doc.effective_start_date or ""):
		frappe.throw("Close Current Rate On cannot be before the current Start Date ({}).".format(
			doc.effective_start_date))

	if str(new_start_date) <= str(close_current_on):
		frappe.throw("New Start Date must be after the Close Current Rate On date ({}).".format(
			close_current_on))

	if new_end_date and str(new_end_date) <= str(new_start_date):
		frappe.throw("New End Date must be after the New Start Date.")

	# Update fields — before_save will auto-log the old values
	doc.effective_end_date   = close_current_on
	doc.welfare_percentage_  = float(new_welfare_percentage)
	doc.welfare_cap          = float(new_welfare_cap)
	doc.effective_start_date = new_start_date
	doc.effective_end_date   = new_end_date or None

	doc.save()
	frappe.db.commit()
