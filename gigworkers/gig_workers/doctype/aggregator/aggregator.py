# Copyright (c) 2026, Jenifar and contributors
# For license information, please see license.txt

import re
import frappe
from frappe.model.document import Document


class Aggregator(Document):
	def validate(self):
		# PAN format: 5 letters, 4 digits, 1 letter
		if self.pan:
			self.pan = self.pan.upper()
			if not re.match(r'^[A-Z]{5}[0-9]{4}[A-Z]{1}$', self.pan):
				frappe.throw("Invalid PAN Format. A valid PAN should be like ABCDE1234F.")

		# GSTIN format (if provided)
		if self.gstin:
			self.gstin = self.gstin.upper()
			if not re.match(r'^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$', self.gstin):
				frappe.throw("Invalid GSTIN Format. A valid GSTIN should be 15 characters like 22ABCDE1234F1Z5.")

		# Mobile: 10-digit Indian number starting with 6-9
		if self.mobile:
			if not re.match(r'^[6-9][0-9]{9}$', self.mobile):
				frappe.throw("Invalid Mobile Number. Please enter a valid 10-digit Indian mobile number.")

		# Company ID validation based on Company Type
		if self.company_type and self.company_id:
			if self.company_type == 'CIN':
				if not re.match(r'^[LUu][0-9]{5}[A-Za-z]{2}[0-9]{4}[Pp][Ll][Cc][0-9]{6}$', self.company_id):
					frappe.throw("Invalid CIN Format. A valid CIN should be like L12345AB2020PLC123456.")
			elif self.company_type == 'LLPIN':
				if not re.match(r'^[A-Z]{3}-[0-9]{4}$', self.company_id.upper()):
					frappe.throw("Invalid LLPIN Format. A valid LLPIN should be like AAA-1234.")

	def after_insert(self):
		self.create_user_and_send_email()

	def create_user_and_send_email(self):
		if not self.email or not self.mobile:
			return
		
		# Check if User already exists
		if not frappe.db.exists("User", self.email):
			user = frappe.get_doc({
				"doctype": "User",
				"email": self.email,
				"first_name": self.aggregator_name,
				"send_welcome_email": 0,
				"roles": [{"role": "Aggregator"}],
			})
			user.flags.ignore_password_policy = True
			user.insert(ignore_permissions=True)
			
			# Set password
			from frappe.utils.password import update_password
			update_password(user.name, self.mobile)
			
			# Send welcome email
			subject = "Registration Successful - Aggregator"
			message = f"""
			<p>Hello {self.aggregator_name},</p>
			<p>You have successfully registered as an Aggregator.</p>
			<p>Here are your login credentials:</p>
			<ul>
				<li><b>Username/Email:</b> {self.email}</li>
				<li><b>Password:</b> {self.mobile}</li>
			</ul>
			<p>Please log in and change your password as soon as possible.</p>
			<p>Thank you,</p>
			<p>Gig Workers Team</p>
			"""
			
			frappe.sendmail(
				recipients=[self.email],
				subject=subject,
				message=message,
				now=True
			)
