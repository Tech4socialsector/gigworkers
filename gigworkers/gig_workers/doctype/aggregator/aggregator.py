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

		# Mobile: 10-digit Indian number starting with 6-9
		if self.mobile:
			if not re.match(r'^[6-9][0-9]{9}$', self.mobile):
				frappe.throw("Invalid Mobile Number. Please enter a valid 10-digit Indian mobile number.")

		# Validate each service row
		service_names = []
		for svc in (self.services or []):
			svc_label = svc.service_name or f"Row {svc.idx}"

			if svc.service_name in service_names:
				frappe.throw(f"Duplicate service '{svc.service_name}' — each service name must be unique.")
			service_names.append(svc.service_name)

			if svc.pan:
				svc.pan = svc.pan.upper()
				if not re.match(r'^[A-Z]{5}[0-9]{4}[A-Z]{1}$', svc.pan):
					frappe.throw(f"[{svc_label}] Invalid PAN Format. Should be like ABCDE1234F.")

			if svc.gstin:
				svc.gstin = svc.gstin.upper()
				if not re.match(r'^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$', svc.gstin):
					frappe.throw(f"[{svc_label}] Invalid GSTIN Format. Should be 15 characters like 22ABCDE1234F1Z5.")

			if svc.company_type and svc.company_id:
				if svc.company_type == 'CIN':
					if not re.match(r'^[LUu][0-9]{5}[A-Za-z]{2}[0-9]{4}[Pp][Ll][Cc][0-9]{6}$', svc.company_id):
						frappe.throw(f"[{svc_label}] Invalid CIN Format. Should be like L12345AB2020PLC123456.")
				elif svc.company_type == 'LLPIN':
					if not re.match(r'^[A-Z]{3}-[0-9]{4}$', svc.company_id.upper()):
						frappe.throw(f"[{svc_label}] Invalid LLPIN Format. Should be like AAA-1234.")

	def after_insert(self):
		frappe.db.set_value("Aggregator", self.name, "status", "Submitted")
		self.status = "Submitted"
		self.send_status_email("Submitted")

	def on_update(self):
		previous_status = self.get_doc_before_save()
		if previous_status and previous_status.status != self.status and self.status in ("Under Process", "Approved", "Rejected"):
			if self.status == "Approved":
				self.create_user_with_role()
				self._generate_and_send_api_key()
			self.send_status_email(self.status)

	def _generate_and_send_api_key(self):
		"""Generate API key + secret for the aggregator's user account on approval.
		Keys are sent over email and must be used in API calls as per requirements §1.4.3."""
		if not self.email or not frappe.db.exists("User", self.email):
			return

		api_key = frappe.generate_hash(length=15)
		api_secret = frappe.generate_hash(length=15)

		user = frappe.get_doc("User", self.email)
		user.api_key = api_key
		user.api_secret = api_secret
		user.save(ignore_permissions=True)

		try:
			frappe.sendmail(
				recipients=[self.email],
				subject="Your API Credentials – Gig Workers Portal",
				message=f"""
				<p>Dear {self.aggregator_name},</p>
				<p>Your aggregator account is now <b>approved</b>. Use the credentials below for programmatic API access to the portal:</p>
				<table style="border-collapse:collapse;margin-top:12px;font-family:monospace;">
				  <tr><td style="padding:4px 16px 4px 0"><b>API Key</b></td><td>{api_key}</td></tr>
				  <tr><td style="padding:4px 16px 4px 0"><b>API Secret</b></td><td>{api_secret}</td></tr>
				</table>
				<p>Pass these as <code>Authorization: token api_key:api_secret</code> in your request headers.</p>
				<p><b>Keep these credentials secure and do not share them.</b></p>
				<p>Thank you,<br>Gig Workers Welfare Team</p>
				""",
			)
		except Exception as e:
			frappe.log_error(
				message=f"API key email failed for aggregator {self.name}: {e}",
				title="Aggregator API Key Email Error",
			)

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

		try:
			frappe.sendmail(
				recipients=[self.email],
				subject=status_messages[status]["subject"],
				message=status_messages[status]["body"],
			)
		except Exception as e:
			frappe.log_error(
				message=f"Status email failed for aggregator {self.name}: {e}",
				title="Aggregator Status Email Error",
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
