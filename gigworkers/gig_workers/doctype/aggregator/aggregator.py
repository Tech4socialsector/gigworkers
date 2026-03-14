# Copyright (c) 2026, Jenifar and contributors
# For license information, please see license.txt

import re
import frappe
from frappe.model.document import Document
from frappe.utils.password import update_password


class Aggregator(Document):
	def validate(self):
		# Email uniqueness across Aggregator and Gig Worker
		if self.email:
			existing_aggregator = frappe.db.get_value(
				"Aggregator", {"email": self.email, "name": ("!=", self.name)}, "name"
			)
			if existing_aggregator:
				frappe.throw(f"Email '{self.email}' is already registered with another Aggregator.")

			existing_worker = frappe.db.get_value(
				"Gig Worker", {"email": self.email}, "name"
			)
			if existing_worker:
				frappe.throw(f"Email '{self.email}' is already registered as a Gig Worker.")

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
		frappe.db.set_value("Aggregator", self.name, "status", "Submitted")
		self.status = "Submitted"
		self.send_status_email("Submitted")

	def on_update(self):
		previous_status = self.get_doc_before_save()
		if previous_status and previous_status.status != self.status and self.status in ("Under Process", "Approved", "Rejected"):
			if self.status == "Approved":
				self.create_user_with_role()
			self.send_status_email(self.status)

	def send_status_email(self, status):
		if not self.email:
			return

		status_messages = {
			"Submitted": {
				"subject": "Application Submitted - Awaiting Admin Approval",
				"body": f"""
				<p>Dear {self.aggregator_name},</p>
				<p>Your aggregator application has been successfully <b>submitted</b>.</p>
				<p>It is currently waiting for approval by the admin. You will be notified once there is an update.</p>
				<p>Thank you,<br>Gig Workers Team</p>
				"""
			},
			"Under Process": {
				"subject": "Application Under Process",
				"body": f"""
				<p>Dear {self.aggregator_name},</p>
				<p>Your aggregator application is currently <b>under process</b>.</p>
				<p>Our admin team is reviewing your details. You will be notified once a decision is made.</p>
				<p>Thank you,<br>Gig Workers Team</p>
				"""
			},
			"Approved": {
				"subject": "Congratulations! Application Approved",
				"body": f"""
				<p>Dear {self.aggregator_name},</p>
				<p>We are pleased to inform you that your aggregator application has been <b>approved</b>.</p>
				<p>Here are your login credentials:</p>
				<ul>
					<li><b>Username/Email:</b> {self.email}</li>
					<li><b>Password:</b> {self.mobile}</li>
				</ul>
				<p>Please log in and change your password as soon as possible.</p>
				<p>Thank you,<br>Gig Workers Team</p>
				"""
			},
			"Rejected": {
				"subject": "Application Rejected",
				"body": f"""
				<p>Dear {self.aggregator_name},</p>
				<p>We regret to inform you that your aggregator application has been <b>rejected</b>.</p>
				<p>Please contact the admin for more information.</p>
				<p>Thank you,<br>Gig Workers Team</p>
				"""
			},
		}

		if status not in status_messages:
			return

		frappe.sendmail(
			recipients=[self.email],
			subject=status_messages[status]["subject"],
			message=status_messages[status]["body"],
			now=True
		)

	def create_user_with_role(self):
		if not self.email or not self.mobile:
			return

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
		else:
			# User exists, ensure Aggregator role is assigned
			user = frappe.get_doc("User", self.email)
			existing_roles = [r.role for r in user.roles]
			if "Aggregator" not in existing_roles:
				user.append("roles", {"role": "Aggregator"})
				user.save(ignore_permissions=True)
			user = frappe.get_doc("User", self.email)

		update_password(self.email, self.mobile)
