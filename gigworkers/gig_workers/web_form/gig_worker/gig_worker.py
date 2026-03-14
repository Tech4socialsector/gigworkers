import frappe


def get_context(context):
	pass


def accept(doc, form_dict):
	"""Explicitly trigger user creation and welcome email after webform submission."""
	gig_worker = frappe.get_doc("Gig Worker", doc.name)
	gig_worker.create_user_and_send_email()
