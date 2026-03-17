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

	let _gw_data = null;

	// Load DataTables CSS + JS dynamically, then fetch data
	load_datatables(function () {
		frappe.call({
			method: "gigworkers.gig_workers.page.gig_worker_dashboard.gig_worker_dashboard.get_dashboard_data",
			callback(r) {
				if (r.message) { _gw_data = r.message; render_dashboard(r.message); }
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

	function fmt_currency_plain(val) {
		return parseFloat(val || 0).toLocaleString("en-IN", {
			minimumFractionDigits: 2, maximumFractionDigits: 2,
		});
	}

	function today_str() {
		return new Date().toISOString().slice(0, 10).replace(/-/g, "");
	}

	function download_pdf() {
		if (!_gw_data) return;

		function do_pdf() {
			const { jsPDF } = window.jspdf;
			const d   = _gw_data;
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
					doc.setDrawColor(...BORDER);
					doc.setLineWidth(0.5);
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
					doc.setDrawColor(...BORDER);
					doc.setLineWidth(1);
					doc.rect(20, 20, PW - 40, PH - 40, "S");
				}
			}

			let y = 0;
			function section_heading(title) {
				y += 10;
				doc.setFontSize(10); doc.setFont(undefined, "bold");
				doc.setTextColor(...DARK);
				doc.text(title.toUpperCase(), ML, y);
				y += 4;
				doc.setDrawColor(...BLACK);
				doc.setLineWidth(1);
				doc.line(ML, y, ML + CW, y);
				y += 8;
				doc.setFont(undefined, "normal");
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
						doc.setDrawColor(...BORDER);
						doc.setLineWidth(0.3);
						doc.rect(ox, ry, colW, rowH, "S");
						doc.setFontSize(8); doc.setFont(undefined, "normal");
						doc.setTextColor(...MUTED);
						doc.text(item.label, ox + 6, ry + 12, { maxWidth: labelW - 8 });
						doc.setFont(undefined, "bold");
						doc.setTextColor(...DARK);
						doc.text(String(item.value), ox + labelW + valW - 6, ry + 12, { align: "right", maxWidth: valW - 4 });
					});
				});

				y += Math.max(left.length, right.length) * rowH + 10;
				doc.setFont(undefined, "normal");
			}

			function pdf_table(head, body) {
				doc.autoTable({
					startY: y,
					head: [head],
					body,
					theme: "grid",
					headStyles: {
						fillColor: GREY_HD, textColor: WHITE,
						fontSize: 7.5, fontStyle: "bold", cellPadding: { top: 4, bottom: 4, left: 4, right: 4 },
					},
					bodyStyles: {
						fontSize: 7.5, textColor: DARK,
						cellPadding: { top: 3, bottom: 3, left: 4, right: 4 },
					},
					alternateRowStyles: { fillColor: GREY_LT },
					tableLineColor: BORDER,
					tableLineWidth: 0.3,
					margin: { left: ML, right: MR, bottom: 60 },
				});
				y = doc.lastAutoTable.finalY + 14;
			}

			// Title block
			y = 60;
			doc.setDrawColor(...BLACK);
			doc.setLineWidth(1.5);
			doc.line(ML, y, ML + CW, y);
			y += 14;

			doc.setFontSize(15); doc.setFont(undefined, "bold");
			doc.setTextColor(...DARK);
			doc.text("Gig Worker Dashboard Report", ML, y);
			doc.setFont(undefined, "normal");
			y += 16;

			doc.setFontSize(8.5); doc.setTextColor(...MUTED);
			doc.text("Gig Workers Welfare Portal", ML, y);
			y += 13;

			doc.setFontSize(8); doc.setTextColor(...DARK);
			doc.text("Worker:", ML, y);
			doc.setFont(undefined, "bold");
			doc.text(`${d.worker.worker_name || "-"}  (${d.worker_id})`, ML + 42, y);
			doc.setFont(undefined, "normal");
			y += 14;

			doc.setDrawColor(...BLACK);
			doc.setLineWidth(0.5);
			doc.line(ML, y, ML + CW, y);
			y += 20;

			// Transaction stats
			section_heading("Transaction Summary");
			stats_table([
				{ label: "Total Transactions",        value: d.stats.total_transactions },
				{ label: "Completed",                 value: d.stats.completed_transactions },
				{ label: "Total Earnings (INR)",       value: fmt_currency_plain(d.stats.total_earnings) },
				{ label: "Base Payout Total (INR)",    value: fmt_currency_plain(d.stats.total_base_payout) },
				{ label: "Welfare Deducted (INR)",     value: fmt_currency_plain(d.stats.total_welfare_deducted) },
			]);

			// Fund stats
			section_heading("Welfare Fund");
			stats_table([
				{ label: "Current Balance (INR)",     value: fmt_currency_plain(d.fund.account_balance) },
				{ label: "Total Collected (INR)",     value: fmt_currency_plain(d.fund.total_collected) },
				{ label: "Total Withdrawn (INR)",     value: fmt_currency_plain(d.fund.total_withdrawn) },
			]);

			// Transactions table
			section_heading("Transaction Details");
			pdf_table(
				["Txn ID", "Date", "Aggregator", "Service", "Amount (INR)", "Base Payout (INR)", "Welfare (INR)", "Status"],
				d.recent_transactions.map(t => [
					t.name, t.date || "-", t.aggregator || "-", t.service || "-",
					fmt_currency_plain(t.amount), fmt_currency_plain(t.base_payout),
					fmt_currency_plain(t.welfare_amount), t.status || "-",
				])
			);

			// Withdrawal requests table
			section_heading("Withdrawal Requests");
			pdf_table(
				["Request ID", "Date", "Amount (INR)", "Reason", "Status"],
				d.withdrawals.map(w => [
					w.name, (w.creation || "").substring(0, 10),
					fmt_currency_plain(w.amount), w.reason || "-", w.status || "-",
				])
			);

			draw_footer();
			draw_page_border();
			doc.save(`gig_worker_dashboard_${today_str()}.pdf`);
		}

		if (window.jspdf && window.jspdf.jsPDF) { do_pdf(); return; }

		frappe.show_alert({ message: "Loading PDF library…", indicator: "blue" });
		$.getScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js", function () {
			$.getScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js", function () {
				do_pdf();
			});
		});
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

		<div style="display:flex; justify-content:flex-end; margin-bottom:16px;">
			<button id="gw-btn-dl-pdf" style="background:#222;color:#fff;border:none;border-radius:6px;padding:8px 20px;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:6px;">
				<i class="fa fa-file-pdf-o"></i> Download PDF
			</button>
		</div>

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

		$("#gw-btn-dl-pdf").on("click", download_pdf);
	}
};
