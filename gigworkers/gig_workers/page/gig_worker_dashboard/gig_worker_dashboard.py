import frappe


@frappe.whitelist()
def get_dashboard_data():
    user = frappe.session.user

    worker_name = frappe.db.get_value("Gig Worker", {"email": user}, "name")
    if not worker_name:
        frappe.throw("No Gig Worker profile found for this user.")

    worker = frappe.db.get_value(
        "Gig Worker", worker_name,
        ["worker_name", "status", "phone", "email"],
        as_dict=True,
    )

    # --- Transaction stats ---
    txn_stats = frappe.db.sql("""
        SELECT
            COUNT(*) AS total_transactions,
            COALESCE(SUM(amount), 0) AS total_earnings,
            COALESCE(SUM(base_payout), 0) AS total_base_payout,
            COALESCE(SUM(welfare_amount), 0) AS total_welfare_deducted
        FROM `tabGig Transaction`
        WHERE gig_worker = %s
    """, worker_name, as_dict=True)[0]

    completed_count = frappe.db.count(
        "Gig Transaction", {"gig_worker": worker_name, "status": "Completed"}
    )

    # --- Welfare fund balance ---
    fund = frappe.db.get_value(
        "Welfare Fund Account", {"gig_worker": worker_name},
        ["account_balance", "total_collected", "total_withdrawn"],
        as_dict=True,
    ) or frappe._dict({"account_balance": 0, "total_collected": 0, "total_withdrawn": 0})

    # --- All transactions (DataTables handles pagination) ---
    recent_txns = frappe.get_all(
        "Gig Transaction",
        filters={"gig_worker": worker_name},
        fields=["name", "date", "aggregator", "service", "amount",
                "base_payout", "welfare_amount", "status"],
        order_by="date desc",
    )

    # --- All withdrawal requests ---
    withdrawals = frappe.get_all(
        "Welfare Benefit Withdrawal",
        filters={"gig_worker": worker_name},
        fields=["name", "amount", "reason", "status", "creation"],
        order_by="creation desc",
    )

    return {
        "worker": worker,
        "worker_id": worker_name,
        "stats": {
            "total_transactions": txn_stats.total_transactions or 0,
            "completed_transactions": completed_count or 0,
            "total_earnings": float(txn_stats.total_earnings or 0),
            "total_base_payout": float(txn_stats.total_base_payout or 0),
            "total_welfare_deducted": float(txn_stats.total_welfare_deducted or 0),
        },
        "fund": {
            "account_balance": float(fund.account_balance or 0),
            "total_collected": float(fund.total_collected or 0),
            "total_withdrawn": float(fund.total_withdrawn or 0),
        },
        "recent_transactions": recent_txns,
        "withdrawals": withdrawals,
    }
