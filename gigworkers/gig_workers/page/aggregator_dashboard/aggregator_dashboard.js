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
	let _active_svc_cat  = [];   // array — multiselect
	let _dd_stack_type   = null; // last open_drilldown() type, for the worker-detail "Back" button

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
				aggregator_override: _agg_override },
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

	function worker_link(id) {
		if (!id) return "-";
		return `<a href="javascript:void(0)" class="agg-worker-link" data-worker="${id}">${id}</a>`;
	}

	function txn_link(id) {
		if (!id) return "-";
		return `<a href="javascript:void(0)" class="agg-worker-link" data-txn="${id}">${id}</a>`;
	}

	// ── CSV export ───────────────────────────────────────────────────────────

	function csv_escape(v) {
		const s = String(v == null ? "" : v);
		return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
	}

	function strip_html(html) {
		return $("<div>").html(html == null ? "" : String(html)).text().trim();
	}

	function export_rows_csv(filename, cols, rows) {
		if (!cols || !cols.length || !rows || !rows.length) return;
		const lines = [cols.map(c => csv_escape(c.label)).join(",")];
		rows.forEach(row => {
			lines.push(cols.map(c => csv_escape(c.csv ? c.csv(row) : strip_html(c.render(row)))).join(","));
		});
		const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `${filename.replace(/[^a-z0-9]+/gi, "_")}_${today_str()}.csv`;
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
	}

	// ── Standalone charts ────────────────────────────────────────────────────

	const STATUS_COLORS = {
		'Payment complete': '#1cc88a', 'Payment pending': '#4e73df',
		'Payment Cancelled': '#e74a3b', 'Suspected duplicate': '#f6c23e',
		Pending: '#f6c23e', Active: '#1cc88a',
	};

	const CAT_COLORS = ['#4e73df','#1cc88a','#36b9cc','#f6c23e','#e74a3b','#858796','#5a5c69','#2e59d9','#17a673','#2c9faf'];

	const WORKER_STATUS_COLORS = {
		Active: '#1cc88a', Onboarded: '#1cc88a', Inactive: '#e74a3b',
		Offboarded: '#6c757d', Deceased: '#343a40', Pending: '#f6c23e',
	};

	function init_agg_charts(data) {
		const { monthly_trend, status_breakdown, svc_cat_breakdown, worker_status_breakdown } = data;

		// Worker Status Donut
		if (worker_status_breakdown && worker_status_breakdown.length && frappe && frappe.Chart) {
			try {
				$("#agg-worker-status-empty").hide();
				new frappe.Chart("#agg-worker-status-chart", {
					type: "donut",
					data: {
						labels: worker_status_breakdown.map(r => r.worker_status || "Unknown"),
						datasets: [{ values: worker_status_breakdown.map(r => r.cnt) }],
					},
					height: 200,
					colors: worker_status_breakdown.map(r => WORKER_STATUS_COLORS[r.worker_status] || "#858796"),
				});
			} catch (e) {
				$("#agg-worker-status-empty").show().text("Chart unavailable");
			}
		} else {
			$("#agg-worker-status-empty").show().text("No worker status data yet");
		}

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
					height: 270,
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
					height: 270,
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
		const { recent_transactions, worker_list, aggregator_workers, pending_wfp, suspected_dups, top_workers } = data;

		const txn_cols = [
			{ label: "Transaction ID", render: t => txn_link(t.name), csv: t => t.name },
			{ label: "Date",           render: t => t.date || "-" },
			{ label: "Gig Worker",     render: t => worker_link(t.gig_worker), csv: t => t.gig_worker || "-" },
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
				title: "All Workers",
				rows: () => aggregator_workers || [],
				cols: [
					{ label: "Worker ID",     render: w => worker_link(w.name), csv: w => w.name },
					{ label: "Name",          render: w => w.worker_name || "-" },
					{ label: "Phone",         render: w => w.phone || "-" },
					{ label: "Service",       render: w => w.name_of_service || "-" },
					{ label: "Status",        render: w => status_badge(w.status) },
					{ label: "Registered On", render: w => (w.creation || "").substring(0, 10) },
				],
				summary: rows => [{ label: "Total Workers", value: rows.length, color: "#4e73df" }],
				chart: rows => {
					const sc = {};
					rows.forEach(w => { const s = w.status || "Unknown"; sc[s] = (sc[s] || 0) + 1; });
					const labels = Object.keys(sc);
					if (!labels.length) return null;
					return { type: "donut", data: { labels, datasets: [{ values: labels.map(l => sc[l]) }] }, colors: labels.map(l => WORKER_STATUS_COLORS[l] || "#858796") };
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

		let _dd_export_cols = null;
		let _dd_export_rows = null;
		let _dd_export_title = "export";

		function destroy_dd_table() {
			$("#agg-dd-body table.dataTable").each(function () {
				if ($.fn.DataTable.isDataTable(this)) $(this).DataTable().destroy();
			});
		}

		function reset_table_wrap() {
			$("#agg-dd-table-wrap").html('<h6>Detail Records</h6><table id="agg-dd-dt-table" class="display" style="width:100%"></table>');
		}

		function render_dd_table(cols, rows, empty_msg) {
			if (cols && cols.length) {
				const thead = `<thead><tr>${cols.map(c => `<th>${c.label}</th>`).join("")}</tr></thead>`;
				const tbody_html = rows.length
					? rows.map(row => `<tr>${cols.map(c => `<td>${c.render(row)}</td>`).join("")}</tr>`).join("")
					: `<tr><td colspan="${cols.length}" style="text-align:center;color:#aaa;padding:24px;">${empty_msg || "No records found"}</td></tr>`;
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
		}

		function open_drilldown(type) {
			const cfg = configs[type];
			if (!cfg) return;
			const rows = cfg.rows();

			destroy_dd_table();
			reset_table_wrap();

			$("#agg-dd-title").text(cfg.title);
			$("#agg-dd-count").text(`${rows.length} record${rows.length !== 1 ? "s" : ""}`);
			$("#agg-dd-back").hide();

			render_dd_summary(cfg.summary ? cfg.summary(rows) : null);
			render_dd_chart(rows.length && cfg.chart ? cfg.chart(rows) : null);
			render_dd_table(cfg.cols, rows);

			_dd_export_cols = cfg.cols;
			_dd_export_rows = rows;
			_dd_export_title = cfg.title;
			$("#agg-dd-export-csv").toggle(!!(cfg.cols && cfg.cols.length && rows.length));

			_dd_stack_type = type;
			$("#agg-dd-overlay").addClass("active");
			$("#agg-dd-body").scrollTop(0);
		}

		function open_worker_detail(gig_worker, return_type) {
			$("#agg-dd-title").text(`Worker Profile — ${gig_worker}`);
			$("#agg-dd-count").text("Loading…");
			$("#agg-dd-back").toggle(!!return_type);
			$("#agg-dd-export-csv").hide();
			$("#agg-dd-summary").hide();
			$("#agg-dd-chart-wrap").hide();
			destroy_dd_table();
			$("#agg-dd-dt-table").html('<tbody><tr><td style="text-align:center;padding:30px;color:#aaa;"><i class="fa fa-spinner fa-spin"></i> Loading worker profile…</td></tr></tbody>');
			_dd_stack_type = return_type || null;

			$("#agg-dd-overlay").addClass("active");
			$("#agg-dd-body").scrollTop(0);

			frappe.call({
				method: "gigworkers.gig_workers.page.aggregator_dashboard.aggregator_dashboard.get_worker_detail",
				args: { gig_worker, aggregator_override: _agg_override },
				callback(r) {
					if (r.message) render_worker_detail(r.message);
				},
				error() {
					$("#agg-dd-count").text("Failed to load");
				},
			});
		}

		function render_worker_detail(d) {
			const w = d.worker_info || {};
			$("#agg-dd-title").text(`Worker Profile — ${w.worker_name || d.gig_worker}`);
			$("#agg-dd-count").text(d.gig_worker);

			render_dd_summary([
				{ label: "Total Transactions", value: d.summary.total_transactions, color: "#4e73df" },
				{ label: "Completed", value: d.summary.completed_transactions, color: "#1cc88a" },
				{ label: "Total Amount", value: fmt_currency(d.summary.total_amount) },
				{ label: "Total Welfare", value: fmt_currency(d.summary.total_welfare), color: "#1cc88a" },
				{ label: "Current Status", value: d.summary.current_status || "-" },
			]);
			render_dd_chart(null);

			const worker_txn_cols = [
				{ label: "Transaction ID", render: t => txn_link(t.name), csv: t => t.name },
				{ label: "Date", render: t => t.date || "-" },
				{ label: "Service", render: t => t.service || "-" },
				{ label: "Service Category", render: t => t.service_category || "-" },
				{ label: "Amount", render: t => fmt_currency(t.amount) },
				{ label: "Welfare", render: t => fmt_currency(t.welfare_amount) },
				{ label: "Status", render: t => status_badge(t.status) },
			];

			const profile_html = `
				<div style="background:#fff;border-radius:10px;padding:14px 18px;box-shadow:0 1px 6px rgba(0,0,0,0.07);margin-bottom:16px;
					display:flex;flex-wrap:wrap;gap:20px;">
					<div><div style="font-size:11px;color:#aaa;text-transform:uppercase;">Worker ID</div><div style="font-weight:700;">${d.gig_worker}</div></div>
					${w.worker_name ? `<div><div style="font-size:11px;color:#aaa;text-transform:uppercase;">Name</div><div style="font-weight:700;">${w.worker_name}</div></div>` : ""}
					${w.phone ? `<div><div style="font-size:11px;color:#aaa;text-transform:uppercase;">Phone</div><div style="font-weight:700;">${w.phone}</div></div>` : ""}
					${w.status ? `<div><div style="font-size:11px;color:#aaa;text-transform:uppercase;">Profile Status</div><div>${status_badge(w.status)}</div></div>` : ""}
				</div>`;

			destroy_dd_table();
			$("#agg-dd-table-wrap").html(`
				${profile_html}
				<h6>Transaction History</h6>
				<table id="agg-dd-dt-table" class="display" style="width:100%"></table>
				<h6 style="margin-top:18px;">Worker Mapping Log</h6>
				<table id="agg-dd-worker-log" class="display" style="width:100%"></table>
			`);
			render_dd_table(worker_txn_cols, d.transactions || [], "No transactions for this worker yet.");

			const log_cols = [
				{ label: "Service", render: l => l.service || "-" },
				{ label: "Event", render: l => l.event_type || "-" },
				{ label: "Worker Status", render: l => status_badge(l.worker_status) },
				{ label: "Logged At", render: l => (l.log_datetime || "").substring(0, 16) },
			];
			const log_rows = d.mapping_log || [];
			const log_thead = `<thead><tr>${log_cols.map(c => `<th>${c.label}</th>`).join("")}</tr></thead>`;
			const log_tbody = log_rows.length
				? log_rows.map(r => `<tr>${log_cols.map(c => `<td>${c.render(r)}</td>`).join("")}</tr>`).join("")
				: `<tr><td colspan="${log_cols.length}" style="text-align:center;color:#aaa;padding:20px;">No mapping log entries.</td></tr>`;
			$("#agg-dd-worker-log").html(`${log_thead}<tbody>${log_tbody}</tbody>`);
			if (log_rows.length && $.fn.DataTable) {
				$("#agg-dd-worker-log").DataTable({
					pageLength: 10, lengthMenu: [5, 10, 25, 50], order: [],
					language: { search: "Filter:", lengthMenu: "Show _MENU_ entries", info: "Showing _START_ to _END_ of _TOTAL_ records", emptyTable: "No records found" },
					dom: '<"dt-top"lf>rt<"dt-bottom"ip>',
				});
			}

			_dd_export_cols = worker_txn_cols;
			_dd_export_rows = d.transactions || [];
			_dd_export_title = `worker_${d.gig_worker}_transactions`;
			$("#agg-dd-export-csv").toggle(!!(d.transactions && d.transactions.length));
		}

		function open_transaction_detail(transaction, return_type) {
			$("#agg-dd-title").text(`Transaction — ${transaction}`);
			$("#agg-dd-count").text("Loading…");
			$("#agg-dd-back").toggle(!!return_type);
			$("#agg-dd-export-csv").hide();
			$("#agg-dd-summary").hide();
			$("#agg-dd-chart-wrap").hide();
			destroy_dd_table();
			reset_table_wrap();
			$("#agg-dd-table-wrap").html('<div style="text-align:center;padding:30px;color:#aaa;"><i class="fa fa-spinner fa-spin"></i> Loading transaction details…</div>');
			_dd_stack_type = return_type || null;

			$("#agg-dd-overlay").addClass("active");
			$("#agg-dd-body").scrollTop(0);

			frappe.call({
				method: "gigworkers.gig_workers.page.aggregator_dashboard.aggregator_dashboard.get_transaction_detail",
				args: { transaction, aggregator_override: _agg_override },
				callback(r) {
					if (r.message) render_transaction_detail(r.message);
				},
				error() {
					$("#agg-dd-count").text("Failed to load");
				},
			});
		}

		function render_transaction_detail(d) {
			const t = d.transaction || {};
			$("#agg-dd-title").text(`Transaction — ${t.name}`);
			$("#agg-dd-count").text(t.service_category ? t.service_category : "");

			render_dd_summary([
				{ label: "Amount", value: fmt_currency(t.amount), color: "#36b9cc" },
				{ label: "Base Payout", value: fmt_currency(t.base_payout) },
				{ label: "Welfare", value: fmt_currency(t.welfare_amount), color: "#1cc88a" },
				{ label: "Net Payout to Worker", value: fmt_currency(t.net_payout_to_worker) },
			]);
			render_dd_chart(null);

			function field(label, value) {
				if (value === null || value === undefined || value === "") return "";
				return `<div style="background:#f8f9fa;border-radius:8px;padding:12px;">
					<div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;">${label}</div>
					<div style="font-size:14px;font-weight:600;margin-top:4px;">${value}</div>
				</div>`;
			}

			const grid = `
				<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px;margin-bottom:20px;">
					${field("Gig Worker", worker_link(t.gig_worker))}
					${field("Service", t.service)}
					${field("Service Category", t.service_category)}
					${field("Service Type", t.service_type)}
					${field("Role", t.role)}
					${field("Date", t.date)}
					${field("Transaction Date", t.transaction_date)}
					${field("Status", status_badge(t.status))}
					${field("Status of Order", t.status_of_order)}
					${field("Settlement Status", t.settlement_status)}
					${field("External Transaction ID", t.external_transaction_id)}
					${field("Incentives", t.incentives != null ? fmt_currency(t.incentives) : null)}
					${field("Welfare %", t.welfare_percentage != null ? t.welfare_percentage + "%" : null)}
					${field("Welfare Cap", t.welfare_cap != null ? fmt_currency(t.welfare_cap) : null)}
					${field("Deduction", t.deduction != null ? fmt_currency(t.deduction) : null)}
					${field("District", t.district)}
					${field("City", t.city)}
					${field("Adjustment Count", t.adjustment_count)}
					${field("Suspected Duplicate", t.suspected_duplicate ? "Yes" : null)}
					${field("Duplicate Of", t.duplicate_of ? txn_link(t.duplicate_of) : null)}
					${field("Confirmed At", t.confirmed_at)}
					${field("Created", t.creation ? String(t.creation).substring(0, 16) : null)}
					${field("Last Modified", t.modified ? String(t.modified).substring(0, 16) : null)}
				</div>`;

			const wfp_cols = [
				{ label: "Payment ID", render: p => `<a href="/app/welfare-fee-payment/${p.name}" style="color:#4e73df;">${p.name}</a>`, csv: p => p.name },
				{ label: "Fee Amount", render: p => fmt_currency(p.fee_amount) },
				{ label: "Due Date", render: p => p.payment_date || "-" },
				{ label: "Status", render: p => status_badge(p.payment_status) },
				{ label: "Settlement Status", render: p => p.settlement_status || "-" },
				{ label: "Mode", render: p => p.mode_of_payment || "-" },
			];
			const wfp_rows = d.welfare_payments || [];

			destroy_dd_table();
			$("#agg-dd-table-wrap").html(`
				<h6>Transaction Details</h6>
				${grid}
				<h6>Linked Welfare Fee Payments</h6>
				<table id="agg-dd-dt-table" class="display" style="width:100%"></table>
			`);
			render_dd_table(wfp_cols, wfp_rows, "No welfare fee payments linked to this transaction.");

			_dd_export_cols = wfp_cols;
			_dd_export_rows = wfp_rows;
			_dd_export_title = `transaction_${t.name}_welfare_payments`;
			$("#agg-dd-export-csv").toggle(!!wfp_rows.length);
		}

		function close_drilldown() {
			destroy_dd_table();
			reset_table_wrap();
			$("#agg-dd-overlay").removeClass("active");
			_dd_stack_type = null;
		}

		$(document).off("click.agg_drilldown").off("keydown.agg_drilldown");
		$("#agg-dashboard").off("click.agg_drilldown").off("click.agg_worker_link").off("click.agg_txn_link");

		$("#agg-dashboard").on("click.agg_drilldown", ".agg-drillable[data-drilldown]", function () {
			open_drilldown($(this).data("drilldown"));
		});

		$("#agg-dashboard").on("click.agg_worker_link", ".agg-worker-link[data-worker]", function (e) {
			e.stopPropagation();
			open_worker_detail($(this).data("worker"), _dd_stack_type);
		});

		$("#agg-dashboard").on("click.agg_txn_link", ".agg-worker-link[data-txn]", function (e) {
			e.stopPropagation();
			open_transaction_detail($(this).data("txn"), _dd_stack_type);
		});

		$("#agg-dd-back").on("click", function () {
			if (_dd_stack_type) open_drilldown(_dd_stack_type);
		});

		$("#agg-dd-export-csv").on("click", function () {
			export_rows_csv(_dd_export_title, _dd_export_cols, _dd_export_rows);
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
		const selected_cats = active_filters.service_category || [];
		const cat_opts = (service_categories || []).map(c => {
			const checked = selected_cats.includes(c) ? "checked" : "";
			return `<label class="agg-ms-opt"><input type="checkbox" class="agg-ms-checkbox" value="${c}" ${checked}> ${c}</label>`;
		}).join("");
		const has_filter = active_filters.from_date || active_filters.to_date || selected_cats.length;
		const cat_summary = !selected_cats.length ? "All Services"
			: selected_cats.length === 1 ? selected_cats[0]
			: `${selected_cats.length} categories selected`;
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
			<div style="flex:1;min-width:200px;position:relative;">
				<label style="font-size:12px;font-weight:600;color:#555;display:block;margin-bottom:4px;">Service Category</label>
				<button type="button" id="agg-ms-toggle"
					style="width:100%;text-align:left;padding:7px 10px;border:1px solid #d1d3e2;border-radius:6px;
						font-size:13px;background:#fff;cursor:pointer;display:flex;justify-content:space-between;align-items:center;">
					<span id="agg-ms-summary" style="color:${selected_cats.length ? '#333' : '#888'};">${cat_summary}</span>
					<i class="fa fa-chevron-down" style="font-size:10px;color:#aaa;"></i>
				</button>
				<div id="agg-ms-panel" style="display:none;position:absolute;top:100%;left:0;right:0;margin-top:4px;
					background:#fff;border:1px solid #d1d3e2;border-radius:8px;box-shadow:0 6px 18px rgba(0,0,0,0.15);
					z-index:50;max-height:260px;overflow-y:auto;">
					<label class="agg-ms-opt" style="border-bottom:1px solid #eee;font-weight:600;">
						<input type="checkbox" id="agg-ms-select-all" ${service_categories && service_categories.length && selected_cats.length === service_categories.length ? "checked" : ""}> Select All
					</label>
					${cat_opts || '<div style="padding:10px 14px;color:#aaa;font-size:12px;">No categories yet</div>'}
				</div>
			</div>
			<div style="display:flex;gap:8px;align-items:flex-end;">
				<button id="agg-btn-apply-filter"
					style="background:#e74a3b;color:#fff;border:none;border-radius:6px;
						padding:8px 20px;font-size:13px;cursor:pointer;font-weight:600;">
					<i class="fa fa-search" style="margin-right:5px;"></i>Apply
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
				${selected_cats.length ? ` &mdash; Service: <b style="color:#e74a3b;">${selected_cats.join(", ")}</b>` : ""}
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
				<td>${worker_link(w.gig_worker)}</td>
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
			service_category_list, monthly_trend, status_breakdown,
			svc_cat_breakdown, worker_status_breakdown, top_workers,
			quarterly_invoices, invoice_summary } = data;

		const has_charts = (monthly_trend && monthly_trend.length) || (status_breakdown && status_breakdown.length)
			|| (worker_status_breakdown && worker_status_breakdown.length) || (svc_cat_breakdown && svc_cat_breakdown.length);

		const html = `
		<style>
			#agg-dashboard { background: #f3f5fb; border-radius: 14px; }
			.agg-card-row { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 14px; }
			.agg-stat-card {
				flex: 1; min-width: 130px; background: #fff; border-radius: 10px;
				padding: 12px 13px; box-shadow: 0 1px 2px rgba(23,26,45,0.04), 0 4px 10px rgba(23,26,45,0.05);
				border-left: 3px solid var(--card-color, #4e73df);
				transition: box-shadow .15s;
			}
			.agg-stat-card .label { font-size: 10px; color: #8a8fa3; text-transform: uppercase; letter-spacing: .4px; font-weight: 600; }
			.agg-stat-card .value { font-size: 19px; font-weight: 700; color: #2b2d3e; margin-top: 4px; line-height: 1.15; }
			.agg-stat-card .sub { font-size: 10.5px; color: #a7abbd; margin-top: 2px; }
			.agg-stat-card.agg-drillable {
				cursor: pointer;
				transition: transform .15s, box-shadow .15s;
				position: relative;
			}
			.agg-stat-card.agg-drillable:hover {
				transform: translateY(-2px);
				box-shadow: 0 6px 18px rgba(23,26,45,0.11);
			}
			.agg-stat-card.agg-drillable::after {
				content: "↗";
				position: absolute; top: 8px; right: 10px;
				font-size: 12px; color: #e2e4ee; transition: color .15s;
			}
			.agg-stat-card.agg-drillable:hover::after { color: var(--card-color, #4e73df); }
			.agg-section {
				background: #fff; border-radius: 12px; padding: 18px 20px;
				box-shadow: 0 1px 2px rgba(23,26,45,0.04), 0 4px 12px rgba(23,26,45,0.05); margin-bottom: 20px;
			}
			.agg-section h5 { font-weight: 700; margin-bottom: 14px; color: #333546; font-size: 14.5px; border-bottom: 1px solid #f0f1f6; padding-bottom: 10px; }
			.agg-section-label {
				font-size: 11px; font-weight: 700; color: #9297ab; text-transform: uppercase;
				letter-spacing: .7px; margin: 22px 0 10px; display: flex; align-items: center; gap: 6px;
			}
			.agg-profile {
				display: flex; align-items: center; gap: 16px; margin-bottom: 20px; background:#fff;
				border-radius:12px; padding:16px 20px; box-shadow: 0 1px 2px rgba(23,26,45,0.04), 0 4px 12px rgba(23,26,45,0.05);
			}
			.agg-avatar { width: 48px; height: 48px; border-radius: 50%; background: linear-gradient(135deg,#e74a3b,#f6685c); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 700; flex-shrink:0; }
			.agg-profile-info .name { font-size: 18px; font-weight: 700; color: #2b2d3e; }
			.agg-profile-info .meta { font-size: 12.5px; color: #8a8fa3; margin-top: 4px; display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
			.highlight { color: #e74a3b; font-weight: 700; }
			.dt-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
			.dt-bottom { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; }
			table.dataTable thead th { background: #f8f9fc; color: #666a7d; font-weight: 600; }
			table.dataTable tbody tr:hover td { background: #fafbfd; }
			table.dataTable { font-size: 12.5px; }
			.agg-section-row { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
			.agg-section-row > .agg-section { margin-bottom: 0; }
			.agg-ms-opt { display: flex; align-items: center; gap: 8px; padding: 8px 14px; font-size: 13px; color: #333; cursor: pointer; margin: 0; }
			.agg-ms-opt:hover { background: #f8f9fa; }
			.agg-worker-link { color: #4e73df; text-decoration: underline; cursor: pointer; }
			.agg-worker-link:hover { color: #224abe; }
			.agg-cat-chip:hover { opacity: .85; }

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
			#agg-dd-back {
				background: #f5f5f5; border: none; font-size: 15px; color: #555; width: 30px; height: 30px;
				border-radius: 50%; cursor: pointer; flex-shrink: 0; margin-top: 1px;
			}
			#agg-dd-back:hover { background: #e9e9e9; color: #333; }
			#agg-dd-export-csv {
				background: #fff; border: 1px solid #1cc88a; color: #1cc88a; border-radius: 6px;
				padding: 6px 14px; font-size: 12px; font-weight: 600; cursor: pointer;
			}
			#agg-dd-export-csv:hover { background: #1cc88a; color: #fff; }
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
					${(service_category_list && service_category_list.length) ? `<span style="color:#4e73df;font-weight:600;"><i class="fa fa-building" style="margin-right:4px;"></i>${service_category_list.length} Service Categor${service_category_list.length > 1 ? "ies" : "y"}</span>` : ""}
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

		<div class="agg-section" style="margin-bottom:20px;">
			<h5><i class="fa fa-building" style="margin-right:6px;color:#4e73df;"></i>Company Profile</h5>
			<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px;">
				<div style="background:#f8f9fc;border-radius:8px;padding:12px;">
					<div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;">Company Type</div>
					<div style="font-size:14px;font-weight:600;margin-top:4px;">${aggregator.company_type || "-"}</div>
				</div>
				<div style="background:#f8f9fc;border-radius:8px;padding:12px;">
					<div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;">Company ID</div>
					<div style="font-size:14px;font-weight:600;margin-top:4px;">${aggregator.company_id || "-"}</div>
				</div>
				<div style="background:#f8f9fc;border-radius:8px;padding:12px;">
					<div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;">CIN Number</div>
					<div style="font-size:14px;font-weight:600;margin-top:4px;font-family:monospace;">${aggregator.cin_number || "-"}</div>
				</div>
				<div style="background:#f8f9fc;border-radius:8px;padding:12px;">
					<div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;">PAN</div>
					<div style="font-size:14px;font-weight:600;margin-top:4px;font-family:monospace;">${aggregator.pan_number || "-"}</div>
				</div>
				<div style="background:#f8f9fc;border-radius:8px;padding:12px;">
					<div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;">GSTIN</div>
					<div style="font-size:14px;font-weight:600;margin-top:4px;font-family:monospace;">${aggregator.gstin || "-"}</div>
				</div>
				${aggregator.website_url ? `<div style="background:#f8f9fc;border-radius:8px;padding:12px;">
					<div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;">Website</div>
					<div style="margin-top:4px;"><a href="${aggregator.website_url}" target="_blank" style="color:#4e73df;">${aggregator.website_url}</a></div>
				</div>` : ""}
				${aggregator.app_url ? `<div style="background:#f8f9fc;border-radius:8px;padding:12px;">
					<div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;">App URL</div>
					<div style="margin-top:4px;"><a href="${aggregator.app_url}" target="_blank" style="color:#4e73df;">${aggregator.app_url}</a></div>
				</div>` : ""}
				${aggregator.registered_address ? `<div style="background:#f8f9fc;border-radius:8px;padding:12px;grid-column:span 2;">
					<div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;">Registered Address</div>
					<div style="font-size:14px;font-weight:500;margin-top:4px;">${aggregator.registered_address}</div>
				</div>` : ""}
			</div>
			${(service_category_list && service_category_list.length) ? `
			<div style="margin-top:16px;">
				<div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">
					Registered Service Categories <span style="text-transform:none;font-weight:400;color:#bbb;">(click to filter the dashboard)</span>
				</div>
				<div style="display:flex;flex-wrap:wrap;gap:8px;">
					${service_category_list.map(c => {
						const cat_name = c.category_name || c.category_id;
						const is_active = (active_filters.service_category || []).includes(cat_name);
						return `<span class="agg-cat-chip${is_active ? " active" : ""}" data-cat="${frappe.utils.escape_html(cat_name)}"
							style="background:${is_active ? "#4e73df" : "#eef2fd"};color:${is_active ? "#fff" : "#4e73df"};
								padding:5px 14px;border-radius:16px;font-size:12.5px;font-weight:600;cursor:pointer;transition:background .15s,color .15s;">
							${cat_name}${is_active ? ' <i class="fa fa-times-circle" style="margin-left:3px;"></i>' : ""}
						</span>`;
					}).join("")}
				</div>
			</div>` : `
			<div style="margin-top:16px;font-size:12.5px;color:#aaa;">
				<i class="fa fa-info-circle" style="margin-right:4px;"></i>No service categories registered yet. Please contact the admin to update your profile.
			</div>`}
		</div>

		<!-- Transaction Count Cards -->
		<div class="agg-section-label">
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
		<div class="agg-section-label">
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

		<!-- Analytics Charts -->
		${has_charts ? `
		<div class="agg-section-label">
			<i class="fa fa-bar-chart" style="margin-right:4px;"></i> Analytics
		</div>
		<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:20px;margin-bottom:16px;">
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
		</div>
		<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-bottom:24px;">
			${(worker_status_breakdown && worker_status_breakdown.length) ? `
			<div class="agg-section" style="margin-bottom:0;padding-bottom:8px;">
				<h5>
					<i class="fa fa-pie-chart" style="color:#4e73df;margin-right:6px;"></i>
					Worker Status
					<a href="javascript:void(0)" class="agg-drillable" data-drilldown="total_workers"
						style="float:right;font-size:11.5px;font-weight:500;color:#4e73df;">All Workers &rarr;</a>
				</h5>
				<div id="agg-worker-status-chart"></div>
				<p id="agg-worker-status-empty" style="text-align:center;color:#ccc;font-size:12px;display:none;padding:40px 0;margin:0;"></p>
			</div>` : ""}
			${(svc_cat_breakdown && svc_cat_breakdown.length) ? `
			<div class="agg-section" style="margin-bottom:0;padding-bottom:8px;">
				<h5>
					<i class="fa fa-pie-chart" style="color:#36b9cc;margin-right:6px;"></i>
					By Service Category
					<span style="float:right;font-size:11.5px;font-weight:400;color:#aaa;">Txn count</span>
				</h5>
				<div id="agg-svc-cat-chart"></div>
				<p id="agg-svc-cat-empty" style="text-align:center;color:#ccc;font-size:12px;display:none;padding:40px 0;margin:0;"></p>
			</div>` : ""}
			${(status_breakdown && status_breakdown.length) ? `
			<div class="agg-section" style="margin-bottom:0;padding-bottom:8px;">
				<h5>
					<i class="fa fa-pie-chart" style="color:#36b9cc;margin-right:6px;"></i>
					Payment Status
					<span style="float:right;font-size:11.5px;font-weight:400;color:#aaa;">Current filter</span>
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
						<td>${txn_link(t.name)}</td>
						<td>${t.date || "-"}</td>
						<td>${worker_link(t.gig_worker)}</td>
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
						<td>${txn_link(d.name)}</td>
						<td>${d.date || "-"}</td>
						<td>${worker_link(d.gig_worker)}</td>
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
					<div style="display:flex;align-items:flex-start;gap:10px;">
						<button id="agg-dd-back" title="Back" style="display:none;">&larr;</button>
						<div>
							<div id="agg-dd-title"></div>
							<div id="agg-dd-count"></div>
						</div>
					</div>
					<div style="display:flex;align-items:center;gap:8px;">
						<button id="agg-dd-export-csv" title="Export to CSV" style="display:none;">
							<i class="fa fa-download"></i> Export CSV
						</button>
						<button id="agg-dd-close" title="Close (Esc)">&#10005;</button>
					</div>
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

		// Service category chip — click to filter the whole dashboard by that category (click again to clear)
		$(".agg-cat-chip").on("click", function () {
			const cat = $(this).data("cat");
			const already_only = _active_svc_cat.length === 1 && _active_svc_cat[0] === cat;
			_active_svc_cat = already_only ? [] : [cat];
			fetch_dashboard();
		});

		// Multiselect: toggle panel
		$("#agg-ms-toggle").on("click", function (e) {
			e.stopPropagation();
			$("#agg-ms-panel").toggle();
		});
		$(document).off("click.agg_ms_close").on("click.agg_ms_close", function (e) {
			if (!$(e.target).closest("#agg-ms-panel, #agg-ms-toggle").length) $("#agg-ms-panel").hide();
		});
		function sync_select_all() {
			const total = $(".agg-ms-checkbox").length;
			const checked = $(".agg-ms-checkbox:checked").length;
			$("#agg-ms-select-all").prop("checked", total > 0 && total === checked);
		}
		$("#agg-ms-select-all").on("change", function () {
			$(".agg-ms-checkbox").prop("checked", $(this).is(":checked"));
		});
		$(document).off("change.agg_ms_opt").on("change.agg_ms_opt", ".agg-ms-checkbox", sync_select_all);
		sync_select_all();

		// Filter events
		$("#agg-btn-apply-filter").on("click", function () {
			_active_from    = $("#agg-filter-from").val() || "";
			_active_to      = $("#agg-filter-to").val() || "";
			_active_svc_cat = $(".agg-ms-checkbox:checked").map(function () { return $(this).val(); }).get();
			fetch_dashboard();
		});
		$("#agg-btn-clear-filter").on("click", function () {
			_active_from = ""; _active_to = ""; _active_svc_cat = [];
			fetch_dashboard();
		});
	}
};
