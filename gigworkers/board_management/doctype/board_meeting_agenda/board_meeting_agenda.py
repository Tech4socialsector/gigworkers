# Copyright (c) 2026, Jenifar and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class BoardMeetingAgenda(Document):

	def validate(self):
		self._number_agenda_items()

	def _number_agenda_items(self):
		for idx, item in enumerate(self.agenda_items or [], start=1):
			item.item_no = idx


@frappe.whitelist()
def make_meeting_minutes(source_name, target_doc=None):
	agenda = frappe.get_doc("Board Meeting Agenda", source_name)

	minutes = frappe.new_doc("Board Meeting Minutes")
	minutes.title = agenda.title
	minutes.meeting_date = agenda.meeting_date
	minutes.venue = agenda.venue
	minutes.meeting_agenda = source_name
	minutes.status = "Draft"

	for item in agenda.agenda_items:
		minutes.append("minutes_items", {
			"agenda_item": item.agenda_item,
		})

	return minutes
