import frappe


def execute():
    for doctype in ("Data Import", "Data Import Log"):
        if not frappe.db.exists(
            "Custom DocPerm",
            {"parent": doctype, "role": "Aggregator"},
        ):
            frappe.get_doc(
                {
                    "doctype": "Custom DocPerm",
                    "parent": doctype,
                    "parenttype": "DocType",
                    "parentfield": "permissions",
                    "role": "Aggregator",
                    "permlevel": 0,
                    "read": 1,
                    "write": 1,
                    "create": 1,
                    "delete": 0,
                    "export": 1,
                }
            ).insert(ignore_permissions=True)

        frappe.clear_cache(doctype=doctype)
