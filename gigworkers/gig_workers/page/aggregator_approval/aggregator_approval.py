import frappe
import json
from frappe.utils import add_days, now_datetime


@frappe.whitelist()
def get_auto_approve_days():
    """Return the configured number of days after which a Submitted application auto-approves."""
    frappe.only_for("System Manager")
    return frappe.db.get_single_value("Aggregator Approval Settings", "auto_approve_days") or 0


@frappe.whitelist()
def set_auto_approve_days(days):
    """Update the number of days after which a Submitted application auto-approves."""
    frappe.only_for("System Manager")

    try:
        days = int(days)
    except (TypeError, ValueError):
        frappe.throw("Days must be a whole number.")

    if days < 0:
        frappe.throw("Days cannot be negative.")

    frappe.db.set_single_value("Aggregator Approval Settings", "auto_approve_days", days)
    frappe.db.commit()
    return {"auto_approve_days": days}


def auto_approve_stale_aggregators():
    """Daily scheduled job: auto-approve applications left in 'Submitted' status
    for longer than the configured number of days."""
    days = frappe.db.get_single_value("Aggregator Approval Settings", "auto_approve_days") or 0
    if not days:
        return

    cutoff = add_days(now_datetime(), -days)
    stale_ids = frappe.get_all(
        "Aggregator",
        filters={"status": "Submitted", "creation": ("<=", cutoff)},
        pluck="name",
    )

    for agg_id in stale_ids:
        try:
            doc = frappe.get_doc("Aggregator", agg_id)
            doc.status = "Approved"
            doc.flags.trigger_status_email = "Approved"
            doc.save(ignore_permissions=True)
            frappe.db.commit()
        except Exception:
            frappe.db.rollback()
            frappe.log_error(
                message=frappe.get_traceback(),
                title=f"Auto-approve failed for aggregator {agg_id}",
            )


@frappe.whitelist()
def get_pending_aggregators(status_filter=None):
    """Return aggregators pending approval (Submitted / Under Process / Pending with Clarification)."""
    frappe.only_for("System Manager")

    filters = {}
    if status_filter and status_filter != "All":
        filters["status"] = status_filter
    else:
        filters["status"] = ["in", ["Submitted", "Under Process", "Pending with Clarification"]]

    rows = frappe.get_all(
        "Aggregator",
        filters=filters,
        fields=[
            "name", "aggregator_name", "email", "mobile", "status", "creation",
            "clarification_comments", "clarification_response"
        ],
        order_by="creation asc",
    )
    return rows


@frappe.whitelist()
def update_aggregator_status(aggregator_id, new_status, clarification_comments=None):
    """Update status of a single aggregator. For Pending with Clarification, comments are mandatory."""
    frappe.only_for("System Manager")

    if new_status not in ("Under Process", "Approved", "Pending with Clarification"):
        frappe.throw("Invalid status. Allowed: Under Process, Approved, Pending with Clarification")

    if new_status == "Pending with Clarification" and not clarification_comments:
        frappe.throw("Clarification comments are required when setting status to Pending with Clarification.")

    doc = frappe.get_doc("Aggregator", aggregator_id)
    doc.status = new_status
    if new_status == "Pending with Clarification" and clarification_comments:
        doc.clarification_comments = clarification_comments
        doc.clarification_response = None
    doc.flags.trigger_status_email = new_status
    doc.save(ignore_permissions=True)
    frappe.db.commit()
    return {"message": f"{aggregator_id} updated to {new_status}"}


@frappe.whitelist()
def bulk_update_status(aggregator_ids, new_status, clarification_comments=None):
    """Bulk update status for a list of aggregators."""
    frappe.only_for("System Manager")

    if new_status not in ("Under Process", "Approved", "Pending with Clarification"):
        frappe.throw("Invalid status. Allowed: Under Process, Approved, Pending with Clarification")

    if new_status == "Pending with Clarification" and not clarification_comments:
        frappe.throw("Clarification comments are required when setting status to Pending with Clarification.")

    ids = json.loads(aggregator_ids) if isinstance(aggregator_ids, str) else aggregator_ids
    if not isinstance(ids, list):
        frappe.throw("aggregator_ids must be a JSON list.")

    updated = 0
    errors = []
    for agg_id in ids:
        try:
            doc = frappe.get_doc("Aggregator", agg_id)
            doc.status = new_status
            if new_status == "Pending with Clarification" and clarification_comments:
                doc.clarification_comments = clarification_comments
                doc.clarification_response = None
            doc.flags.trigger_status_email = new_status
            doc.save(ignore_permissions=True)
            updated += 1
        except Exception as e:
            errors.append({"id": agg_id, "error": str(e)})

    frappe.db.commit()
    return {"updated": updated, "errors": errors}
