import frappe
from frappe.model.document import Document
from frappe.utils import now_datetime, today


class Grievance(Document):
	def before_insert(self):
		self.submitted_date = today()
		# Auto-link gig worker from current user if role is Gig Worker
		if not self.gig_worker:
			roles = frappe.get_roles(frappe.session.user)
			if "Gig Worker" in roles:
				gig_worker = frappe.db.get_value(
					"Gig Worker", {"email": frappe.session.user}, "name"
				)
				if gig_worker:
					self.gig_worker = gig_worker

	def validate(self):
		if not self.title:
			frappe.throw("Title is required.")
		if not self.description:
			frappe.throw("Description is required.")
		if not self.category:
			frappe.throw("Category is required.")
