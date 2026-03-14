# Copyright (c) 2026, Jenifar and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class WorkerServiceMapping(Document):
	def validate(self):
		self.check_duplicate_mapping()

	def check_duplicate_mapping(self):
		filters = {
			"gig_worker": self.gig_worker,
			"aggregator": self.aggregator,
			"service": self.service,
		}
		if not self.is_new():
			filters["name"] = ("!=", self.name)

		existing = frappe.db.exists("Worker Service Mapping", filters)
		if existing:
			frappe.throw(
				f"A mapping for Gig Worker <b>{self.gig_worker}</b>, Aggregator <b>{self.aggregator}</b>, "
				f"and Service <b>{self.service}</b> already exists."
			)
