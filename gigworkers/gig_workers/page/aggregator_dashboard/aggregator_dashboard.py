import frappe


def _as_list(value):
    """Accept a single value, comma-separated string, or JSON-encoded list and
    normalize it to a plain python list (empty list if nothing was passed)."""
    if not value:
        return []
    if isinstance(value, list):
        return [v for v in value if v]
    if isinstance(value, str):
        try:
            parsed = frappe.parse_json(value)
            if isinstance(parsed, list):
                return [v for v in parsed if v]
        except Exception:
            pass
        return [v.strip() for v in value.split(",") if v.strip()]
    return [value]


@frappe.whitelist()
def get_dashboard_data(from_date=None, to_date=None, service_category=None, aggregator_override=None):
    user = frappe.session.user

    # System Manager can view any aggregator's dashboard, but only via an explicit
    # aggregator_override — never silently pick an arbitrary tenant for Administrator.
    if aggregator_override and "System Manager" in frappe.get_roles(user):
        aggregator_name = aggregator_override
    else:
        aggregator_name = frappe.db.get_value("Aggregator", {"email": user}, "name")
    if not aggregator_name:
        frappe.throw("No Aggregator profile found for this user.")

    aggregator = frappe.db.get_value(
        "Aggregator", aggregator_name,
        ["aggregator_name", "status", "email", "mobile", "clarification_comments", "clarification_response",
         "company_type", "cin_number", "registered_address", "website_url", "company_id", "app_url",
         "pan_number", "gstin"],
        as_dict=True,
    )

    # --- Registered service categories (child table -> Service Category master) ---
    service_category_rows = frappe.db.sql("""
        SELECT sc.category_name AS category_name, link.service_category AS category_id
        FROM `tabAggregator Service Category` link
        LEFT JOIN `tabService Category` sc ON sc.name = link.service_category
        WHERE link.parent = %s
        ORDER BY link.idx
    """, aggregator_name, as_dict=True)

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

    service_categories_filter = _as_list(service_category)
    if service_categories_filter:
        sql_cond  += " AND service_category IN %(svc_cat)s"
        sql_params["svc_cat"] = tuple(service_categories_filter)
        orm_filter["service_category"] = ["in", service_categories_filter]

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

    # --- Welfare fee payment stats (filtered by date + service category,
    # via a join back to the Gig Transaction the payment was raised for) ---
    wfp_sql_cond  = "WHERE wfp.aggregator = %(agg)s"
    wfp_params    = {"agg": aggregator_name}
    wfp_join = ""
    if service_categories_filter:
        wfp_join = "JOIN `tabGig Transaction` gt ON gt.name = wfp.transaction"
        wfp_sql_cond += " AND gt.service_category IN %(svc_cat_wfp)s"
        wfp_params["svc_cat_wfp"] = tuple(service_categories_filter)
    if from_date:
        wfp_sql_cond += " AND wfp.payment_date >= %(from_date)s"
        wfp_params["from_date"] = from_date
    if to_date:
        wfp_sql_cond += " AND wfp.payment_date <= %(to_date)s"
        wfp_params["to_date"] = to_date

    wfp_stats = frappe.db.sql(f"""
        SELECT COUNT(*) AS total_payments, COALESCE(SUM(wfp.fee_amount), 0) AS total_paid
        FROM `tabWelfare Fee Payment` wfp
        {wfp_join}
        {wfp_sql_cond} AND wfp.payment_status = 'Completed'
    """, wfp_params, as_dict=True)[0]

    pending_welfare = frappe.db.sql(f"""
        SELECT COALESCE(SUM(wfp.fee_amount), 0) AS pending
        FROM `tabWelfare Fee Payment` wfp
        {wfp_join}
        {wfp_sql_cond} AND wfp.payment_status = 'Pending'
    """, wfp_params, as_dict=True)[0].pending

    # --- Transactions (filtered) ---
    recent_txns = frappe.get_all(
        "Gig Transaction",
        filters=orm_filter,
        fields=["name", "date", "gig_worker", "service", "service_category",
                "amount", "base_payout", "welfare_amount", "status"],
        order_by="date desc",
    )

    # --- Pending welfare fee payments (same date + service category filters) ---
    pending_wfp = frappe.db.sql(f"""
        SELECT wfp.name, wfp.transaction, wfp.fee_amount, wfp.payment_date, wfp.payment_status
        FROM `tabWelfare Fee Payment` wfp
        {wfp_join}
        {wfp_sql_cond} AND wfp.payment_status = 'Pending'
        ORDER BY wfp.payment_date DESC
    """, wfp_params, as_dict=True)

    # --- Worker roster + status breakdown, sourced from the Gig Worker
    # records this aggregator actually owns (Worker Mapping Log is not
    # populated for most aggregators, so it can't drive this) ---
    gw_sql_cond   = "WHERE created_by_aggregator = %(agg)s"
    gw_params     = {"agg": aggregator_name}
    if from_date:
        gw_sql_cond += " AND DATE(creation) >= %(from_date)s"
        gw_params["from_date"] = from_date
    if to_date:
        gw_sql_cond += " AND DATE(creation) <= %(to_date)s"
        gw_params["to_date"] = to_date

    # Phone numbers are masked in this bulk roster view; the full number is only
    # available via the scoped, per-worker get_worker_detail drill-through.
    aggregator_workers = frappe.db.sql(f"""
        SELECT name, worker_name,
               CONCAT('xxxxxx', RIGHT(phone, 4)) AS phone,
               status, name_of_service, creation
        FROM `tabGig Worker`
        {gw_sql_cond}
        ORDER BY creation DESC
    """, gw_params, as_dict=True)

    worker_status_breakdown = frappe.db.sql(f"""
        SELECT status AS worker_status, COUNT(*) AS cnt
        FROM `tabGig Worker`
        {gw_sql_cond}
        GROUP BY status
        ORDER BY cnt DESC
    """, gw_params, as_dict=True)

    # --- Suspected duplicate transactions (read-only view for aggregator,
    # respects the same date + service category filters as everything else) ---
    suspected_dups = frappe.db.sql(f"""
        SELECT name, date, gig_worker, service, service_category, amount,
               base_payout, welfare_amount, duplicate_of
        FROM `tabGig Transaction`
        {sql_cond} AND status = 'Suspected duplicate'
        ORDER BY creation DESC
    """, sql_params, as_dict=True)

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
    if service_categories_filter:
        mt_extra += " AND service_category IN %(svc_cat_mt)s"
        mt_params["svc_cat_mt"] = tuple(service_categories_filter)
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

    # --- Worker growth trend (new Gig Workers registered, last 12 months) ---
    worker_growth_trend = frappe.db.sql("""
        SELECT DATE_FORMAT(creation, '%%Y-%%m') AS month, COUNT(*) AS cnt
        FROM `tabGig Worker`
        WHERE created_by_aggregator = %(agg)s AND creation >= %(trend_start)s
        GROUP BY month
        ORDER BY month
    """, {"agg": aggregator_name, "trend_start": trend_start}, as_dict=True)

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
        "service_category_list": service_category_rows,
        "service_categories": [s.service_category for s in service_cats],
        "active_filters": {
            "from_date":        from_date or "",
            "to_date":          to_date or "",
            "service_category": service_categories_filter,
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
        "welfare_payments": {
            "total_paid":     float(wfp_stats.total_paid or 0),
            "total_payments": wfp_stats.total_payments or 0,
            "pending_amount": float(pending_welfare or 0),
        },
        "quarterly_invoices": quarterly_invoices,
        "invoice_summary":    invoice_summary,
        "recent_transactions": recent_txns,
        "pending_wfp":         pending_wfp,
        "aggregator_workers":  aggregator_workers,
        "worker_status_breakdown": [dict(r) for r in worker_status_breakdown],
        "suspected_dups":      suspected_dups,
        "monthly_trend":       [dict(r) for r in monthly_trend],
        "worker_growth_trend": [dict(r) for r in worker_growth_trend],
        "status_breakdown":    [dict(r) for r in status_breakdown],
        "svc_cat_breakdown":   [dict(r) for r in svc_cat_breakdown],
        "top_workers":         [dict(r) for r in top_workers],
    }


