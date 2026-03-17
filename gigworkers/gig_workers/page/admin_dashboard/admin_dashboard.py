import frappe


@frappe.whitelist()
def get_dashboard_data(from_date=None, to_date=None, aggregator=None):
    frappe.only_for("System Manager")

    # Build WHERE clauses for date + aggregator filters
    txn_conditions = []
    txn_params = {}

    if from_date:
        txn_conditions.append("date >= %(from_date)s")
        txn_params["from_date"] = from_date
    if to_date:
        txn_conditions.append("date <= %(to_date)s")
        txn_params["to_date"] = to_date
    if aggregator:
        txn_conditions.append("aggregator = %(aggregator)s")
        txn_params["aggregator"] = aggregator

    txn_where = ("WHERE " + " AND ".join(txn_conditions)) if txn_conditions else ""

    # WFP uses payment_date
    wfp_conditions = []
    wfp_params = {}
    if from_date:
        wfp_conditions.append("payment_date >= %(from_date)s")
        wfp_params["from_date"] = from_date
    if to_date:
        wfp_conditions.append("payment_date <= %(to_date)s")
        wfp_params["to_date"] = to_date
    if aggregator:
        wfp_conditions.append("aggregator = %(aggregator)s")
        wfp_params["aggregator"] = aggregator

    wfp_where = ("WHERE " + " AND ".join(wfp_conditions)) if wfp_conditions else ""

    # --- Platform-wide transaction stats (with filters) ---
    txn_stats = frappe.db.sql(f"""
        SELECT
            COUNT(*)                         AS total_transactions,
            COALESCE(SUM(amount), 0)         AS total_amount,
            COALESCE(SUM(base_payout), 0)    AS total_base_payout,
            COALESCE(SUM(welfare_amount), 0) AS total_welfare
        FROM `tabGig Transaction`
        {txn_where}
    """, txn_params, as_dict=True)[0]

    status_conditions = dict(txn_params)
    completed_where_parts = list(txn_conditions) + ["status = 'Completed'"]
    pending_where_parts = list(txn_conditions) + ["status = 'Registered'"]

    completed_count = frappe.db.sql(
        f"SELECT COUNT(*) AS cnt FROM `tabGig Transaction` WHERE {' AND '.join(completed_where_parts)}",
        status_conditions,
        as_dict=True,
    )[0].cnt if txn_conditions else frappe.db.count("Gig Transaction", {"status": "Completed"})

    pending_count = frappe.db.sql(
        f"SELECT COUNT(*) AS cnt FROM `tabGig Transaction` WHERE {' AND '.join(pending_where_parts)}",
        status_conditions,
        as_dict=True,
    )[0].cnt if txn_conditions else frappe.db.count("Gig Transaction", {"status": "Registered"})

    if not txn_conditions:
        completed_count = frappe.db.count("Gig Transaction", {"status": "Completed"})
        pending_count = frappe.db.count("Gig Transaction", {"status": "Registered"})

    # --- Aggregator stats (not date-filtered; aggregator filter still applies) ---
    agg_filters = {"status": "Active"} if not aggregator else {"status": "Active", "name": aggregator}
    total_aggregators = frappe.db.count("Aggregator", {"name": aggregator} if aggregator else {})
    active_aggregators = frappe.db.count("Aggregator", agg_filters)

    # --- Gig Worker stats (aggregator filter via Worker Service Mapping) ---
    worker_agg_join = ""
    worker_agg_cond = ""
    worker_params = {}
    if aggregator:
        worker_agg_join = "JOIN `tabWorker Service Mapping` wsm ON wsm.gig_worker = gw.name"
        worker_agg_cond = "AND wsm.aggregator = %(aggregator)s"
        worker_params["aggregator"] = aggregator

    worker_stats = frappe.db.sql(f"""
        SELECT
            COUNT(DISTINCT gw.name)                                          AS total_workers,
            SUM(gw.status = 'Active')                                        AS active_workers,
            SUM(gw.status = 'Pending Verification')                          AS pending_verification,
            SUM(gw.status = 'Inactive')                                      AS inactive_workers
        FROM `tabGig Worker` gw
        {worker_agg_join}
        WHERE 1=1 {worker_agg_cond}
    """, worker_params, as_dict=True)[0]

    # --- Welfare fee payment stats (with filters) ---
    wfp_stats = frappe.db.sql(f"""
        SELECT
            COUNT(*)                       AS total_payments,
            COALESCE(SUM(fee_amount), 0)   AS total_paid
        FROM `tabWelfare Fee Payment`
        {wfp_where + (" AND " if wfp_where else "WHERE ")}payment_status = 'Completed'
    """, wfp_params, as_dict=True)[0]

    pending_wfp_params = dict(wfp_params)
    pending_welfare_cond = (wfp_where + " AND " if wfp_where else "WHERE ") + "payment_status = 'Pending'"
    pending_welfare_amount = frappe.db.sql(f"""
        SELECT COALESCE(SUM(fee_amount), 0) AS pending
        FROM `tabWelfare Fee Payment`
        {pending_welfare_cond}
    """, pending_wfp_params, as_dict=True)[0].pending

    # --- Welfare fund summary (always current, not date-filtered) ---
    fund_agg_cond = "WHERE gig_worker IN (SELECT gig_worker FROM `tabWorker Service Mapping` WHERE aggregator = %(aggregator)s)" if aggregator else ""
    fund_params = {"aggregator": aggregator} if aggregator else {}
    fund_stats = frappe.db.sql(f"""
        SELECT
            COALESCE(SUM(account_balance), 0)  AS total_balance,
            COALESCE(SUM(total_collected), 0)  AS total_collected,
            COALESCE(SUM(total_withdrawn), 0)  AS total_withdrawn
        FROM `tabWelfare Fund Account`
        {fund_agg_cond}
    """, fund_params, as_dict=True)[0]

    # --- Per-aggregator breakdown (date-filtered for txn/wfp) ---
    txn_date_cond = ""
    if from_date:
        txn_date_cond += " AND t.date >= %(from_date)s"
    if to_date:
        txn_date_cond += " AND t.date <= %(to_date)s"

    wfp_date_cond = ""
    if from_date:
        wfp_date_cond += " AND wfp.payment_date >= %(from_date)s"
    if to_date:
        wfp_date_cond += " AND wfp.payment_date <= %(to_date)s"

    agg_filter_cond = "WHERE a.name = %(aggregator)s" if aggregator else ""
    breakdown_params = {}
    if from_date:
        breakdown_params["from_date"] = from_date
    if to_date:
        breakdown_params["to_date"] = to_date
    if aggregator:
        breakdown_params["aggregator"] = aggregator

    aggregator_breakdown = frappe.db.sql(f"""
        SELECT
            a.name                              AS aggregator_id,
            a.aggregator_name,
            a.status,
            COUNT(DISTINCT wsm.gig_worker)      AS worker_count,
            COUNT(DISTINCT t.name)              AS txn_count,
            COALESCE(SUM(t.amount), 0)          AS txn_amount,
            COALESCE(SUM(t.welfare_amount), 0)  AS welfare_collected,
            COALESCE(SUM(CASE WHEN wfp.payment_status = 'Pending'
                              THEN wfp.fee_amount ELSE 0 END), 0) AS pending_fees
        FROM `tabAggregator` a
        LEFT JOIN `tabWorker Service Mapping` wsm ON wsm.aggregator = a.name
        LEFT JOIN `tabGig Transaction` t ON t.aggregator = a.name {txn_date_cond}
        LEFT JOIN `tabWelfare Fee Payment` wfp ON wfp.aggregator = a.name {wfp_date_cond}
        {agg_filter_cond}
        GROUP BY a.name
        ORDER BY txn_amount DESC
    """, breakdown_params, as_dict=True)

    # --- Transactions list (with filters) ---
    txn_list_filters: dict = {}
    if aggregator:
        txn_list_filters["aggregator"] = aggregator
    if from_date and to_date:
        txn_list_filters["date"] = ["between", [from_date, to_date]]
    elif from_date:
        txn_list_filters["date"] = [">=", from_date]
    elif to_date:
        txn_list_filters["date"] = ["<=", to_date]

    recent_txns = frappe.get_all(
        "Gig Transaction",
        filters=txn_list_filters,
        fields=["name", "date", "gig_worker", "aggregator", "service",
                "amount", "base_payout", "welfare_amount", "status"],
        order_by="date desc",
        limit=500,
    )

    # --- Pending welfare fee payments (with filters) ---
    wfp_list_filters: dict = {"payment_status": "Pending"}
    if aggregator:
        wfp_list_filters["aggregator"] = aggregator
    if from_date and to_date:
        wfp_list_filters["payment_date"] = ["between", [from_date, to_date]]
    elif from_date:
        wfp_list_filters["payment_date"] = [">=", from_date]
    elif to_date:
        wfp_list_filters["payment_date"] = ["<=", to_date]

    pending_wfp = frappe.get_all(
        "Welfare Fee Payment",
        filters=wfp_list_filters,
        fields=["name", "aggregator", "transaction", "fee_amount", "payment_date", "payment_status"],
        order_by="payment_date desc",
        limit=500,
    )

    # --- Gig Workers list (with aggregator filter) ---
    worker_list_filters = {}
    if aggregator:
        worker_ids = frappe.db.get_all(
            "Worker Service Mapping",
            filters={"aggregator": aggregator},
            pluck="gig_worker",
        )
        worker_list_filters["name"] = ["in", worker_ids] if worker_ids else ["in", ["__none__"]]

    recent_workers = frappe.get_all(
        "Gig Worker",
        filters=worker_list_filters,
        fields=["name", "worker_name", "gender", "status", "created_by_aggregator", "creation"],
        order_by="creation desc",
        limit=200,
    )

    # --- Aggregator list for filter dropdown ---
    aggregator_list = frappe.get_all(
        "Aggregator",
        fields=["name", "aggregator_name"],
        order_by="aggregator_name asc",
    )

    return {
        "stats": {
            "total_transactions": txn_stats.total_transactions or 0,
            "completed_transactions": completed_count or 0,
            "pending_transactions": pending_count or 0,
            "total_amount": float(txn_stats.total_amount or 0),
            "total_base_payout": float(txn_stats.total_base_payout or 0),
            "total_welfare": float(txn_stats.total_welfare or 0),
        },
        "aggregators": {
            "total": total_aggregators or 0,
            "active": active_aggregators or 0,
        },
        "workers": {
            "total": int(worker_stats.total_workers or 0),
            "active": int(worker_stats.active_workers or 0),
            "pending_verification": int(worker_stats.pending_verification or 0),
            "inactive": int(worker_stats.inactive_workers or 0),
        },
        "welfare_payments": {
            "total_paid": float(wfp_stats.total_paid or 0),
            "total_payments": wfp_stats.total_payments or 0,
            "pending_amount": float(pending_welfare_amount or 0),
        },
        "welfare_fund": {
            "total_balance": float(fund_stats.total_balance or 0),
            "total_collected": float(fund_stats.total_collected or 0),
            "total_withdrawn": float(fund_stats.total_withdrawn or 0),
        },
        "aggregator_breakdown": aggregator_breakdown,
        "recent_transactions": recent_txns,
        "pending_wfp": pending_wfp,
        "recent_workers": recent_workers,
        "aggregator_list": aggregator_list,
    }
