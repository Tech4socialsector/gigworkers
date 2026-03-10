# Copyright (c) 2026, Jenifar and contributors
# For license information, please see license.txt

# ============================================================
#  gigworkers — Gig Worker Controller
# ============================================================

import re

import frappe
from frappe.model.document import Document


class GigWorker(Document):

	# --------------------------------------------------------
	#  gigworkers validation — field format checks
	# --------------------------------------------------------

	def validate(self):
		self.validate_email_format()
		self.validate_phone_format()

	def validate_email_format(self):
		"""
		gigworkers validation — ensure the Email field contains
		a valid email address (e.g. worker@domain.com).
		"""
		if self.email:
			email_pattern = r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$"
			if not re.match(email_pattern, self.email.strip()):
				frappe.throw(
					f"❌ <b>Email</b> '{self.email}' is not a valid email address.<br>"
					"Please enter a valid email (e.g. worker@example.com).",
					title="Invalid Email",
				)

	def validate_phone_format(self):
		"""
		gigworkers validation — ensure the Phone field contains
		exactly 10 digits (Indian mobile number format).
		"""
		if self.phone:
			phone_clean = self.phone.strip()
			if not re.fullmatch(r"[6-9]\d{9}", phone_clean):
				frappe.throw(
					f"❌ <b>Phone</b> '{self.phone}' is not a valid phone number.<br>"
					"Please enter a 10-digit Indian mobile number starting with 6, 7, 8, or 9.",
					title="Invalid Phone Number",
				)

	# --------------------------------------------------------
	#  gigworkers lifecycle — after insert: create user & send email
	# --------------------------------------------------------

	def after_insert(self):
		self.create_user_and_send_email()

	def create_user_and_send_email(self):
		# 'email' fieldname = Email label, 'phone' fieldname = Phone label
		user_email = self.email
		user_mobile = self.phone

		if not user_email or not user_mobile:
			return

		# Check if User already exists
		if not frappe.db.exists("User", user_email):
			user = frappe.get_doc({
				"doctype": "User",
				"email": user_email,
				"first_name": self.worker_name,
				"send_welcome_email": 0,
				"roles": [{"role": "Gig Worker"}],
			})
			user.flags.ignore_password_policy = True
			user.insert(ignore_permissions=True)

			# Set password
			from frappe.utils.password import update_password
			update_password(user.name, user_mobile)

			# Send welcome email
			subject = "Registration Successful - Gig Worker"
			message = f"""
			<p>Hello {self.worker_name},</p>
			<p>You have successfully registered as a Gig Worker.</p>
			<p>Here are your login credentials:</p>
			<ul>
				<li><b>Username/Email:</b> {user_email}</li>
				<li><b>Password:</b> {user_mobile}</li>
			</ul>
			<p>Please log in and change your password as soon as possible.</p>
			<p>Thank you,</p>
			<p>Gig Workers Team</p>
			"""

			frappe.sendmail(
				recipients=[user_email],
				subject=subject,
				message=message,
				now=True,
			)