def _resolve_aggregator(aggregator_override=None):
    user = frappe.session.user
    if aggregator_override and "System Manager" in frappe.get_roles(user):
        return aggregator_override
    aggregator_name = frappe.db.get_value("Aggregator", {"email": user}, "name")
    if not aggregator_name:
        frappe.throw("No Aggregator profile found for this user.")
    return aggregator_name


@frappe.whitelist()
def get_worker_detail(gig_worker, aggregator_override=None):
    """Full drill-through profile for a single gig worker, scoped to the
    calling aggregator — used for the second-level drilldown from any
    worker/transaction table on the dashboard."""
    aggregator_name = _resolve_aggregator(aggregator_override)

    transactions = frappe.get_all(
        "Gig Transaction",
        filters={"aggregator": aggregator_name, "gig_worker": gig_worker},
        fields=["name", "date", "service", "service_category",
                "amount", "base_payout", "welfare_amount", "status"],
        order_by="date desc",
    )

    mapping_log = frappe.get_all(
        "Worker Mapping Log",
        filters={"aggregator": aggregator_name, "gig_worker": gig_worker},
        fields=["name", "service", "event_type", "worker_status", "log_datetime"],
        order_by="log_datetime desc",
    )

    # Only return the worker's PII if this aggregator actually has an onboarding
    # or transaction relationship with them — a bare Gig Worker name lookup with
    # no relationship check would let an aggregator enumerate arbitrary workers.
    worker_is_related = bool(transactions) or bool(mapping_log) or frappe.db.exists(
        "Gig Worker", {"name": gig_worker, "created_by_aggregator": aggregator_name}
    )
    worker_info = frappe.db.get_value(
        "Gig Worker", gig_worker,
        ["name", "worker_name", "phone", "status"],
        as_dict=True,
    ) if worker_is_related else None

    total_amount = sum(t.amount or 0 for t in transactions)
    total_welfare = sum(t.welfare_amount or 0 for t in transactions)
    completed = len([t for t in transactions if t.status == "Payment complete"])

    return {
        "gig_worker": gig_worker,
        "worker_info": worker_info,
        "transactions": transactions,
        "mapping_log": mapping_log,
        "summary": {
            "total_transactions": len(transactions),
            "completed_transactions": completed,
            "total_amount": total_amount,
            "total_welfare": total_welfare,
            "current_status": mapping_log[0].worker_status if mapping_log else None,
        },
    }


