frappe.pages["gig-worker-dashboard"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "My Dashboard",
		single_column: true,
	});

	$(wrapper).find(".page-content").html(`
		<div id="gw-dashboard" style="padding: 20px;">
			<div id="gw-loading" style="text-align:center; padding: 60px; color: #888;">
				<i class="fa fa-spinner fa-spin fa-2x"></i>
				<p style="margin-top:12px;">Loading your dashboard...</p>
			</div>
		</div>
	`);

	// Load DataTables CSS + JS dynamically, then fetch data
	load_datatables(function () {
		frappe.call({
			method: "gigworkers.gig_workers.page.gig_worker_dashboard.gig_worker_dashboard.get_dashboard_data",
			callback(r) {
				if (r.message) render_dashboard(r.message);
			},
			error() {
				$("#gw-loading").html('<p style="color:red;">Failed to load dashboard. Please refresh.</p>');
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
			Requested: "#17a2b8", Approved: "#28a745", Rejected: "#dc3545", Paid: "#6f42c1",
		};
		const color = colors[status] || "#6c757d";
		return `<span style="background:${color};color:#fff;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;">${status || "-"}</span>`;
	}

	function render_dashboard(data) {
		const { worker, worker_id, stats, fund, recent_transactions, withdrawals } = data;

		const html = `
		<style>
			.gw-card-row { display: flex; flex-wrap: wrap; gap: 16px; margin-bottom: 24px; }
			.gw-stat-card {
				flex: 1; min-width: 160px; background: #fff; border-radius: 10px;
				padding: 20px 18px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);
				border-left: 4px solid var(--card-color, #4e73df);
			}
			.gw-stat-card .label { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: .5px; }
			.gw-stat-card .value { font-size: 26px; font-weight: 700; color: #333; margin-top: 6px; }
			.gw-section { background: #fff; border-radius: 10px; padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.07); margin-bottom: 24px; }
			.gw-section h5 { font-weight: 700; margin-bottom: 14px; color: #444; border-bottom: 1px solid #eee; padding-bottom: 8px; }
			.gw-profile { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; }
			.gw-avatar { width: 52px; height: 52px; border-radius: 50%; background: #4e73df; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 700; }
			.gw-profile-info .name { font-size: 20px; font-weight: 700; color: #333; }
			.gw-profile-info .meta { font-size: 13px; color: #888; margin-top: 2px; }
			.dt-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
			.dt-bottom { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; }
			table.dataTable thead th { background: #f8f9fa; color: #555; font-weight: 600; }
			table.dataTable tbody tr:hover td { background: #fafafa; }
			table.dataTable { font-size: 13px; }
		</style>

		<div class="gw-profile">
			<div class="gw-avatar">${(worker.worker_name || "?")[0].toUpperCase()}</div>
			<div class="gw-profile-info">
				<div class="name">${worker.worker_name || "-"}</div>
				<div class="meta">${worker_id} &nbsp;|&nbsp; ${worker.email || ""} &nbsp;|&nbsp; ${status_badge(worker.status)}</div>
			</div>
		</div>

		<div class="gw-card-row">
			<div class="gw-stat-card" style="--card-color:#4e73df;"><div class="label">Total Transactions</div><div class="value">${stats.total_transactions}</div></div>
			<div class="gw-stat-card" style="--card-color:#1cc88a;"><div class="label">Completed</div><div class="value">${stats.completed_transactions}</div></div>
			<div class="gw-stat-card" style="--card-color:#f6c23e;"><div class="label">Total Earnings</div><div class="value" style="font-size:20px;">${fmt_currency(stats.total_earnings)}</div></div>
			<div class="gw-stat-card" style="--card-color:#36b9cc;"><div class="label">Welfare Balance</div><div class="value" style="font-size:20px;">${fmt_currency(fund.account_balance)}</div></div>
			<div class="gw-stat-card" style="--card-color:#e74a3b;"><div class="label">Welfare Deducted</div><div class="value" style="font-size:20px;">${fmt_currency(stats.total_welfare_deducted)}</div></div>
		</div>

		<div class="gw-card-row">
			<div class="gw-stat-card" style="--card-color:#858796;"><div class="label">Total Collected</div><div class="value" style="font-size:20px;">${fmt_currency(fund.total_collected)}</div></div>
			<div class="gw-stat-card" style="--card-color:#5a5c69;"><div class="label">Total Withdrawn</div><div class="value" style="font-size:20px;">${fmt_currency(fund.total_withdrawn)}</div></div>
			<div class="gw-stat-card" style="--card-color:#1cc88a; flex:2;"><div class="label">Base Payout (Total)</div><div class="value" style="font-size:20px;">${fmt_currency(stats.total_base_payout)}</div></div>
		</div>

		<div class="gw-section">
			<h5>Transactions</h5>
			<table id="gw-txn-table" class="display" style="width:100%">
				<thead><tr>
					<th>Transaction ID</th><th>Date</th><th>Aggregator</th><th>Service</th>
					<th>Amount</th><th>Base Payout</th><th>Welfare</th><th>Status</th>
				</tr></thead>
				<tbody>
					${recent_transactions.map(t => `<tr>
						<td><a href="/app/gig-transaction/${t.name}" style="color:#4e73df;">${t.name}</a></td>
						<td>${t.date || "-"}</td>
						<td>${t.aggregator || "-"}</td>
						<td>${t.service || "-"}</td>
						<td>${fmt_currency(t.amount)}</td>
						<td>${fmt_currency(t.base_payout)}</td>
						<td>${fmt_currency(t.welfare_amount)}</td>
						<td>${status_badge(t.status)}</td>
					</tr>`).join("")}
				</tbody>
			</table>
		</div>

		<div class="gw-section">
			<h5>My Withdrawal Requests
				<a href="/app/welfare-benefit-withdrawal/new-welfare-benefit-withdrawal-1"
					style="float:right;font-size:13px;font-weight:500;color:#4e73df;">+ New Request</a>
			</h5>
			<table id="gw-wd-table" class="display" style="width:100%">
				<thead><tr>
					<th>Request ID</th><th>Date</th><th>Amount</th><th>Reason</th><th>Status</th>
				</tr></thead>
				<tbody>
					${withdrawals.map(w => `<tr>
						<td><a href="/app/welfare-benefit-withdrawal/${w.name}" style="color:#4e73df;">${w.name}</a></td>
						<td>${(w.creation || "").substring(0, 10)}</td>
						<td>${fmt_currency(w.amount)}</td>
						<td>${w.reason || "-"}</td>
						<td>${status_badge(w.status)}</td>
					</tr>`).join("")}
				</tbody>
			</table>
		</div>
		`;

		$("#gw-dashboard").html(html);

		// Initialize DataTables on both tables
		init_datatable("#gw-txn-table");
		init_datatable("#gw-wd-table");
	}
};
