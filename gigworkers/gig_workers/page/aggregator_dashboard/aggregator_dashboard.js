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
			'Payment complete': "#28a745", 'Payment pending': "#007bff", Pending: "#ffc107",
			Onboarded: "#28a745", Inactive: "#6c757d", Approved: "#28a745",
			Rejected: "#dc3545", Active: "#1cc88a", Offboarded: "#6c757d", 'Payment Cancelled': "#dc3545", 'Suspected duplicate': "#ffc107"
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
			doc.text("Aggregator Dashboard Report", ML, y);
			doc.setFont(undefined, "normal");
			y += 16;

			doc.setFontSize(8.5); doc.setTextColor(...MUTED);
			doc.text("Gig Workers Welfare Portal", ML, y);
			y += 13;

			doc.setFontSize(8); doc.setTextColor(...DARK);
			doc.text("Aggregator:", ML, y);
			doc.setFont(undefined, "bold");
			doc.text(`${d.aggregator.aggregator_name || "-"}  (${d.aggregator_id})`, ML + 60, y);
			doc.setFont(undefined, "normal");
			y += 14;

			doc.setDrawColor(...BLACK);
			doc.setLineWidth(0.5);
			doc.line(ML, y, ML + CW, y);
			y += 20;

			// Transaction stats
			section_heading("Transactions");
			stats_table([
				{ label: "Total Transactions",       value: d.stats.total_transactions },
				{ label: "Completed",                value: d.stats.completed_transactions },
				{ label: "Pending",                  value: d.stats.pending_transactions },
				{ label: "Total Amount (INR)",        value: fmt_currency_plain(d.stats.total_amount) },
				{ label: "Total Welfare (INR)",       value: fmt_currency_plain(d.stats.total_welfare) },
				{ label: "Base Payout Total (INR)",   value: fmt_currency_plain(d.stats.total_base_payout) },
			]);

			// Worker & welfare stats
			section_heading("Workers & Welfare");
			stats_table([
				{ label: "Total Workers",             value: d.workers.total },
				{ label: "Onboarded Workers",         value: d.workers.active },
				{ label: "Welfare Fees Settled (INR)", value: fmt_currency_plain(d.welfare_payments.total_paid) },
				{ label: "Welfare Fees Pending (INR)", value: fmt_currency_plain(d.welfare_payments.pending_amount) },
			]);

			// Transactions table
			section_heading("Transaction Details");
			pdf_table(
				["Txn ID", "Date", "Gig Worker", "Service", "Amount (INR)", "Base Payout (INR)", "Welfare (INR)", "Status"],
				(d.recent_transactions || []).map(t => [
					t.name, t.date || "-", t.gig_worker || "-", t.service || "-",
					fmt_currency_plain(t.amount), fmt_currency_plain(t.base_payout),
					fmt_currency_plain(t.welfare_amount), t.status || "-",
				])
			);

			// Worker mapping log table
			section_heading("Worker Mapping Log");
			pdf_table(
				["Log ID", "Gig Worker", "Service", "Event", "Worker Status", "Logged At"],
				(d.worker_list || []).map(w => [
					w.name, w.gig_worker || "-", w.service || "-",
					w.event_type || "-", w.worker_status || "-",
					(w.log_datetime || "").substring(0, 16),
				])
			);

			// Pending welfare fee payments table
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

	function render_dashboard(data) {
		const { aggregator, aggregator_id, stats, workers, welfare_payments,
			recent_transactions, worker_list, pending_wfp,
			service_categories, active_filters, suspected_dups,
			services } = data;

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

		<div class="agg-profile">
			<div class="agg-avatar">${(aggregator.aggregator_name || "?")[0].toUpperCase()}</div>
			<div class="agg-profile-info">
				<div class="name">${aggregator.aggregator_name || "-"}</div>
				<div class="meta">
					${aggregator_id} &nbsp;|&nbsp; ${aggregator.email || ""} &nbsp;|&nbsp;
					${status_badge(aggregator.status)}
					${(services && services.length) ? `&nbsp;|&nbsp; <span style="color:#4e73df;font-weight:600;">${services.length} Service${services.length > 1 ? "s" : ""} Registered</span>` : ""}
				</div>
			</div>
		</div>

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

		<div class="agg-card-row">
			<div class="agg-stat-card" style="--card-color:#4e73df;"><div class="label">Total Transactions</div><div class="value">${stats.total_transactions}</div></div>
			<div class="agg-stat-card" style="--card-color:#1cc88a;"><div class="label">Payment Complete</div><div class="value">${stats.completed_transactions}</div></div>
			<div class="agg-stat-card" style="--card-color:#f6c23e;"><div class="label">Payment Pending</div><div class="value">${stats.pending_transactions}</div></div>
			<div class="agg-stat-card" style="--card-color:#6c757d;"><div class="label">Payment Cancelled</div><div class="value">${stats.cancelled_transactions}</div></div>
			<div class="agg-stat-card" style="--card-color:#e74a3b;cursor:${stats.suspected_duplicates ? 'pointer' : 'default'};"
				onclick="if(${stats.suspected_duplicates || 0}){var el=document.getElementById('agg-dup-section');if(el)el.scrollIntoView({behavior:'smooth'});}">
				<div class="label">Suspected Duplicates</div>
				<div class="value" style="color:${stats.suspected_duplicates ? '#e74a3b' : '#333'};">${stats.suspected_duplicates || 0}</div>
			</div>
		</div>

		<div class="agg-card-row">
			<div class="agg-stat-card" style="--card-color:#4e73df;"><div class="label">Total Workers</div><div class="value">${workers.total}</div></div>
			<div class="agg-stat-card" style="--card-color:#1cc88a;"><div class="label">Onboarded Workers</div><div class="value">${workers.active}</div></div>
			<div class="agg-stat-card" style="--card-color:#28a745;"><div class="label">Welfare Fees Settled</div><div class="value" style="font-size:20px;">${fmt_currency(welfare_payments.total_paid)}</div></div>
			<div class="agg-stat-card" style="--card-color:#e74a3b;"><div class="label">Welfare Fees Pending</div><div class="value" style="font-size:20px;color:#e74a3b;">${fmt_currency(welfare_payments.pending_amount)}</div></div>
		</div>

		<!-- Transactions Table -->
		<div class="agg-section">
			<h5>Transactions
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
		`;

		$("#agg-dashboard").html(html);

		// Initialize DataTables
		init_datatable("#agg-txn-table");
		init_datatable("#agg-wfp-table");
		if (suspected_dups && suspected_dups.length) {
			init_datatable("#agg-dup-table");
		}

		$("#agg-btn-dl-pdf").on("click", download_pdf);

		// Service tab switching
		$(document).off("click.svctab").on("click.svctab", ".svc-tab-btn", function () {
			const idx = $(this).data("idx");
			const svc = $(this).data("svc");
			// "All Services" tab: grey style, others blue
			$(".svc-tab-btn[data-idx='-1']").css({ background: "#fff", color: "#555" });
			$(".svc-tab-btn:not([data-idx='-1'])").css({ background: "#fff", color: "#4e73df" });
			if (idx === -1) { $(this).css({ background: "#555", color: "#fff" }); }
			else { $(this).css({ background: "#4e73df", color: "#fff" }); }
			$(".svc-detail").hide();
			if (idx !== -1) $(`.svc-detail[data-idx="${idx}"]`).show();
			_active_platform = svc || "";
			fetch_dashboard();
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
