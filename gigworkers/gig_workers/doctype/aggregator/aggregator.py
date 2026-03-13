# Copyright (c) 2026, Jenifar and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class Aggregator(Document):
	def after_insert(self):
		self.create_user_and_send_email()

	def create_user_and_send_email(self):
		if not self.email or not self.mobile:
			return
		
		# Ensure the Aggregator role exists
		if not frappe.db.exists("Role", "Aggregator"):
			role = frappe.get_doc({
				"doctype": "Role",
				"role_name": "Aggregator",
				"desk_access": 1
			})
			role.insert(ignore_permissions=True)
			
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
