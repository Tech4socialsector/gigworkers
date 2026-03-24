import frappe


@frappe.whitelist()
def get_dashboard_data(from_date=None, to_date=None, service_category=None, aggregator_override=None, platform=None):
    user = frappe.session.user

    # System Manager can view any aggregator's dashboard
    if aggregator_override and "System Manager" in frappe.get_roles(user):
        aggregator_name = aggregator_override
    else:
        aggregator_name = frappe.db.get_value("Aggregator", {"email": user}, "name")
        if not aggregator_name and user == "Administrator":
            aggregator_name = frappe.db.get_value("Aggregator", {}, "name")
    if not aggregator_name:
        frappe.throw("No Aggregator profile found for this user.")

    aggregator = frappe.db.get_value(
        "Aggregator", aggregator_name,
        ["aggregator_name", "status", "email", "mobile"],
        as_dict=True,
    )

    # Fetch all registered services (child table)
    services = frappe.get_all(
        "Aggregator Service",
        filters={"parent": aggregator_name},
        fields=["service_name", "brand_name", "company_type", "company_id",
                "address", "website_url", "app_url", "pan", "gstin", "service_status"],
        order_by="idx asc",
    )

    # --- Distinct service categories for filter dropdown ---
    service_cats = frappe.db.sql("""
        SELECT DISTINCT service_category
        FROM `tabGig Transaction`
        WHERE aggregator = %s AND service_category IS NOT NULL AND service_category != ''
        ORDER BY service_category
    """, aggregator_name, as_dict=True)

    # --- Build dynamic filter ---
    sql_cond  = "WHERE aggregator = %(agg)s"
    orm_filter = {"aggregator": aggregator_name}
    sql_params = {"agg": aggregator_name}

    if from_date:
        sql_cond  += " AND date >= %(from_date)s"
        sql_params["from_date"] = from_date
        orm_filter["date"] = [">=", from_date]

    if to_date:
        sql_cond  += " AND date <= %(to_date)s"
        sql_params["to_date"] = to_date
        if "date" in orm_filter:
            orm_filter["date"] = ["between", [from_date, to_date]]
        else:
            orm_filter["date"] = ["<=", to_date]

    if service_category:
        sql_cond  += " AND service_category = %(svc_cat)s"
        sql_params["svc_cat"] = service_category
        orm_filter["service_category"] = service_category

    if platform:
        sql_cond  += " AND platform = %(platform)s"
        sql_params["platform"] = platform
        orm_filter["platform"] = platform

    # --- Transaction stats ---
    txn_stats = frappe.db.sql(f"""
        SELECT
            COUNT(*)                         AS total_transactions,
            COALESCE(SUM(amount), 0)         AS total_amount,
            COALESCE(SUM(base_payout), 0)    AS total_base_payout,
            COALESCE(SUM(welfare_amount), 0) AS total_welfare
        FROM `tabGig Transaction`
        {sql_cond}
    """, sql_params, as_dict=True)[0]

    completed_count = frappe.db.sql(f"""
        SELECT COUNT(*) AS cnt FROM `tabGig Transaction`
        {sql_cond} AND status = 'Completed'
    """, sql_params, as_dict=True)[0].cnt

    pending_count = frappe.db.sql(f"""
        SELECT COUNT(*) AS cnt FROM `tabGig Transaction`
        {sql_cond} AND status = 'Registered'
    """, sql_params, as_dict=True)[0].cnt

    # --- Worker stats ---
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

    # --- Welfare fee payment stats (filtered by date) ---
    wfp_sql_cond  = "WHERE aggregator = %(agg)s"
    wfp_params    = {"agg": aggregator_name}
    if from_date:
        wfp_sql_cond += " AND payment_date >= %(from_date)s"
        wfp_params["from_date"] = from_date
    if to_date:
        wfp_sql_cond += " AND payment_date <= %(to_date)s"
        wfp_params["to_date"] = to_date

    wfp_stats = frappe.db.sql(f"""
        SELECT COUNT(*) AS total_payments, COALESCE(SUM(fee_amount), 0) AS total_paid
        FROM `tabWelfare Fee Payment`
        {wfp_sql_cond} AND payment_status = 'Completed'
    """, wfp_params, as_dict=True)[0]

    pending_welfare = frappe.db.sql(f"""
        SELECT COALESCE(SUM(fee_amount), 0) AS pending
        FROM `tabWelfare Fee Payment`
        {wfp_sql_cond} AND payment_status = 'Pending'
    """, wfp_params, as_dict=True)[0].pending

    # --- Transactions (filtered) ---
    recent_txns = frappe.get_all(
        "Gig Transaction",
        filters=orm_filter,
        fields=["name", "date", "gig_worker", "service", "service_category",
                "amount", "base_payout", "welfare_amount", "status"],
        order_by="date desc",
    )

    # --- Worker mapping log (not date-filtered) ---
    workers = frappe.get_all(
        "Worker Mapping Log",
        filters={"aggregator": aggregator_name},
        fields=["name", "gig_worker", "service", "event_type", "worker_status", "log_datetime"],
        order_by="log_datetime desc",
    )

    # --- Pending welfare fee payments ---
    wfp_orm = {"aggregator": aggregator_name, "payment_status": "Pending"}
    pending_wfp = frappe.get_all(
        "Welfare Fee Payment",
        filters=wfp_orm,
        fields=["name", "transaction", "fee_amount", "payment_date", "payment_status"],
        order_by="payment_date desc",
    )

    # --- Suspected duplicate transactions (read-only view for aggregator) ---
    suspected_dups = frappe.get_all(
        "Gig Transaction",
        filters={"aggregator": aggregator_name, "status": "Suspected Duplicate"},
        fields=["name", "date", "gig_worker", "service", "amount",
                "base_payout", "welfare_amount", "duplicate_of"],
        order_by="creation desc",
    )

    return {
        "aggregator":       aggregator,
        "aggregator_id":    aggregator_name,
        "services":         services,
        "service_categories": [s.service_category for s in service_cats],
        "active_filters": {
            "from_date":        from_date or "",
            "to_date":          to_date or "",
            "service_category": service_category or "",
            "platform":         platform or "",
        },
        "stats": {
            "total_transactions":     txn_stats.total_transactions or 0,
            "completed_transactions": int(completed_count or 0),
            "pending_transactions":   int(pending_count or 0),
            "suspected_duplicates":   len(suspected_dups),
            "total_amount":           float(txn_stats.total_amount or 0),
            "total_base_payout":      float(txn_stats.total_base_payout or 0),
            "total_welfare":          float(txn_stats.total_welfare or 0),
        },
        "workers": {
            "total":  total_workers or 0,
            "active": active_workers or 0,
        },
        "welfare_payments": {
            "total_paid":     float(wfp_stats.total_paid or 0),
            "total_payments": wfp_stats.total_payments or 0,
            "pending_amount": float(pending_welfare or 0),
        },
        "recent_transactions": recent_txns,
        "worker_list":         workers,
        "pending_wfp":         pending_wfp,
        "suspected_dups":      suspected_dups,
    }
