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
	let _active_aggregator = "";
	let _active_service_cat = "";
	let _active_drill_month = "";

	// Load DataTables CSS + JS dynamically, then fetch data
	load_datatables(function () {
		fetch_dashboard();
	});

	// Allow admin to view a specific worker via URL param ?worker=GW001
	const _worker_override = frappe.utils.get_url_arg("worker") || null;

	function fetch_dashboard() {
		$("#gw-dashboard").html(`
			<div id="gw-loading" style="text-align:center; padding: 60px; color: #888;">
				<i class="fa fa-spinner fa-spin fa-2x"></i>
				<p style="margin-top:12px;">Loading...</p>
			</div>
		`);

		frappe.call({
			method: "gigworkers.gig_workers.page.gig_worker_dashboard.gig_worker_dashboard.get_dashboard_data",
			args: {
				aggregator: _active_aggregator,
				service_category: _active_service_cat,
				worker_override: _worker_override,
			},
			callback(r) {
				if (r.message) {
					_gw_data = r.message;
					render_dashboard(r.message);
				}
			},
			error() {
				$("#gw-dashboard").html('<p style="color:red;padding:40px;">Failed to load dashboard. Please refresh.</p>');
			},
		});
	}

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
		return "\u20B9" + parseFloat(val || 0).toLocaleString("en-IN", {
			minimumFractionDigits: 2, maximumFractionDigits: 2,
		});
	}

	function fmt_currency_plain(val) {
		return parseFloat(val || 0).toLocaleString("en-IN", {
			minimumFractionDigits: 2, maximumFractionDigits: 2,
		});
	}

	function status_badge(status) {
		const colors = {
			'Payment complete': "#28a745", 'Payment pending': "#007bff", Pending: "#ffc107",
			Requested: "#17a2b8", Approved: "#28a745", Rejected: "#dc3545", Paid: "#6f42c1",
			'Payment Cancelled': "#dc3545", 'Suspected duplicate': "#ffc107"
		};
		const color = colors[status] || "#6c757d";
		return `<span style="background:${color};color:#fff;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;">${status || "-"}</span>`;
	}

	function today_str() {
		return new Date().toISOString().slice(0, 10).replace(/-/g, "");
	}

	// ── Monthly earnings chart ───────────────────────────────────────────────────
	function render_monthly_chart(monthly_earnings) {
		if (!monthly_earnings || monthly_earnings.length === 0) return "";

		// Build month list and aggregator list
		const monthSet = [...new Set(monthly_earnings.map(r => r.month))].sort();
		const aggSet   = [...new Set(monthly_earnings.map(r => r.aggregator))];

		const AGG_COLORS = ["#4e73df","#1cc88a","#f6c23e","#36b9cc","#e74a3b","#858796","#6f42c1","#fd7e14"];

		// Map: { "2026-01": { "Swiggy": 1200, "Zomato": 800 } }
		const byMonth = {};
		monthly_earnings.forEach(r => {
			if (!byMonth[r.month]) byMonth[r.month] = {};
			byMonth[r.month][r.aggregator] = (byMonth[r.month][r.aggregator] || 0) + r.earnings;
		});

		// Chart dimensions
		const W = 700, H = 220, PAD_L = 70, PAD_R = 20, PAD_T = 20, PAD_B = 50;
		const chartW = W - PAD_L - PAD_R;
		const chartH = H - PAD_T - PAD_B;

		const maxEarning = Math.max(...monthSet.map(m =>
			aggSet.reduce((s, a) => s + (byMonth[m][a] || 0), 0)
		)) || 1;

		const barGroupW = chartW / monthSet.length;
		const barW      = Math.min(barGroupW / aggSet.length - 2, 30);

		let bars = "", labels = "", yAxis = "", legend = "";

		// Y-axis gridlines
		for (let i = 0; i <= 4; i++) {
			const val = (maxEarning / 4) * i;
			const y   = PAD_T + chartH - (chartH * i / 4);
			yAxis += `<line x1="${PAD_L}" y1="${y}" x2="${W - PAD_R}" y2="${y}"
				stroke="#eee" stroke-width="1"/>`;
			yAxis += `<text x="${PAD_L - 6}" y="${y + 4}" text-anchor="end"
				font-size="10" fill="#aaa">\u20B9${Math.round(val / 100) * 100}</text>`;
		}

		// Bars + month labels
		monthSet.forEach((month, mi) => {
			const groupX = PAD_L + mi * barGroupW + barGroupW / 2 - (aggSet.length * (barW + 2)) / 2;
			aggSet.forEach((agg, ai) => {
				const val    = byMonth[month][agg] || 0;
				const barH   = chartH * (val / maxEarning);
				const x      = groupX + ai * (barW + 2);
				const y      = PAD_T + chartH - barH;
				const color  = AGG_COLORS[ai % AGG_COLORS.length];
				bars += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}"
					fill="${color}" rx="2" opacity="0.85"
					class="gw-month-bar" data-month="${month}" style="cursor:pointer;">
					<title>${agg}: \u20B9${val.toFixed(2)} (${month}) \u2014 click to filter table</title>
				</rect>`;
			});
			// Month label
			const lx = PAD_L + mi * barGroupW + barGroupW / 2;
			labels += `<text x="${lx}" y="${H - 8}" text-anchor="middle"
				font-size="10" fill="#888">${month.substring(5)}</text>`;
			// Year label on Jan or first month
			if (month.endsWith("-01") || mi === 0) {
				labels += `<text x="${lx}" y="${H}" text-anchor="middle"
					font-size="9" fill="#bbb">${month.substring(0, 4)}</text>`;
			}
		});

		// Legend
		aggSet.forEach((agg, i) => {
			const color = AGG_COLORS[i % AGG_COLORS.length];
			legend += `<span style="display:inline-flex;align-items:center;gap:5px;margin-right:14px;font-size:12px;color:#555;">
				<span style="width:12px;height:12px;border-radius:2px;background:${color};display:inline-block;"></span>
				${agg}
			</span>`;
		});

		return `
		<div class="gw-section">
			<h5>Monthly Earnings (Last 12 Months)
				<span style="float:right;font-size:12px;font-weight:400;color:#aaa;">Click a bar to filter the table below by month</span>
			</h5>
			<div id="gw-month-drill-bar" style="display:none;margin-bottom:10px;"></div>
			<div style="overflow-x:auto;">
				<svg id="gw-monthly-chart-svg" viewBox="0 0 ${W} ${H}" width="100%" style="display:block;">
					${yAxis}
					${bars}
					${labels}
					<line x1="${PAD_L}" y1="${PAD_T}" x2="${PAD_L}" y2="${PAD_T + chartH}"
						stroke="#ccc" stroke-width="1"/>
				</svg>
			</div>
			<div style="margin-top:8px;">${legend}</div>
		</div>`;
	}

	// ── Per-aggregator breakdown cards ──────────────────────────────────────────
	function render_agg_breakdown(agg_breakdown, active_aggregator) {
		if (!agg_breakdown || agg_breakdown.length === 0) return "";

		const AGG_COLORS = ["#4e73df", "#1cc88a", "#f6c23e", "#36b9cc", "#e74a3b",
			"#858796", "#6f42c1", "#fd7e14", "#20c997"];

		const cards = agg_breakdown.map((a, i) => {
			const color = AGG_COLORS[i % AGG_COLORS.length];
			const isActive = active_aggregator && a.aggregator === active_aggregator;
			const border = isActive ? `3px solid ${color}` : `1px solid #e3e6f0`;
			const shadow = isActive ? `0 4px 16px rgba(0,0,0,0.15)` : `0 2px 8px rgba(0,0,0,0.07)`;
			return `
			<div class="gw-agg-card" data-aggregator="${a.aggregator}"
				style="flex:1;min-width:180px;background:#fff;border-radius:10px;
					padding:16px;box-shadow:${shadow};border-left:4px solid ${color};
					border:${border};cursor:pointer;transition:box-shadow .2s;">
				<div style="font-size:13px;font-weight:700;color:${color};margin-bottom:6px;
					white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
					${a.aggregator}
				</div>
				<div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.4px;">Earnings</div>
				<div style="font-size:18px;font-weight:700;color:#333;">${fmt_currency(a.total_earnings)}</div>
				<div style="font-size:11px;color:#aaa;margin-top:4px;">${a.total_transactions} txn(s)</div>
				<div style="font-size:11px;color:#e74a3b;margin-top:2px;">Welfare: ${fmt_currency(a.total_welfare)}</div>
				${isActive ? `<div style="font-size:11px;font-weight:600;color:${color};margin-top:6px;">Currently filtered</div>` : ""}
			</div>`;
		}).join("");

		return `
		<div class="gw-section">
			<h5>Earnings by Aggregator
				<span style="float:right;font-size:12px;color:#aaa;font-weight:400;">Click a card to filter</span>
			</h5>
			<div style="display:flex;flex-wrap:wrap;gap:14px;">${cards}</div>
		</div>`;
	}

	// ── Per-service-category breakdown ──────────────────────────────────────────
	function render_cat_breakdown(cat_breakdown, active_cat) {
		if (!cat_breakdown || cat_breakdown.length === 0) return "";

		const CAT_COLORS = ["#36b9cc", "#f6c23e", "#1cc88a", "#4e73df", "#e74a3b"];

		const items = cat_breakdown.map((c, i) => {
			const color = CAT_COLORS[i % CAT_COLORS.length];
			const isActive = active_cat && c.service_category === active_cat;
			const bg = isActive ? `#f0f4ff` : `#fff`;
			const border = isActive ? `2px solid ${color}` : `1px solid #e3e6f0`;
			return `
			<div class="gw-cat-card" data-category="${c.service_category}"
				style="display:flex;align-items:center;gap:12px;background:${bg};
					border-radius:8px;padding:12px 16px;border:${border};cursor:pointer;
					min-width:180px;flex:1;">
				<div style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0;"></div>
				<div>
					<div style="font-size:13px;font-weight:600;color:#333;">${c.service_category}</div>
					<div style="font-size:12px;color:#888;">${c.total_transactions} txn(s) &mdash; ${fmt_currency(c.total_earnings)}</div>
				</div>
				${isActive ? `<span style="margin-left:auto;font-size:11px;font-weight:600;color:${color};">Filtered</span>` : ""}
			</div>`;
		}).join("");

		return `
		<div class="gw-section">
			<h5>Earnings by Service Category
				<span style="float:right;font-size:12px;color:#aaa;font-weight:400;">Click a card to filter</span>
			</h5>
			<div style="display:flex;flex-wrap:wrap;gap:12px;">${items}</div>
		</div>`;
	}

	// ── Filter bar ───────────────────────────────────────────────────────────────
	function render_filter_bar(aggregators, service_categories, active_agg, active_cat) {
		const agg_options = aggregators.map(a =>
			`<option value="${a}" ${active_agg === a ? "selected" : ""}>${a}</option>`
		).join("");

		const cat_options = service_categories.map(c =>
			`<option value="${c}" ${active_cat === c ? "selected" : ""}>${c}</option>`
		).join("");

		const has_filter = active_agg || active_cat;

		return `
		<div id="gw-filter-bar" style="background:#fff;border-radius:10px;padding:16px 20px;
			box-shadow:0 2px 8px rgba(0,0,0,0.07);margin-bottom:20px;
			display:flex;flex-wrap:wrap;align-items:flex-end;gap:14px;">

			<div style="flex:1;min-width:180px;">
				<label style="font-size:12px;font-weight:600;color:#555;display:block;margin-bottom:4px;">
					Aggregator (Platform)
				</label>
				<select id="gw-filter-agg"
					style="width:100%;padding:7px 10px;border:1px solid #d1d3e2;border-radius:6px;font-size:13px;">
					<option value="">All Aggregators</option>
					${agg_options}
				</select>
			</div>

			<div style="flex:1;min-width:180px;">
				<label style="font-size:12px;font-weight:600;color:#555;display:block;margin-bottom:4px;">
					Service Category
				</label>
				<select id="gw-filter-cat"
					style="width:100%;padding:7px 10px;border:1px solid #d1d3e2;border-radius:6px;font-size:13px;">
					<option value="">All Services</option>
					${cat_options}
				</select>
			</div>

			<div style="display:flex;gap:8px;align-items:flex-end;">
				<button id="gw-btn-apply-filter"
					style="background:#4e73df;color:#fff;border:none;border-radius:6px;
						padding:8px 20px;font-size:13px;cursor:pointer;font-weight:600;">
					Apply Filter
				</button>
				${has_filter ? `
				<button id="gw-btn-clear-filter"
					style="background:#fff;color:#e74a3b;border:1px solid #e74a3b;border-radius:6px;
						padding:8px 14px;font-size:13px;cursor:pointer;">
					Clear
				</button>` : ""}
			</div>

			${has_filter ? `
			<div style="width:100%;margin-top:4px;">
				<span style="font-size:12px;color:#888;">Showing results for:
					${active_agg ? `<strong style="color:#4e73df;">${active_agg}</strong>` : ""}
					${active_agg && active_cat ? " &nbsp;+&nbsp; " : ""}
					${active_cat ? `<strong style="color:#36b9cc;">${active_cat}</strong>` : ""}
				</span>
			</div>` : ""}
		</div>`;
	}

	// ── PDF download ─────────────────────────────────────────────────────────────
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
			y += 12;

			// Active filters in PDF
			const af = d.active_filters;
			if (af.aggregator || af.service_category) {
				doc.setFontSize(8); doc.setTextColor(...MUTED);
				const filterStr = [
					af.aggregator ? `Aggregator: ${af.aggregator}` : "",
					af.service_category ? `Service: ${af.service_category}` : "",
				].filter(Boolean).join("  |  ");
				doc.text(`Filter: ${filterStr}`, ML, y);
				y += 12;
			}

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

			// Per-aggregator breakdown
			if (d.agg_breakdown && d.agg_breakdown.length > 0) {
				section_heading("Earnings by Aggregator");
				pdf_table(
					["Aggregator", "Transactions", "Total Earnings (INR)", "Welfare (INR)"],
					d.agg_breakdown.map(a => [
						a.aggregator,
						a.total_transactions,
						fmt_currency_plain(a.total_earnings),
						fmt_currency_plain(a.total_welfare),
					])
				);
			}

			// Transactions table
			section_heading("Transaction Details");
			pdf_table(
				["Txn ID", "Date", "Aggregator", "Service", "Service Category", "Amount (INR)", "Base Payout (INR)", "Welfare (INR)", "Status"],
				d.recent_transactions.map(t => [
					t.name, t.date || "-", t.aggregator || "-", t.service || "-",
					t.service_category || "-",
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

		frappe.show_alert({ message: "Loading PDF library\u2026", indicator: "blue" });
		$.getScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js", function () {
			$.getScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js", function () {
				do_pdf();
			});
		});
	}

	// ── Main render ──────────────────────────────────────────────────────────────
	function render_dashboard(data) {
		const { worker, worker_id, stats, fund, recent_transactions, withdrawals,
			aggregators, service_categories, agg_breakdown, cat_breakdown, active_filters,
			monthly_earnings } = data;

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
			.gw-stat-card.gw-drillable {
				cursor: pointer; transition: transform .15s, box-shadow .15s; position: relative;
			}
			.gw-stat-card.gw-drillable:hover {
				transform: translateY(-3px); box-shadow: 0 8px 24px rgba(0,0,0,0.13);
			}
			.gw-stat-card.gw-drillable::after {
				content: "↗"; position: absolute; top: 10px; right: 12px;
				font-size: 13px; color: #ddd; transition: color .15s;
			}
			.gw-stat-card.gw-drillable:hover::after { color: var(--card-color, #4e73df); }
			/* Drill-down modal */
			#gw-dd-overlay {
				display: none; position: fixed; inset: 0;
				background: rgba(0,0,0,0.5); z-index: 10000;
				align-items: center; justify-content: center; padding: 20px; box-sizing: border-box;
			}
			#gw-dd-overlay.active { display: flex; }
			#gw-dd-modal {
				background: #f8f9fc; border-radius: 14px;
				width: 95vw; max-width: 1100px; max-height: 90vh;
				display: flex; flex-direction: column;
				box-shadow: 0 28px 70px rgba(0,0,0,0.28); overflow: hidden;
			}
			#gw-dd-header {
				padding: 18px 24px 14px; background: #fff; border-bottom: 1px solid #eee;
				display: flex; align-items: flex-start; justify-content: space-between; flex-shrink: 0;
			}
			#gw-dd-title { font-size: 16px; font-weight: 700; color: #333; margin: 0; }
			#gw-dd-count { font-size: 12px; color: #aaa; margin-top: 3px; }
			#gw-dd-close {
				background: none; border: none; font-size: 20px; color: #bbb;
				cursor: pointer; line-height: 1; padding: 2px 6px; border-radius: 4px; transition: all .12s;
			}
			#gw-dd-close:hover { color: #333; background: #f5f5f5; }
			#gw-dd-body { padding: 16px 20px 20px; overflow-y: auto; flex: 1; }
			#gw-dd-summary { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; }
			.gw-dd-stat {
				background: #fff; border-radius: 10px; padding: 12px 20px;
				box-shadow: 0 1px 6px rgba(0,0,0,0.07); min-width: 110px;
			}
			.gw-dd-stat-label { font-size: 11px; color: #aaa; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 4px; }
			.gw-dd-stat-value { font-size: 20px; font-weight: 700; }
			#gw-dd-chart-wrap {
				background: #fff; border-radius: 10px; padding: 16px 20px 8px;
				box-shadow: 0 1px 6px rgba(0,0,0,0.07); margin-bottom: 16px;
			}
			#gw-dd-chart-wrap h6 { font-size: 12px; font-weight: 700; color: #999; text-transform: uppercase; letter-spacing: .5px; margin: 0 0 8px; }
			#gw-dd-table-wrap {
				background: #fff; border-radius: 10px; padding: 16px 20px;
				box-shadow: 0 1px 6px rgba(0,0,0,0.07); overflow-x: auto;
			}
			#gw-dd-table-wrap h6 { font-size: 12px; font-weight: 700; color: #999; text-transform: uppercase; letter-spacing: .5px; margin: 0 0 12px; }
			#gw-dd-body table.dataTable { font-size: 13px; width: 100% !important; }
			#gw-dd-body .dt-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
			#gw-dd-body .dt-bottom { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; }
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
			.gw-agg-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.13) !important; }
			.gw-cat-card:hover { box-shadow: 0 2px 10px rgba(0,0,0,0.10); }
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

		${render_filter_bar(aggregators || [], service_categories || [],
			active_filters.aggregator, active_filters.service_category)}

		${render_monthly_chart(monthly_earnings)}
		${render_agg_breakdown(agg_breakdown, active_filters.aggregator)}
		${render_cat_breakdown(cat_breakdown, active_filters.service_category)}

		<div class="gw-card-row">
			<div class="gw-stat-card gw-drillable" style="--card-color:#4e73df;" data-drilldown="total_txns"><div class="label">Total Transactions</div><div class="value">${stats.total_transactions}</div></div>
			<div class="gw-stat-card gw-drillable" style="--card-color:#1cc88a;" data-drilldown="completed_txns"><div class="label">Payment Complete</div><div class="value">${stats.completed_transactions}</div></div>
			<div class="gw-stat-card gw-drillable" style="--card-color:#f6c23e;" data-drilldown="pending_txns"><div class="label">Payment Pending</div><div class="value">${stats.pending_transactions}</div></div>
			<div class="gw-stat-card gw-drillable" style="--card-color:#6c757d;" data-drilldown="cancelled_txns"><div class="label">Payment Cancelled</div><div class="value">${stats.cancelled_transactions}</div></div>
			<div class="gw-stat-card ${stats.suspected_duplicates ? 'gw-drillable' : ''}"
				style="--card-color:#e74a3b;cursor:${stats.suspected_duplicates ? 'pointer' : 'default'};"
				${stats.suspected_duplicates ? 'data-drilldown="dup_txns"' : ''}>
				<div class="label">Suspected Duplicates</div>
				<div class="value" style="color:${stats.suspected_duplicates ? '#e74a3b' : '#333'};">${stats.suspected_duplicates || 0}</div>
			</div>
		</div>

		<div class="gw-card-row">
			<div class="gw-stat-card gw-drillable" style="--card-color:#36b9cc;" data-drilldown="welfare_balance"><div class="label">Welfare Balance</div><div class="value" style="font-size:20px;">${fmt_currency(fund.account_balance)}</div></div>
			<div class="gw-stat-card" style="--card-color:#858796;"><div class="label">Total Collected</div><div class="value" style="font-size:20px;">${fmt_currency(fund.total_collected)}</div></div>
			<div class="gw-stat-card gw-drillable" style="--card-color:#5a5c69;" data-drilldown="withdrawals"><div class="label">Total Withdrawn</div><div class="value" style="font-size:20px;">${fmt_currency(fund.total_withdrawn)}</div></div>
		</div>

		<div class="gw-section">
			<h5>Transactions
				${active_filters.aggregator || active_filters.service_category
					? `<span style="float:right;font-size:12px;font-weight:400;color:#4e73df;">
						Filtered view &mdash; showing ${recent_transactions.length} record(s)
					</span>` : ""}
			</h5>
			<table id="gw-txn-table" class="display" style="width:100%">
				<thead><tr>
					<th>Transaction ID</th><th>Date</th><th>Aggregator</th><th>Service</th>
					<th>Service Category</th><th>Amount</th><th>Base Payout</th><th>Welfare</th><th>Status</th>
				</tr></thead>
				<tbody>
					${recent_transactions.map(t => `<tr>
						<td><a href="/app/gig-transaction/${t.name}" style="color:#4e73df;">${t.name}</a></td>
						<td>${t.date || "-"}</td>
						<td>${t.aggregator || "-"}</td>
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

		<!-- Drill-down modal overlay -->
		<div id="gw-dd-overlay">
			<div id="gw-dd-modal">
				<div id="gw-dd-header">
					<div>
						<div id="gw-dd-title"></div>
						<div id="gw-dd-count"></div>
					</div>
					<button id="gw-dd-close" title="Close (Esc)">&#10005;</button>
				</div>
				<div id="gw-dd-body">
					<div id="gw-dd-summary" style="display:none;"></div>
					<div id="gw-dd-chart-wrap" style="display:none;">
						<h6>Chart</h6>
						<div id="gw-dd-chart"></div>
					</div>
					<div id="gw-dd-table-wrap">
						<h6>Detail Records</h6>
						<table id="gw-dd-dt-table" class="display" style="width:100%"></table>
					</div>
				</div>
			</div>
		</div>
		`;

		$("#gw-dashboard").html(html);

		// Initialize DataTables
		init_datatable("#gw-txn-table");
		init_datatable("#gw-wd-table");

		// PDF button
		$("#gw-btn-dl-pdf").on("click", download_pdf);

		// Filter bar — Apply button
		$("#gw-btn-apply-filter").on("click", function () {
			_active_aggregator = $("#gw-filter-agg").val() || "";
			_active_service_cat = $("#gw-filter-cat").val() || "";
			fetch_dashboard();
		});

		// Filter bar — Clear button
		$("#gw-btn-clear-filter").on("click", function () {
			_active_aggregator = "";
			_active_service_cat = "";
			fetch_dashboard();
		});

		// Aggregator breakdown cards — click to filter
		$(".gw-agg-card").on("click", function () {
			const agg = $(this).data("aggregator");
			_active_aggregator = (_active_aggregator === agg) ? "" : agg;
			fetch_dashboard();
		});

		// Service category cards — click to filter
		$(".gw-cat-card").on("click", function () {
			const cat = $(this).data("category");
			_active_service_cat = (_active_service_cat === cat) ? "" : cat;
			fetch_dashboard();
		});

		// ── Monthly chart bar drill-down ──────────────────────────────────────
		$(document).off("click.gw_month").on("click.gw_month", ".gw-month-bar", function () {
			const month = $(this).data("month");
			_active_drill_month = (_active_drill_month === month) ? "" : month;

			// Dim/highlight bars
			$("#gw-monthly-chart-svg rect.gw-month-bar").attr("opacity", "0.85");
			if (_active_drill_month) {
				$(`#gw-monthly-chart-svg rect.gw-month-bar[data-month="${_active_drill_month}"]`).attr("opacity", "1");
			}

			// Filter transaction DataTable by date column (col 1)
			if ($.fn.DataTable && $.fn.DataTable.isDataTable("#gw-txn-table")) {
				$("#gw-txn-table").DataTable().column(1).search(_active_drill_month || "", false, false).draw();
			}

			// Update drill indicator
			const $bar = $("#gw-month-drill-bar");
			if (_active_drill_month) {
				$bar.html(`
					<div style="background:#eef2ff;border:1.5px solid #4e73df;border-radius:8px;
						padding:8px 16px;display:flex;align-items:center;gap:12px;">
						<i class="fa fa-filter" style="color:#4e73df;"></i>
						<span style="color:#4e73df;font-weight:600;">Showing month: ${_active_drill_month}</span>
						<button id="gw-clear-month-drill" style="margin-left:auto;background:#4e73df;
							color:#fff;border:none;border-radius:6px;padding:4px 12px;font-size:12px;cursor:pointer;">
							Clear
						</button>
					</div>`).show();
				$("#gw-clear-month-drill").on("click", function () {
					_active_drill_month = "";
					$("#gw-monthly-chart-svg rect.gw-month-bar").attr("opacity", "0.85");
					if ($.fn.DataTable && $.fn.DataTable.isDataTable("#gw-txn-table")) {
						$("#gw-txn-table").DataTable().column(1).search("", false, false).draw();
					}
					$bar.hide();
				});
			} else {
				$bar.hide();
			}

			// Scroll to table
			const tbl = document.getElementById("gw-txn-table");
			if (tbl) tbl.closest(".gw-section").scrollIntoView({ behavior: "smooth" });
		});

		// ── Stat card + withdrawal drill-down modal ──────────────────────────
		(function bind_gw_drilldown() {
			const GW_STATUS_COLORS = {
				'Payment complete': '#1cc88a', 'Payment pending': '#4e73df',
				'Payment Cancelled': '#e74a3b', 'Suspected duplicate': '#f6c23e',
				Requested: '#17a2b8', Approved: '#28a745', Rejected: '#dc3545', Paid: '#6f42c1',
			};

			const txn_cols = [
				{ label: "Transaction ID",   render: t => `<a href="/app/gig-transaction/${t.name}" style="color:#4e73df;">${t.name}</a>` },
				{ label: "Date",             render: t => t.date || "-" },
				{ label: "Aggregator",       render: t => t.aggregator || "-" },
				{ label: "Service",          render: t => t.service || "-" },
				{ label: "Service Category", render: t => t.service_category || "-" },
				{ label: "Amount",           render: t => fmt_currency(t.amount) },
				{ label: "Base Payout",      render: t => fmt_currency(t.base_payout) },
				{ label: "Welfare",          render: t => fmt_currency(t.welfare_amount) },
				{ label: "Status",           render: t => status_badge(t.status) },
			];

			function month_trend(rows) {
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
						{ label: "Total Earnings", value: fmt_currency(rows.reduce((s, t) => s + (t.amount || 0), 0)) },
						{ label: "Total Welfare", value: fmt_currency(rows.reduce((s, t) => s + (t.welfare_amount || 0), 0)) },
					],
					chart: rows => {
						const sc = {};
						rows.forEach(t => { sc[t.status] = (sc[t.status] || 0) + 1; });
						const labels = Object.keys(sc);
						if (!labels.length) return null;
						return { type: "donut", data: { labels, datasets: [{ values: labels.map(l => sc[l]) }] }, colors: labels.map(l => GW_STATUS_COLORS[l] || "#858796") };
					},
				},
				completed_txns: {
					title: "Completed Transactions",
					rows: () => recent_transactions.filter(t => t.status === "Payment complete"),
					cols: txn_cols,
					summary: rows => [
						{ label: "Count", value: rows.length, color: "#1cc88a" },
						{ label: "Total Earnings", value: fmt_currency(rows.reduce((s, t) => s + (t.amount || 0), 0)), color: "#1cc88a" },
					],
					chart: rows => {
						const { labels, values } = month_trend(rows);
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
						const { labels, values } = month_trend(rows);
						if (!labels.length) return null;
						return { type: "bar", data: { labels, datasets: [{ name: "Pending per Month", values }] }, colors: ["#4e73df"] };
					},
				},
				cancelled_txns: {
					title: "Cancelled Transactions",
					rows: () => recent_transactions.filter(t => t.status === "Payment Cancelled"),
					cols: txn_cols,
					summary: rows => [
						{ label: "Count", value: rows.length, color: "#6c757d" },
						{ label: "Total Amount", value: fmt_currency(rows.reduce((s, t) => s + (t.amount || 0), 0)) },
					],
					chart: null,
				},
				dup_txns: {
					title: "Suspected Duplicate Transactions",
					rows: () => recent_transactions.filter(t => t.status === "Suspected duplicate"),
					cols: txn_cols,
					summary: rows => [{ label: "Count", value: rows.length, color: "#f6c23e" }],
					chart: null,
				},
				welfare_balance: {
					title: "Welfare Fund Details",
					rows: () => [],
					cols: [],
					summary: () => [
						{ label: "Current Balance", value: fmt_currency(fund.account_balance), color: "#36b9cc" },
						{ label: "Total Collected", value: fmt_currency(fund.total_collected) },
						{ label: "Total Withdrawn", value: fmt_currency(fund.total_withdrawn) },
					],
					chart: null,
				},
				withdrawals: {
					title: "My Withdrawal Requests",
					rows: () => withdrawals,
					cols: [
						{ label: "Request ID", render: w => `<a href="/app/welfare-benefit-withdrawal/${w.name}" style="color:#4e73df;">${w.name}</a>` },
						{ label: "Date",       render: w => (w.creation || "").substring(0, 10) },
						{ label: "Amount",     render: w => fmt_currency(w.amount) },
						{ label: "Reason",     render: w => w.reason || "-" },
						{ label: "Status",     render: w => status_badge(w.status) },
					],
					summary: rows => [
						{ label: "Total Requests", value: rows.length },
						{ label: "Total Withdrawn", value: fmt_currency(rows.reduce((s, w) => s + (w.amount || 0), 0)) },
					],
					chart: rows => {
						if (!rows.length) return null;
						const sc = {};
						rows.forEach(w => { sc[w.status] = (sc[w.status] || 0) + 1; });
						const labels = Object.keys(sc);
						return { type: "donut", data: { labels, datasets: [{ values: labels.map(l => sc[l]) }] }, colors: labels.map(l => GW_STATUS_COLORS[l] || "#858796") };
					},
				},
			};

			function render_gw_dd_summary(items) {
				const $el = $("#gw-dd-summary");
				if (!items || !items.length) { $el.hide(); return; }
				$el.show().html(items.map(item =>
					`<div class="gw-dd-stat">
						<div class="gw-dd-stat-label">${item.label}</div>
						<div class="gw-dd-stat-value" style="color:${item.color || "#333"};">${item.value}</div>
					</div>`
				).join(""));
			}

			function render_gw_dd_chart(cfg) {
				const $wrap = $("#gw-dd-chart-wrap");
				$wrap.hide();
				$("#gw-dd-chart").empty();
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
					new frappe.Chart("#gw-dd-chart", opts);
				} catch (_) {
					$wrap.hide();
				}
			}

			function open_gw_drilldown(type) {
				const cfg = configs[type];
				if (!cfg) return;
				const rows = cfg.rows();

				if ($.fn.DataTable && $.fn.DataTable.isDataTable("#gw-dd-dt-table")) {
					$("#gw-dd-dt-table").DataTable().destroy();
					$("#gw-dd-dt-table").empty();
				}

				$("#gw-dd-title").text(cfg.title);
				$("#gw-dd-count").text(`${rows.length} record${rows.length !== 1 ? "s" : ""}`);

				render_gw_dd_summary(cfg.summary ? cfg.summary(rows) : null);
				render_gw_dd_chart(rows.length && cfg.chart ? cfg.chart(rows) : null);

				if (cfg.cols && cfg.cols.length) {
					const thead = `<thead><tr>${cfg.cols.map(c => `<th>${c.label}</th>`).join("")}</tr></thead>`;
					const tbody_html = rows.length
						? rows.map(row => `<tr>${cfg.cols.map(c => `<td>${c.render(row)}</td>`).join("")}</tr>`).join("")
						: `<tr><td colspan="${cfg.cols.length}" style="text-align:center;color:#aaa;padding:24px;">No records found</td></tr>`;
					$("#gw-dd-dt-table").html(`${thead}<tbody>${tbody_html}</tbody>`);
					if (rows.length && $.fn.DataTable) {
						$("#gw-dd-dt-table").DataTable({
							pageLength: 15, lengthMenu: [10, 15, 25, 50, 100], order: [],
							language: { search: "Filter:", lengthMenu: "Show _MENU_ entries", info: "Showing _START_ to _END_ of _TOTAL_ records", emptyTable: "No records found" },
							dom: '<"dt-top"lf>rt<"dt-bottom"ip>',
						});
					}
				} else {
					$("#gw-dd-dt-table").html(`<tbody><tr><td style="text-align:center;padding:24px;color:#888;">No detailed records available for this view.</td></tr></tbody>`);
				}

				$("#gw-dd-overlay").addClass("active");
				$("#gw-dd-body").scrollTop(0);
			}

			function close_gw_drilldown() {
				if ($.fn.DataTable && $.fn.DataTable.isDataTable("#gw-dd-dt-table")) {
					$("#gw-dd-dt-table").DataTable().destroy();
					$("#gw-dd-dt-table").empty();
				}
				$("#gw-dd-overlay").removeClass("active");
			}

			$(document).off("click.gw_drilldown").off("keydown.gw_drilldown");
			$("#gw-dashboard").off("click.gw_drilldown");

			$("#gw-dashboard").on("click.gw_drilldown", ".gw-drillable[data-drilldown]", function () {
				open_gw_drilldown($(this).data("drilldown"));
			});

			$("#gw-dd-close").on("click", close_gw_drilldown);
			$("#gw-dd-overlay").on("click", function (e) {
				if ($(e.target).is("#gw-dd-overlay")) close_gw_drilldown();
			});
			$(document).on("keydown.gw_drilldown", function (e) {
				if (e.key === "Escape" && $("#gw-dd-overlay").hasClass("active")) close_gw_drilldown();
			});
		})();
	}
};
