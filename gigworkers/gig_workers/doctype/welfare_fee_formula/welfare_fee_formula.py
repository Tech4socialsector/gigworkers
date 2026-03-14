# Copyright (c) 2026, Jenifar and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class WelfareFeeFormula(Document):

    def validate(self):
        if self.welfare_percentage is None or self.welfare_percentage < 0:
            frappe.throw("Welfare percentage cannot be negative.")
        if self.welfare_percentage > 100:
            frappe.throw("Welfare percentage cannot exceed 100%.")
