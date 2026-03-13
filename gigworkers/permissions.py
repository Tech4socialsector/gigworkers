import frappe

def user_based_query(user=None, doctype=None):
    if not user:
        user = frappe.session.user

    # Admin can see everything
    if "System Manager" in frappe.get_roles(user):
        return ""

    meta = frappe.get_meta(doctype)

    # if doctype has email field
    if meta.has_field("email"):
        return f"`tab{doctype}`.email = '{user}'"

    # if doctype has user field
    if meta.has_field("user"):
        return f"`tab{doctype}`.user = '{user}'"

    # fallback owner filter
    return f"`tab{doctype}`.owner = '{user}'"


def user_has_permission(doc, user=None):
    if not user:
        user = frappe.session.user

    if "System Manager" in frappe.get_roles(user):
        return True

    if hasattr(doc, "email"):
        return doc.email == user

    if hasattr(doc, "user"):
        return doc.user == user

    return doc.owner == user