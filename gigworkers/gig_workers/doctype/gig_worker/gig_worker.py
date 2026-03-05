# Copyright (c) 2026, Jenifar and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class GigWorker(Document):
	def after_insert(self):
		self.create_user_and_send_email()

	def create_user_and_send_email(self):
		# 'phone' fieldname holds the Email value, 'email' fieldname holds Mobile value
		user_email = self.phone
		user_mobile = self.email
		
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
				now=True
			)
