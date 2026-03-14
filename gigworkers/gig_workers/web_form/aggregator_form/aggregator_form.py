import re
import frappe


def get_context(context):
	pass


def validate(doc, method=None):
	# PAN format: 5 letters, 4 digits, 1 letter
	if doc.pan:
		doc.pan = doc.pan.upper()
		if not re.match(r'^[A-Z]{5}[0-9]{4}[A-Z]{1}$', doc.pan):
			frappe.throw("Invalid PAN Format. A valid PAN should be like ABCDE1234F.")

	# GSTIN format (if provided)
	if doc.gstin:
		doc.gstin = doc.gstin.upper()
		if not re.match(r'^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$', doc.gstin):
			frappe.throw("Invalid GSTIN Format. A valid GSTIN should be 15 characters like 22ABCDE1234F1Z5.")

	# Mobile: 10-digit Indian number starting with 6-9
	if doc.mobile:
		if not re.match(r'^[6-9][0-9]{9}$', doc.mobile):
			frappe.throw("Invalid Mobile Number. Please enter a valid 10-digit Indian mobile number.")

	# Company ID validation based on Company Type
	if doc.company_type and doc.company_id:
		if doc.company_type == 'CIN':
			if not re.match(r'^[LUu][0-9]{5}[A-Za-z]{2}[0-9]{4}[Pp][Ll][Cc][0-9]{6}$', doc.company_id):
				frappe.throw("Invalid CIN Format. A valid CIN should be like L12345AB2020PLC123456.")
		elif doc.company_type == 'LLPIN':
			if not re.match(r'^[A-Z]{3}-[0-9]{4}$', doc.company_id.upper()):
				frappe.throw("Invalid LLPIN Format. A valid LLPIN should be like AAA-1234.")

	# Duplicate email check
	if doc.email:
		existing = frappe.db.get_value("Aggregator", {"email": doc.email, "name": ("!=", doc.name)}, "name")
		if existing:
			frappe.throw(f"An Aggregator with email {doc.email} already exists.")
