import frappe


def _get_aggregator_name(user):
    """Return the Aggregator record name linked to this user's email."""
    return frappe.db.get_value("Aggregator", {"email": user}, "name")


def _get_gig_worker_name(user):
    """Return the Gig Worker record name linked to this user's email."""
    return frappe.db.get_value("Gig Worker", {"email": user}, "name")


def user_based_query(user=None, doctype=None):
    if not user:
        user = frappe.session.user

    roles = frappe.get_roles(user)

    # System Manager sees everything
    if "System Manager" in roles:
        return ""

    # ----------------------------------------------------------------
    # Aggregator role — scoped to their own aggregator
    # ----------------------------------------------------------------
    if "Aggregator" in roles:
        if doctype == "Aggregator":
            # Only their own record
            return f"`tabAggregator`.`email` = {frappe.db.escape(user)}"

        elif doctype == "Gig Worker":
            # Only workers assigned to their aggregator
            aggregator = _get_aggregator_name(user)
            if not aggregator:
                return "1=0"
            return f"`tabGig Worker`.`created_by_aggregator` = {frappe.db.escape(aggregator)}"

        elif doctype == "Gig Transaction":
            # Only transactions that belong to their aggregator
            aggregator = _get_aggregator_name(user)
            if not aggregator:
                return "1=0"
            return f"`tabGig Transaction`.`aggregator` = {frappe.db.escape(aggregator)}"

        elif doctype == "Worker Service Mapping":
            aggregator = _get_aggregator_name(user)
            if not aggregator:
                return "1=0"
            return f"`tabWorker Service Mapping`.`aggregator` = {frappe.db.escape(aggregator)}"

        elif doctype == "Welfare Fund Account":
            aggregator = _get_aggregator_name(user)
            if not aggregator:
                return "1=0"
            return (
                f"`tabWelfare Fund Account`.`gig_worker` IN ("
                f"SELECT `name` FROM `tabGig Worker` "
                f"WHERE `created_by_aggregator` = {frappe.db.escape(aggregator)})"
            )

        elif doctype == "Worker Mapping Log":
            aggregator = _get_aggregator_name(user)
            if not aggregator:
                return "1=0"
            return f"`tabWorker Mapping Log`.`aggregator` = {frappe.db.escape(aggregator)}"

        elif doctype == "Grievance":
            aggregator = _get_aggregator_name(user)
            if not aggregator:
                return "1=0"
            # Grievances related to this aggregator OR from their workers
            return (
                f"(`tabGrievance`.`aggregator` = {frappe.db.escape(aggregator)} "
                f"OR `tabGrievance`.`gig_worker` IN ("
                f"SELECT `name` FROM `tabGig Worker` "
                f"WHERE `created_by_aggregator` = {frappe.db.escape(aggregator)}))"
            )

        return "1=0"

    # ----------------------------------------------------------------
    # Gig Worker role — scoped to their own worker record
    # ----------------------------------------------------------------
    if "Gig Worker" in roles:
        if doctype == "Gig Worker":
            # Only their own record
            return f"`tabGig Worker`.`email` = {frappe.db.escape(user)}"

        elif doctype == "Gig Transaction":
            # Only transactions where they are the worker
            gig_worker = _get_gig_worker_name(user)
            if not gig_worker:
                return "1=0"
            return f"`tabGig Transaction`.`gig_worker` = {frappe.db.escape(gig_worker)}"

        elif doctype == "Worker Service Mapping":
            gig_worker = _get_gig_worker_name(user)
            if not gig_worker:
                return "1=0"
            return f"`tabWorker Service Mapping`.`gig_worker` = {frappe.db.escape(gig_worker)}"

        elif doctype == "Welfare Fund Account":
            gig_worker = _get_gig_worker_name(user)
            if not gig_worker:
                return "1=0"
            return f"`tabWelfare Fund Account`.`gig_worker` = {frappe.db.escape(gig_worker)}"

        elif doctype == "Worker Mapping Log":
            gig_worker = _get_gig_worker_name(user)
            if not gig_worker:
                return "1=0"
            return f"`tabWorker Mapping Log`.`gig_worker` = {frappe.db.escape(gig_worker)}"

        elif doctype == "Aggregator":
            return "1=0"

        elif doctype == "Grievance":
            gig_worker = _get_gig_worker_name(user)
            if gig_worker:
                return (
                    f"(`tabGrievance`.`gig_worker` = {frappe.db.escape(gig_worker)} "
                    f"OR `tabGrievance`.`owner` = {frappe.db.escape(user)})"
                )
            # No GW profile yet — fall back to owner (their user account)
            return f"`tabGrievance`.`owner` = {frappe.db.escape(user)}"

        return "1=0"

    # ----------------------------------------------------------------
    # Fallback for any other roles
    # ----------------------------------------------------------------
    meta = frappe.get_meta(doctype)
    if meta.has_field("email"):
        return f"`tab{doctype}`.`email` = {frappe.db.escape(user)}"
    if meta.has_field("user"):
        return f"`tab{doctype}`.`user` = {frappe.db.escape(user)}"
    return f"`tab{doctype}`.`owner` = {frappe.db.escape(user)}"


