# Copyright (c) 2026, Jenifar and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class WorkerPartnerMapping(Document):
	def validate(self):
		self.validate_unique_aggregators()

	def validate_unique_aggregators(self):
		seen = set()
		for row in self.aggregator_mappings:
			if not row.aggregator:
				continue
			if row.aggregator in seen:
				frappe.throw(
					f"{self.gig_worker_id} is already mapped to aggregator {row.aggregator} — "
					f"a worker can only have one entry per aggregator."
				)
			seen.add(row.aggregator)