@frappe.whitelist()
def get_transaction_detail(transaction, aggregator_override=None):
    """Full field-level detail for a single Gig Transaction, scoped to the
    calling aggregator — powers the transaction-row drilldown popup."""
    aggregator_name = _resolve_aggregator(aggregator_override)

    txn = frappe.db.get_value(
        "Gig Transaction", {"name": transaction, "aggregator": aggregator_name},
        [
            "name", "date", "transaction_date", "gig_worker", "service", "service_category",
            "service_type", "role", "status", "status_of_order", "settlement_status",
            "amount", "base_payout", "incentives", "welfare_percentage", "welfare_amount",
            "welfare_cap", "deduction", "net_payout_to_worker", "external_transaction_id",
            "suspected_duplicate", "duplicate_of", "confirmed_at", "district", "city",
            "adjustment_count", "creation", "modified",
        ],
        as_dict=True,
    )
    if not txn:
        frappe.throw("Transaction not found.")

    welfare_payments = frappe.get_all(
        "Welfare Fee Payment",
        filters={"aggregator": aggregator_name, "transaction": transaction},
        fields=["name", "fee_amount", "payment_date", "payment_status",
                "settlement_status", "mode_of_payment", "bank_reference"],
        order_by="creation desc",
    )

    return {"transaction": txn, "welfare_payments": welfare_payments}


@frappe.whitelist()
def get_invoice_detail(invoice, aggregator_override=None):
    """Line-item breakdown for a single Welfare Fee Invoice, scoped to the
    calling aggregator — powers the quarterly-invoice card drilldown."""
    aggregator_name = _resolve_aggregator(aggregator_override)

    inv = frappe.db.get_value(
        "Welfare Fee Invoice", {"name": invoice, "aggregator": aggregator_name},
        ["name", "quarter", "year", "from_date", "to_date", "due_date",
         "total_transactions", "total_due_amount", "amount_paid", "balance_due", "invoice_status"],
        as_dict=True,
    )
    if not inv:
        frappe.throw("Invoice not found.")

    items = frappe.get_all(
        "Welfare Fee Invoice Item",
        filters={"parent": invoice},
        fields=["transaction", "gig_worker", "transaction_date", "fee_amount", "payment_status"],
        order_by="transaction_date desc",
    )

    return {"invoice": inv, "items": items}
