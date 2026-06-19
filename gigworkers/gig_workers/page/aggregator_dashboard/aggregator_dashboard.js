frappe.pages["aggregator-dashboard"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Aggregator Dashboard",
		single_column: true,
	});

	$(wrapper).find(".page-content").html(`
		<div id="agg-dashboard" style="padding: 20px;">
			<div id="agg-loading" style="text-align:center; padding: 60px; color: #888;">
				<i class="fa fa-spinner fa-spin fa-2x"></i>
				<p style="margin-top:12px;">Loading dashboard...</p>
			</div>
		</div>
	`);

	let _agg_data        = null;
	let _active_from     = "";
	let _active_to       = "";
	let _active_svc_cat  = "";
	let _active_platform = "";

	// Allow admin to view a specific aggregator via URL param ?aggregator=AG001
	const _agg_override = frappe.utils.get_url_arg("aggregator") || null;

	function fetch_dashboard() {
		$("#agg-dashboard").html(`
			<div id="agg-loading" style="text-align:center;padding:60px;color:#888;">
				<i class="fa fa-spinner fa-spin fa-2x"></i>
				<p style="margin-top:12px;">Loading...</p>
			</div>
		`);
		frappe.call({
			method: "gigworkers.gig_workers.page.aggregator_dashboard.aggregator_dashboard.get_dashboard_data",
			args: { from_date: _active_from, to_date: _active_to, service_category: _active_svc_cat,
				aggregator_override: _agg_override, platform: _active_platform },
			callback(r) {
				if (r.message) { _agg_data = r.message; render_dashboard(r.message); }
			},
			error() {
				$("#agg-dashboard").html('<p style="color:red;padding:40px;">Failed to load dashboard. Please refresh.</p>');
			},
		});
	}

	// Load DataTables CSS + JS dynamically, then fetch data
	load_datatables(function () { fetch_dashboard(); });

	function load_datatables(callback) {
		if ($.fn.DataTable) { callback(); return; }

		$("<link>")
			.attr({ rel: "stylesheet", href: "https://cdn.datatables.net/1.13.7/css/jquery.dataTables.min.css" })
			.appendTo("head");

		$.getScript("https://cdn.datatables.net/1.13.7/js/jquery.dataTables.min.js", callback);
	}

	function init_datatable(table_id, extra_opts) {
		if ($.fn.DataTable) {
			return $(table_id).DataTable(Object.assign({
				pageLength: 10,
				lengthMenu: [5, 10, 25, 50, 100],
				order: [],
				language: {
					search: "Filter:",
					lengthMenu: "Show _MENU_ entries",
					info: "Showing _START_ to _END_ of _TOTAL_ records",
					emptyTable: "No data available",
				},
				dom: '<"dt-top"lf>rt<"dt-bottom"ip>',
			}, extra_opts || {}));
		}
		return null;
	}

	function fmt_currency(val) {
		return "₹" + parseFloat(val || 0).toLocaleString("en-IN", {
			minimumFractionDigits: 2, maximumFractionDigits: 2,
		});
	}

	function fmt_currency_plain(val) {
		return parseFloat(val || 0).toLocaleString("en-IN", {
			minimumFractionDigits: 2, maximumFractionDigits: 2,
		});
	}

	function fmt_currency_compact(val) {
		const n = parseFloat(val || 0);
		if (n >= 10000000) return "₹" + (n / 10000000).toFixed(2) + "Cr";
		if (n >= 100000)   return "₹" + (n / 100000).toFixed(2) + "L";
		if (n >= 1000)     return "₹" + (n / 1000).toFixed(1) + "K";
		return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	}

	function status_badge(status) {
		const colors = {
			'Payment complete': "#28a745", 'Payment pending': "#007bff", Pending: "#ffc107",
			Onboarded: "#28a745", Inactive: "#6c757d", Approved: "#28a745",
			'Pending with Clarification': "#f59e0b", Active: "#1cc88a", Offboarded: "#6c757d",
			'Payment Cancelled': "#dc3545", 'Suspected duplicate': "#ffc107",
			Overdue: "#dc3545", 'Fully Paid': "#28a745", 'Partially Paid': "#17a2b8",
		};
		const color = colors[status] || "#6c757d";
		return `<span style="background:${color};color:#fff;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;">${status || "-"}</span>`;
	}

	function today_str() {
		return new Date().toISOString().slice(0, 10).replace(/-/g, "");
	}

	// ── Standalone charts ────────────────────────────────────────────────────

	const STATUS_COLORS = {
		'Payment complete': '#1cc88a', 'Payment pending': '#4e73df',
		'Payment Cancelled': '#e74a3b', 'Suspected duplicate': '#f6c23e',
		Pending: '#f6c23e', Active: '#1cc88a',
	};

	const CAT_COLORS = ['#4e73df','#1cc88a','#36b9cc','#f6c23e','#e74a3b','#858796','#5a5c69','#2e59d9','#17a673','#2c9faf'];

	function init_agg_charts(data) {
		const { monthly_trend, status_breakdown, svc_cat_breakdown } = data;

		// Monthly Trend Chart (Transaction Count)
		if (monthly_trend && monthly_trend.length && frappe && frappe.Chart) {
			try {
				$("#agg-trend-empty").hide();
				new frappe.Chart("#agg-trend-chart", {
					type: "bar",
					data: {
						labels: monthly_trend.map(r => r.month),
						datasets: [
							{ name: "Total", values: monthly_trend.map(r => r.total_count) },
							{ name: "Completed", values: monthly_trend.map(r => r.completed_count) },
						],
					},
					height: 200,
					colors: ["#c7d5f8", "#4e73df"],
					barOptions: { spaceRatio: 0.35 },
					axisOptions: { xIsSeries: false, shortenYAxisNumbers: true },
				});
			} catch (e) {
				$("#agg-trend-empty").show().text("Chart unavailable");
			}
		} else {
			$("#agg-trend-empty").show().text(
				monthly_trend && monthly_trend.length ? "Chart library unavailable" : "No transaction data yet"
			);
		}

		// Monthly Welfare Amount Chart
		if (monthly_trend && monthly_trend.length && frappe && frappe.Chart) {
			try {
				$("#agg-welfare-trend-empty").hide();
				new frappe.Chart("#agg-welfare-trend-chart", {
					type: "line",
					data: {
						labels: monthly_trend.map(r => r.month),
						datasets: [
							{ name: "Total Amount (₹)", values: monthly_trend.map(r => parseFloat(r.total_amount || 0)) },
							{ name: "Welfare (₹)", values: monthly_trend.map(r => parseFloat(r.total_welfare || 0)) },
						],
					},
					height: 200,
					colors: ["#36b9cc", "#1cc88a"],
					lineOptions: { regionFill: 0, dotSize: 4 },
					axisOptions: { xIsSeries: false, shortenYAxisNumbers: true },
				});
			} catch (e) {
				$("#agg-welfare-trend-empty").show().text("Chart unavailable");
			}
		} else {
			$("#agg-welfare-trend-empty").show().text("No data available");
		}

		// Service Category Distribution Chart
		if (svc_cat_breakdown && svc_cat_breakdown.length && frappe && frappe.Chart) {
			try {
				$("#agg-svc-cat-empty").hide();
				new frappe.Chart("#agg-svc-cat-chart", {
					type: "bar",
					data: {
						labels: svc_cat_breakdown.map(r => r.service_category),
						datasets: [{ name: "Transactions", values: svc_cat_breakdown.map(r => r.cnt) }],
					},
					height: 200,
					colors: ["#36b9cc"],
					barOptions: { spaceRatio: 0.3 },
					axisOptions: { xIsSeries: false, shortenYAxisNumbers: true },
				});
			} catch (e) {
				$("#agg-svc-cat-empty").show().text("Chart unavailable");
			}
		} else {
			$("#agg-svc-cat-empty").show().text(
				svc_cat_breakdown && svc_cat_breakdown.length ? "Chart library unavailable" : "No category data yet"
			);
		}

		// Status Distribution Donut
		if (status_breakdown && status_breakdown.length && frappe && frappe.Chart) {
			try {
				$("#agg-status-empty").hide();
				new frappe.Chart("#agg-status-chart", {
					type: "donut",
					data: {
						labels: status_breakdown.map(r => r.status),
						datasets: [{ values: status_breakdown.map(r => r.cnt) }],
					},
					height: 200,
					colors: status_breakdown.map(r => STATUS_COLORS[r.status] || "#858796"),
				});
			} catch (e) {
				$("#agg-status-empty").show().text("Chart unavailable");
			}
		} else {
			$("#agg-status-empty").show().text(
				status_breakdown && status_breakdown.length ? "Chart library unavailable" : "No data available"
			);
		}
	}

	// ── Drill-down modal ─────────────────────────────────────────────────────

	function bind_agg_drilldown(data) {
		const { recent_transactions, worker_list, pending_wfp, suspected_dups, top_workers } = data;

		const txn_cols = [
			{ label: "Transaction ID", render: t => `<a href="/app/gig-transaction/${t.name}" style="color:#4e73df;">${t.name}</a>` },
			{ label: "Date",           render: t => t.date || "-" },
			{ label: "Gig Worker",     render: t => t.gig_worker || "-" },
			{ label: "Service",        render: t => t.service || "-" },
			{ label: "Service Category", render: t => t.service_category || "-" },
			{ label: "Amount",         render: t => fmt_currency(t.amount) },
			{ label: "Base Payout",    render: t => fmt_currency(t.base_payout) },
			{ label: "Welfare",        render: t => fmt_currency(t.welfare_amount) },
			{ label: "Status",         render: t => status_badge(t.status) },
		];

		function group_by_month_count(rows) {
			const map = {};
			rows.forEach(r => { const m = (r.date || "").substring(0, 7) || "?"; map[m] = (map[m] || 0) + 1; });
			const labels = Object.keys(map).sort();
			return { labels, values: labels.map(k => map[k]) };
		}

		const configs = {
			total_txns: {
				title: "All Transactions",
				rows: () => recent_transactions,
				cols: txn_cols,
				summary: rows => [
					{ label: "Total", value: rows.length, color: "#4e73df" },
					{ label: "Total Amount", value: fmt_currency(rows.reduce((s, t) => s + (t.amount || 0), 0)) },
					{ label: "Total Welfare", value: fmt_currency(rows.reduce((s, t) => s + (t.welfare_amount || 0), 0)) },
				],
				chart: rows => {
					const sc = {};
					rows.forEach(t => { sc[t.status] = (sc[t.status] || 0) + 1; });
					const labels = Object.keys(sc);
					if (!labels.length) return null;
					return { type: "donut", data: { labels, datasets: [{ values: labels.map(l => sc[l]) }] }, colors: labels.map(l => STATUS_COLORS[l] || "#858796") };
				},
			},
			completed_txns: {
				title: "Completed Transactions",
				rows: () => recent_transactions.filter(t => t.status === "Payment complete"),
				cols: txn_cols,
				summary: rows => [
					{ label: "Count", value: rows.length, color: "#1cc88a" },
					{ label: "Total Amount", value: fmt_currency(rows.reduce((s, t) => s + (t.amount || 0), 0)), color: "#1cc88a" },
					{ label: "Total Welfare", value: fmt_currency(rows.reduce((s, t) => s + (t.welfare_amount || 0), 0)) },
				],
				chart: rows => {
					const { labels, values } = group_by_month_count(rows);
					if (!labels.length) return null;
					return { type: "line", data: { labels, datasets: [{ name: "Completed per Month", values }] }, colors: ["#1cc88a"] };
				},
			},
			pending_txns: {
				title: "Pending Transactions",
				rows: () => recent_transactions.filter(t => t.status === "Payment pending"),
				cols: txn_cols,
				summary: rows => [
					{ label: "Count", value: rows.length, color: "#4e73df" },
					{ label: "Total Amount", value: fmt_currency(rows.reduce((s, t) => s + (t.amount || 0), 0)) },
				],
				chart: rows => {
					const { labels, values } = group_by_month_count(rows);
					if (!labels.length) return null;
					return { type: "bar", data: { labels, datasets: [{ name: "Pending per Month", values }] }, colors: ["#4e73df"] };
				},
			},
			cancelled_txns: {
				title: "Cancelled Transactions",
				rows: () => recent_transactions.filter(t => t.status === "Payment Cancelled"),
				cols: txn_cols,
				summary: rows => [
					{ label: "Count", value: rows.length, color: "#e74a3b" },
					{ label: "Total Amount", value: fmt_currency(rows.reduce((s, t) => s + (t.amount || 0), 0)) },
				],
				chart: rows => {
					const { labels, values } = group_by_month_count(rows);
					if (!labels.length) return null;
					return { type: "bar", data: { labels, datasets: [{ name: "Cancelled per Month", values }] }, colors: ["#e74a3b"] };
				},
			},
			dup_txns: {
				title: "Suspected Duplicate Transactions",
				rows: () => suspected_dups || [],
				cols: txn_cols,
				summary: rows => [
					{ label: "Count", value: rows.length, color: "#f6c23e" },
					{ label: "Total Amount", value: fmt_currency(rows.reduce((s, t) => s + (t.amount || 0), 0)) },
				],
				chart: null,
			},
			total_amount: {
				title: "All Transactions — Amount Details",
				rows: () => recent_transactions,
				cols: txn_cols,
				summary: rows => [
					{ label: "Total Amount", value: fmt_currency(rows.reduce((s, t) => s + (t.amount || 0), 0)), color: "#36b9cc" },
					{ label: "Base Payout", value: fmt_currency(rows.reduce((s, t) => s + (t.base_payout || 0), 0)) },
					{ label: "Total Welfare", value: fmt_currency(rows.reduce((s, t) => s + (t.welfare_amount || 0), 0)) },
				],
				chart: rows => {
					const map = {};
					rows.forEach(t => { const m = (t.date || "").substring(0, 7) || "?"; map[m] = (map[m] || 0) + (t.amount || 0); });
					const labels = Object.keys(map).sort();
					if (!labels.length) return null;
					return { type: "line", data: { labels, datasets: [{ name: "Amount (₹)", values: labels.map(k => map[k]) }] }, colors: ["#36b9cc"] };
				},
			},
			base_payout: {
				title: "Base Payout Breakdown",
				rows: () => recent_transactions,
				cols: txn_cols,
				summary: rows => [
					{ label: "Total Base Payout", value: fmt_currency(rows.reduce((s, t) => s + (t.base_payout || 0), 0)), color: "#4e73df" },
					{ label: "Avg per Transaction", value: fmt_currency(rows.length ? rows.reduce((s, t) => s + (t.base_payout || 0), 0) / rows.length : 0) },
				],
				chart: rows => {
					const map = {};
					rows.forEach(t => { const m = (t.date || "").substring(0, 7) || "?"; map[m] = (map[m] || 0) + (t.base_payout || 0); });
					const labels = Object.keys(map).sort();
					if (!labels.length) return null;
					return { type: "bar", data: { labels, datasets: [{ name: "Base Payout (₹)", values: labels.map(k => map[k]) }] }, colors: ["#4e73df"] };
				},
			},
			total_welfare_collected: {
				title: "Welfare Collected from Transactions",
				rows: () => recent_transactions.filter(t => (t.welfare_amount || 0) > 0),
				cols: txn_cols,
				summary: rows => [
					{ label: "Total Welfare", value: fmt_currency(rows.reduce((s, t) => s + (t.welfare_amount || 0), 0)), color: "#1cc88a" },
					{ label: "Transactions with Welfare", value: rows.length, color: "#1cc88a" },
				],
				chart: rows => {
					const map = {};
					rows.forEach(t => { const m = (t.date || "").substring(0, 7) || "?"; map[m] = (map[m] || 0) + (t.welfare_amount || 0); });
					const labels = Object.keys(map).sort();
					if (!labels.length) return null;
					return { type: "bar", data: { labels, datasets: [{ name: "Welfare (₹)", values: labels.map(k => map[k]) }] }, colors: ["#1cc88a"] };
				},
			},
			total_workers: {
				title: "Worker Mapping Log",
				rows: () => worker_list || [],
				cols: [
					{ label: "Gig Worker",   render: w => `<a href="/app/gig-worker/${w.gig_worker}" style="color:#4e73df;">${w.gig_worker || "-"}</a>` },
					{ label: "Service",      render: w => w.service || "-" },
					{ label: "Event",        render: w => w.event_type || "-" },
					{ label: "Worker Status", render: w => status_badge(w.worker_status) },
					{ label: "Logged At",    render: w => (w.log_datetime || "").substring(0, 16) },
				],
				summary: rows => [{ label: "Total Records", value: rows.length }],
				chart: rows => {
					const sc = {};
					rows.forEach(w => { const s = w.worker_status || "Unknown"; sc[s] = (sc[s] || 0) + 1; });
					const labels = Object.keys(sc);
					if (!labels.length) return null;
					return { type: "donut", data: { labels, datasets: [{ values: labels.map(l => sc[l]) }] }, colors: ["#1cc88a", "#6c757d", "#4e73df", "#f6c23e", "#e74a3b"] };
				},
			},
			onboarded_workers: {
				title: "Onboarded Workers",
				rows: () => (worker_list || []).filter(w => ["Onboarded", "Active"].includes(w.worker_status)),
				cols: [
					{ label: "Gig Worker",   render: w => `<a href="/app/gig-worker/${w.gig_worker}" style="color:#4e73df;">${w.gig_worker || "-"}</a>` },
					{ label: "Service",      render: w => w.service || "-" },
					{ label: "Event",        render: w => w.event_type || "-" },
					{ label: "Worker Status", render: w => status_badge(w.worker_status) },
					{ label: "Logged At",    render: w => (w.log_datetime || "").substring(0, 16) },
				],
				summary: rows => [{ label: "Count", value: rows.length, color: "#1cc88a" }],
				chart: null,
			},
			workers_transacted: {
				title: "Workers Who Have Transacted",
				rows: () => recent_transactions,
				cols: txn_cols,
				summary: rows => [
					{ label: "Unique Workers", value: new Set(rows.map(t => t.gig_worker).filter(Boolean)).size, color: "#4e73df" },
					{ label: "Total Transactions", value: rows.length },
				],
				chart: rows => {
					const sc = {};
					rows.forEach(t => { const w = t.gig_worker || "Unknown"; sc[w] = (sc[w] || 0) + 1; });
					const top = Object.entries(sc).sort((a, b) => b[1] - a[1]).slice(0, 8);
					const labels = top.map(e => e[0]);
					if (!labels.length) return null;
					return { type: "bar", data: { labels, datasets: [{ name: "Transactions", values: top.map(e => e[1]) }] }, colors: ["#4e73df"] };
				},
			},
			welfare_settled: {
				title: "Welfare Fees Settled",
				rows: () => [],
				cols: [],
				summary: () => [{ label: "View full list", value: "→ Welfare Fee Payment" }],
				chart: null,
			},
			welfare_pending: {
				title: "Pending Welfare Fee Payments",
				rows: () => pending_wfp || [],
				cols: [
					{ label: "Payment ID",   render: p => `<a href="/app/welfare-fee-payment/${p.name}" style="color:#4e73df;">${p.name}</a>` },
					{ label: "Transaction",  render: p => p.transaction || "-" },
					{ label: "Fee Amount",   render: p => fmt_currency(p.fee_amount) },
					{ label: "Due Date",     render: p => p.payment_date || "-" },
					{ label: "Status",       render: p => status_badge(p.payment_status) },
				],
				summary: rows => [
					{ label: "Count", value: rows.length, color: "#e74a3b" },
					{ label: "Total Pending", value: fmt_currency(rows.reduce((s, p) => s + (p.fee_amount || 0), 0)), color: "#e74a3b" },
				],
				chart: rows => {
					if (!rows.length) return null;
					const map = {};
					rows.forEach(p => { const d = (p.payment_date || "").substring(0, 7) || "?"; map[d] = (map[d] || 0) + (p.fee_amount || 0); });
					const labels = Object.keys(map).sort();
					return { type: "bar", data: { labels, datasets: [{ name: "Pending Fees (₹)", values: labels.map(k => map[k]) }] }, colors: ["#e74a3b"] };
				},
			},
		};

		function render_dd_summary(items) {
			const $el = $("#agg-dd-summary");
			if (!items || !items.length) { $el.hide(); return; }
			$el.show().html(items.map(item =>
				`<div class="agg-dd-stat">
					<div class="agg-dd-stat-label">${item.label}</div>
					<div class="agg-dd-stat-value" style="color:${item.color || "#333"};">${item.value}</div>
				</div>`
			).join(""));
		}

		function render_dd_chart(cfg) {
			const $wrap = $("#agg-dd-chart-wrap");
			$wrap.hide();
			$("#agg-dd-chart").empty();
			if (!cfg || !cfg.data || !cfg.data.labels || !cfg.data.labels.length) return;
			if (!frappe || !frappe.Chart) return;
			$wrap.show();
			try {
				const opts = { type: cfg.type || "bar", data: cfg.data, height: 240, colors: cfg.colors || ["#4e73df"] };
				if (cfg.type === "line") {
					opts.axisOptions = { xIsSeries: true, shortenYAxisNumbers: true };
					opts.lineOptions  = { regionFill: 1, dotSize: 3 };
				} else if (cfg.type === "bar") {
					opts.axisOptions = { xIsSeries: false, shortenYAxisNumbers: true };
					opts.barOptions  = { spaceRatio: 0.3 };
				}
				new frappe.Chart("#agg-dd-chart", opts);
			} catch (_) {
				$wrap.hide();
			}
		}

		function open_drilldown(type) {
			const cfg = configs[type];
			if (!cfg) return;
			const rows = cfg.rows();

			if ($.fn.DataTable && $.fn.DataTable.isDataTable("#agg-dd-dt-table")) {
				$("#agg-dd-dt-table").DataTable().destroy();
				$("#agg-dd-dt-table").empty();
			}

			$("#agg-dd-title").text(cfg.title);
			$("#agg-dd-count").text(`${rows.length} record${rows.length !== 1 ? "s" : ""}`);

			render_dd_summary(cfg.summary ? cfg.summary(rows) : null);
			render_dd_chart(rows.length && cfg.chart ? cfg.chart(rows) : null);

			if (cfg.cols && cfg.cols.length) {
				const thead = `<thead><tr>${cfg.cols.map(c => `<th>${c.label}</th>`).join("")}</tr></thead>`;
				const tbody_html = rows.length
					? rows.map(row => `<tr>${cfg.cols.map(c => `<td>${c.render(row)}</td>`).join("")}</tr>`).join("")
					: `<tr><td colspan="${cfg.cols.length}" style="text-align:center;color:#aaa;padding:24px;">No records found</td></tr>`;
				$("#agg-dd-dt-table").html(`${thead}<tbody>${tbody_html}</tbody>`);

				if (rows.length && $.fn.DataTable) {
					$("#agg-dd-dt-table").DataTable({
						pageLength: 15, lengthMenu: [10, 15, 25, 50, 100], order: [],
						language: { search: "Filter:", lengthMenu: "Show _MENU_ entries", info: "Showing _START_ to _END_ of _TOTAL_ records", emptyTable: "No records found" },
						dom: '<"dt-top"lf>rt<"dt-bottom"ip>',
					});
				}
			} else {
				$("#agg-dd-dt-table").html(`<tbody><tr><td style="text-align:center;padding:24px;color:#888;">No detailed records available for this view.</td></tr></tbody>`);
			}

			$("#agg-dd-overlay").addClass("active");
			$("#agg-dd-body").scrollTop(0);
		}

		function close_drilldown() {
			if ($.fn.DataTable && $.fn.DataTable.isDataTable("#agg-dd-dt-table")) {
				$("#agg-dd-dt-table").DataTable().destroy();
				$("#agg-dd-dt-table").empty();
			}
			$("#agg-dd-overlay").removeClass("active");
		}

		$(document).off("click.agg_drilldown").off("keydown.agg_drilldown");
		$("#agg-dashboard").off("click.agg_drilldown");

		$("#agg-dashboard").on("click.agg_drilldown", ".agg-drillable[data-drilldown]", function () {
			open_drilldown($(this).data("drilldown"));
		});

		$("#agg-dd-close").on("click", close_drilldown);
		$("#agg-dd-overlay").on("click", function (e) {
			if ($(e.target).is("#agg-dd-overlay")) close_drilldown();
		});
		$(document).on("keydown.agg_drilldown", function (e) {
			if (e.key === "Escape" && $("#agg-dd-overlay").hasClass("active")) close_drilldown();
		});
	}

	// ── PDF download ─────────────────────────────────────────────────────────

	function download_pdf() {
		if (!_agg_data) return;

		function do_pdf() {
			const { jsPDF } = window.jspdf;
			const d   = _agg_data;
			const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
			const PW  = doc.internal.pageSize.getWidth();
			const PH  = doc.internal.pageSize.getHeight();
			const ML  = 45, MR = 45, CW = PW - ML - MR;

			const now        = new Date();
			const nowStr     = now.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
			const downloader = (frappe.session && frappe.session.user) || "Unknown";

			const BLACK   = [0, 0, 0];
			const WHITE   = [255, 255, 255];
			const DARK    = [30, 30, 30];
			const GREY_HD = [50, 50, 50];
			const GREY_LT = [245, 245, 245];
			const MUTED   = [130, 130, 130];
			const BORDER  = [180, 180, 180];

			function draw_footer() {
				const pages = doc.internal.getNumberOfPages();
				for (let i = 1; i <= pages; i++) {
					doc.setPage(i);
					doc.setDrawColor(...BORDER); doc.setLineWidth(0.5);
					doc.line(ML, PH - 46, PW - MR, PH - 46);
					doc.setFontSize(7.5); doc.setFont(undefined, "normal");
					doc.setTextColor(...MUTED);
					doc.text(`Downloaded by: ${downloader}   |   ${nowStr}`, ML, PH - 34);
					doc.text(`Page ${i} / ${pages}`, PW - MR, PH - 34, { align: "right" });
				}
			}

			function draw_page_border() {
				const pages = doc.internal.getNumberOfPages();
				for (let i = 1; i <= pages; i++) {
					doc.setPage(i);
					doc.setDrawColor(...BORDER); doc.setLineWidth(1);
					doc.rect(20, 20, PW - 40, PH - 40, "S");
				}
			}

			let y = 0;
			function section_heading(title) {
				y += 10;
				doc.setFontSize(10); doc.setFont(undefined, "bold"); doc.setTextColor(...DARK);
				doc.text(title.toUpperCase(), ML, y);
				y += 4;
				doc.setDrawColor(...BLACK); doc.setLineWidth(1);
				doc.line(ML, y, ML + CW, y);
				y += 8; doc.setFont(undefined, "normal");
			}

			function stats_table(rows_data) {
				const half  = Math.ceil(rows_data.length / 2);
				const left  = rows_data.slice(0, half);
				const right = rows_data.slice(half);
				const colW  = (CW - 10) / 2;
				const rowH  = 18;
				const labelW = colW * 0.62;
				const valW   = colW - labelW;

				[left, right].forEach((col, ci) => {
					const ox = ML + ci * (colW + 10);
					col.forEach((item, ri) => {
						const ry = y + ri * rowH;
						const isEven = ri % 2 === 0;
						doc.setFillColor(...(isEven ? WHITE : GREY_LT));
						doc.rect(ox, ry, colW, rowH, "F");
						doc.setDrawColor(...BORDER); doc.setLineWidth(0.3);
						doc.rect(ox, ry, colW, rowH, "S");
						doc.setFontSize(8); doc.setFont(undefined, "normal"); doc.setTextColor(...MUTED);
						doc.text(item.label, ox + 6, ry + 12, { maxWidth: labelW - 8 });
						doc.setFont(undefined, "bold"); doc.setTextColor(...DARK);
						doc.text(String(item.value), ox + labelW + valW - 6, ry + 12, { align: "right", maxWidth: valW - 4 });
					});
				});

				y += Math.max(left.length, right.length) * rowH + 10;
				doc.setFont(undefined, "normal");
			}

			function pdf_table(head, body) {
				doc.autoTable({
					startY: y, head: [head], body,
					theme: "grid",
					headStyles: { fillColor: GREY_HD, textColor: WHITE, fontSize: 7.5, fontStyle: "bold", cellPadding: { top: 4, bottom: 4, left: 4, right: 4 } },
					bodyStyles: { fontSize: 7.5, textColor: DARK, cellPadding: { top: 3, bottom: 3, left: 4, right: 4 } },
					alternateRowStyles: { fillColor: GREY_LT },
					tableLineColor: BORDER, tableLineWidth: 0.3,
					margin: { left: ML, right: MR, bottom: 60 },
				});
				y = doc.lastAutoTable.finalY + 14;
			}

			y = 60;
			doc.setDrawColor(...BLACK); doc.setLineWidth(1.5);
			doc.line(ML, y, ML + CW, y);
			y += 14;
			doc.setFontSize(15); doc.setFont(undefined, "bold"); doc.setTextColor(...DARK);
			doc.text("Aggregator Dashboard Report", ML, y);
			doc.setFont(undefined, "normal"); y += 16;
			doc.setFontSize(8.5); doc.setTextColor(...MUTED);
			doc.text("Gig Workers Welfare Portal", ML, y); y += 13;
			doc.setFontSize(8); doc.setTextColor(...DARK);
			doc.text("Aggregator:", ML, y);
			doc.setFont(undefined, "bold");
			doc.text(`${d.aggregator.aggregator_name || "-"}  (${d.aggregator_id})`, ML + 60, y);
			doc.setFont(undefined, "normal"); y += 14;
			doc.setDrawColor(...BLACK); doc.setLineWidth(0.5);
			doc.line(ML, y, ML + CW, y); y += 20;

			section_heading("Transactions");
			stats_table([
				{ label: "Total Transactions",      value: d.stats.total_transactions },
				{ label: "Completed",               value: d.stats.completed_transactions },
				{ label: "Pending",                 value: d.stats.pending_transactions },
				{ label: "Total Amount (INR)",       value: fmt_currency_plain(d.stats.total_amount) },
				{ label: "Total Base Payout (INR)",  value: fmt_currency_plain(d.stats.total_base_payout) },
				{ label: "Total Welfare (INR)",      value: fmt_currency_plain(d.stats.total_welfare) },
			]);

			section_heading("Workers & Welfare");
			stats_table([
				{ label: "Workers Transacted",         value: d.workers.total },
				{ label: "Onboarded Workers",          value: d.workers.active },
				{ label: "Welfare Fees Settled (INR)", value: fmt_currency_plain(d.welfare_payments.total_paid) },
				{ label: "Welfare Fees Pending (INR)", value: fmt_currency_plain(d.welfare_payments.pending_amount) },
			]);

			section_heading("Transaction Details");
			pdf_table(
				["Txn ID", "Date", "Gig Worker", "Service", "Amount (INR)", "Base Payout (INR)", "Welfare (INR)", "Status"],
				(d.recent_transactions || []).map(t => [
					t.name, t.date || "-", t.gig_worker || "-", t.service || "-",
					fmt_currency_plain(t.amount), fmt_currency_plain(t.base_payout),
					fmt_currency_plain(t.welfare_amount), t.status || "-",
				])
			);

			section_heading("Worker Mapping Log");
			pdf_table(
				["Log ID", "Gig Worker", "Service", "Event", "Worker Status", "Logged At"],
				(d.worker_list || []).map(w => [
					w.name, w.gig_worker || "-", w.service || "-",
					w.event_type || "-", w.worker_status || "-",
					(w.log_datetime || "").substring(0, 16),
				])
			);

			section_heading("Pending Welfare Fee Payments");
			pdf_table(
				["Payment ID", "Transaction", "Fee Amount (INR)", "Due Date", "Status"],
				(d.pending_wfp || []).map(p => [
					p.name, p.transaction || "-",
					fmt_currency_plain(p.fee_amount), p.payment_date || "-", p.payment_status || "-",
				])
			);

			draw_footer();
			draw_page_border();
			doc.save(`aggregator_dashboard_${today_str()}.pdf`);
		}

		if (window.jspdf && window.jspdf.jsPDF) { do_pdf(); return; }

		frappe.show_alert({ message: "Loading PDF library…", indicator: "blue" });
		$.getScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js", function () {
			$.getScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js", function () {
				do_pdf();
			});
		});
	}

	function render_filter_bar(service_categories, active_filters) {
		const cat_opts = (service_categories || []).map(c =>
			`<option value="${c}" ${active_filters.service_category === c ? "selected" : ""}>${c}</option>`
		).join("");
		const has_filter = active_filters.from_date || active_filters.to_date || active_filters.service_category;
		return `
		<div id="agg-filter-bar" style="background:#fff;border-radius:10px;padding:16px 20px;
			box-shadow:0 2px 8px rgba(0,0,0,0.07);margin-bottom:20px;
			display:flex;flex-wrap:wrap;align-items:flex-end;gap:14px;">
			<div style="flex:1;min-width:140px;">
				<label style="font-size:12px;font-weight:600;color:#555;display:block;margin-bottom:4px;">From Date</label>
				<input type="date" id="agg-filter-from" value="${active_filters.from_date}"
					style="width:100%;padding:7px 10px;border:1px solid #d1d3e2;border-radius:6px;font-size:13px;">
			</div>
			<div style="flex:1;min-width:140px;">
				<label style="font-size:12px;font-weight:600;color:#555;display:block;margin-bottom:4px;">To Date</label>
				<input type="date" id="agg-filter-to" value="${active_filters.to_date}"
					style="width:100%;padding:7px 10px;border:1px solid #d1d3e2;border-radius:6px;font-size:13px;">
			</div>
			<div style="flex:1;min-width:160px;">
				<label style="font-size:12px;font-weight:600;color:#555;display:block;margin-bottom:4px;">Service Category</label>
				<select id="agg-filter-cat"
					style="width:100%;padding:7px 10px;border:1px solid #d1d3e2;border-radius:6px;font-size:13px;">
					<option value="">All Services</option>
					${cat_opts}
				</select>
			</div>
			<div style="display:flex;gap:8px;align-items:flex-end;">
				<button id="agg-btn-apply-filter"
					style="background:#e74a3b;color:#fff;border:none;border-radius:6px;
						padding:8px 20px;font-size:13px;cursor:pointer;font-weight:600;">
					Apply Filter
				</button>
				${has_filter ? `<button id="agg-btn-clear-filter"
					style="background:#fff;color:#e74a3b;border:1px solid #e74a3b;
						border-radius:6px;padding:8px 14px;font-size:13px;cursor:pointer;">
					Clear
				</button>` : ""}
			</div>
			${has_filter ? `<div style="width:100%;margin-top:4px;font-size:12px;color:#888;">
				Showing filtered results
				${active_filters.from_date ? ` from <b>${active_filters.from_date}</b>` : ""}
				${active_filters.to_date ? ` to <b>${active_filters.to_date}</b>` : ""}
				${active_filters.service_category ? ` &mdash; Service: <b style="color:#e74a3b;">${active_filters.service_category}</b>` : ""}
			</div>` : ""}
		</div>`;
	}

	function render_quarterly_invoices(quarterly_invoices, invoice_summary) {
		if (!quarterly_invoices || !quarterly_invoices.length) return "";

		const inv_status_color = { "Fully Paid": "#1cc88a", "Overdue": "#e74a3b", "Partially Paid": "#17a2b8", "Pending": "#f6c23e" };

		const inv_cards = quarterly_invoices.map(inv => {
			const color = inv_status_color[inv.invoice_status] || "#6c757d";
			const is_overdue = inv.invoice_status === "Overdue";
			return `
			<div style="flex:1;min-width:200px;background:#fff;border-radius:10px;padding:16px 18px;
				box-shadow:0 2px 8px rgba(0,0,0,0.08);border-top:4px solid ${color};position:relative;">
				<div style="font-size:12px;font-weight:700;color:#555;margin-bottom:8px;">
					${inv.quarter || ""} ${inv.year || ""}
				</div>
				<div style="font-size:11px;color:#888;margin-bottom:4px;">
					${inv.from_date || ""} – ${inv.to_date || ""}
				</div>
				<div style="font-size:20px;font-weight:700;color:${is_overdue ? "#e74a3b" : "#333"};margin:8px 0 4px;">
					${fmt_currency(inv.balance_due)}
				</div>
				<div style="font-size:11px;color:#aaa;">Balance Due</div>
				<div style="margin-top:8px;display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#888;">
					<span>Total: <b style="color:#333;">${fmt_currency(inv.total_due_amount)}</b></span>
					<span>Paid: <b style="color:#1cc88a;">${fmt_currency(inv.amount_paid)}</b></span>
				</div>
				<div style="margin-top:8px;">
					<span style="background:${color};color:#fff;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:600;">${inv.invoice_status || "-"}</span>
					${inv.due_date ? `<span style="font-size:11px;color:#888;margin-left:6px;">Due: ${inv.due_date}</span>` : ""}
				</div>
				<a href="/app/welfare-fee-invoice/${inv.name}" style="position:absolute;top:14px;right:14px;font-size:11px;color:#4e73df;">View →</a>
			</div>`;
		}).join("");

		const has_outstanding = invoice_summary.total_outstanding > 0;
		return `
		<div class="agg-section" style="margin-bottom:24px;">
			<h5 style="display:flex;align-items:center;justify-content:space-between;">
				<span><i class="fa fa-file-text" style="color:#f6c23e;margin-right:6px;"></i>Quarterly Welfare Invoices</span>
				<a href="/app/welfare-fee-invoice" style="font-size:13px;font-weight:500;color:#4e73df;">View All</a>
			</h5>
			${has_outstanding ? `
			<div style="display:flex;flex-wrap:wrap;gap:14px;margin-bottom:16px;">
				${invoice_summary.total_outstanding > 0 ? `
				<div style="background:#fff8e1;border:1.5px solid #f6c23e;border-radius:8px;padding:12px 20px;display:flex;align-items:center;gap:10px;">
					<i class="fa fa-clock-o" style="color:#f6c23e;font-size:18px;"></i>
					<div><div style="font-size:11px;color:#856404;font-weight:600;">OUTSTANDING</div>
					<div style="font-size:18px;font-weight:700;color:#856404;">${fmt_currency(invoice_summary.total_outstanding)}</div></div>
				</div>` : ""}
				${invoice_summary.total_overdue > 0 ? `
				<div style="background:#fdf2f2;border:1.5px solid #e74a3b;border-radius:8px;padding:12px 20px;display:flex;align-items:center;gap:10px;">
					<i class="fa fa-exclamation-circle" style="color:#e74a3b;font-size:18px;"></i>
					<div><div style="font-size:11px;color:#721c24;font-weight:600;">OVERDUE</div>
					<div style="font-size:18px;font-weight:700;color:#e74a3b;">${fmt_currency(invoice_summary.total_overdue)}</div></div>
				</div>` : ""}
				${invoice_summary.pending_invoices > 0 ? `
				<div style="background:#f0f9ff;border:1.5px solid #17a2b8;border-radius:8px;padding:12px 20px;display:flex;align-items:center;gap:10px;">
					<i class="fa fa-list-alt" style="color:#17a2b8;font-size:18px;"></i>
					<div><div style="font-size:11px;color:#0c5460;font-weight:600;">OPEN INVOICES</div>
					<div style="font-size:18px;font-weight:700;color:#0c5460;">${invoice_summary.pending_invoices}</div></div>
				</div>` : ""}
			</div>` : `
			<div style="background:#d4edda;border:1px solid #c3e6cb;border-radius:8px;padding:10px 16px;margin-bottom:14px;font-size:13px;color:#155724;display:flex;align-items:center;gap:8px;">
				<i class="fa fa-check-circle"></i> All invoices are fully paid. No outstanding dues.
			</div>`}
			<div style="display:flex;flex-wrap:wrap;gap:14px;">
				${inv_cards}
			</div>
		</div>`;
	}

	function render_top_workers(top_workers) {
		if (!top_workers || !top_workers.length) return "";
		const rows = top_workers.map((w, i) => `
			<tr>
				<td style="font-weight:600;color:#555;">${i + 1}</td>
				<td><a href="/app/gig-worker/${w.gig_worker}" style="color:#4e73df;">${w.gig_worker || "-"}</a></td>
				<td style="text-align:center;font-weight:600;">${w.txn_count || 0}</td>
				<td style="text-align:right;">${fmt_currency(w.total_amount)}</td>
				<td style="text-align:right;color:#1cc88a;">${fmt_currency(w.total_welfare)}</td>
				<td style="text-align:center;">${w.completed_count || 0}</td>
			</tr>`).join("");
		return `
		<div class="agg-section" style="margin-bottom:24px;">
			<h5><i class="fa fa-trophy" style="color:#f6c23e;margin-right:6px;"></i>Top Workers by Transactions</h5>
			<table style="width:100%;border-collapse:collapse;font-size:13px;">
				<thead>
					<tr style="background:#f8f9fa;">
						<th style="padding:8px 10px;text-align:left;font-weight:600;color:#555;border-bottom:2px solid #eee;">#</th>
						<th style="padding:8px 10px;text-align:left;font-weight:600;color:#555;border-bottom:2px solid #eee;">Worker ID</th>
						<th style="padding:8px 10px;text-align:center;font-weight:600;color:#555;border-bottom:2px solid #eee;">Transactions</th>
						<th style="padding:8px 10px;text-align:right;font-weight:600;color:#555;border-bottom:2px solid #eee;">Total Amount</th>
						<th style="padding:8px 10px;text-align:right;font-weight:600;color:#555;border-bottom:2px solid #eee;">Welfare</th>
						<th style="padding:8px 10px;text-align:center;font-weight:600;color:#555;border-bottom:2px solid #eee;">Completed</th>
					</tr>
				</thead>
				<tbody>${rows}</tbody>
			</table>
		</div>`;
	}

	function render_svc_cat_table(svc_cat_breakdown) {
		if (!svc_cat_breakdown || !svc_cat_breakdown.length) return "";
		const rows = svc_cat_breakdown.map(s => `
			<tr>
				<td style="font-weight:600;">${s.service_category || "-"}</td>
				<td style="text-align:center;font-weight:600;">${s.cnt || 0}</td>
				<td style="text-align:right;">${fmt_currency(s.total_amount)}</td>
				<td style="text-align:right;color:#1cc88a;">${fmt_currency(s.total_welfare)}</td>
			</tr>`).join("");
		return `
		<table style="width:100%;border-collapse:collapse;font-size:13px;">
			<thead>
				<tr style="background:#f8f9fa;">
					<th style="padding:8px 10px;text-align:left;font-weight:600;color:#555;border-bottom:2px solid #eee;">Category</th>
					<th style="padding:8px 10px;text-align:center;font-weight:600;color:#555;border-bottom:2px solid #eee;">Transactions</th>
					<th style="padding:8px 10px;text-align:right;font-weight:600;color:#555;border-bottom:2px solid #eee;">Total Amount</th>
					<th style="padding:8px 10px;text-align:right;font-weight:600;color:#555;border-bottom:2px solid #eee;">Welfare</th>
				</tr>
			</thead>
			<tbody>${rows}</tbody>
		</table>`;
	}

	function render_dashboard(data) {
		const { aggregator, aggregator_id, stats, workers, welfare_payments,
			recent_transactions, worker_list, pending_wfp,
			service_categories, active_filters, suspected_dups,
			services, monthly_trend, status_breakdown,
			svc_cat_breakdown, top_workers,
			quarterly_invoices, invoice_summary } = data;

		const has_charts = (monthly_trend && monthly_trend.length) || (status_breakdown && status_breakdown.length);

		const html = `
		<style>
			.agg-card-row { display: flex; flex-wrap: wrap; gap: 16px; margin-bottom: 20px; }
			.agg-stat-card {
				flex: 1; min-width: 150px; background: #fff; border-radius: 10px;
				padding: 18px 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);
				border-left: 4px solid var(--card-color, #4e73df);
			}
			.agg-stat-card .label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: .5px; font-weight: 600; }
			.agg-stat-card .value { font-size: 26px; font-weight: 700; color: #333; margin-top: 6px; }
			.agg-stat-card .sub { font-size: 11px; color: #aaa; margin-top: 3px; }
			.agg-stat-card.agg-drillable {
				cursor: pointer;
				transition: transform .15s, box-shadow .15s;
				position: relative;
			}
			.agg-stat-card.agg-drillable:hover {
				transform: translateY(-3px);
				box-shadow: 0 8px 24px rgba(0,0,0,0.13);
			}
			.agg-stat-card.agg-drillable::after {
				content: "↗";
				position: absolute; top: 10px; right: 12px;
				font-size: 13px; color: #ddd; transition: color .15s;
			}
			.agg-stat-card.agg-drillable:hover::after { color: var(--card-color, #4e73df); }
			.agg-section { background: #fff; border-radius: 10px; padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.07); margin-bottom: 24px; }
			.agg-section h5 { font-weight: 700; margin-bottom: 14px; color: #444; border-bottom: 1px solid #eee; padding-bottom: 8px; }
			.agg-profile { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; background:#fff; border-radius:10px; padding:18px 20px; box-shadow:0 2px 8px rgba(0,0,0,0.07); }
			.agg-avatar { width: 52px; height: 52px; border-radius: 50%; background: #e74a3b; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 700; flex-shrink:0; }
			.agg-profile-info .name { font-size: 20px; font-weight: 700; color: #333; }
			.agg-profile-info .meta { font-size: 13px; color: #888; margin-top: 4px; display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
			.highlight { color: #e74a3b; font-weight: 700; }
			.dt-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
			.dt-bottom { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; }
			table.dataTable thead th { background: #f8f9fa; color: #555; font-weight: 600; }
			table.dataTable tbody tr:hover td { background: #fafafa; }
			table.dataTable { font-size: 13px; }
			.agg-section-row { display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 24px; }
			.agg-section-row > .agg-section { margin-bottom: 0; }

			/* ── Drill-down modal ── */
			#agg-dd-overlay {
				display: none; position: fixed; inset: 0;
				background: rgba(0,0,0,0.5); z-index: 10000;
				align-items: center; justify-content: center; padding: 20px; box-sizing: border-box;
			}
			#agg-dd-overlay.active { display: flex; }
			#agg-dd-modal {
				background: #f8f9fc; border-radius: 14px;
				width: 95vw; max-width: 1100px; max-height: 90vh;
				display: flex; flex-direction: column;
				box-shadow: 0 28px 70px rgba(0,0,0,0.28); overflow: hidden;
			}
			#agg-dd-header {
				padding: 18px 24px 14px; background: #fff;
				border-bottom: 1px solid #eee;
				display: flex; align-items: flex-start; justify-content: space-between; flex-shrink: 0;
			}
			#agg-dd-title { font-size: 16px; font-weight: 700; color: #333; margin: 0; }
			#agg-dd-count { font-size: 12px; color: #aaa; margin-top: 3px; }
			#agg-dd-close {
				background: none; border: none; font-size: 20px; color: #bbb;
				cursor: pointer; line-height: 1; padding: 2px 6px; border-radius: 4px; transition: all .12s;
			}
			#agg-dd-close:hover { color: #333; background: #f5f5f5; }
			#agg-dd-body { padding: 16px 20px 20px; overflow-y: auto; flex: 1; }
			#agg-dd-summary { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; }
			.agg-dd-stat {
				background: #fff; border-radius: 10px; padding: 12px 20px;
				box-shadow: 0 1px 6px rgba(0,0,0,0.07); min-width: 110px;
			}
			.agg-dd-stat-label { font-size: 11px; color: #aaa; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 4px; }
			.agg-dd-stat-value { font-size: 20px; font-weight: 700; }
			#agg-dd-chart-wrap {
				background: #fff; border-radius: 10px; padding: 16px 20px 8px;
				box-shadow: 0 1px 6px rgba(0,0,0,0.07); margin-bottom: 16px;
			}
			#agg-dd-chart-wrap h6 { font-size: 12px; font-weight: 700; color: #999; text-transform: uppercase; letter-spacing: .5px; margin: 0 0 8px; }
			#agg-dd-table-wrap {
				background: #fff; border-radius: 10px; padding: 16px 20px;
				box-shadow: 0 1px 6px rgba(0,0,0,0.07); overflow-x: auto;
			}
			#agg-dd-table-wrap h6 { font-size: 12px; font-weight: 700; color: #999; text-transform: uppercase; letter-spacing: .5px; margin: 0 0 12px; }
			#agg-dd-body table.dataTable { font-size: 13px; width: 100% !important; }
			#agg-dd-body .dt-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
			#agg-dd-body .dt-bottom { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; }
		</style>

		<div style="display:flex; justify-content:flex-end; margin-bottom:16px;">
			<button id="agg-btn-dl-pdf" style="background:#222;color:#fff;border:none;border-radius:6px;padding:8px 20px;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:6px;">
				<i class="fa fa-file-pdf-o"></i> Download PDF
			</button>
		</div>

		${render_filter_bar(service_categories, active_filters || {})}

		${(suspected_dups && suspected_dups.length) ? `
		<div style="background:#fff8e1;border:1.5px solid #f6c23e;border-radius:10px;
			padding:14px 20px;margin-bottom:20px;display:flex;align-items:center;gap:12px;">
			<i class="fa fa-exclamation-triangle" style="color:#f6c23e;font-size:20px;"></i>
			<div style="flex:1;">
				<strong style="color:#856404;">
					${suspected_dups.length} transaction${suspected_dups.length > 1 ? "s" : ""} flagged as suspected duplicate
				</strong>
				<span style="color:#856404;font-size:13px;margin-left:8px;">
					— Under review by admin. No action required from you.
				</span>
			</div>
			<a href="javascript:void(0)" onclick="var el=document.getElementById('agg-dup-section');if(el)el.scrollIntoView({behavior:'smooth'});"
				style="font-size:13px;font-weight:600;color:#856404;text-decoration:underline;cursor:pointer;">
				View &darr;
			</a>
		</div>
		` : ""}

		<!-- Aggregator Profile -->
		<div class="agg-profile">
			<div class="agg-avatar">${(aggregator.aggregator_name || "?")[0].toUpperCase()}</div>
			<div class="agg-profile-info" style="flex:1;">
				<div class="name">${aggregator.aggregator_name || "-"}</div>
				<div class="meta">
					<span><i class="fa fa-id-badge" style="margin-right:4px;"></i>${aggregator_id}</span>
					<span><i class="fa fa-envelope" style="margin-right:4px;"></i>${aggregator.email || ""}</span>
					${aggregator.mobile ? `<span><i class="fa fa-phone" style="margin-right:4px;"></i>${aggregator.mobile}</span>` : ""}
					${status_badge(aggregator.status)}
					${(services && services.length) ? `<span style="color:#4e73df;font-weight:600;"><i class="fa fa-building" style="margin-right:4px;"></i>${services.length} Service${services.length > 1 ? "s" : ""}</span>` : ""}
				</div>
			</div>
		</div>

		${aggregator.status === "Pending with Clarification" ? `
		<div id="agg-clarification-panel" style="background:#fffbeb;border:2px solid #f59e0b;border-radius:10px;padding:20px 24px;margin-bottom:20px;">
			<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
				<span style="font-size:22px;">&#9432;</span>
				<div>
					<div style="font-size:15px;font-weight:700;color:#92400e;">Action Required: Clarification Needed</div>
					<div style="font-size:12px;color:#a16207;margin-top:2px;">Your application is on hold pending your response to the admin's comments below.</div>
				</div>
			</div>
			<div style="background:#fff;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:6px;margin-bottom:16px;">
				<div style="font-size:11px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Admin Comments</div>
				<div style="font-size:13px;color:#374151;white-space:pre-wrap;">${frappe.utils.escape_html(data.aggregator_clarification_comments || "Please log in to the portal to review the clarification request.")}</div>
			</div>
			${data.aggregator_clarification_response ? `
			<div style="background:#f0fdf4;border-left:4px solid #22c55e;padding:12px 16px;border-radius:6px;margin-bottom:16px;">
				<div style="font-size:11px;font-weight:700;color:#166534;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Your Submitted Response</div>
				<div style="font-size:13px;color:#374151;white-space:pre-wrap;">${frappe.utils.escape_html(data.aggregator_clarification_response)}</div>
			</div>` : `
			<div>
				<label style="font-size:12px;font-weight:700;color:#374151;display:block;margin-bottom:6px;">Your Clarification Response <span style="color:#dc2626;">*</span></label>
				<textarea id="agg-clarif-response" rows="4" placeholder="Enter your response to the admin's comments…"
					style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;font-family:inherit;resize:vertical;outline:none;"></textarea>
				<button id="agg-clarif-submit" style="margin-top:10px;padding:8px 20px;background:#f59e0b;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;">
					Submit Clarification
				</button>
			</div>`}
		</div>` : ""}

		${(services && services.length) ? `
		<div class="agg-section" style="margin-bottom:24px;">
			<h5><i class="fa fa-building" style="margin-right:6px;color:#4e73df;"></i>My Registered Services</h5>
			<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;" id="svc-tabs">
					<button class="svc-tab-btn" data-idx="-1" data-svc=""
						style="padding:6px 18px;border-radius:20px;font-size:13px;font-weight:600;cursor:pointer;
						border:2px solid #aaa;background:${!_active_platform?'#555':'#fff'};color:${!_active_platform?'#fff':'#555'};">
						<i class="fa fa-th" style="font-size:10px;margin-right:4px;"></i> All Services
					</button>
				${(services || []).map((s, i) => `
					<button class="svc-tab-btn" data-idx="${i}" data-svc="${s.service_name}"
						style="padding:6px 18px;border-radius:20px;font-size:13px;font-weight:600;cursor:pointer;
						border:2px solid #4e73df;background:${_active_platform ? (_active_platform===s.service_name?'#4e73df':'#fff') : (i===0?'#4e73df':'#fff')};color:${_active_platform ? (_active_platform===s.service_name?'#fff':'#4e73df') : (i===0?'#fff':'#4e73df')};">
						<i class="fa fa-circle" style="font-size:8px;margin-right:4px;color:${s.service_status==='Active'?'#1cc88a':'#aaa'};"></i>
						${s.service_name}
					</button>`).join("")}
			</div>
			<div id="svc-detail-panel">
				${(services || []).map((s, i) => `
				<div class="svc-detail" data-idx="${i}" style="display:${_active_platform ? (_active_platform===s.service_name?'block':'none') : (i===0?'block':'none')}">
					<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;">
						<div style="background:#f8f9fa;border-radius:8px;padding:12px;">
							<div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;">Brand Name</div>
							<div style="font-size:15px;font-weight:600;margin-top:4px;">${s.brand_name || "-"}</div>
						</div>
						<div style="background:#f8f9fa;border-radius:8px;padding:12px;">
							<div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;">Company Type</div>
							<div style="font-size:15px;font-weight:600;margin-top:4px;">${s.company_type || "-"}</div>
						</div>
						<div style="background:#f8f9fa;border-radius:8px;padding:12px;">
							<div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;">Company ID</div>
							<div style="font-size:15px;font-weight:600;margin-top:4px;">${s.company_id || "-"}</div>
						</div>
						<div style="background:#f8f9fa;border-radius:8px;padding:12px;">
							<div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;">PAN</div>
							<div style="font-size:15px;font-weight:600;margin-top:4px;font-family:monospace;">${s.pan || "-"}</div>
						</div>
						<div style="background:#f8f9fa;border-radius:8px;padding:12px;">
							<div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;">GSTIN</div>
							<div style="font-size:15px;font-weight:600;margin-top:4px;font-family:monospace;">${s.gstin || "-"}</div>
						</div>
						<div style="background:#f8f9fa;border-radius:8px;padding:12px;">
							<div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;">Status</div>
							<div style="margin-top:4px;">${s.service_status === 'Active'
								? '<span style="background:#d4edda;color:#155724;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;">Active</span>'
								: '<span style="background:#f8d7da;color:#721c24;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;">Inactive</span>'}</div>
						</div>
						${s.address ? `<div style="background:#f8f9fa;border-radius:8px;padding:12px;grid-column:span 2;">
							<div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;">Registered Address</div>
							<div style="font-size:14px;font-weight:500;margin-top:4px;">${s.address}</div>
						</div>` : ""}
						${s.website_url ? `<div style="background:#f8f9fa;border-radius:8px;padding:12px;">
							<div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;">Website</div>
							<div style="margin-top:4px;"><a href="${s.website_url}" target="_blank" style="color:#4e73df;">${s.website_url}</a></div>
						</div>` : ""}
						${s.app_url ? `<div style="background:#f8f9fa;border-radius:8px;padding:12px;">
							<div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;">App URL</div>
							<div style="margin-top:4px;"><a href="${s.app_url}" target="_blank" style="color:#4e73df;">${s.app_url}</a></div>
						</div>` : ""}
					</div>
				</div>`).join("")}
			</div>
		</div>
		` : `
		<div class="agg-section" style="margin-bottom:24px;text-align:center;color:#888;padding:30px;">
			<i class="fa fa-building" style="font-size:28px;margin-bottom:8px;display:block;color:#ccc;"></i>
			No services registered yet. Please contact the admin to update your profile.
		</div>
		`}

		${_active_platform ? `
		<div style="background:#e8f4fd;border:1.5px solid #4e73df;border-radius:8px;padding:10px 18px;margin-bottom:16px;display:flex;align-items:center;gap:10px;">
			<i class="fa fa-filter" style="color:#4e73df;"></i>
			<span style="font-weight:600;color:#4e73df;">Filtered by: ${_active_platform}</span>
			<span style="font-size:12px;color:#888;margin-left:4px;">Stats and tables below show data for this service only</span>
		</div>` : ""}

		<!-- Transaction Count Cards -->
		<div style="font-size:11px;font-weight:700;color:#aaa;text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px;">
			<i class="fa fa-exchange" style="margin-right:4px;"></i> Transaction Overview
		</div>
		<div class="agg-card-row">
			<div class="agg-stat-card agg-drillable" style="--card-color:#4e73df;" data-drilldown="total_txns">
				<div class="label">Total Transactions</div>
				<div class="value">${stats.total_transactions}</div>
				<div class="sub">All time (filtered)</div>
			</div>
			<div class="agg-stat-card agg-drillable" style="--card-color:#1cc88a;" data-drilldown="completed_txns">
				<div class="label">Payment Complete</div>
				<div class="value">${stats.completed_transactions}</div>
				<div class="sub">${stats.total_transactions ? Math.round(stats.completed_transactions * 100 / stats.total_transactions) : 0}% of total</div>
			</div>
			<div class="agg-stat-card agg-drillable" style="--card-color:#f6c23e;" data-drilldown="pending_txns">
				<div class="label">Payment Pending</div>
				<div class="value">${stats.pending_transactions}</div>
				<div class="sub">Awaiting processing</div>
			</div>
			<div class="agg-stat-card agg-drillable" style="--card-color:#6c757d;" data-drilldown="cancelled_txns">
				<div class="label">Payment Cancelled</div>
				<div class="value">${stats.cancelled_transactions}</div>
			</div>
			<div class="agg-stat-card ${stats.suspected_duplicates ? 'agg-drillable' : ''}"
				style="--card-color:#e74a3b;cursor:${stats.suspected_duplicates ? 'pointer' : 'default'};"
				${stats.suspected_duplicates ? 'data-drilldown="dup_txns"' : ''}>
				<div class="label">Suspected Duplicates</div>
				<div class="value" style="color:${stats.suspected_duplicates ? '#e74a3b' : '#333'};">${stats.suspected_duplicates || 0}</div>
				<div class="sub">${stats.suspected_duplicates ? 'Click to review' : 'None flagged'}</div>
			</div>
		</div>

		<!-- Financial Amount Cards -->
		<div style="font-size:11px;font-weight:700;color:#aaa;text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px;">
			<i class="fa fa-inr" style="margin-right:4px;"></i> Financial Summary
		</div>
		<div class="agg-card-row">
			<div class="agg-stat-card agg-drillable" style="--card-color:#36b9cc;" data-drilldown="total_amount">
				<div class="label">Total Transaction Amount</div>
				<div class="value" style="font-size:20px;">${fmt_currency_compact(stats.total_amount)}</div>
				<div class="sub">${fmt_currency(stats.total_amount)}</div>
			</div>
			<div class="agg-stat-card agg-drillable" style="--card-color:#4e73df;" data-drilldown="base_payout">
				<div class="label">Total Base Payout</div>
				<div class="value" style="font-size:20px;">${fmt_currency_compact(stats.total_base_payout)}</div>
				<div class="sub">${fmt_currency(stats.total_base_payout)}</div>
			</div>
			<div class="agg-stat-card agg-drillable" style="--card-color:#1cc88a;" data-drilldown="total_welfare_collected">
				<div class="label">Total Welfare Collected</div>
				<div class="value" style="font-size:20px;">${fmt_currency_compact(stats.total_welfare)}</div>
				<div class="sub">${fmt_currency(stats.total_welfare)}</div>
			</div>
			<div class="agg-stat-card agg-drillable" style="--card-color:#28a745;" data-drilldown="welfare_settled">
				<div class="label">Welfare Fees Settled</div>
				<div class="value" style="font-size:20px;color:#28a745;">${fmt_currency_compact(welfare_payments.total_paid)}</div>
				<div class="sub">${fmt_currency(welfare_payments.total_paid)}</div>
			</div>
			<div class="agg-stat-card agg-drillable" style="--card-color:#e74a3b;" data-drilldown="welfare_pending">
				<div class="label">Welfare Fees Pending</div>
				<div class="value" style="font-size:20px;color:#e74a3b;">${fmt_currency_compact(welfare_payments.pending_amount)}</div>
				<div class="sub">${fmt_currency(welfare_payments.pending_amount)}</div>
			</div>
		</div>

		<!-- Worker Cards -->
		<div style="font-size:11px;font-weight:700;color:#aaa;text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px;">
			<i class="fa fa-users" style="margin-right:4px;"></i> Worker Summary
		</div>
		<div class="agg-card-row" style="margin-bottom:24px;">
			<div class="agg-stat-card agg-drillable" style="--card-color:#4e73df;" data-drilldown="workers_transacted">
				<div class="label">Workers Transacted</div>
				<div class="value">${workers.total}</div>
				<div class="sub">Unique workers with transactions</div>
			</div>
			<div class="agg-stat-card agg-drillable" style="--card-color:#1cc88a;" data-drilldown="onboarded_workers">
				<div class="label">Onboarded Workers</div>
				<div class="value">${workers.active}</div>
				<div class="sub">Active in mapping log</div>
			</div>
		</div>

		<!-- Analytics Charts -->
		${has_charts ? `
		<div style="font-size:11px;font-weight:700;color:#aaa;text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px;">
			<i class="fa fa-bar-chart" style="margin-right:4px;"></i> Analytics
		</div>
		<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px;margin-bottom:24px;">
			${(monthly_trend && monthly_trend.length) ? `
			<div class="agg-section" style="margin-bottom:0;padding-bottom:8px;">
				<h5>
					<i class="fa fa-bar-chart" style="color:#4e73df;margin-right:6px;"></i>
					Monthly Transactions
					<span style="float:right;font-size:12px;font-weight:400;color:#aaa;">Last 12 months</span>
				</h5>
				<div id="agg-trend-chart"></div>
				<p id="agg-trend-empty" style="text-align:center;color:#ccc;font-size:12px;display:none;padding:40px 0;margin:0;"></p>
				<div style="display:flex;gap:16px;font-size:11px;color:#666;margin-top:6px;">
					<span><span style="display:inline-block;width:10px;height:10px;background:#4e73df;border-radius:2px;margin-right:4px;"></span>Completed</span>
					<span><span style="display:inline-block;width:10px;height:10px;background:#c7d5f8;border-radius:2px;margin-right:4px;"></span>Total</span>
				</div>
			</div>` : ""}
			${(monthly_trend && monthly_trend.length) ? `
			<div class="agg-section" style="margin-bottom:0;padding-bottom:8px;">
				<h5>
					<i class="fa fa-line-chart" style="color:#36b9cc;margin-right:6px;"></i>
					Monthly Amount Trend
					<span style="float:right;font-size:12px;font-weight:400;color:#aaa;">Last 12 months</span>
				</h5>
				<div id="agg-welfare-trend-chart"></div>
				<p id="agg-welfare-trend-empty" style="text-align:center;color:#ccc;font-size:12px;display:none;padding:40px 0;margin:0;"></p>
				<div style="display:flex;gap:16px;font-size:11px;color:#666;margin-top:6px;">
					<span><span style="display:inline-block;width:10px;height:10px;background:#36b9cc;border-radius:2px;margin-right:4px;"></span>Total Amount</span>
					<span><span style="display:inline-block;width:10px;height:10px;background:#1cc88a;border-radius:2px;margin-right:4px;"></span>Welfare</span>
				</div>
			</div>` : ""}
			${(svc_cat_breakdown && svc_cat_breakdown.length) ? `
			<div class="agg-section" style="margin-bottom:0;padding-bottom:8px;">
				<h5>
					<i class="fa fa-pie-chart" style="color:#36b9cc;margin-right:6px;"></i>
					By Service Category
					<span style="float:right;font-size:12px;font-weight:400;color:#aaa;">Transaction count</span>
				</h5>
				<div id="agg-svc-cat-chart"></div>
				<p id="agg-svc-cat-empty" style="text-align:center;color:#ccc;font-size:12px;display:none;padding:40px 0;margin:0;"></p>
			</div>` : ""}
			${(status_breakdown && status_breakdown.length) ? `
			<div class="agg-section" style="margin-bottom:0;padding-bottom:8px;">
				<h5>
					<i class="fa fa-pie-chart" style="color:#36b9cc;margin-right:6px;"></i>
					Payment Status
					<span style="float:right;font-size:12px;font-weight:400;color:#aaa;">Current filter</span>
				</h5>
				<div id="agg-status-chart"></div>
				<p id="agg-status-empty" style="text-align:center;color:#ccc;font-size:12px;display:none;padding:40px 0;margin:0;"></p>
			</div>` : ""}
		</div>
		` : ""}

		<!-- Quarterly Invoices -->
		${render_quarterly_invoices(quarterly_invoices, invoice_summary)}

		<!-- Service Category Breakdown Table + Top Workers side by side -->
		${(svc_cat_breakdown && svc_cat_breakdown.length) || (top_workers && top_workers.length) ? `
		<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px;margin-bottom:24px;">
			${(svc_cat_breakdown && svc_cat_breakdown.length) ? `
			<div class="agg-section" style="margin-bottom:0;">
				<h5><i class="fa fa-th-list" style="color:#36b9cc;margin-right:6px;"></i>Service Category Breakdown</h5>
				${render_svc_cat_table(svc_cat_breakdown)}
			</div>` : ""}
			${(top_workers && top_workers.length) ? render_top_workers(top_workers).replace('<div class="agg-section" style="margin-bottom:24px;">', '<div class="agg-section" style="margin-bottom:0;">') : ""}
		</div>` : ""}

		<!-- Transactions Table -->
		<div class="agg-section">
			<h5>All Transactions
				<a href="/app/gig-transaction" style="float:right;font-size:13px;font-weight:500;color:#4e73df;">View All</a>
			</h5>
			<table id="agg-txn-table" class="display" style="width:100%">
				<thead><tr>
					<th>Transaction ID</th><th>Date</th><th>Gig Worker</th><th>Service</th><th>Service Category</th>
					<th>Amount</th><th>Base Payout</th><th>Welfare</th><th>Status</th>
				</tr></thead>
				<tbody>
					${recent_transactions.map(t => `<tr>
						<td><a href="/app/gig-transaction/${t.name}" style="color:#4e73df;">${t.name}</a></td>
						<td>${t.date || "-"}</td>
						<td>${t.gig_worker || "-"}</td>
						<td>${t.service || "-"}</td>
						<td>${t.service_category || "-"}</td>
						<td>${fmt_currency(t.amount)}</td>
						<td>${fmt_currency(t.base_payout)}</td>
						<td>${fmt_currency(t.welfare_amount)}</td>
						<td>${status_badge(t.status)}</td>
					</tr>`).join("")}
				</tbody>
			</table>
		</div>

		<!-- Pending Welfare Fee Payments Table -->
		<div class="agg-section">
			<h5>Pending Welfare Fee Payments
				<a href="/app/welfare-fee-payment" style="float:right;font-size:13px;font-weight:500;color:#4e73df;">View All</a>
			</h5>
			<table id="agg-wfp-table" class="display" style="width:100%">
				<thead><tr>
					<th>Payment ID</th><th>Transaction</th><th>Fee Amount</th>
					<th>Due Date</th><th>Status</th>
				</tr></thead>
				<tbody>
					${pending_wfp.length ? pending_wfp.map(p => `<tr>
						<td><a href="/app/welfare-fee-payment/${p.name}" style="color:#4e73df;">${p.name}</a></td>
						<td>${p.transaction || "-"}</td>
						<td class="highlight">${fmt_currency(p.fee_amount)}</td>
						<td>${p.payment_date || "-"}</td>
						<td>${status_badge(p.payment_status)}</td>
					</tr>`).join("") : ""}
				</tbody>
			</table>
		</div>

		${(suspected_dups && suspected_dups.length) ? `
		<!-- Suspected Duplicate Transactions (read-only) -->
		<div class="agg-section" id="agg-dup-section" style="border-left:4px solid #f6c23e;">
			<h5 style="color:#856404;">
				<i class="fa fa-exclamation-triangle" style="margin-right:6px;"></i>
				Suspected Duplicate Transactions
				<span style="float:right;font-size:12px;font-weight:400;color:#888;">
					Read-only — admin will review and take action
				</span>
			</h5>
			<table id="agg-dup-table" class="display" style="width:100%">
				<thead><tr>
					<th>Transaction ID</th><th>Date</th><th>Gig Worker</th>
					<th>Service</th><th>Service Category</th><th>Amount</th><th>Welfare</th><th>Matches</th>
				</tr></thead>
				<tbody>
					${suspected_dups.map(d => `<tr>
						<td><a href="/app/gig-transaction/${d.name}" style="color:#4e73df;">${d.name}</a></td>
						<td>${d.date || "-"}</td>
						<td>${d.gig_worker || "-"}</td>
						<td>${d.service || "-"}</td>
						<td>${d.service_category || "-"}</td>
						<td style="color:#e74a3b;font-weight:600;">${fmt_currency(d.amount)}</td>
						<td>${fmt_currency(d.welfare_amount)}</td>
						<td style="font-size:12px;">
							${d.duplicate_of
								? `<a href="/app/gig-transaction/${d.duplicate_of}" style="color:#4e73df;">${d.duplicate_of}</a>`
								: `<span style="color:#aaa;">—</span>`}
						</td>
					</tr>`).join("")}
				</tbody>
			</table>
		</div>
		` : ""}

		<!-- Drill-down modal overlay -->
		<div id="agg-dd-overlay">
			<div id="agg-dd-modal">
				<div id="agg-dd-header">
					<div>
						<div id="agg-dd-title"></div>
						<div id="agg-dd-count"></div>
					</div>
					<button id="agg-dd-close" title="Close (Esc)">&#10005;</button>
				</div>
				<div id="agg-dd-body">
					<div id="agg-dd-summary" style="display:none;"></div>
					<div id="agg-dd-chart-wrap" style="display:none;">
						<h6>Chart</h6>
						<div id="agg-dd-chart"></div>
					</div>
					<div id="agg-dd-table-wrap">
						<h6>Detail Records</h6>
						<table id="agg-dd-dt-table" class="display" style="width:100%"></table>
					</div>
				</div>
			</div>
		</div>
		`;

		$("#agg-dashboard").html(html);

		// Initialize DataTables
		init_datatable("#agg-txn-table");
		init_datatable("#agg-wfp-table");
		if (suspected_dups && suspected_dups.length) {
			init_datatable("#agg-dup-table");
		}

		// Initialize standalone charts
		init_agg_charts(data);

		// Bind drill-down modal events
		bind_agg_drilldown(data);

		$("#agg-btn-dl-pdf").on("click", download_pdf);

		// Service tab switching
		$(document).off("click.svctab").on("click.svctab", ".svc-tab-btn", function () {
			const idx = $(this).data("idx");
			const svc = $(this).data("svc");
			$(".svc-tab-btn[data-idx='-1']").css({ background: "#fff", color: "#555" });
			$(".svc-tab-btn:not([data-idx='-1'])").css({ background: "#fff", color: "#4e73df" });
			if (idx === -1) { $(this).css({ background: "#555", color: "#fff" }); }
			else { $(this).css({ background: "#4e73df", color: "#fff" }); }
			$(".svc-detail").hide();
			if (idx !== -1) $(`.svc-detail[data-idx="${idx}"]`).show();
			_active_platform = svc || "";
			fetch_dashboard();
		});

		// Clarification submit
		$("#agg-clarif-submit").on("click", function () {
			const response = $("#agg-clarif-response").val().trim();
			if (!response) {
				frappe.msgprint("Please enter your clarification response before submitting.");
				return;
			}
			frappe.call({
				method: "frappe.client.set_value",
				args: {
					doctype: "Aggregator",
					name: data.aggregator_id,
					fieldname: "clarification_response",
					value: response,
				},
				callback() {
					frappe.show_alert({ message: "Clarification submitted. Your application is back under review.", indicator: "green" });
					fetch_dashboard();
				},
			});
		});

		// Filter events
		$("#agg-btn-apply-filter").on("click", function () {
			_active_from    = $("#agg-filter-from").val() || "";
			_active_to      = $("#agg-filter-to").val() || "";
			_active_svc_cat = $("#agg-filter-cat").val() || "";
			fetch_dashboard();
		});
		$("#agg-btn-clear-filter").on("click", function () {
			_active_from = ""; _active_to = ""; _active_svc_cat = ""; _active_platform = "";
			fetch_dashboard();
		});
	}
};