def user_has_permission(doc, ptype="read", user=None):
    if not user:
        user = frappe.session.user

    roles = frappe.get_roles(user)

    if "System Manager" in roles:
        return True

    doctype = doc.doctype

    # ----------------------------------------------------------------
    # Aggregator role
    # ----------------------------------------------------------------
    if "Aggregator" in roles:
        aggregator = _get_aggregator_name(user)

        if doctype == "Aggregator":
            return doc.email == user

        elif doctype == "Gig Worker":
            # Allow create — created_by_aggregator is not set yet on new docs
            if ptype == "create":
                return True
            return doc.created_by_aggregator == aggregator

        elif doctype == "Gig Transaction":
            if ptype == "create":
                return True
            return doc.aggregator == aggregator

        elif doctype == "Worker Service Mapping":
            if ptype == "create":
                return True
            return doc.aggregator == aggregator

        elif doctype == "Welfare Fund Account":
            worker_agg = frappe.db.get_value(
                "Gig Worker", doc.gig_worker, "created_by_aggregator"
            )
            return worker_agg == aggregator

        elif doctype == "Worker Mapping Log":
            return doc.aggregator == aggregator

        elif doctype == "Grievance":
            if ptype == "create":
                return False  # only workers create grievances
            worker_agg = (
                frappe.db.get_value("Gig Worker", doc.gig_worker, "created_by_aggregator")
                if doc.gig_worker
                else None
            )
            return doc.aggregator == aggregator or worker_agg == aggregator

        return False

    # ----------------------------------------------------------------
    # Gig Worker role
    # ----------------------------------------------------------------
    if "Gig Worker" in roles:
        gig_worker = _get_gig_worker_name(user)

        if doctype == "Gig Worker":
            return doc.email == user

        elif doctype == "Gig Transaction":
            return doc.gig_worker == gig_worker

        elif doctype == "Worker Service Mapping":
            return doc.gig_worker == gig_worker

        elif doctype == "Welfare Fund Account":
            return doc.gig_worker == gig_worker

        elif doctype == "Worker Mapping Log":
            return doc.gig_worker == gig_worker

        elif doctype == "Aggregator":
            return False

        elif doctype == "Grievance":
            if ptype == "create":
                return True
            gig_worker = _get_gig_worker_name(user)
            if gig_worker:
                return doc.gig_worker == gig_worker or doc.owner == user
            return doc.owner == user

        return False

    # ----------------------------------------------------------------
    # Fallback
    # ----------------------------------------------------------------
    if hasattr(doc, "email"):
        return doc.email == user
    if hasattr(doc, "user"):
        return doc.user == user
    return doc.owner == user
