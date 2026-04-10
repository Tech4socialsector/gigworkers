import frappe


@frappe.whitelist()
def get_dashboard_data(aggregator=None, service_category=None, worker_override=None):
    user = frappe.session.user

    # System Manager can view any worker's dashboard
    if worker_override and "System Manager" in frappe.get_roles(user):
        worker_name = worker_override
    else:
        worker_name = frappe.db.get_value("Gig Worker", {"email": user}, "name")
    if not worker_name:
        frappe.throw("No Gig Worker profile found for this user.")

    worker = frappe.db.get_value(
        "Gig Worker", worker_name,
        ["worker_name", "status", "phone", "email"],
        as_dict=True,
    )

    # --- Distinct aggregators & service categories for this worker ---
    worker_aggregators = frappe.db.sql("""
        SELECT DISTINCT aggregator
        FROM `tabGig Transaction`
        WHERE gig_worker = %s AND aggregator IS NOT NULL AND aggregator != ''
        ORDER BY aggregator
    """, worker_name, as_dict=True)

    worker_service_cats = frappe.db.sql("""
        SELECT DISTINCT service_category
        FROM `tabGig Transaction`
        WHERE gig_worker = %s AND service_category IS NOT NULL AND service_category != ''
        ORDER BY service_category
    """, worker_name, as_dict=True)

    # --- Build dynamic WHERE clause ---
    sql_conditions = "WHERE gig_worker = %(worker)s"
    sql_params = {"worker": worker_name}
    orm_filters = {"gig_worker": worker_name}

    if aggregator:
        sql_conditions += " AND aggregator = %(aggregator)s"
        sql_params["aggregator"] = aggregator
        orm_filters["aggregator"] = aggregator

    if service_category:
        sql_conditions += " AND service_category = %(service_category)s"
        sql_params["service_category"] = service_category
        orm_filters["service_category"] = service_category

    # --- Transaction stats (filtered) ---
    txn_stats = frappe.db.sql(f"""
        SELECT
            COUNT(*) AS total_transactions,
            COALESCE(SUM(amount), 0) AS total_earnings,
            COALESCE(SUM(base_payout), 0) AS total_base_payout,
            COALESCE(SUM(welfare_amount), 0) AS total_welfare_deducted
        FROM `tabGig Transaction`
        {sql_conditions}
    """, sql_params, as_dict=True)[0]

    completed_count = frappe.db.count(
        "Gig Transaction", {**orm_filters, "status": "Payment complete"}
    )
    pending_count = frappe.db.count(
        "Gig Transaction", {**orm_filters, "status": "Payment pending"}
    )
    cancelled_count = frappe.db.count(
        "Gig Transaction", {**orm_filters, "status": "Payment Cancelled"}
    )
    suspected_count = frappe.db.count(
        "Gig Transaction", {**orm_filters, "status": "Suspected duplicate"}
    )

    # --- Welfare fund balance (always full, not filtered) ---
    fund = frappe.db.get_value(
        "Welfare Fund Account", {"gig_worker": worker_name},
        ["account_balance", "total_collected", "total_withdrawn"],
        as_dict=True,
    ) or frappe._dict({"account_balance": 0, "total_collected": 0, "total_withdrawn": 0})

    # --- Per-aggregator breakdown (always full, for overview cards) ---
    agg_breakdown = frappe.db.sql("""
        SELECT
            aggregator,
            COUNT(*) AS total_transactions,
            COALESCE(SUM(amount), 0) AS total_earnings,
            COALESCE(SUM(welfare_amount), 0) AS total_welfare
        FROM `tabGig Transaction`
        WHERE gig_worker = %(worker)s
            AND aggregator IS NOT NULL AND aggregator != ''
        GROUP BY aggregator
        ORDER BY total_earnings DESC
    """, {"worker": worker_name}, as_dict=True)

    # --- Per-service-category breakdown (always full) ---
    cat_breakdown = frappe.db.sql("""
        SELECT
            service_category,
            COUNT(*) AS total_transactions,
            COALESCE(SUM(amount), 0) AS total_earnings
        FROM `tabGig Transaction`
        WHERE gig_worker = %(worker)s
            AND service_category IS NOT NULL AND service_category != ''
        GROUP BY service_category
        ORDER BY total_earnings DESC
    """, {"worker": worker_name}, as_dict=True)

    # --- Transactions (filtered) ---
    recent_txns = frappe.get_all(
        "Gig Transaction",
        filters=orm_filters,
        fields=["name", "date", "aggregator", "service", "service_category",
                "amount", "base_payout", "welfare_amount", "status"],
        order_by="date desc",
    )

    # --- Withdrawal requests (never filtered) ---
    withdrawals = frappe.get_all(
        "Welfare Benefit Withdrawal",
        filters={"gig_worker": worker_name},
        fields=["name", "amount", "reason", "status", "creation"],
        order_by="creation desc",
    )

    # --- Monthly earnings chart (last 12 months, by aggregator) ---
    monthly_earnings = frappe.db.sql("""
        SELECT
            DATE_FORMAT(date, '%%Y-%%m') AS month,
            aggregator,
            COALESCE(SUM(amount), 0)     AS earnings
        FROM `tabGig Transaction`
        WHERE gig_worker = %(worker)s
            AND date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
        GROUP BY DATE_FORMAT(date, '%%Y-%%m'), aggregator
        ORDER BY month ASC
    """, {"worker": worker_name}, as_dict=True)

    return {
        "worker": worker,
        "worker_id": worker_name,
        "stats": {
            "total_transactions": txn_stats.total_transactions or 0,
            "completed_transactions": completed_count or 0,
            "pending_transactions": pending_count or 0,
            "cancelled_transactions": cancelled_count or 0,
            "suspected_duplicates": suspected_count or 0,
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
        "aggregators": [a.aggregator for a in worker_aggregators],
        "service_categories": [s.service_category for s in worker_service_cats],
        "agg_breakdown": [
            {
                "aggregator": a.aggregator,
                "total_transactions": int(a.total_transactions),
                "total_earnings": float(a.total_earnings),
                "total_welfare": float(a.total_welfare),
            }
            for a in agg_breakdown
        ],
        "cat_breakdown": [
            {
                "service_category": c.service_category,
                "total_transactions": int(c.total_transactions),
                "total_earnings": float(c.total_earnings),
            }
            for c in cat_breakdown
        ],
        "active_filters": {
            "aggregator": aggregator or "",
            "service_category": service_category or "",
        },
        "monthly_earnings": [
            {
                "month":      m.month,
                "aggregator": m.aggregator or "Unknown",
                "earnings":   float(m.earnings),
            }
            for m in monthly_earnings
        ],
    }
