import frappe


def execute():
    """Insert the default Gig Transaction Settings row into tabSingles if absent.

    Cannot use frappe.db.get_single_value here because it raises DoesNotExistError
    when no row exists in tabSingles yet, which would abort the patch itself.
    Direct SQL is intentional and safe.
    """
    has_row = frappe.db.sql(
        "SELECT COUNT(*) FROM `tabSingles` WHERE `doctype` = 'Gig Transaction Settings'",
        as_list=True,
    )[0][0]

    if not has_row:
        frappe.db.sql(
            "INSERT INTO `tabSingles` (`doctype`, `field`, `value`) "
            "VALUES ('Gig Transaction Settings', 'max_adjustment_attempts', '3')"
        )
        frappe.db.commit()
