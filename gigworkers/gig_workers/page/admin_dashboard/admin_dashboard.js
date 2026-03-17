frappe.pages["admin-dashboard"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
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
			Completed: "#28a745", Registered: "#007bff", Pending: "#ffc107",
			Onboarded: "#28a745", Inactive: "#6c757d", Approved: "#28a745",
			Rejected: "#dc3545", Active: "#1cc88a", Offboarded: "#6c757d",
			"Pending Verification": "#fd7e14", Deceased: "#343a40",
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
				{ label: "Pending Verification",  value: d.workers.pending_verification },
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
				["Txn ID", "Date", "Aggregator", "Gig Worker", "Service", "Amount (INR)", "Welfare (INR)", "Status"],
				d.recent_transactions.map(t => [
					t.name, t.date || "-", t.aggregator || "-", t.gig_worker || "-",
					t.service || "-", fmt_currency_plain(t.amount),
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

	// ── render ────────────────────────────────────────────────────────────────

	function render_dashboard(data, filters) {
		const { stats, aggregators, workers, welfare_payments, welfare_fund,
			aggregator_breakdown, recent_transactions, pending_wfp,
			recent_workers, aggregator_list } = data;

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
		</style>

		${filter_bar}

		<!-- Transactions -->
		<div class="admin-section-title">Transactions</div>
		<div class="admin-card-row">
			<div class="admin-stat-card" style="--card-color:#4e73df;"><div class="label">Total Transactions</div><div class="value">${stats.total_transactions}</div></div>
			<div class="admin-stat-card" style="--card-color:#1cc88a;"><div class="label">Completed</div><div class="value">${stats.completed_transactions}</div></div>
			<div class="admin-stat-card" style="--card-color:#f6c23e;"><div class="label">Pending</div><div class="value">${stats.pending_transactions}</div></div>
			<div class="admin-stat-card" style="--card-color:#36b9cc;"><div class="label">Total Amount</div><div class="value" style="font-size:20px;">${fmt_currency(stats.total_amount)}</div></div>
			<div class="admin-stat-card" style="--card-color:#e74a3b;"><div class="label">Welfare Collected</div><div class="value" style="font-size:20px;">${fmt_currency(stats.total_welfare)}</div></div>
			<div class="admin-stat-card" style="--card-color:#858796;"><div class="label">Base Payout Total</div><div class="value" style="font-size:20px;">${fmt_currency(stats.total_base_payout)}</div></div>
		</div>

		<!-- Platform Overview -->
		<div class="admin-section-title">Platform Overview</div>
		<div class="admin-card-row">
			<div class="admin-stat-card" style="--card-color:#4e73df;"><div class="label">Total Aggregators</div><div class="value">${aggregators.total}</div></div>
			<div class="admin-stat-card" style="--card-color:#1cc88a;"><div class="label">Active Aggregators</div><div class="value">${aggregators.active}</div></div>
			<div class="admin-stat-card" style="--card-color:#4e73df;"><div class="label">Total Gig Workers</div><div class="value">${workers.total}</div></div>
			<div class="admin-stat-card" style="--card-color:#1cc88a;"><div class="label">Active Workers</div><div class="value">${workers.active}</div></div>
			<div class="admin-stat-card" style="--card-color:#fd7e14;"><div class="label">Pending Verification</div><div class="value">${workers.pending_verification}</div></div>
			<div class="admin-stat-card" style="--card-color:#6c757d;"><div class="label">Inactive Workers</div><div class="value">${workers.inactive}</div></div>
		</div>

		<!-- Welfare -->
		<div class="admin-section-title">Welfare</div>
		<div class="admin-card-row">
			<div class="admin-stat-card" style="--card-color:#28a745;"><div class="label">Welfare Fees Settled</div><div class="value" style="font-size:20px;">${fmt_currency(welfare_payments.total_paid)}</div></div>
			<div class="admin-stat-card" style="--card-color:#e74a3b;"><div class="label">Welfare Fees Pending</div><div class="value" style="font-size:20px;color:#e74a3b;">${fmt_currency(welfare_payments.pending_amount)}</div></div>
			<div class="admin-stat-card" style="--card-color:#1cc88a;"><div class="label">Welfare Fund Balance</div><div class="value" style="font-size:20px;">${fmt_currency(welfare_fund.total_balance)}</div></div>
			<div class="admin-stat-card" style="--card-color:#36b9cc;"><div class="label">Total Fund Collected</div><div class="value" style="font-size:20px;">${fmt_currency(welfare_fund.total_collected)}</div></div>
			<div class="admin-stat-card" style="--card-color:#f6c23e;"><div class="label">Total Withdrawn</div><div class="value" style="font-size:20px;">${fmt_currency(welfare_fund.total_withdrawn)}</div></div>
		</div>

		<!-- Aggregator Breakdown -->
		<div class="admin-section">
			<h5>Aggregator Breakdown <a href="/app/aggregator" style="float:right;font-size:13px;font-weight:500;color:#4e73df;">View All</a></h5>
			<table id="admin-agg-table" class="display" style="width:100%">
				<thead><tr>
					<th>Aggregator ID</th><th>Name</th><th>Status</th>
					<th>Workers</th><th>Transactions</th><th>Total Amount</th>
					<th>Welfare Collected</th><th>Pending Fees</th>
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
						<td class="${parseFloat(a.pending_fees) > 0 ? "highlight" : ""}">${fmt_currency(a.pending_fees)}</td>
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
					<th>Service</th><th>Amount</th><th>Welfare</th><th>Status</th>
				</tr></thead>
				<tbody>
					${recent_transactions.map(t => `<tr>
						<td><a href="/app/gig-transaction/${t.name}" style="color:#4e73df;">${t.name}</a></td>
						<td>${t.date || "-"}</td>
						<td>${t.aggregator || "-"}</td>
						<td>${t.gig_worker || "-"}</td>
						<td>${t.service || "-"}</td>
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
					<th>Status</th><th>Registered By</th>
				</tr></thead>
				<tbody>
					${recent_workers.map(w => `<tr>
						<td><a href="/app/gig-worker/${w.name}" style="color:#4e73df;">${w.name}</a></td>
						<td>${w.worker_name || "-"}</td>
						<td>${w.gender || "-"}</td>
						<td>${status_badge(w.status)}</td>
						<td>${w.created_by_aggregator || "-"}</td>
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
		</div>
		`;

		$("#admin-dashboard").html(html);

		init_datatable("#admin-agg-table");
		init_datatable("#admin-txn-table");
		init_datatable("#admin-wfp-table");
		init_datatable("#admin-workers-table");

		bind_filter_events(aggregator_list || []);
		render_active_tags(filters || {});

		$("#btn-dl-pdf").on("click", download_pdf);
	}
};
