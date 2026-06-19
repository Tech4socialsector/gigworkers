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
        ["aggregator_name", "status", "email", "mobile", "clarification_comments", "clarification_response"],
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
        {sql_cond} AND status = 'Payment complete'
    """, sql_params, as_dict=True)[0].cnt

    pending_count = frappe.db.sql(f"""
        SELECT COUNT(*) AS cnt FROM `tabGig Transaction`
        {sql_cond} AND status = 'Payment pending'
    """, sql_params, as_dict=True)[0].cnt

    cancelled_count = frappe.db.sql(f"""
        SELECT COUNT(*) AS cnt FROM `tabGig Transaction`
        {sql_cond} AND status = 'Payment Cancelled'
    """, sql_params, as_dict=True)[0].cnt

    # --- Worker stats ---
    # Total unique workers who have transacted (respects active date/service filters)
    total_workers_result = frappe.db.sql(f"""
        SELECT COUNT(DISTINCT gig_worker) AS cnt
        FROM `tabGig Transaction`
        {sql_cond}
    """, sql_params, as_dict=True)
    total_workers = total_workers_result[0].cnt if total_workers_result else 0

    # Workers with Onboarded/Active status in mapping log
    onboarded_workers_result = frappe.db.sql("""
        SELECT COUNT(DISTINCT gig_worker) AS cnt
        FROM `tabWorker Mapping Log`
        WHERE aggregator = %s AND worker_status IN ('Onboarded', 'Active')
    """, aggregator_name, as_dict=True)
    onboarded_workers = onboarded_workers_result[0].cnt if onboarded_workers_result else 0

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

    # --- Pending welfare fee payments ---
    wfp_orm = {"aggregator": aggregator_name, "payment_status": "Pending"}
    pending_wfp = frappe.get_all(
        "Welfare Fee Payment",
        filters=wfp_orm,
        fields=["name", "transaction", "fee_amount", "payment_date", "payment_status"],
        order_by="payment_date desc",
    )

    # --- Worker Mapping Log ---
    worker_list_sql_cond = "WHERE aggregator = %(agg)s"
    worker_list_params   = {"agg": aggregator_name}
    if from_date:
        worker_list_sql_cond += " AND log_datetime >= %(from_date)s"
        worker_list_params["from_date"] = from_date
    if to_date:
        worker_list_sql_cond += " AND log_datetime <= %(to_date)s"
        worker_list_params["to_date"] = to_date + " 23:59:59"

    worker_list = frappe.db.sql(f"""
        SELECT name, gig_worker, service, event_type, worker_status, log_datetime
        FROM `tabWorker Mapping Log`
        {worker_list_sql_cond}
        ORDER BY log_datetime DESC
    """, worker_list_params, as_dict=True)

    # --- Suspected duplicate transactions (read-only view for aggregator) ---
    suspected_dups = frappe.get_all(
        "Gig Transaction",
        filters={"aggregator": aggregator_name, "status": "Suspected duplicate"},
        fields=["name", "date", "gig_worker", "service", "service_category", "amount",
                "base_payout", "welfare_amount", "duplicate_of"],
        order_by="creation desc",
    )

    # --- Quarterly Welfare Fee Invoices ---
    quarterly_invoices = frappe.get_all(
        "Welfare Fee Invoice",
        filters={"aggregator": aggregator_name},
        fields=["name", "quarter", "year", "from_date", "to_date", "due_date",
                "total_due_amount", "amount_paid", "balance_due", "invoice_status"],
        order_by="year desc, quarter desc",
        limit=4
    )

    invoice_summary = {
        "total_outstanding": sum(inv.balance_due or 0 for inv in quarterly_invoices if inv.invoice_status not in ["Fully Paid"]),
        "total_overdue": sum(inv.balance_due or 0 for inv in quarterly_invoices if inv.invoice_status == "Overdue"),
        "pending_invoices": len([inv for inv in quarterly_invoices if inv.invoice_status in ["Pending", "Partially Paid", "Overdue"]])
    }

    # --- Service category breakdown (filtered) ---
    svc_cat_breakdown = frappe.db.sql(f"""
        SELECT service_category, COUNT(*) AS cnt,
               COALESCE(SUM(amount), 0) AS total_amount,
               COALESCE(SUM(welfare_amount), 0) AS total_welfare
        FROM `tabGig Transaction`
        {sql_cond} AND service_category IS NOT NULL AND service_category != ''
        GROUP BY service_category
        ORDER BY cnt DESC
        LIMIT 10
    """, sql_params, as_dict=True)

    # --- Top 5 workers by transaction count (filtered) ---
    top_workers = frappe.db.sql(f"""
        SELECT gig_worker, COUNT(*) AS txn_count,
               COALESCE(SUM(amount), 0) AS total_amount,
               COALESCE(SUM(welfare_amount), 0) AS total_welfare,
               COALESCE(SUM(CASE WHEN status = 'Payment complete' THEN 1 ELSE 0 END), 0) AS completed_count
        FROM `tabGig Transaction`
        {sql_cond} AND gig_worker IS NOT NULL AND gig_worker != ''
        GROUP BY gig_worker
        ORDER BY txn_count DESC
        LIMIT 5
    """, sql_params, as_dict=True)

    # ── Monthly transaction trend (last 12 months) ──────────────────────────
    import datetime as _dt
    _today = _dt.date.today()
    _t_mo = _today.month - 11
    _t_yr = _today.year + (_t_mo - 1) // 12
    _t_mo = ((_t_mo - 1) % 12) + 1
    trend_start = f"{_t_yr}-{_t_mo:02d}-01"

    mt_params = {"agg": aggregator_name, "trend_start": trend_start}
    mt_extra = ""
    if service_category:
        mt_extra += " AND service_category = %(svc_cat_mt)s"
        mt_params["svc_cat_mt"] = service_category
    if platform:
        mt_extra += " AND platform = %(platform_mt)s"
        mt_params["platform_mt"] = platform

    monthly_trend = frappe.db.sql(f"""
        SELECT
            LEFT(date, 7)                                                     AS month,
            COUNT(*)                                                           AS total_count,
            SUM(CASE WHEN status = 'Payment complete'  THEN 1 ELSE 0 END)   AS completed_count,
            SUM(CASE WHEN status = 'Payment pending'   THEN 1 ELSE 0 END)   AS pending_count,
            COALESCE(SUM(amount), 0)                                          AS total_amount,
            COALESCE(SUM(welfare_amount), 0)                                  AS total_welfare
        FROM `tabGig Transaction`
        WHERE aggregator = %(agg)s
          AND date >= %(trend_start)s
          {mt_extra}
        GROUP BY month
        ORDER BY month
    """, mt_params, as_dict=True)

    # Status breakdown for donut chart (respects active filters)
    status_breakdown = frappe.db.sql(f"""
        SELECT status, COUNT(*) AS cnt
        FROM `tabGig Transaction`
        {sql_cond}
        GROUP BY status
        ORDER BY cnt DESC
    """, sql_params, as_dict=True)

    return {
        "aggregator":                      aggregator,
        "aggregator_id":                   aggregator_name,
        "aggregator_clarification_comments":  aggregator.get("clarification_comments") or "",
        "aggregator_clarification_response":  aggregator.get("clarification_response") or "",
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
            "cancelled_transactions": int(cancelled_count or 0),
            "suspected_duplicates":   len(suspected_dups),
            "total_amount":           float(txn_stats.total_amount or 0),
            "total_base_payout":      float(txn_stats.total_base_payout or 0),
            "total_welfare":          float(txn_stats.total_welfare or 0),
        },
        "workers": {
            "total":     total_workers or 0,
            "active":    onboarded_workers or 0,
        },
        "welfare_payments": {
            "total_paid":     float(wfp_stats.total_paid or 0),
            "total_payments": wfp_stats.total_payments or 0,
            "pending_amount": float(pending_welfare or 0),
        },
        "quarterly_invoices": quarterly_invoices,
        "invoice_summary":    invoice_summary,
        "recent_transactions": recent_txns,
        "pending_wfp":         pending_wfp,
        "worker_list":         worker_list,
        "suspected_dups":      suspected_dups,
        "monthly_trend":       [dict(r) for r in monthly_trend],
        "status_breakdown":    [dict(r) for r in status_breakdown],
        "svc_cat_breakdown":   [dict(r) for r in svc_cat_breakdown],
        "top_workers":         [dict(r) for r in top_workers],
    }
