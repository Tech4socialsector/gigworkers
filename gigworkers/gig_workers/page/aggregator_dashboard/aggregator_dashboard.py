import frappe


@frappe.whitelist()
def get_dashboard_data():
    user = frappe.session.user

    aggregator_name = frappe.db.get_value("Aggregator", {"email": user}, "name")
    if not aggregator_name and user == "Administrator":
        aggregator_name = frappe.db.get_value("Aggregator", {}, "name")
    if not aggregator_name:
        frappe.throw("No Aggregator profile found for this user.")

    aggregator = frappe.db.get_value(
        "Aggregator", aggregator_name,
        ["aggregator_name", "status", "email", "mobile", "company_type"],
        as_dict=True,
    )

    # --- Transaction stats ---
    txn_stats = frappe.db.sql("""
        SELECT
            COUNT(*)                        AS total_transactions,
            COALESCE(SUM(amount), 0)        AS total_amount,
            COALESCE(SUM(base_payout), 0)   AS total_base_payout,
            COALESCE(SUM(welfare_amount), 0) AS total_welfare
        FROM `tabGig Transaction`
        WHERE aggregator = %s
    """, aggregator_name, as_dict=True)[0]

    completed_count = frappe.db.count(
        "Gig Transaction", {"aggregator": aggregator_name, "status": "Completed"}
    )
    pending_count = frappe.db.count(
        "Gig Transaction", {"aggregator": aggregator_name, "status": "Registered"}
    )

    # --- Worker stats (from Worker Mapping Log) ---
    total_workers_result = frappe.db.sql("""
        SELECT COUNT(DISTINCT gig_worker) AS cnt
        FROM `tabWorker Mapping Log`
        WHERE aggregator = %s
    """, aggregator_name, as_dict=True)
    total_workers = total_workers_result[0].cnt if total_workers_result else 0

    active_workers_result = frappe.db.sql("""
        SELECT COUNT(DISTINCT gig_worker) AS cnt
        FROM `tabGig Transaction`
        WHERE aggregator = %s AND status = 'Completed'
    """, aggregator_name, as_dict=True)
    active_workers = active_workers_result[0].cnt if active_workers_result else 0

    # --- Welfare fee payment stats ---
    wfp_stats = frappe.db.sql("""
        SELECT
            COUNT(*)                        AS total_payments,
            COALESCE(SUM(fee_amount), 0)    AS total_paid
        FROM `tabWelfare Fee Payment`
        WHERE aggregator = %s AND payment_status = 'Completed'
    """, aggregator_name, as_dict=True)[0]

    pending_welfare = frappe.db.sql("""
        SELECT COALESCE(SUM(fee_amount), 0) AS pending
        FROM `tabWelfare Fee Payment`
        WHERE aggregator = %s AND payment_status = 'Pending'
    """, aggregator_name, as_dict=True)[0].pending

    # --- All transactions (DataTables handles pagination) ---
    recent_txns = frappe.get_all(
        "Gig Transaction",
        filters={"aggregator": aggregator_name},
        fields=["name", "date", "gig_worker", "service", "amount",
                "base_payout", "welfare_amount", "status"],
        order_by="date desc",
    )

    # --- Worker mapping log entries ---
    workers = frappe.get_all(
        "Worker Mapping Log",
        filters={"aggregator": aggregator_name},
        fields=["name", "gig_worker", "service", "event_type", "worker_status", "log_datetime"],
        order_by="log_datetime desc",
    )

    # --- All pending welfare fee payments ---
    pending_wfp = frappe.get_all(
        "Welfare Fee Payment",
        filters={"aggregator": aggregator_name, "payment_status": "Pending"},
        fields=["name", "transaction", "fee_amount", "payment_date", "payment_status"],
        order_by="payment_date desc",
    )

    return {
        "aggregator": aggregator,
        "aggregator_id": aggregator_name,
        "stats": {
            "total_transactions": txn_stats.total_transactions or 0,
            "completed_transactions": completed_count or 0,
            "pending_transactions": pending_count or 0,
            "total_amount": float(txn_stats.total_amount or 0),
            "total_base_payout": float(txn_stats.total_base_payout or 0),
            "total_welfare": float(txn_stats.total_welfare or 0),
        },
        "workers": {
            "total": total_workers or 0,
            "active": active_workers or 0,
        },
        "welfare_payments": {
            "total_paid": float(wfp_stats.total_paid or 0),
            "total_payments": wfp_stats.total_payments or 0,
            "pending_amount": float(pending_welfare or 0),
        },
        "recent_transactions": recent_txns,
        "worker_list": workers,
        "pending_wfp": pending_wfp,
    }
