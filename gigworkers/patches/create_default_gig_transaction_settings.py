import frappe


def execute():
    """Create the default Gig Transaction Settings Single document if it doesn't exist."""
    if not frappe.db.get_single_value("Gig Transaction Settings", "max_adjustment_attempts"):
        doc = frappe.get_doc({
            "doctype": "Gig Transaction Settings",
            "max_adjustment_attempts": 3,
        })
        doc.insert(ignore_permissions=True)
        frappe.db.commit()
