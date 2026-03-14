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

	// Load DataTables CSS + JS dynamically, then fetch data
	load_datatables(function () {
		frappe.call({
			method: "gigworkers.gig_workers.page.aggregator_dashboard.aggregator_dashboard.get_dashboard_data",
			callback(r) {
				if (r.message) render_dashboard(r.message);
			},
			error() {
				$("#agg-loading").html('<p style="color:red;">Failed to load dashboard. Please refresh.</p>');
			},
		});
	});

	function load_datatables(callback) {
		if ($.fn.DataTable) { callback(); return; }

		$("<link>")
			.attr({ rel: "stylesheet", href: "https://cdn.datatables.net/1.13.7/css/jquery.dataTables.min.css" })
			.appendTo("head");

		$.getScript("https://cdn.datatables.net/1.13.7/js/jquery.dataTables.min.js", callback);
	}

	function init_datatable(table_id) {
		if ($.fn.DataTable) {
			$(table_id).DataTable({
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
			});
		}
	}

	function fmt_currency(val) {
		return "₹" + parseFloat(val || 0).toLocaleString("en-IN", {
			minimumFractionDigits: 2, maximumFractionDigits: 2,
		});
	}

	function status_badge(status) {
		const colors = {
			Completed: "#28a745", Registered: "#007bff", Pending: "#ffc107",
			Onboarded: "#28a745", Inactive: "#6c757d", Approved: "#28a745",
			Rejected: "#dc3545", Active: "#1cc88a", Offboarded: "#6c757d",
		};
		const color = colors[status] || "#6c757d";
		return `<span style="background:${color};color:#fff;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;">${status || "-"}</span>`;
	}

	function render_dashboard(data) {
		const { aggregator, aggregator_id, stats, workers, welfare_payments,
			recent_transactions, worker_list, pending_wfp } = data;

		const html = `
		<style>
			.agg-card-row { display: flex; flex-wrap: wrap; gap: 16px; margin-bottom: 24px; }
			.agg-stat-card {
				flex: 1; min-width: 160px; background: #fff; border-radius: 10px;
				padding: 20px 18px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);
				border-left: 4px solid var(--card-color, #4e73df);
			}
			.agg-stat-card .label { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: .5px; }
			.agg-stat-card .value { font-size: 26px; font-weight: 700; color: #333; margin-top: 6px; }
			.agg-section { background: #fff; border-radius: 10px; padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.07); margin-bottom: 24px; }
			.agg-section h5 { font-weight: 700; margin-bottom: 14px; color: #444; border-bottom: 1px solid #eee; padding-bottom: 8px; }
			.agg-profile { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; }
			.agg-avatar { width: 52px; height: 52px; border-radius: 50%; background: #e74a3b; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 700; }
			.agg-profile-info .name { font-size: 20px; font-weight: 700; color: #333; }
			.agg-profile-info .meta { font-size: 13px; color: #888; margin-top: 2px; }
			.highlight { color: #e74a3b; font-weight: 700; }
			.dt-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
			.dt-bottom { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; }
			table.dataTable thead th { background: #f8f9fa; color: #555; font-weight: 600; }
			table.dataTable tbody tr:hover td { background: #fafafa; }
			table.dataTable { font-size: 13px; }
		</style>

		<div class="agg-profile">
			<div class="agg-avatar">${(aggregator.aggregator_name || "?")[0].toUpperCase()}</div>
			<div class="agg-profile-info">
				<div class="name">${aggregator.aggregator_name || "-"}</div>
				<div class="meta">
					${aggregator_id} &nbsp;|&nbsp; ${aggregator.company_type || ""} &nbsp;|&nbsp;
					${aggregator.email || ""} &nbsp;|&nbsp; ${status_badge(aggregator.status)}
				</div>
			</div>
		</div>

		<div class="agg-card-row">
			<div class="agg-stat-card" style="--card-color:#4e73df;"><div class="label">Total Transactions</div><div class="value">${stats.total_transactions}</div></div>
			<div class="agg-stat-card" style="--card-color:#1cc88a;"><div class="label">Completed</div><div class="value">${stats.completed_transactions}</div></div>
			<div class="agg-stat-card" style="--card-color:#f6c23e;"><div class="label">Pending</div><div class="value">${stats.pending_transactions}</div></div>
			<div class="agg-stat-card" style="--card-color:#36b9cc;"><div class="label">Total Amount Paid</div><div class="value" style="font-size:20px;">${fmt_currency(stats.total_amount)}</div></div>
			<div class="agg-stat-card" style="--card-color:#e74a3b;"><div class="label">Total Welfare Collected</div><div class="value" style="font-size:20px;">${fmt_currency(stats.total_welfare)}</div></div>
		</div>

		<div class="agg-card-row">
			<div class="agg-stat-card" style="--card-color:#4e73df;"><div class="label">Total Workers</div><div class="value">${workers.total}</div></div>
			<div class="agg-stat-card" style="--card-color:#1cc88a;"><div class="label">Onboarded Workers</div><div class="value">${workers.active}</div></div>
			<div class="agg-stat-card" style="--card-color:#28a745;"><div class="label">Welfare Fees Settled</div><div class="value" style="font-size:20px;">${fmt_currency(welfare_payments.total_paid)}</div></div>
			<div class="agg-stat-card" style="--card-color:#e74a3b;"><div class="label">Welfare Fees Pending</div><div class="value" style="font-size:20px;color:#e74a3b;">${fmt_currency(welfare_payments.pending_amount)}</div></div>
			<div class="agg-stat-card" style="--card-color:#858796;"><div class="label">Base Payout Total</div><div class="value" style="font-size:20px;">${fmt_currency(stats.total_base_payout)}</div></div>
		</div>

		<!-- Transactions Table -->
		<div class="agg-section">
			<h5>Transactions
				<a href="/app/gig-transaction" style="float:right;font-size:13px;font-weight:500;color:#4e73df;">View All</a>
			</h5>
			<table id="agg-txn-table" class="display" style="width:100%">
				<thead><tr>
					<th>Transaction ID</th><th>Date</th><th>Gig Worker</th><th>Service</th>
					<th>Amount</th><th>Base Payout</th><th>Welfare</th><th>Status</th>
				</tr></thead>
				<tbody>
					${recent_transactions.map(t => `<tr>
						<td><a href="/app/gig-transaction/${t.name}" style="color:#4e73df;">${t.name}</a></td>
						<td>${t.date || "-"}</td>
						<td>${t.gig_worker || "-"}</td>
						<td>${t.service || "-"}</td>
						<td>${fmt_currency(t.amount)}</td>
						<td>${fmt_currency(t.base_payout)}</td>
						<td>${fmt_currency(t.welfare_amount)}</td>
						<td>${status_badge(t.status)}</td>
					</tr>`).join("")}
				</tbody>
			</table>
		</div>

		<!-- Worker Onboarding Table -->
		<div class="agg-section">
			<h5>Worker Onboarding
				<a href="/app/worker-service-mapping" style="float:right;font-size:13px;font-weight:500;color:#4e73df;">View All</a>
			</h5>
			<table id="agg-worker-table" class="display" style="width:100%">
				<thead><tr>
					<th>Mapping ID</th><th>Gig Worker</th><th>Service</th>
					<th>Role</th><th>Start Date</th><th>Status</th>
				</tr></thead>
				<tbody>
					${worker_list.map(w => `<tr>
						<td><a href="/app/worker-service-mapping/${w.name}" style="color:#4e73df;">${w.name}</a></td>
						<td>${w.gig_worker || "-"}</td>
						<td>${w.service || "-"}</td>
						<td>${w.role || "-"}</td>
						<td>${w.start_date || "-"}</td>
						<td>${status_badge(w.status)}</td>
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
		`;

		$("#agg-dashboard").html(html);

		// Initialize DataTables on all three tables
		init_datatable("#agg-txn-table");
		init_datatable("#agg-worker-table");
		init_datatable("#agg-wfp-table");
	}
};
