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
		self.validate_aadhaar_format()
		self.validate_pan_format()
		self.validate_dob()
		self.validate_eshram_id()

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

	def validate_aadhaar_format(self):
		if self.aadhaar_number:
			aadhaar_clean = self.aadhaar_number.replace(" ", "")
			if not re.fullmatch(r"[0-9]{12}", aadhaar_clean):
				frappe.throw(
					f"❌ <b>Aadhaar Number</b> '{self.aadhaar_number}' is not valid.<br>"
					"Please enter a valid 12-digit Aadhaar number.",
					title="Invalid Aadhaar Number",
				)

	def validate_pan_format(self):
		if self.pan_number:
			self.pan_number = self.pan_number.upper()
			if not re.fullmatch(r"[A-Z]{5}[0-9]{4}[A-Z]", self.pan_number):
				frappe.throw(
					f"❌ <b>PAN Number</b> '{self.pan_number}' is not valid.<br>"
					"Please enter a valid PAN (e.g., ABCDE1234F).",
					title="Invalid PAN Number",
				)

	def validate_dob(self):
		if self.dob:
			from frappe.utils import getdate, date_diff, today
			dob_date = getdate(self.dob)
			today_date = getdate(today())
			if dob_date > today_date:
				frappe.throw("❌ <b>Date of Birth</b> cannot be a future date.", title="Invalid Date of Birth")
			age_days = date_diff(today_date, dob_date)
			if age_days < 18 * 365:
				frappe.throw("❌ Gig Worker must be at least 18 years old.", title="Age Requirement Not Met")

	def validate_eshram_id(self):
		if self.eshram_id:
			self.eshram_id = self.eshram_id.upper()
			if not re.fullmatch(r"UW-[0-9]{12}", self.eshram_id):
				frappe.throw(
					f"❌ <b>eShram ID</b> '{self.eshram_id}' is not valid.<br>"
					"Please enter a valid eShram ID (e.g., UW-123456789012).",
					title="Invalid eShram ID",
				)

	# --------------------------------------------------------
	#  gigworkers lifecycle — before insert: set aggregator
	# --------------------------------------------------------

	def before_insert(self):
		if not self.created_by_aggregator:
			aggregator = frappe.db.get_value(
				"Aggregator", {"email": frappe.session.user}, "name"
			)
			if aggregator:
				self.created_by_aggregator = aggregator

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

			# Link user back to this Gig Worker record
			self.db_set("user", user_email, update_modified=False)

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
