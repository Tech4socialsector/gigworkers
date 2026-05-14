frappe.pages["admin-dashboard"].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({
		parent: wrapper,
		title: "Admin Dashboard",
		single_column: true,
	});

	$(wrapper).find(".page-content").html(`
		<div id="admin-dashboard" style="padding: 20px;">
			<div id="admin-loading" style="text-align:center; padding: 60px; color: #888;">
				<i class="fa fa-spinner fa-spin fa-2x"></i>
				<p style="margin-top:12px;">Loading dashboard...</p>
			</div>
		</div>
	`);

	// Store last fetched data for downloads
	let _dash_data = null;
	let _dash_filters = {};

	load_datatables(function () {
		fetch_data({});
	});

	// ── helpers ──────────────────────────────────────────────────────────────

	function load_datatables(callback) {
		if ($.fn.DataTable) { callback(); return; }
		$("<link>")
			.attr({ rel: "stylesheet", href: "https://cdn.datatables.net/1.13.7/css/jquery.dataTables.min.css" })
			.appendTo("head");
		$.getScript("https://cdn.datatables.net/1.13.7/js/jquery.dataTables.min.js", callback);
	}

	function init_datatable(table_id) {
		if (!$.fn.DataTable) return;
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

	function fmt_currency(val) {
		return "₹" + parseFloat(val || 0).toLocaleString("en-IN", {
			minimumFractionDigits: 2, maximumFractionDigits: 2,
		});
	}

	function fmt_currency_plain(val) {
		return parseFloat(val || 0).toFixed(2);
	}

	function status_badge(status) {
		const colors = {
			'Payment complete': "#28a745", 'Payment pending': "#007bff", Pending: "#ffc107",
			Onboarded: "#28a745", Inactive: "#6c757d", Approved: "#28a745",
			Rejected: "#dc3545", Active: "#1cc88a", Offboarded: "#6c757d",
			Deceased: "#343a40", 'Payment Cancelled': "#dc3545", 'Suspected duplicate': "#ffc107"
		};
		return `<span style="background:${colors[status] || "#6c757d"};color:#fff;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;">${status || "-"}</span>`;
	}

	function pad(n) { return String(n).padStart(2, "0"); }

	function today_str() {
		const d = new Date();
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
	}

	function month_range(year, month) {
		const last = new Date(year, month, 0).getDate();
		return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(last)}` };
	}

	function preset_to_dates(preset) {
		const d = new Date(), y = d.getFullYear(), m = d.getMonth() + 1;
		if (preset === "today") return { from: today_str(), to: today_str() };
		if (preset === "this_week") {
			const day = d.getDay() || 7;
			const mon = new Date(d); mon.setDate(d.getDate() - day + 1);
			const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
			return {
				from: `${mon.getFullYear()}-${pad(mon.getMonth()+1)}-${pad(mon.getDate())}`,
				to:   `${sun.getFullYear()}-${pad(sun.getMonth()+1)}-${pad(sun.getDate())}`,
			};
		}
		if (preset === "this_month")   return month_range(y, m);
		if (preset === "last_month")   return month_range(m === 1 ? y-1 : y, m === 1 ? 12 : m-1);
		if (preset === "this_quarter") {
			const q = Math.ceil(m / 3);
			return { from: month_range(y, (q-1)*3+1).from, to: month_range(y, q*3).to };
		}
		if (preset === "this_year") return { from: `${y}-01-01`, to: `${y}-12-31` };
		return { from: "", to: "" }; // "all"
	}

	// ── data fetch ────────────────────────────────────────────────────────────

	function fetch_data(filters) {
		_dash_filters = filters;
		$("#admin-dashboard").html(`
			<div id="admin-loading" style="text-align:center; padding: 60px; color: #888;">
				<i class="fa fa-spinner fa-spin fa-2x"></i>
				<p style="margin-top:12px;">Loading dashboard...</p>
			</div>
		`);
		frappe.call({
			method: "gigworkers.gig_workers.page.admin_dashboard.admin_dashboard.get_dashboard_data",
			args: { from_date: filters.from_date || "", to_date: filters.to_date || "", aggregator: filters.aggregator || "" },
			callback(r) {
				if (r.message) { _dash_data = r.message; render_dashboard(r.message, filters); }
			},
			error() {
				$("#admin-dashboard").html('<p style="color:red;padding:20px;">Failed to load dashboard. Please refresh.</p>');
			},
		});
	}

	// ── filter bar ────────────────────────────────────────────────────────────

	function build_filter_bar(aggregator_list, current) {
		const now = new Date();
		const cur_year = now.getFullYear();
		const years = [];
		for (let y = cur_year; y >= cur_year - 5; y--) years.push(y);

		const months = [
			["", "All Months"], ["01", "Jan"], ["02", "Feb"], ["03", "Mar"],
			["04", "Apr"], ["05", "May"], ["06", "Jun"], ["07", "Jul"],
			["08", "Aug"], ["09", "Sep"], ["10", "Oct"], ["11", "Nov"], ["12", "Dec"],
		];

		const cur_agg_label = current.aggregator
			? (aggregator_list.find(a => a.name === current.aggregator) || {aggregator_name: current.aggregator}).aggregator_name + ` (${current.aggregator})`
			: "";

		return `
		<style>
			#admin-filter-bar {
				background: #fff;
				border-radius: 12px;
				box-shadow: 0 1px 8px rgba(0,0,0,0.08);
				margin-bottom: 24px;
				padding: 16px 20px 14px;
			}
			.filter-row {
				display: flex;
				flex-wrap: wrap;
				gap: 12px;
				align-items: flex-end;
			}
			.filter-field {
				display: flex;
				flex-direction: column;
				gap: 5px;
			}
			.filter-field > label {
				font-size: 11px;
				font-weight: 700;
				color: #aaa;
				text-transform: uppercase;
				letter-spacing: .5px;
				margin: 0;
			}
			.filter-control {
				height: 36px;
				border: 1.5px solid #e8e8e8;
				border-radius: 8px;
				padding: 0 10px;
				font-size: 13px;
				color: #333;
				background: #fafafa;
				outline: none;
				transition: border-color .15s, box-shadow .15s;
				cursor: pointer;
				font-family: inherit;
			}
			.filter-control:focus {
				border-color: #4e73df;
				box-shadow: 0 0 0 3px rgba(78,115,223,.12);
				background: #fff;
			}
			.filter-divider {
				width: 1px; background: #eee;
				align-self: stretch; margin: 0 2px;
			}
			#admin-filter-apply {
				height: 36px; padding: 0 22px;
				border-radius: 8px; font-size: 13px; font-weight: 600;
				background: #4e73df; border: none; color: #fff;
				cursor: pointer; transition: background .15s;
				box-shadow: 0 2px 6px rgba(78,115,223,.3);
				font-family: inherit;
			}
			#admin-filter-apply:hover { background: #3a5ec7; }
			#admin-filter-clear {
				height: 36px; padding: 0 14px; border-radius: 8px;
				font-size: 13px; font-weight: 500; background: transparent;
				border: 1.5px solid #e0e0e0; color: #999; cursor: pointer;
				transition: all .15s; font-family: inherit;
			}
			#admin-filter-clear:hover { border-color: #e74a3b; color: #e74a3b; background: #fff5f5; }

			/* Aggregator search */
			.agg-search-wrap { position: relative; }
			#admin-agg-dropdown {
				display: none; position: absolute; top: calc(100% + 4px); left: 0; right: 0;
				background: #fff; border: 1.5px solid #e8e8e8; border-radius: 8px;
				box-shadow: 0 6px 20px rgba(0,0,0,0.12); z-index: 9999;
				max-height: 220px; overflow-y: auto;
			}
			.agg-option {
				padding: 9px 12px; font-size: 13px; color: #333; cursor: pointer;
				border-bottom: 1px solid #f5f5f5; transition: background .1s;
			}
			.agg-option:last-child { border-bottom: none; }
			.agg-option:hover, .agg-option.highlighted { background: #eef2ff; color: #4e73df; }
			.agg-option .agg-id { font-size: 11px; color: #aaa; margin-left: 6px; }
			.agg-clear-btn {
				position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
				color: #bbb; cursor: pointer; font-size: 14px; line-height: 1;
				display: none;
			}
			.agg-clear-btn:hover { color: #e74a3b; }

			/* Active filter tags */
			.filter-tag {
				display: inline-flex; align-items: center; gap: 5px;
				padding: 3px 10px; border-radius: 20px;
				font-size: 12px; font-weight: 600;
			}
		</style>

		<div id="admin-filter-bar">
			<div class="filter-row">

				<!-- Period quick-select -->
				<div class="filter-field">
					<label>Period</label>
					<select id="admin-filter-preset" class="filter-control" style="width:140px;">
						<option value="">Custom</option>
						<option value="today">Today</option>
						<option value="this_week">This Week</option>
						<option value="this_month">This Month</option>
						<option value="last_month">Last Month</option>
						<option value="this_quarter">This Quarter</option>
						<option value="this_year">This Year</option>
						<option value="all">All Time</option>
					</select>
				</div>

				<div class="filter-divider"></div>

				<!-- Year -->
				<div class="filter-field">
					<label>Year</label>
					<select id="admin-filter-year" class="filter-control" style="width:100px;">
						<option value="">All</option>
						${years.map(y => `<option value="${y}" ${current.year == y ? "selected" : ""}>${y}</option>`).join("")}
					</select>
				</div>

				<!-- Month -->
				<div class="filter-field">
					<label>Month</label>
					<select id="admin-filter-month" class="filter-control" style="width:110px;">
						${months.map(([v, l]) => `<option value="${v}" ${current.month === v ? "selected" : ""}>${l}</option>`).join("")}
					</select>
				</div>

				<div class="filter-divider"></div>

				<!-- From Date -->
				<div class="filter-field">
					<label>From</label>
					<input id="admin-filter-from" type="date" class="filter-control" value="${current.from_date || ""}" style="width:140px;">
				</div>

				<!-- To Date -->
				<div class="filter-field">
					<label>To</label>
					<input id="admin-filter-to" type="date" class="filter-control" value="${current.to_date || ""}" style="width:140px;">
				</div>

				<div class="filter-divider"></div>

				<!-- Aggregator search -->
				<div class="filter-field">
					<label>Aggregator</label>
					<div class="agg-search-wrap">
						<input id="admin-agg-search" type="text" class="filter-control"
							placeholder="Type to search…"
							value="${cur_agg_label}"
							autocomplete="off" style="width:200px;padding-right:28px;">
						<input id="admin-filter-agg" type="hidden" value="${current.aggregator || ""}">
						<span class="agg-clear-btn" id="admin-agg-clear" title="Clear">&#10005;</span>
						<div id="admin-agg-dropdown"></div>
					</div>
				</div>

				<!-- Buttons -->
				<div class="filter-field">
					<label style="visibility:hidden;">x</label>
					<div style="display:flex;gap:8px;">
						<button id="admin-filter-apply">
							<i class="fa fa-search" style="margin-right:5px;font-size:11px;"></i>Apply
						</button>
						<button id="admin-filter-clear">
							<i class="fa fa-times" style="margin-right:4px;font-size:11px;"></i>Clear
						</button>
					</div>
				</div>

			</div>

			<!-- Active filter tags -->
			<div id="admin-active-filters" style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;min-height:20px;"></div>
		</div>
		`;
	}

	function read_filters() {
		return {
			from_date:  $("#admin-filter-from").val(),
			to_date:    $("#admin-filter-to").val(),
			aggregator: $("#admin-filter-agg").val(),
			year:       $("#admin-filter-year").val(),
			month:      $("#admin-filter-month").val(),
		};
	}

	function bind_filter_events(aggregator_list) {

		// ── Aggregator search autocomplete ──
		const $search  = $("#admin-agg-search");
		const $hidden  = $("#admin-filter-agg");
		const $dd      = $("#admin-agg-dropdown");
		const $clr     = $("#admin-agg-clear");

		function show_agg_dropdown(query) {
			const q = (query || "").toLowerCase().trim();
			const matches = q
				? aggregator_list.filter(a =>
					(a.aggregator_name || "").toLowerCase().includes(q) ||
					a.name.toLowerCase().includes(q))
				: aggregator_list;

			if (!matches.length) { $dd.hide(); return; }

			$dd.html(matches.slice(0, 20).map(a =>
				`<div class="agg-option" data-id="${a.name}">
					${a.aggregator_name || a.name}
					<span class="agg-id">${a.name}</span>
				</div>`
			).join("")).show();
		}

		$search.on("input", function () {
			const val = $(this).val();
			if (!val) { $hidden.val(""); $clr.hide(); }
			else { $clr.show(); }
			show_agg_dropdown(val);
		});

		$search.on("focus", function () {
			if (!$hidden.val()) show_agg_dropdown($(this).val());
		});

		$(document).on("click", ".agg-option", function () {
			const id   = $(this).data("id");
			const name = $(this).text().replace(id, "").trim();
			$hidden.val(id);
			$search.val(`${name} (${id})`);
			$clr.show();
			$dd.hide();
		});

		$clr.on("click", function () {
			$hidden.val(""); $search.val(""); $clr.hide(); $dd.hide();
		});

		// Close dropdown on outside click
		$(document).on("click.agg_dd", function (e) {
			if (!$(e.target).closest(".agg-search-wrap").length) $dd.hide();
		});

		// ── Period preset ──
		$("#admin-filter-preset").on("change", function () {
			const preset = $(this).val();
			if (!preset) return;
			const { from, to } = preset_to_dates(preset);
			$("#admin-filter-from").val(from);
			$("#admin-filter-to").val(to);
			// sync year/month dropdowns for month presets
			if (preset === "this_month" || preset === "last_month") {
				const d = from ? from.split("-") : [];
				if (d.length >= 2) { $("#admin-filter-year").val(d[0]); $("#admin-filter-month").val(d[1]); }
			} else if (preset === "this_year") {
				$("#admin-filter-year").val(new Date().getFullYear()); $("#admin-filter-month").val("");
			} else {
				$("#admin-filter-year").val(""); $("#admin-filter-month").val("");
			}
		});

		// ── Year / Month → auto-fill date range ──
		function sync_year_month() {
			const year  = $("#admin-filter-year").val();
			const month = $("#admin-filter-month").val();
			if (year && month) {
				const r = month_range(parseInt(year), parseInt(month));
				$("#admin-filter-from").val(r.from); $("#admin-filter-to").val(r.to);
			} else if (year && !month) {
				$("#admin-filter-from").val(`${year}-01-01`); $("#admin-filter-to").val(`${year}-12-31`);
			}
			$("#admin-filter-preset").val("");
		}
		$("#admin-filter-year").on("change", sync_year_month);
		$("#admin-filter-month").on("change", sync_year_month);

		// Manual date change → clear period/year/month
		$("#admin-filter-from, #admin-filter-to").on("change", function () {
			$("#admin-filter-year").val(""); $("#admin-filter-month").val("");
			$("#admin-filter-preset").val("");
		});

		// ── Apply / Clear ──
		$("#admin-filter-apply").on("click", function () { fetch_data(read_filters()); });

		$("#admin-filter-clear").on("click", function () {
			$("#admin-filter-from, #admin-filter-to").val("");
			$("#admin-filter-year, #admin-filter-month").val("");
			$("#admin-filter-preset").val("");
			$hidden.val(""); $search.val(""); $clr.hide(); $dd.hide();
			fetch_data({});
		});
	}

	function render_active_tags(filters) {
		const tags = [];
		if (filters.from_date || filters.to_date) {
			const label = filters.from_date && filters.to_date
				? `${filters.from_date} → ${filters.to_date}`
				: filters.from_date ? `From ${filters.from_date}` : `Until ${filters.to_date}`;
			tags.push(`<span class="filter-tag" style="background:#eef2ff;color:#4e73df;border:1px solid #c7d5f8;">
				<i class="fa fa-calendar" style="font-size:10px;"></i> ${label}</span>`);
		}
		if (filters.aggregator) {
			const agg = (_dash_data && _dash_data.aggregator_list || []).find(a => a.name === filters.aggregator);
			const label = agg ? `${agg.aggregator_name} (${agg.name})` : filters.aggregator;
			tags.push(`<span class="filter-tag" style="background:#e6f9f0;color:#1a8a50;border:1px solid #b3e8ce;">
				<i class="fa fa-building" style="font-size:10px;"></i> ${label}</span>`);
		}
		if (!tags.length) {
			tags.push(`<span style="color:#bbb;font-size:12px;font-style:italic;">No filters applied — showing all data</span>`);
		}
		$("#admin-active-filters").html(tags.join(""));
	}

	// ── downloads ────────────────────────────────────────────────────────────

	function download_pdf() {
		if (!_dash_data) return;

		function do_pdf() {
			const { jsPDF } = window.jspdf;
			// Portrait A4
			const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
			const d   = _dash_data;
			const PW  = doc.internal.pageSize.getWidth();   // 595.28
			const PH  = doc.internal.pageSize.getHeight();  // 841.89
			const ML  = 45, MR = 45, CW = PW - ML - MR;

			const now        = new Date();
			const nowStr     = now.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
			const downloader = (frappe.session && frappe.session.user) || "Unknown";
			const date_label = _dash_filters.from_date
				? `${_dash_filters.from_date}  to  ${_dash_filters.to_date || "now"}`
				: "All Time";

			// ── palette: black / white / grey only ──────────────────────────
			const BLACK   = [0, 0, 0];
			const WHITE   = [255, 255, 255];
			const DARK    = [30, 30, 30];
			const GREY_HD = [50, 50, 50];      // table header bg
			const GREY_LT = [245, 245, 245];   // alternating row
			const MUTED   = [130, 130, 130];
			const BORDER  = [180, 180, 180];

			// ── footer on every page ────────────────────────────────────────
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

			// ── section heading ─────────────────────────────────────────────
			let y = 0;
			function section_heading(title) {
				// Space before section
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

			// ── stats summary table (2-col: label | value) ──────────────────
			function stats_table(rows_data) {
				// Split into 2 columns side by side
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
						// row bg
						doc.setFillColor(...(isEven ? WHITE : GREY_LT));
						doc.rect(ox, ry, colW, rowH, "F");
						// border
						doc.setDrawColor(...BORDER);
						doc.setLineWidth(0.3);
						doc.rect(ox, ry, colW, rowH, "S");
						// label
						doc.setFontSize(8); doc.setFont(undefined, "normal");
						doc.setTextColor(...MUTED);
						doc.text(item.label, ox + 6, ry + 12, { maxWidth: labelW - 8 });
						// value
						doc.setFont(undefined, "bold");
						doc.setTextColor(...DARK);
						doc.text(String(item.value), ox + labelW + valW - 6, ry + 12, { align: "right", maxWidth: valW - 4 });
					});
				});

				y += Math.max(left.length, right.length) * rowH + 10;
				doc.setFont(undefined, "normal");
			}

			// ── data table ──────────────────────────────────────────────────
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
					margin: { left: ML, right: MR, bottom: 50 },
				});
				y = doc.lastAutoTable.finalY + 14;
			}

			// ════════════════════════════════════════════════════════════════
			// Page border (drawn once; repeated via footer loop later)
			// ════════════════════════════════════════════════════════════════
			function draw_page_border() {
				const pages = doc.internal.getNumberOfPages();
				for (let i = 1; i <= pages; i++) {
					doc.setPage(i);
					doc.setDrawColor(...BORDER);
					doc.setLineWidth(1);
					doc.rect(20, 20, PW - 40, PH - 40, "S");
				}
			}

			// ════════════════════════════════════════════════════════════════
			// Title block
			// ════════════════════════════════════════════════════════════════
			y = 60;

			// Top rule — with proper gap above text
			doc.setDrawColor(...BLACK);
			doc.setLineWidth(1.5);
			doc.line(ML, y, ML + CW, y);
			y += 14;

			doc.setFontSize(15); doc.setFont(undefined, "bold");
			doc.setTextColor(...DARK);
			doc.text("Admin Dashboard Report", ML, y);
			doc.setFont(undefined, "normal");
			y += 16;

			doc.setFontSize(8.5); doc.setTextColor(...MUTED);
			doc.text("Gig Workers Welfare Portal", ML, y);
			y += 13;

			// Meta row
			doc.setFontSize(8); doc.setTextColor(...DARK);
			doc.text("Period:", ML, y);
			doc.setFont(undefined, "bold");
			doc.text(date_label, ML + 40, y);
			doc.setFont(undefined, "normal");
			y += 14;

			// Bottom rule
			doc.setDrawColor(...BLACK);
			doc.setLineWidth(0.5);
			doc.line(ML, y, ML + CW, y);
			y += 20;

			// ── TRANSACTIONS summary ─────────────────────────────────────────
			section_heading("Transactions");
			stats_table([
				{ label: "Total Transactions",    value: d.stats.total_transactions },
				{ label: "Completed",             value: d.stats.completed_transactions },
				{ label: "Pending",               value: d.stats.pending_transactions },
				{ label: "Total Amount (INR)",     value: fmt_currency_plain(d.stats.total_amount) },
				{ label: "Welfare Collected (INR)",value: fmt_currency_plain(d.stats.total_welfare) },
				{ label: "Base Payout Total (INR)",value: fmt_currency_plain(d.stats.total_base_payout) },
			]);

			// ── PLATFORM OVERVIEW ────────────────────────────────────────────
			section_heading("Platform Overview");
			stats_table([
				{ label: "Total Aggregators",     value: d.aggregators.total },
				{ label: "Active Aggregators",    value: d.aggregators.active },
				{ label: "Total Gig Workers",     value: d.workers.total },
				{ label: "Active Workers",        value: d.workers.active },
				{ label: "Inactive Workers",      value: d.workers.inactive },
			]);

			// ── WELFARE ──────────────────────────────────────────────────────
			section_heading("Welfare");
			stats_table([
				{ label: "Fees Settled (INR)",    value: fmt_currency_plain(d.welfare_payments.total_paid) },
				{ label: "Fees Pending (INR)",    value: fmt_currency_plain(d.welfare_payments.pending_amount) },
				{ label: "Fund Balance (INR)",    value: fmt_currency_plain(d.welfare_fund.total_balance) },
				{ label: "Total Collected (INR)", value: fmt_currency_plain(d.welfare_fund.total_collected) },
				{ label: "Total Withdrawn (INR)", value: fmt_currency_plain(d.welfare_fund.total_withdrawn) },
			]);

			// ── AGGREGATOR BREAKDOWN ─────────────────────────────────────────
			section_heading("Aggregator Breakdown");
			pdf_table(
				["Aggregator ID", "Name", "Status", "Workers", "Transactions", "Total Amt (INR)", "Welfare (INR)", "Pending Fees (INR)"],
				d.aggregator_breakdown.map(a => [
					a.aggregator_id, a.aggregator_name || "-", a.status || "-",
					a.worker_count || 0, a.txn_count || 0,
					fmt_currency_plain(a.txn_amount),
					fmt_currency_plain(a.welfare_collected),
					fmt_currency_plain(a.pending_fees),
				])
			);

			// ── TRANSACTIONS TABLE ───────────────────────────────────────────
			section_heading("Transaction Details");
			pdf_table(
				["Txn ID", "Date", "Aggregator", "Gig Worker", "Service", "Service Category", "Amount (INR)", "Welfare (INR)", "Status"],
				d.recent_transactions.map(t => [
					t.name, t.date || "-", t.aggregator || "-", t.gig_worker || "-",
					t.service || "-", t.service_category || "-", fmt_currency_plain(t.amount),
					fmt_currency_plain(t.welfare_amount), t.status || "-",
				])
			);

			// ── PENDING WELFARE FEE PAYMENTS ─────────────────────────────────
			section_heading("Pending Welfare Fee Payments");
			pdf_table(
				["Payment ID", "Aggregator", "Transaction", "Fee Amount (INR)", "Due Date", "Status"],
				d.pending_wfp.map(p => [
					p.name, p.aggregator || "-", p.transaction || "-",
					fmt_currency_plain(p.fee_amount), p.payment_date || "-", p.payment_status || "-",
				])
			);

			// ── GIG WORKERS ──────────────────────────────────────────────────
			section_heading("Gig Workers");
			pdf_table(
				["Worker ID", "Name", "Gender", "Status", "Registered By"],
				d.recent_workers.map(w => [
					w.name, w.worker_name || "-", w.gender || "-",
					w.status || "-", w.created_by_aggregator || "-",
				])
			);

			draw_footer();
			draw_page_border();
			doc.save(`admin_dashboard_${today_str()}.pdf`);
		}

		if (window.jspdf && window.jspdf.jsPDF) { do_pdf(); return; }

		frappe.show_alert({ message: "Loading PDF library…", indicator: "blue" });
		$.getScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js", function () {
			$.getScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js", function () {
				do_pdf();
			});
		});
	}

	// ── drilldown ─────────────────────────────────────────────────────────────

	function bind_drilldown_events() {
		const d = _dash_data;
		if (!d) return;

		// Column definitions reused across drilldown types
		const txn_cols = [
			{ label: "Transaction ID", render: t => `<a href="/app/gig-transaction/${t.name}" style="color:#4e73df;">${t.name}</a>` },
			{ label: "Date",           render: t => t.date || "-" },
			{ label: "Aggregator",     render: t => t.aggregator || "-" },
			{ label: "Gig Worker",     render: t => t.gig_worker || "-" },
			{ label: "Service",        render: t => t.service || "-" },
			{ label: "Service Category", render: t => t.service_category || "-" },
			{ label: "Amount",         render: t => fmt_currency(t.amount) },
			{ label: "Welfare",        render: t => fmt_currency(t.welfare_amount) },
			{ label: "Base Payout",    render: t => fmt_currency(t.base_payout) },
			{ label: "Status",         render: t => status_badge(t.status) },
		];

		const worker_cols = [
			{ label: "Worker ID",      render: w => `<a href="/app/gig-worker/${w.name}" style="color:#4e73df;">${w.name}</a>` },
			{ label: "Name",           render: w => w.worker_name || "-" },
			{ label: "Gender",         render: w => w.gender || "-" },
			{ label: "Status",         render: w => status_badge(w.status) },
			{ label: "Registered By",  render: w => w.created_by_aggregator || "-" },
		];

		const agg_cols = [
			{ label: "Aggregator ID",      render: a => `<a href="/app/aggregator/${a.aggregator_id}" style="color:#4e73df;">${a.aggregator_id}</a>` },
			{ label: "Name",               render: a => a.aggregator_name || "-" },
			{ label: "Status",             render: a => status_badge(a.status) },
			{ label: "Workers",            render: a => a.worker_count || 0 },
			{ label: "Transactions",       render: a => a.txn_count || 0 },
			{ label: "Total Amount",       render: a => fmt_currency(a.txn_amount) },
			{ label: "Welfare Collected",  render: a => fmt_currency(a.welfare_collected) },
			{ label: "Pending Fees",       render: a => fmt_currency(a.pending_fees) },
		];

		const wfp_cols = [
			{ label: "Payment ID",   render: p => `<a href="/app/welfare-fee-payment/${p.name}" style="color:#4e73df;">${p.name}</a>` },
			{ label: "Aggregator",   render: p => p.aggregator || "-" },
			{ label: "Transaction",  render: p => p.transaction ? `<a href="/app/gig-transaction/${p.transaction}" style="color:#4e73df;">${p.transaction}</a>` : "-" },
			{ label: "Fee Amount",   render: p => fmt_currency(p.fee_amount) },
			{ label: "Date",         render: p => p.payment_date || "-" },
			{ label: "Status",       render: p => status_badge(p.payment_status) },
		];

		const fund_cols = [
			{ label: "Aggregator ID",   render: a => a.aggregator_id ? `<a href="/app/aggregator/${a.aggregator_id}" style="color:#4e73df;">${a.aggregator_id}</a>` : "-" },
			{ label: "Aggregator Name", render: a => a.aggregator_name || "-" },
			{ label: "Workers",         render: a => a.worker_count || 0 },
			{ label: "Fund Balance",    render: a => fmt_currency(a.total_balance) },
			{ label: "Total Collected", render: a => fmt_currency(a.total_collected) },
			{ label: "Total Withdrawn", render: a => fmt_currency(a.total_withdrawn) },
		];

		// ── chart helpers ────────────────────────────────────────────────────

		// Group items by a key, sum a numeric value; returns { labels, values } for top N
		function group_sum(items, key_fn, val_fn, limit) {
			const map = {};
			items.forEach(item => {
				const k = key_fn(item) || "Unknown";
				map[k] = (map[k] || 0) + (parseFloat(val_fn(item)) || 0);
			});
			const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, limit || 12);
			return { labels: sorted.map(e => e[0]), values: sorted.map(e => e[1]) };
		}

		function group_count(items, key_fn, limit) {
			return group_sum(items, key_fn, () => 1, limit);
		}

		// Group items by date field, sum a numeric value; returns { labels, values } sorted chronologically
		function group_by_date(items, val_fn) {
			const map = {};
			items.forEach(item => {
				const k = item.date || "Unknown";
				map[k] = (map[k] || 0) + (parseFloat(val_fn(item)) || 0);
			});
			const sorted = Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
			return { labels: sorted.map(e => e[0]), values: sorted.map(e => e[1]) };
		}

		// Render frappe.Chart in #dd-chart; hides wrapper if no data
		function render_dd_chart(cfg) {
			const $wrap = $("#dd-chart-wrap");
			$wrap.hide();
			$("#dd-chart").empty();
			if (!cfg || !cfg.data || !cfg.data.labels || !cfg.data.labels.length) return;
			if (typeof frappe === "undefined" || !frappe.Chart) return;
			$wrap.show();
			try {
				const opts = {
					type:   cfg.type || "bar",
					data:   cfg.data,
					height: 260,
					colors: cfg.colors || ["#4e73df"],
				};
				if (cfg.type === "line") {
					opts.axisOptions  = { xIsSeries: true, shortenYAxisNumbers: true };
					opts.lineOptions  = { regionFill: 1, dotSize: 4 };
				} else if (cfg.type === "bar") {
					opts.axisOptions  = { xIsSeries: false, shortenYAxisNumbers: true };
					opts.barOptions   = { spaceRatio: 0.25 };
				}
				// donut/pie need no extra options
				new frappe.Chart("#dd-chart", opts);
			} catch (_) {
				$wrap.hide();
			}
		}

		// Render summary pill-cards in #dd-summary
		function render_dd_summary(items) {
			const $el = $("#dd-summary");
			if (!items || !items.length) { $el.hide(); return; }
			$el.show().html(items.map(item =>
				`<div class="dd-stat">
					<div class="dd-stat-label">${item.label}</div>
					<div class="dd-stat-value" style="color:${item.color || "#333"};">${item.value}</div>
				</div>`
			).join(""));
		}

		// ── drilldown configs ────────────────────────────────────────────────

		const configs = {

			// ── Transactions ─────────────────────────────────────────────────
			all_txns: {
				title: "All Transactions",
				rows:    () => d.recent_transactions,
				cols:    txn_cols,
				summary: rows => [
					{ label: "Total",        value: rows.length, color: "#4e73df" },
					{ label: "Completed",    value: rows.filter(t => t.status === "Payment complete").length, color: "#1cc88a" },
					{ label: "Pending",      value: rows.filter(t => t.status === "Payment pending").length, color: "#f6c23e" },
					{ label: "Total Amount", value: fmt_currency(rows.reduce((s, t) => s + (t.amount || 0), 0)) },
				],
				chart: rows => {
					const sc = {};
					rows.forEach(t => { sc[t.status] = (sc[t.status] || 0) + 1; });
					const labels = Object.keys(sc);
					if (!labels.length) return { type: "donut", data: { labels: ["No Data"], datasets: [{ values: [1] }] }, colors: ["#eee"] };
					const STATUS_C = { 'Payment complete': '#1cc88a', 'Payment pending': '#4e73df', 'Payment Cancelled': '#e74a3b', 'Suspected duplicate': '#f6c23e' };
					return { type: "donut", data: { labels, datasets: [{ values: labels.map(l => sc[l]) }] }, colors: labels.map(l => STATUS_C[l] || "#858796") };
				},
			},

			completed_txns: {
				title: "Completed Transactions",
				rows:    () => d.recent_transactions.filter(t => t.status === "Payment complete"),
				cols:    txn_cols,
				summary: rows => {
					const total = rows.reduce((s, t) => s + (t.amount || 0), 0);
					return [
						{ label: "Count",        value: rows.length, color: "#1cc88a" },
						{ label: "Total Amount", value: fmt_currency(total) },
						{ label: "Avg Amount",   value: rows.length ? fmt_currency(total / rows.length) : "₹0.00" },
					];
				},
				chart: rows => {
					const { labels, values } = group_by_date(rows, t => t.amount);
					return { type: "line", data: { labels, datasets: [{ name: "Amount (₹)", values }] }, colors: ["#1cc88a"] };
				},
			},

			pending_txns: {
				title: "Pending Transactions",
				rows:    () => d.recent_transactions.filter(t => t.status === "Payment pending"),
				cols:    txn_cols,
				summary: rows => [
					{ label: "Count",        value: rows.length, color: "#f6c23e" },
					{ label: "Total Amount", value: fmt_currency(rows.reduce((s, t) => s + (t.amount || 0), 0)) },
				],
				chart: rows => {
					const { labels, values } = group_by_date(rows, () => 1);
					return { type: "line", data: { labels, datasets: [{ name: "Pending Txns", values }] }, colors: ["#f6c23e"] };
				},
			},

			cancelled_txns: {
				title: "Cancelled Transactions",
				rows:    () => d.recent_transactions.filter(t => t.status === "Payment Cancelled"),
				cols:    txn_cols,
				summary: rows => [
					{ label: "Count",        value: rows.length, color: "#6c757d" },
					{ label: "Total Amount", value: fmt_currency(rows.reduce((s, t) => s + (t.amount || 0), 0)) },
					{ label: "Total Welfare Reversed", value: fmt_currency(rows.reduce((s, t) => s + (t.welfare_amount || 0), 0)) },
				],
				chart: rows => {
					const { labels, values } = group_by_date(rows, () => 1);
					return { type: "bar", data: { labels, datasets: [{ name: "Cancelled Txns", values }] }, colors: ["#6c757d"] };
				},
			},

			txn_amount: {
				title: "Transactions by Amount",
				rows:    () => [...d.recent_transactions].sort((a, b) => (b.amount || 0) - (a.amount || 0)),
				cols:    txn_cols,
				summary: rows => {
					const total = rows.reduce((s, t) => s + (t.amount || 0), 0);
					return [
						{ label: "Total Amount", value: fmt_currency(total), color: "#36b9cc" },
						{ label: "Count",        value: rows.length },
						{ label: "Avg Amount",   value: rows.length ? fmt_currency(total / rows.length) : "₹0.00" },
					];
				},
				chart: rows => {
					const { labels, values } = group_by_date(rows, t => t.amount);
					return { type: "line", data: { labels, datasets: [{ name: "Amount (₹)", values }] }, colors: ["#36b9cc"] };
				},
			},

			welfare_txn: {
				title: "Welfare Collected from Transactions",
				rows:    () => [...d.recent_transactions].sort((a, b) => (b.welfare_amount || 0) - (a.welfare_amount || 0)),
				cols:    txn_cols,
				summary: rows => [
					{ label: "Total Welfare", value: fmt_currency(rows.reduce((s, t) => s + (t.welfare_amount || 0), 0)), color: "#e74a3b" },
					{ label: "Transactions",  value: rows.length },
				],
				chart: rows => {
					const { labels, values } = group_by_date(rows, t => t.welfare_amount);
					return { type: "line", data: { labels, datasets: [{ name: "Welfare (₹)", values }] }, colors: ["#e74a3b"] };
				},
			},

			base_payout: {
				title: "Transactions — Base Payout",
				rows:    () => [...d.recent_transactions].sort((a, b) => (b.base_payout || 0) - (a.base_payout || 0)),
				cols:    txn_cols,
				summary: rows => [
					{ label: "Total Base Payout", value: fmt_currency(rows.reduce((s, t) => s + (t.base_payout || 0), 0)), color: "#858796" },
					{ label: "Transactions",      value: rows.length },
				],
				chart: rows => {
					const { labels, values } = group_by_date(rows, t => t.base_payout);
					return { type: "line", data: { labels, datasets: [{ name: "Base Payout (₹)", values }] }, colors: ["#858796"] };
				},
			},

			// ── Aggregators ───────────────────────────────────────────────────
			all_aggregators: {
				title: "All Aggregators",
				rows:    () => d.aggregator_breakdown,
				cols:    agg_cols,
				summary: rows => [
					{ label: "Total",         value: rows.length, color: "#4e73df" },
					{ label: "Active",         value: rows.filter(a => a.status === "Active").length, color: "#1cc88a" },
					{ label: "Total Workers", value: rows.reduce((s, a) => s + (a.worker_count || 0), 0) },
					{ label: "Total Amount",  value: fmt_currency(rows.reduce((s, a) => s + (a.txn_amount || 0), 0)) },
				],
				chart: rows => {
					const statuses = ["Active", "Inactive", "Submitted"].filter(s => rows.some(a => a.status === s));
					return { type: "donut", data: { labels: statuses, datasets: [{ values: statuses.map(s => rows.filter(a => a.status === s).length) }] }, colors: ["#1cc88a", "#6c757d", "#4e73df"] };
				},
			},

			active_aggregators: {
				title: "Active Aggregators",
				rows:    () => d.aggregator_breakdown.filter(a => a.status === "Active"),
				cols:    agg_cols,
				summary: rows => [
					{ label: "Active Aggregators", value: rows.length, color: "#1cc88a" },
					{ label: "Total Amount",       value: fmt_currency(rows.reduce((s, a) => s + (a.txn_amount || 0), 0)) },
				],
				chart: rows => {
					const top = rows.slice(0, 12);
					return { type: "bar", data: { labels: top.map(a => a.aggregator_name || a.aggregator_id), datasets: [{ name: "Amount (₹)", values: top.map(a => parseFloat(a.txn_amount) || 0) }] }, colors: ["#1cc88a"] };
				},
			},

			// ── Workers ───────────────────────────────────────────────────────
			all_workers: {
				title: "All Gig Workers",
				rows:    () => d.recent_workers,
				cols:    worker_cols,
				summary: rows => [
					{ label: "Total",                value: rows.length, color: "#4e73df" },
					{ label: "Active",               value: rows.filter(w => w.status === "Active").length, color: "#1cc88a" },
					{ label: "Inactive",             value: rows.filter(w => w.status === "Inactive").length, color: "#6c757d" },
				],
				chart: rows => {
					const statuses = ["Active", "Inactive", "Onboarded", "Offboarded", "Deceased"].filter(s => rows.some(w => w.status === s));
					return { type: "donut", data: { labels: statuses, datasets: [{ values: statuses.map(s => rows.filter(w => w.status === s).length) }] }, colors: ["#1cc88a", "#6c757d", "#28a745", "#858796", "#343a40"] };
				},
			},

			active_workers: {
				title: "Active Gig Workers",
				rows:    () => d.recent_workers.filter(w => w.status === "Active"),
				cols:    worker_cols,
				summary: rows => [{ label: "Active Workers", value: rows.length, color: "#1cc88a" }],
				chart: rows => {
					const { labels, values } = group_count(rows, w => w.created_by_aggregator);
					return { type: "bar", data: { labels, datasets: [{ name: "Active Workers", values }] }, colors: ["#1cc88a"] };
				},
			},

			inactive_workers: {
				title: "Inactive Workers",
				rows:    () => d.recent_workers.filter(w => w.status === "Inactive"),
				cols:    worker_cols,
				summary: rows => [{ label: "Inactive Workers", value: rows.length, color: "#6c757d" }],
				chart: rows => {
					const { labels, values } = group_count(rows, w => w.created_by_aggregator);
					return { type: "bar", data: { labels, datasets: [{ name: "Inactive Workers", values }] }, colors: ["#6c757d"] };
				},
			},

			// ── Welfare Payments ──────────────────────────────────────────────
			welfare_settled: {
				title: "Settled Welfare Fee Payments",
				rows:    () => d.completed_wfp || [],
				cols:    wfp_cols,
				summary: rows => [
					{ label: "Payments",      value: rows.length, color: "#28a745" },
					{ label: "Total Settled", value: fmt_currency(rows.reduce((s, p) => s + (p.fee_amount || 0), 0)), color: "#28a745" },
				],
				chart: rows => {
					const { labels, values } = group_sum(rows, p => p.aggregator, p => p.fee_amount, 8);
					return { type: "donut", data: { labels, datasets: [{ values }] }, colors: ["#28a745", "#1cc88a", "#36b9cc", "#4e73df", "#858796", "#f6c23e", "#e74a3b", "#fd7e14"] };
				},
			},

			welfare_pending: {
				title: "Pending Welfare Fee Payments",
				rows:    () => d.pending_wfp,
				cols:    wfp_cols,
				summary: rows => [
					{ label: "Payments",      value: rows.length, color: "#e74a3b" },
					{ label: "Total Pending", value: fmt_currency(rows.reduce((s, p) => s + (p.fee_amount || 0), 0)), color: "#e74a3b" },
				],
				chart: rows => {
					const { labels, values } = group_sum(rows, p => p.aggregator, p => p.fee_amount, 8);
					return { type: "donut", data: { labels, datasets: [{ values }] }, colors: ["#e74a3b", "#f6c23e", "#fd7e14", "#858796", "#4e73df", "#36b9cc", "#1cc88a", "#28a745"] };
				},
			},

			// ── Welfare Fund ──────────────────────────────────────────────────
			fund_balance: {
				title: "Welfare Fund Balance by Aggregator",
				rows:    () => (d.welfare_fund_by_agg || []).slice().sort((a, b) => (b.total_balance || 0) - (a.total_balance || 0)),
				cols:    fund_cols,
				summary: rows => [{ label: "Total Fund Balance", value: fmt_currency(rows.reduce((s, a) => s + (a.total_balance || 0), 0)), color: "#1cc88a" }],
				chart: rows => {
					const top = rows.slice(0, 12);
					return { type: "bar", data: { labels: top.map(a => a.aggregator_name || a.aggregator_id || "Unknown"), datasets: [{ name: "Balance (₹)", values: top.map(a => parseFloat(a.total_balance) || 0) }] }, colors: ["#1cc88a"] };
				},
			},

			fund_collected: {
				title: "Fund Collected by Aggregator",
				rows:    () => (d.welfare_fund_by_agg || []).slice().sort((a, b) => (b.total_collected || 0) - (a.total_collected || 0)),
				cols:    fund_cols,
				summary: rows => [{ label: "Total Collected", value: fmt_currency(rows.reduce((s, a) => s + (a.total_collected || 0), 0)), color: "#36b9cc" }],
				chart: rows => {
					const top = rows.slice(0, 12);
					return { type: "bar", data: { labels: top.map(a => a.aggregator_name || a.aggregator_id || "Unknown"), datasets: [{ name: "Collected (₹)", values: top.map(a => parseFloat(a.total_collected) || 0) }] }, colors: ["#36b9cc"] };
				},
			},

			fund_withdrawn: {
				title: "Fund Withdrawn by Aggregator",
				rows:    () => (d.welfare_fund_by_agg || []).slice().sort((a, b) => (b.total_withdrawn || 0) - (a.total_withdrawn || 0)),
				cols:    fund_cols,
				summary: rows => [{ label: "Total Withdrawn", value: fmt_currency(rows.reduce((s, a) => s + (a.total_withdrawn || 0), 0)), color: "#f6c23e" }],
				chart: rows => {
					const top = rows.slice(0, 12);
					return { type: "bar", data: { labels: top.map(a => a.aggregator_name || a.aggregator_id || "Unknown"), datasets: [{ name: "Withdrawn (₹)", values: top.map(a => parseFloat(a.total_withdrawn) || 0) }] }, colors: ["#f6c23e"] };
				},
			},

			// ── Suspected Duplicates ──────────────────────────────────────────────
			suspected_dups: {
				title: "Suspected Duplicate Transactions",
				rows:    () => d.duplicate_transactions || [],
				cols: [
					{ label: "Transaction ID", render: t => `<a href="/app/gig-transaction/${t.name}" style="color:#4e73df;">${t.name}</a>` },
					{ label: "Date",           render: t => t.date || "-" },
					{ label: "Gig Worker",     render: t => t.gig_worker ? `<a href="/app/gig-worker/${t.gig_worker}" style="color:#4e73df;">${t.gig_worker}</a>` : "-" },
					{ label: "Aggregator",     render: t => t.aggregator || "-" },
					{ label: "Service",        render: t => t.service || "-" },
					{ label: "Amount",         render: t => `<span style="color:#e74a3b;font-weight:600;">${fmt_currency(t.amount)}</span>` },
					{ label: "Welfare",        render: t => fmt_currency(t.welfare_amount) },
					{ label: "Duplicate Of",   render: t => t.duplicate_of ? `<a href="/app/gig-transaction/${t.duplicate_of}" style="color:#4e73df;font-size:12px;">${t.duplicate_of}</a>` : `<span style="color:#aaa;">—</span>` },
					{ label: "Actions",        render: t => `
						<button class="btn-confirm-dup" data-txn="${t.name}" data-dup-of="${t.duplicate_of || ""}"
							style="background:#e53935;border:none;color:#fff;padding:4px 10px;border-radius:5px;font-size:12px;font-weight:600;cursor:pointer;margin-right:4px;">
							<i class="fa fa-ban"></i> Mark Duplicate
						</button>
						<button class="btn-dismiss-dup" data-txn="${t.name}"
							style="background:#fff;border:1px solid #28a745;color:#28a745;padding:4px 10px;border-radius:5px;font-size:12px;font-weight:600;cursor:pointer;">
							<i class="fa fa-check"></i> Dismiss
						</button>` },
				],
				summary: rows => [
					{ label: "Total Suspected", value: rows.length, color: "#e74a3b" },
					{ label: "Total Amount",    value: fmt_currency(rows.reduce((s, t) => s + (t.amount || 0), 0)) },
					{ label: "Total Welfare",   value: fmt_currency(rows.reduce((s, t) => s + (t.welfare_amount || 0), 0)), color: "#f6c23e" },
				],
				chart: rows => {
					const { labels, values } = group_count(rows, t => t.aggregator);
					return { type: "donut", data: { labels, datasets: [{ values }] }, colors: ["#e74a3b", "#fd7e14", "#f6c23e", "#4e73df", "#36b9cc", "#1cc88a"] };
				},
				dt_opts: { columnDefs: [{ orderable: false, targets: [8] }] },
			},
		};

		function open_drilldown(type) {
			const cfg = configs[type];
			if (!cfg) return;

			const rows = cfg.rows();

			// Tear down any existing DataTable in the modal
			if ($.fn.DataTable && $.fn.DataTable.isDataTable("#dd-dt-table")) {
				$("#dd-dt-table").DataTable().destroy();
				$("#dd-dt-table").empty();
			}

			// Header
			$("#dd-title").text(cfg.title);
			$("#dd-count").text(`${rows.length} record${rows.length !== 1 ? "s" : ""}`);

			// Summary strip
			render_dd_summary(cfg.summary ? cfg.summary(rows) : null);

			// Chart
			render_dd_chart(rows.length && cfg.chart ? cfg.chart(rows) : null);

			// Table
			const thead = `<thead><tr>${cfg.cols.map(c => `<th>${c.label}</th>`).join("")}</tr></thead>`;
			const tbody_html = rows.length
				? rows.map(row => `<tr>${cfg.cols.map(c => `<td>${c.render(row)}</td>`).join("")}</tr>`).join("")
				: `<tr><td colspan="${cfg.cols.length}" style="text-align:center;color:#aaa;padding:24px;">No records found</td></tr>`;
			$("#dd-dt-table").html(`${thead}<tbody>${tbody_html}</tbody>`);

			if (rows.length && $.fn.DataTable) {
				$("#dd-dt-table").DataTable(Object.assign({
					pageLength: 15,
					lengthMenu: [10, 15, 25, 50, 100],
					order: [],
					autoWidth: false,
					language: {
						search: "Filter:",
						lengthMenu: "Show _MENU_ entries",
						info: "Showing _START_ to _END_ of _TOTAL_ records",
						emptyTable: "No records found",
					},
					dom: '<"dt-top"lf>rt<"dt-bottom"ip>',
				}, cfg.dt_opts || {}));
			}

			$("#dd-overlay").addClass("active");
			$("#dd-body").scrollTop(0);
		}

		function close_drilldown() {
			if ($.fn.DataTable && $.fn.DataTable.isDataTable("#dd-dt-table")) {
				$("#dd-dt-table").DataTable().destroy();
				$("#dd-dt-table").empty();
			}
			$("#dd-overlay").removeClass("active");
		}

		// Remove previously attached listeners to avoid duplicates on re-render
		$(document).off("click.drilldown").off("keydown.drilldown");
		$("#admin-dashboard").off("click.drilldown");

		// Card click — use delegation scoped to the dashboard container
		$("#admin-dashboard").on("click.drilldown", ".drillable[data-drilldown]", function () {
			open_drilldown($(this).data("drilldown"));
		});

		// Modal close via button, overlay backdrop, or Escape
		$("#dd-close").on("click", close_drilldown);
		$("#dd-overlay").on("click", function (e) {
			if ($(e.target).is("#dd-overlay")) close_drilldown();
		});
		$(document).on("keydown.drilldown", function (e) {
			if (e.key === "Escape" && $("#dd-overlay").hasClass("active")) close_drilldown();
		});
	}

	// ── render ────────────────────────────────────────────────────────────────

	function render_dashboard(data, filters) {
		const { stats, aggregators, workers, welfare_payments, welfare_fund,
			aggregator_breakdown, recent_transactions, pending_wfp,
			recent_workers, aggregator_list, duplicate_transactions } = data;

		const filter_bar = build_filter_bar(aggregator_list || [], filters || {});

		const html = `
		<style>
			.admin-card-row { display: flex; flex-wrap: wrap; gap: 16px; margin-bottom: 24px; }
			.admin-stat-card {
				flex: 1; min-width: 160px; background: #fff; border-radius: 10px;
				padding: 20px 18px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);
				border-left: 4px solid var(--card-color, #4e73df);
			}
			.admin-stat-card .label { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: .5px; }
			.admin-stat-card .value { font-size: 26px; font-weight: 700; color: #333; margin-top: 6px; }
			.admin-section { background: #fff; border-radius: 10px; padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.07); margin-bottom: 24px; }
			.admin-section h5 { font-weight: 700; margin-bottom: 14px; color: #444; border-bottom: 1px solid #eee; padding-bottom: 8px; }
			.admin-section-title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: #888; margin: 24px 0 12px; }
			.highlight { color: #e74a3b; font-weight: 700; }
			.dt-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
			.dt-bottom { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; }
			table.dataTable thead th { background: #f8f9fa; color: #555; font-weight: 600; }
			table.dataTable tbody tr:hover td { background: #fafafa; }
			table.dataTable { font-size: 13px; }
			.download-bar {
				background: #fff; border-radius: 12px; padding: 16px 20px;
				box-shadow: 0 1px 8px rgba(0,0,0,0.08); margin-top: 8px;
				display: flex; align-items: center; gap: 16px;
			}
			.download-bar .dl-label {
				font-size: 13px; font-weight: 600; color: #555;
				margin-right: 4px;
			}
			.dl-btn {
				display: inline-flex; align-items: center; gap: 7px;
				padding: 8px 18px; border-radius: 8px; font-size: 13px;
				font-weight: 600; cursor: pointer; border: none; transition: all .15s;
				font-family: inherit;
			}
			.dl-btn-pdf {
				background: #fce4ec; color: #c62828;
				border: 1.5px solid #ef9a9a;
			}
			.dl-btn-pdf:hover { background: #c62828; color: #fff; }

			/* ── Drillable stat cards ── */
			.admin-stat-card.drillable {
				cursor: pointer;
				transition: transform .15s, box-shadow .15s;
				position: relative;
			}
			.admin-stat-card.drillable:hover {
				transform: translateY(-3px);
				box-shadow: 0 8px 24px rgba(0,0,0,0.13);
			}
			.admin-stat-card.drillable::after {
				content: "↗";
				position: absolute;
				top: 10px; right: 12px;
				font-size: 13px; color: #ddd;
				transition: color .15s;
			}
			.admin-stat-card.drillable:hover::after {
				color: var(--card-color, #4e73df);
			}

			/* ── Bulk action toolbar for duplicates ── */
			#dup-bulk-bar {
				display: none; align-items: center; gap: 12px; flex-wrap: wrap;
				background: #fff8e1; border: 1.5px solid #ffe082; border-radius: 8px;
				padding: 10px 16px; margin-bottom: 14px;
			}
			#dup-bulk-bar .bulk-count {
				font-size: 13px; font-weight: 700; color: #856404;
				flex: 1; min-width: 100px;
			}
			.bulk-btn {
				display: inline-flex; align-items: center; gap: 6px;
				padding: 7px 16px; border-radius: 7px; font-size: 13px;
				font-weight: 600; cursor: pointer; border: none; font-family: inherit;
				transition: all .15s;
			}
			.bulk-btn-danger  { background:#e53935; color:#fff; }
			.bulk-btn-danger:hover  { background:#b71c1c; }
			.bulk-btn-success { background:#2e7d32; color:#fff; }
			.bulk-btn-success:hover { background:#1b5e20; }
			.bulk-btn-ghost   { background:#fff; color:#555; border:1.5px solid #ccc; }
			.bulk-btn-ghost:hover   { background:#f5f5f5; }
			.dup-row-cb { width:16px; height:16px; cursor:pointer; accent-color:#e53935; }
			#dup-select-all { width:16px; height:16px; cursor:pointer; accent-color:#e53935; }
			#admin-dup-table tbody tr.dup-selected td { background:#fff3e0 !important; }

			/* ── Chart toggle buttons ── */
			.adm-chart-toggle {
				padding: 4px 12px; border-radius: 6px; font-size: 12px; font-weight: 600;
				cursor: pointer; border: 1.5px solid #d1d3e2; background: #fff; color: #666;
				transition: all .15s; font-family: inherit;
			}
			.adm-chart-toggle.active {
				background: #4e73df; color: #fff; border-color: #4e73df;
			}
			.adm-chart-toggle:hover:not(.active) { background: #f0f2ff; border-color: #4e73df; color: #4e73df; }
			.adm-chart-section {
				background: #fff; border-radius: 10px; padding: 20px;
				box-shadow: 0 2px 8px rgba(0,0,0,0.07); flex: 1; min-width: 0;
			}
			.adm-chart-header {
				display: flex; align-items: center; justify-content: space-between;
				margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid #eee;
			}
			.adm-chart-header h5 { margin: 0; font-weight: 700; color: #444; font-size: 14px; }
			.adm-chart-summary {
				display: flex; gap: 20px; flex-wrap: wrap; margin-top: 10px;
				padding-top: 10px; border-top: 1px solid #f0f0f0; font-size: 12px; color: #666;
			}
			.adm-chart-summary .sum-item b { font-size: 15px; font-weight: 700; }
			.adm-status-legend { margin-top: 12px; font-size: 12px; }
			.adm-status-legend .leg-row {
				display: flex; align-items: center; justify-content: space-between;
				padding: 5px 0; border-bottom: 1px solid #f8f8f8;
			}
			.adm-status-legend .leg-row:last-child { border-bottom: none; }
			.adm-status-legend .leg-dot {
				display: inline-block; width: 10px; height: 10px;
				border-radius: 2px; margin-right: 7px; flex-shrink: 0;
			}
			.adm-status-legend .leg-label { display: flex; align-items: center; }
			.adm-status-legend .leg-count { font-weight: 700; color: #333; }
			.adm-status-legend .leg-pct { color: #aaa; font-weight: 400; margin-left: 4px; }
			.adm-total-badge {
				text-align: center; margin-top: 8px; font-size: 13px; color: #555;
				padding: 6px 0; border-top: 1px solid #eee;
			}
			.adm-total-badge b { font-size: 20px; font-weight: 700; color: #333; }

			/* ── Drilldown modal overlay ── */
			#dd-overlay {
				display: none;
				position: fixed; inset: 0;
				background: rgba(0,0,0,0.5);
				z-index: 10000;
				align-items: center; justify-content: center;
				padding: 20px;
				box-sizing: border-box;
			}
			#dd-overlay.active { display: flex; }
			#dd-modal {
				background: #f8f9fc; border-radius: 14px;
				width: 95vw; max-width: 1200px; max-height: 90vh;
				display: flex; flex-direction: column;
				box-shadow: 0 28px 70px rgba(0,0,0,0.28);
				overflow: hidden;
			}
			#dd-header {
				padding: 18px 24px 14px;
				background: #fff;
				border-bottom: 1px solid #eee;
				display: flex; align-items: flex-start; justify-content: space-between;
				flex-shrink: 0;
			}
			#dd-title { font-size: 16px; font-weight: 700; color: #333; margin: 0; }
			#dd-count { font-size: 12px; color: #aaa; margin-top: 3px; }
			#dd-close {
				background: none; border: none; font-size: 20px; color: #bbb;
				cursor: pointer; line-height: 1; padding: 2px 6px;
				border-radius: 4px; transition: all .12s; flex-shrink: 0;
			}
			#dd-close:hover { color: #333; background: #f5f5f5; }
			#dd-body {
				padding: 16px 20px 20px;
				overflow-y: auto; flex: 1;
			}
			/* Summary stat pills */
			#dd-summary {
				display: flex; flex-wrap: wrap; gap: 12px;
				margin-bottom: 16px;
			}
			.dd-stat {
				background: #fff; border-radius: 10px;
				padding: 12px 20px;
				box-shadow: 0 1px 6px rgba(0,0,0,0.07);
				min-width: 110px;
			}
			.dd-stat-label { font-size: 11px; color: #aaa; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 4px; }
			.dd-stat-value { font-size: 20px; font-weight: 700; }
			/* Chart section */
			#dd-chart-wrap {
				background: #fff; border-radius: 10px;
				padding: 16px 20px 8px;
				box-shadow: 0 1px 6px rgba(0,0,0,0.07);
				margin-bottom: 16px;
			}
			#dd-chart-wrap h6 {
				font-size: 12px; font-weight: 700; color: #999;
				text-transform: uppercase; letter-spacing: .5px;
				margin: 0 0 8px;
			}
			/* Table section */
			#dd-table-wrap {
				background: #fff; border-radius: 10px;
				padding: 16px 20px;
				box-shadow: 0 1px 6px rgba(0,0,0,0.07);
				overflow-x: auto;
			}
			#dd-table-wrap h6 {
				font-size: 12px; font-weight: 700; color: #999;
				text-transform: uppercase; letter-spacing: .5px;
				margin: 0 0 12px;
			}
			#dd-body table.dataTable { font-size: 13px; width: 100% !important; }
			#dd-body table.dataTable thead th { white-space: nowrap; }
			#dd-body .dt-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
			#dd-body .dt-bottom { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; }
		</style>

		${filter_bar}

		<!-- Suspected Duplicates Warning Banner -->
		${stats.suspected_duplicates ? `
		<div id="dup-banner" style="
			background:#fff8e1; border:1.5px solid #f6c23e; border-radius:10px;
			padding:14px 20px; margin-bottom:20px;
			display:flex; align-items:center; gap:12px;
		">
			<i class="fa fa-exclamation-triangle" style="color:#f6c23e;font-size:20px;"></i>
			<div style="flex:1;">
				<strong style="color:#856404;">
					${stats.suspected_duplicates} suspected duplicate transaction${stats.suspected_duplicates > 1 ? "s" : ""} require review
				</strong>
				<span style="color:#856404;font-size:13px;margin-left:8px;">
					— Mark each as Duplicate to reverse welfare credits, or Dismiss if legitimate.
				</span>
			</div>
			<a href="javascript:void(0)" onclick="var el=document.getElementById('dup-section');if(el)el.scrollIntoView({behavior:'smooth'});" style="font-size:13px;font-weight:600;color:#856404;text-decoration:underline;cursor:pointer;">
				Review &darr;
			</a>
		</div>
		` : ""}

		<!-- Suspected Duplicates Section -->
		${duplicate_transactions && duplicate_transactions.length ? `
		<div class="admin-section" id="dup-section">
			<h5 style="color:#856404;margin-bottom:12px;">
				<i class="fa fa-exclamation-triangle" style="margin-right:6px;"></i>
				Suspected Duplicate Transactions
				<span style="float:right;font-size:12px;font-weight:400;color:#888;">
					Select rows and use Bulk Actions, or act row-by-row
				</span>
			</h5>

			<!-- Bulk Action Toolbar -->
			<div id="dup-bulk-bar">
				<span class="bulk-count" id="dup-bulk-count">0 selected</span>
				<button class="bulk-btn bulk-btn-danger" id="btn-bulk-mark-dup">
					<i class="fa fa-ban"></i> Mark Selected as Duplicate
				</button>
				<button class="bulk-btn bulk-btn-success" id="btn-bulk-dismiss">
					<i class="fa fa-check"></i> Dismiss Selected
				</button>
				<button class="bulk-btn bulk-btn-ghost" id="btn-bulk-clear">
					<i class="fa fa-times"></i> Clear Selection
				</button>
			</div>

			<table id="admin-dup-table" class="display" style="width:100%">
				<thead><tr>
					<th style="width:32px;text-align:center;"><input type="checkbox" id="dup-select-all" title="Select all"></th>
					<th>Transaction ID</th>
					<th>Date</th>
					<th>Gig Worker</th>
					<th>Aggregator</th>
					<th>Service</th>
					<th>Service Category</th>
					<th>Amount</th>
					<th>Duplicate Of</th>
					<th>Actions</th>
				</tr></thead>
				<tbody>
					${duplicate_transactions.map(d => `<tr data-txn="${d.name}" data-dup-of="${d.duplicate_of || ""}">
						<td style="text-align:center;"><input type="checkbox" class="dup-row-cb" value="${d.name}"></td>
						<td><a href="/app/gig-transaction/${d.name}" style="color:#4e73df;">${d.name}</a></td>
						<td>${d.date || "-"}</td>
						<td><a href="/app/gig-worker/${d.gig_worker}" style="color:#4e73df;">${d.gig_worker}</a></td>
						<td>${d.aggregator || "-"}</td>
						<td>${d.service || "-"}</td>
						<td>${d.service_category || "-"}</td>
						<td style="color:#e74a3b;font-weight:600;">${fmt_currency(d.amount)}</td>
						<td style="font-size:12px;">
							${d.duplicate_of
								? `<a href="/app/gig-transaction/${d.duplicate_of}" style="color:#4e73df;">${d.duplicate_of}</a>`
								: `<span style="color:#aaa;">—</span>`}
						</td>
						<td style="white-space:nowrap;">
							<button class="btn-confirm-dup" data-txn="${d.name}" data-dup-of="${d.duplicate_of || ""}"
								style="background:#e53935;border:none;color:#fff;padding:4px 10px;
								border-radius:5px;font-size:12px;font-weight:600;cursor:pointer;margin-right:4px;">
								<i class="fa fa-ban"></i> Mark Duplicate
							</button>
							<button class="btn-dismiss-dup" data-txn="${d.name}"
								style="background:#fff;border:1px solid #28a745;color:#28a745;padding:4px 10px;
								border-radius:5px;font-size:12px;font-weight:600;cursor:pointer;">
								<i class="fa fa-check"></i> Dismiss
							</button>
						</td>
					</tr>`).join("")}
				</tbody>
			</table>
		</div>
		` : ""}

		<!-- Analytics Charts -->
		${(data.monthly_trend && data.monthly_trend.length) || (data.status_breakdown && data.status_breakdown.length) ? `
		<div style="display:flex;flex-wrap:wrap;gap:20px;margin-bottom:24px;align-items:flex-start;">

			<!-- Monthly Trend -->
			<div class="adm-chart-section" style="flex:1;min-width:300px;">
				<div class="adm-chart-header">
					<h5><i class="fa fa-bar-chart" style="color:#4e73df;margin-right:7px;"></i>Monthly Transaction Trend
						<span style="font-size:11px;font-weight:400;color:#aaa;margin-left:8px;">Last 12 months</span>
					</h5>
					<div style="display:flex;gap:6px;flex-shrink:0;">
						<button class="adm-chart-toggle active" data-mode="count">Transactions</button>
						<button class="adm-chart-toggle" data-mode="amount">Amount (₹)</button>
					</div>
				</div>
				<div id="admin-trend-chart" style="min-height:200px;"></div>
				<div id="admin-trend-empty" style="text-align:center;color:#ccc;font-size:12px;display:none;padding:40px 0;"></div>
				<div id="admin-trend-summary" class="adm-chart-summary"></div>
			</div>

			<!-- Status Donut -->
			<div class="adm-chart-section" style="flex:1;min-width:280px;">
				<div class="adm-chart-header">
					<h5><i class="fa fa-pie-chart" style="color:#36b9cc;margin-right:7px;"></i>Transaction Summary</h5>
					<span style="font-size:11px;color:#aaa;">Current filter</span>
				</div>
				<div id="admin-status-chart" style="min-height:160px;"></div>
				<div id="admin-status-empty" style="text-align:center;color:#ccc;font-size:12px;display:none;padding:30px 0;"></div>
				<div id="admin-total-badge" class="adm-total-badge" style="display:none;"></div>
				<div id="admin-status-legend" class="adm-status-legend"></div>
			</div>

		</div>
		` : ""}

		<!-- Transactions -->
		<div class="admin-section-title">Transactions</div>
		<div class="admin-card-row">
			<div class="admin-stat-card drillable" style="--card-color:#4e73df;" data-drilldown="all_txns"><div class="label">Total Transactions</div><div class="value">${stats.total_transactions}</div></div>
			<div class="admin-stat-card drillable" style="--card-color:#1cc88a;" data-drilldown="completed_txns"><div class="label">Payment Complete</div><div class="value">${stats.completed_transactions}</div></div>
			<div class="admin-stat-card drillable" style="--card-color:#f6c23e;" data-drilldown="pending_txns"><div class="label">Payment Pending</div><div class="value">${stats.pending_transactions}</div></div>
			<div class="admin-stat-card drillable" style="--card-color:#6c757d;" data-drilldown="cancelled_txns"><div class="label">Payment Cancelled</div><div class="value">${stats.cancelled_transactions}</div></div>
			<div class="admin-stat-card ${stats.suspected_duplicates ? 'drillable' : ''}" style="--card-color:#e74a3b;cursor:${stats.suspected_duplicates ? 'pointer' : 'default'};"
				${stats.suspected_duplicates ? 'data-drilldown="suspected_dups"' : ''}>
				<div class="label">Suspected Duplicates</div>
				<div class="value" style="color:${stats.suspected_duplicates ? '#e74a3b' : '#333'};">${stats.suspected_duplicates || 0}</div>
			</div>
		</div>

		<!-- Platform Overview -->
		<div class="admin-section-title">Platform Overview</div>
		<div class="admin-card-row">
			<div class="admin-stat-card drillable" style="--card-color:#4e73df;" data-drilldown="all_aggregators"><div class="label">Total Aggregators</div><div class="value">${aggregators.total}</div></div>
			<div class="admin-stat-card drillable" style="--card-color:#1cc88a;" data-drilldown="active_aggregators"><div class="label">Active Aggregators</div><div class="value">${aggregators.active}</div></div>
			<div class="admin-stat-card drillable" style="--card-color:#4e73df;" data-drilldown="all_workers"><div class="label">Total Gig Workers</div><div class="value">${workers.total}</div></div>
			<div class="admin-stat-card drillable" style="--card-color:#1cc88a;" data-drilldown="active_workers"><div class="label">Active Workers</div><div class="value">${workers.active}</div></div>
			<div class="admin-stat-card drillable" style="--card-color:#6c757d;" data-drilldown="inactive_workers"><div class="label">Inactive Workers</div><div class="value">${workers.inactive}</div></div>
		</div>

		<!-- Welfare -->
		<div class="admin-section-title">Welfare</div>
		<div class="admin-card-row">
			<div class="admin-stat-card drillable" style="--card-color:#28a745;" data-drilldown="welfare_settled"><div class="label">Welfare Fees Settled</div><div class="value" style="font-size:20px;">${fmt_currency(welfare_payments.total_paid)}</div></div>
			<div class="admin-stat-card drillable" style="--card-color:#e74a3b;" data-drilldown="welfare_pending"><div class="label">Welfare Fees Pending</div><div class="value" style="font-size:20px;color:#e74a3b;">${fmt_currency(welfare_payments.pending_amount)}</div></div>
			<div class="admin-stat-card drillable" style="--card-color:#1cc88a;" data-drilldown="fund_balance"><div class="label">Welfare Fund Balance</div><div class="value" style="font-size:20px;">${fmt_currency(welfare_fund.total_balance)}</div></div>
			<div class="admin-stat-card drillable" style="--card-color:#36b9cc;" data-drilldown="fund_collected"><div class="label">Total Fund Collected</div><div class="value" style="font-size:20px;">${fmt_currency(welfare_fund.total_collected)}</div></div>
			<div class="admin-stat-card drillable" style="--card-color:#f6c23e;" data-drilldown="fund_withdrawn"><div class="label">Total Withdrawn</div><div class="value" style="font-size:20px;">${fmt_currency(welfare_fund.total_withdrawn)}</div></div>
		</div>

		<!-- Aggregator Breakdown -->
		<div class="admin-section">
			<h5>Aggregator Breakdown <a href="/app/aggregator" style="float:right;font-size:13px;font-weight:500;color:#4e73df;">View All</a></h5>
			<table id="admin-agg-table" class="display" style="width:100%">
				<thead><tr>
					<th>Aggregator ID</th><th>Name</th><th>Status</th>
					<th>Workers</th><th>Transactions</th><th>Total Amount</th>
					<th>Welfare Collected</th><th>Pending Fees</th><th>Dashboard</th>
				</tr></thead>
				<tbody>
					${aggregator_breakdown.map(a => `<tr>
						<td><a href="/app/aggregator/${a.aggregator_id}" style="color:#4e73df;">${a.aggregator_id}</a></td>
						<td>${a.aggregator_name || "-"}</td>
						<td>${status_badge(a.status)}</td>
						<td>${a.worker_count || 0}</td>
						<td>${a.txn_count || 0}</td>
						<td>${fmt_currency(a.txn_amount)}</td>
						<td>${fmt_currency(a.welfare_collected)}</td>
						<td class="${parseFloat(a.pending_fees) > 0 ? 'highlight' : ''}">${fmt_currency(a.pending_fees)}</td>
						<td><a href="/app/aggregator-dashboard?aggregator=${a.aggregator_id}" target="_blank"
							style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;
							border-radius:5px;font-size:12px;font-weight:600;color:#4e73df;
							border:1.5px solid #4e73df;text-decoration:none;white-space:nowrap;">
							<i class="fa fa-bar-chart"></i> View Dashboard
						</a></td>
					</tr>`).join("")}
				</tbody>
			</table>
		</div>

		<!-- Transactions -->
		<div class="admin-section">
			<h5>Transactions <a href="/app/gig-transaction" style="float:right;font-size:13px;font-weight:500;color:#4e73df;">View All</a></h5>
			<table id="admin-txn-table" class="display" style="width:100%">
				<thead><tr>
					<th>Transaction ID</th><th>Date</th><th>Aggregator</th><th>Gig Worker</th>
					<th>Service</th><th>Service Category</th><th>Amount</th><th>Welfare</th><th>Status</th>
				</tr></thead>
				<tbody>
					${recent_transactions.map(t => `<tr>
						<td><a href="/app/gig-transaction/${t.name}" style="color:#4e73df;">${t.name}</a></td>
						<td>${t.date || "-"}</td>
						<td>${t.aggregator || "-"}</td>
						<td>${t.gig_worker || "-"}</td>
						<td>${t.service || "-"}</td>
						<td>${t.service_category || "-"}</td>
						<td>${fmt_currency(t.amount)}</td>
						<td>${fmt_currency(t.welfare_amount)}</td>
						<td>${status_badge(t.status)}</td>
					</tr>`).join("")}
				</tbody>
			</table>
		</div>

		<!-- Pending Welfare Fee Payments -->
		<div class="admin-section">
			<h5>Pending Welfare Fee Payments <a href="/app/welfare-fee-payment" style="float:right;font-size:13px;font-weight:500;color:#4e73df;">View All</a></h5>
			<table id="admin-wfp-table" class="display" style="width:100%">
				<thead><tr>
					<th>Payment ID</th><th>Aggregator</th><th>Transaction</th>
					<th>Fee Amount</th><th>Due Date</th><th>Status</th>
				</tr></thead>
				<tbody>
					${pending_wfp.map(p => `<tr>
						<td><a href="/app/welfare-fee-payment/${p.name}" style="color:#4e73df;">${p.name}</a></td>
						<td>${p.aggregator || "-"}</td>
						<td>${p.transaction || "-"}</td>
						<td class="highlight">${fmt_currency(p.fee_amount)}</td>
						<td>${p.payment_date || "-"}</td>
						<td>${status_badge(p.payment_status)}</td>
					</tr>`).join("")}
				</tbody>
			</table>
		</div>

		<!-- Gig Workers -->
		<div class="admin-section">
			<h5>Gig Workers <a href="/app/gig-worker" style="float:right;font-size:13px;font-weight:500;color:#4e73df;">View All</a></h5>
			<table id="admin-workers-table" class="display" style="width:100%">
				<thead><tr>
					<th>Worker ID</th><th>Name</th><th>Gender</th>
					<th>Status</th><th>Registered By</th><th>Dashboard</th>
				</tr></thead>
				<tbody>
					${recent_workers.map(w => `<tr>
						<td><a href="/app/gig-worker/${w.name}" style="color:#4e73df;">${w.name}</a></td>
						<td>${w.worker_name || "-"}</td>
						<td>${w.gender || "-"}</td>
						<td>${status_badge(w.status)}</td>
						<td>${w.created_by_aggregator || "-"}</td>
						<td><a href="/app/gig-worker-dashboard?worker=${w.name}" target="_blank"
							style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;
							border-radius:5px;font-size:12px;font-weight:600;color:#1cc88a;
							border:1.5px solid #1cc88a;text-decoration:none;white-space:nowrap;">
							<i class="fa fa-bar-chart"></i> View Dashboard
						</a></td>
					</tr>`).join("")}
				</tbody>
			</table>
		</div>

		<!-- Download bar -->
		<div class="download-bar">
			<span class="dl-label"><i class="fa fa-download" style="margin-right:6px;color:#aaa;"></i>Download Report:</span>
			<button class="dl-btn dl-btn-pdf" id="btn-dl-pdf">
				<i class="fa fa-file-pdf-o"></i> Download PDF
			</button>
			<a href="/app/query-report/Quarterly%20Welfare%20Compliance%20Report"
				style="display:inline-flex;align-items:center;gap:7px;padding:8px 18px;
					border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;
					background:#e3f2fd;color:#1565c0;border:1.5px solid #90caf9;
					text-decoration:none;font-family:inherit;"
				target="_blank">
				<i class="fa fa-table"></i> Quarterly Compliance Report
			</a>
		</div>

		<!-- Drilldown modal overlay -->
		<div id="dd-overlay">
			<div id="dd-modal">
				<div id="dd-header">
					<div>
						<div id="dd-title"></div>
						<div id="dd-count"></div>
					</div>
					<button id="dd-close" title="Close (Esc)">&#10005;</button>
				</div>
				<div id="dd-body">
					<!-- Summary stat pills -->
					<div id="dd-summary" style="display:none;"></div>

					<!-- Chart -->
					<div id="dd-chart-wrap" style="display:none;">
						<h6>Chart</h6>
						<div id="dd-chart"></div>
					</div>

					<!-- Detail table -->
					<div id="dd-table-wrap">
						<h6>Detail Records</h6>
						<table id="dd-dt-table" class="display" style="width:100%"></table>
					</div>
				</div>
			</div>
		</div>
		`;

		$("#admin-dashboard").html(html);

		// ── Standalone analytics charts ──────────────────────────────────────
		(function init_admin_charts() {
			const mt  = data.monthly_trend    || [];
			const sb  = data.status_breakdown || [];
			if (!mt.length && !sb.length) return;

			const STATUS_COLORS_ADM = {
				'Payment complete':   '#1cc88a',
				'Payment pending':    '#4e73df',
				'Payment Cancelled':  '#e74a3b',
				'Suspected duplicate':'#f6c23e',
			};
			const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

			function fmt_month(m) {
				const parts = (m || "").split("-");
				if (parts.length < 2) return m;
				return MONTHS[parseInt(parts[1]) - 1] + " '" + parts[0].slice(2);
			}

			function fmt_inr(n) {
				return "₹" + parseFloat(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
			}

			let trend_mode = "count";

			function render_trend_chart() {
				if (!mt.length) { $("#admin-trend-empty").show().text("No trend data available"); return; }
				$("#admin-trend-chart").empty();
				const labels = mt.map(r => fmt_month(r.month));
				let datasets, colors;

				if (trend_mode === "count") {
					datasets = [
						{ name: "Total",     values: mt.map(r => parseInt(r.total_count)     || 0) },
						{ name: "Completed", values: mt.map(r => parseInt(r.completed_count) || 0) },
						{ name: "Pending",   values: mt.map(r => parseInt(r.pending_count)   || 0) },
					];
					colors = ["#c7d5f8", "#1cc88a", "#f6c23e"];
				} else {
					datasets = [
						{ name: "Total Amount",  values: mt.map(r => parseFloat(r.total_amount)   || 0) },
						{ name: "Welfare (₹)",   values: mt.map(r => parseFloat(r.total_welfare)  || 0) },
					];
					colors = ["#4e73df", "#1cc88a"];
				}

				try {
					new frappe.Chart("#admin-trend-chart", {
						type: "bar",
						data: { labels, datasets },
						height: 260,
						colors: colors,
						barOptions: { spaceRatio: 0.3 },
						axisOptions: { xIsSeries: false, shortenYAxisNumbers: true },
					});
				} catch (_) {
					$("#admin-trend-empty").show().text("Chart unavailable");
				}

				// Summary strip
				if (trend_mode === "count") {
					const tot  = mt.reduce((s, r) => s + (parseInt(r.total_count)     || 0), 0);
					const comp = mt.reduce((s, r) => s + (parseInt(r.completed_count) || 0), 0);
					const pend = mt.reduce((s, r) => s + (parseInt(r.pending_count)   || 0), 0);
					$("#admin-trend-summary").html(`
						<div class="sum-item"><b style="color:#555;">${tot}</b>&nbsp;Total</div>
						<div class="sum-item"><b style="color:#1cc88a;">${comp}</b>&nbsp;Completed</div>
						<div class="sum-item"><b style="color:#f6c23e;">${pend}</b>&nbsp;Pending</div>
					`);
				} else {
					const tot_amt = mt.reduce((s, r) => s + (parseFloat(r.total_amount)  || 0), 0);
					const tot_wf  = mt.reduce((s, r) => s + (parseFloat(r.total_welfare) || 0), 0);
					$("#admin-trend-summary").html(`
						<div class="sum-item"><b style="color:#4e73df;">${fmt_inr(tot_amt)}</b>&nbsp;Total Amount</div>
						<div class="sum-item"><b style="color:#1cc88a;">${fmt_inr(tot_wf)}</b>&nbsp;Total Welfare</div>
					`);
				}
			}

			// Toggle handler (namespaced to avoid duplication on re-render)
			$(document).off("click.adm_chart_toggle").on("click.adm_chart_toggle", ".adm-chart-toggle", function() {
				$(".adm-chart-toggle").removeClass("active");
				$(this).addClass("active");
				trend_mode = $(this).data("mode");
				render_trend_chart();
			});

			if (frappe && frappe.Chart) render_trend_chart();

			// ── Status donut using status_breakdown from backend ──────────────
			if (!frappe || !frappe.Chart || !$("#admin-status-chart").length) return;

			const breakdown = sb.length ? sb : (() => {
				const sc = {};
				(data.recent_transactions || []).forEach(t => { sc[t.status] = (sc[t.status] || 0) + 1; });
				return Object.keys(sc).map(s => ({ status: s, cnt: sc[s] }));
			})();

			if (!breakdown.length) {
				$("#admin-status-empty").show().text("No transaction data");
				return;
			}

			try {
				const labels = breakdown.map(r => r.status);
				const values = breakdown.map(r => parseInt(r.cnt) || 0);
				const total  = values.reduce((a, b) => a + b, 0);

				new frappe.Chart("#admin-status-chart", {
					type: "donut",
					data: { labels, datasets: [{ values }] },
					height: 200,
					colors: labels.map(l => STATUS_COLORS_ADM[l] || "#858796"),
				});

				// Total badge
				$("#admin-total-badge").show().html(`<b>${total}</b> total transactions`);

				// Rich legend with count + percentage
				const legend_html = breakdown.map(r => {
					const cnt   = parseInt(r.cnt) || 0;
					const pct   = total ? Math.round(cnt / total * 100) : 0;
					const color = STATUS_COLORS_ADM[r.status] || "#858796";
					return `<div class="leg-row">
						<span class="leg-label">
							<span class="leg-dot" style="background:${color};"></span>
							${r.status}
						</span>
						<span>
							<span class="leg-count">${cnt}</span>
							<span class="leg-pct">(${pct}%)</span>
						</span>
					</div>`;
				}).join("");
				$("#admin-status-legend").html(legend_html);
			} catch (_) {
				$("#admin-status-empty").show().text("Chart unavailable");
			}
		})();

		if ($.fn.DataTable) {
			$("#admin-agg-table").DataTable({
				pageLength: 10, lengthMenu: [5, 10, 25, 50], order: [],
				columnDefs: [{ orderable: false, targets: [8] }],
				language: { search: "Filter:", lengthMenu: "Show _MENU_ entries", info: "Showing _START_ to _END_ of _TOTAL_ records", emptyTable: "No data available" },
				dom: '<"dt-top"lf>rt<"dt-bottom"ip>',
			});
			$("#admin-workers-table").DataTable({
				pageLength: 10, lengthMenu: [5, 10, 25, 50], order: [],
				columnDefs: [{ orderable: false, targets: [5] }],
				language: { search: "Filter:", lengthMenu: "Show _MENU_ entries", info: "Showing _START_ to _END_ of _TOTAL_ records", emptyTable: "No data available" },
				dom: '<"dt-top"lf>rt<"dt-bottom"ip>',
			});
		}
		init_datatable("#admin-txn-table");
		init_datatable("#admin-wfp-table");
		if (duplicate_transactions && duplicate_transactions.length) {
			if ($.fn.DataTable) {
				$("#admin-dup-table").DataTable({
					pageLength: 25,
					lengthMenu: [10, 25, 50, 100, 500],
					deferRender: true,
					order: [],
					columnDefs: [{ orderable: false, targets: [0, 9] }],
					language: {
						search: "Filter:",
						lengthMenu: "Show _MENU_ entries",
						info: "Showing _START_ to _END_ of _TOTAL_ suspected duplicates",
						emptyTable: "No suspected duplicates found",
					},
					dom: '<"dt-top"lf>rt<"dt-bottom"ip>',
				});
			}

			// ── Bulk selection helpers ───────────────────────────────────────
			function get_checked_txns() {
				return $("#admin-dup-table tbody .dup-row-cb:checked").map(function() {
					return $(this).val();
				}).get();
			}

			function update_bulk_bar() {
				const selected = get_checked_txns();
				const n = selected.length;
				if (n > 0) {
					$("#dup-bulk-bar").css("display", "flex");
					$("#dup-bulk-count").text(n + " transaction" + (n > 1 ? "s" : "") + " selected");
				} else {
					$("#dup-bulk-bar").hide();
				}
				// highlight selected rows
				$("#admin-dup-table tbody tr").each(function() {
					const cb = $(this).find(".dup-row-cb");
					$(this).toggleClass("dup-selected", cb.prop("checked"));
				});
				// sync select-all state
				const total_visible = $("#admin-dup-table tbody .dup-row-cb").length;
				$("#dup-select-all").prop("indeterminate", n > 0 && n < total_visible);
				$("#dup-select-all").prop("checked", total_visible > 0 && n === total_visible);
			}

			// Select / deselect all
			$(document).off("change.dupSelectAll").on("change.dupSelectAll", "#dup-select-all", function() {
				const checked = $(this).prop("checked");
				$("#admin-dup-table tbody .dup-row-cb").prop("checked", checked);
				update_bulk_bar();
			});

			// Individual checkbox change
			$(document).off("change.dupRowCb").on("change.dupRowCb", ".dup-row-cb", function() {
				update_bulk_bar();
			});

			// Click anywhere on the row (except links/buttons) to toggle checkbox
			$(document).off("click.dupRowClick").on("click.dupRowClick", "#admin-dup-table tbody tr", function(e) {
				if ($(e.target).is("a, button, input")) return;
				const cb = $(this).find(".dup-row-cb");
				cb.prop("checked", !cb.prop("checked"));
				update_bulk_bar();
			});

			// Clear selection
			$(document).off("click.dupBulkClear").on("click.dupBulkClear", "#btn-bulk-clear", function() {
				$("#admin-dup-table tbody .dup-row-cb, #dup-select-all").prop("checked", false);
				update_bulk_bar();
			});

			// ── Bulk Mark as Duplicate ───────────────────────────────────────
			$(document).off("click.bulkMarkDup").on("click.bulkMarkDup", "#btn-bulk-mark-dup", function() {
				const txns = get_checked_txns();
				if (!txns.length) return;
				frappe.confirm(
					`Mark <strong>${txns.length}</strong> transaction${txns.length > 1 ? "s" : ""} as <strong>Duplicate</strong>?<br>
					<small style="color:#888;">Welfare credits will be reversed for any completed transactions.</small>`,
					function() {
						const $btn = $("#btn-bulk-mark-dup");
						$btn.text("Processing…").prop("disabled", true);
						frappe.call({
							method: "gigworkers.gig_workers.doctype.gig_transaction.gig_transaction.bulk_mark_as_duplicate",
							args: { transaction_names: JSON.stringify(txns) },
							callback(r) {
								$btn.html('<i class="fa fa-ban"></i> Mark Selected as Duplicate').prop("disabled", false);
								if (!r.exc && r.message) {
									const res = r.message;
									const ok  = res.success ? res.success.length : 0;
									const bad = res.failed  ? res.failed.length  : 0;
									if (ok)  frappe.show_alert({ message: `${ok} transaction${ok > 1 ? "s" : ""} marked as Duplicate.`, indicator: "red" });
									if (bad) frappe.show_alert({ message: `${bad} failed — check console.`, indicator: "orange" });
									fetch_data(_dash_filters);
								}
							},
						});
					}
				);
			});

			// ── Bulk Dismiss ─────────────────────────────────────────────────
			$(document).off("click.bulkDismiss").on("click.bulkDismiss", "#btn-bulk-dismiss", function() {
				const txns = get_checked_txns();
				if (!txns.length) return;
				frappe.confirm(
					`Dismiss the duplicate flag for <strong>${txns.length}</strong> transaction${txns.length > 1 ? "s" : ""}?<br>
					<small style="color:#888;">These transactions will be restored as legitimate.</small>`,
					function() {
						const $btn = $("#btn-bulk-dismiss");
						$btn.text("Processing…").prop("disabled", true);
						frappe.call({
							method: "gigworkers.gig_workers.doctype.gig_transaction.gig_transaction.bulk_dismiss_suspected_duplicate",
							args: { transaction_names: JSON.stringify(txns) },
							callback(r) {
								$btn.html('<i class="fa fa-check"></i> Dismiss Selected').prop("disabled", false);
								if (!r.exc && r.message) {
									const res = r.message;
									const ok  = res.success ? res.success.length : 0;
									const bad = res.failed  ? res.failed.length  : 0;
									if (ok)  frappe.show_alert({ message: `${ok} transaction${ok > 1 ? "s" : ""} dismissed.`, indicator: "green" });
									if (bad) frappe.show_alert({ message: `${bad} failed — check console.`, indicator: "orange" });
									fetch_data(_dash_filters);
								}
							},
						});
					}
				);
			});
		}

		bind_filter_events(aggregator_list || []);
		render_active_tags(filters || {});
		bind_drilldown_events();

		// ── Mark as Duplicate (admin confirms it is a duplicate) ─────────────
		$(document).off("click.confirmdup").on("click.confirmdup", ".btn-confirm-dup", function () {
			const txn_id = $(this).data("txn");
			const dup_of = $(this).data("dup-of");
			const $btn = $(this);
			frappe.confirm(
				`Mark <strong>${txn_id}</strong> as <strong>Duplicate</strong>?<br>
				<small style="color:#888;">If this transaction was Completed, its welfare fund credit will be reversed.</small>`,
				function () {
					$btn.text("Processing…").prop("disabled", true);
					frappe.call({
						method: "gigworkers.gig_workers.doctype.gig_transaction.gig_transaction.mark_as_duplicate",
						args: { transaction_name: txn_id, duplicate_of: dup_of || "" },
						callback(r) {
							if (!r.exc) {
								frappe.show_alert({ message: r.message.message, indicator: "red" });
								fetch_data(_dash_filters);
							} else {
								$btn.html('<i class="fa fa-ban"></i> Mark Duplicate').prop("disabled", false);
							}
						},
					});
				}
			);
		});

		// ── Dismiss (admin confirms it is NOT a duplicate) ────────────────────
		$(document).off("click.dismissdup").on("click.dismissdup", ".btn-dismiss-dup", function () {
			const txn_id = $(this).data("txn");
			const $btn = $(this);
			frappe.confirm(
				`Clear the duplicate flag for <strong>${txn_id}</strong>?<br>
				<small style="color:#888;">This transaction will be restored and no changes to welfare fund.</small>`,
				function () {
					$btn.text("Clearing…").prop("disabled", true);
					frappe.call({
						method: "gigworkers.gig_workers.doctype.gig_transaction.gig_transaction.dismiss_suspected_duplicate",
						args: { transaction_name: txn_id },
						callback(r) {
							if (!r.exc) {
								frappe.show_alert({ message: r.message.message, indicator: "green" });
								fetch_data(_dash_filters);
							} else {
								$btn.html('<i class="fa fa-check"></i> Dismiss').prop("disabled", false);
							}
						},
					});
				}
			);
		});
		$("#btn-dl-pdf").on("click", download_pdf);
	}
};
