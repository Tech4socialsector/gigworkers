# Copyright (c) 2026, Jenifar and contributors
# For license information, please see license.txt

import re
import frappe
from frappe.model.document import Document


class BoardMember(Document):

	def validate(self):
		if self.email:
			email_pattern = r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$"
			if not re.match(email_pattern, self.email.strip()):
				frappe.throw(
					f"Invalid Email '{self.email}'. Please enter a valid email address.",
					title="Invalid Email",
				)

		if self.phone:
			phone_clean = self.phone.strip()
			if not re.fullmatch(r"[6-9]\d{9}", phone_clean):
				frappe.throw(
					f"Invalid Phone '{self.phone}'. Please enter a 10-digit Indian mobile number starting with 6, 7, 8, or 9.",
					title="Invalid Phone Number",
				)
