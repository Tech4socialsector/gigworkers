// Copyright (c) 2026, Jenifar and contributors
// For license information, please see license.txt

frappe.listview_settings["Welfare Fund Account"] = {
	refresh(listview) {
		if (!listview.$wfa_summary_bar) {
			_inject_summary_bar(listview);
		}
		_fetch_and_update(listview);
	},
};

function _inject_summary_bar(listview) {
	if (!document.getElementById("wfa-summary-styles")) {
		const style = document.createElement("style");
		style.id = "wfa-summary-styles";
		style.textContent = `
			.wfa-summary-bar {
				display: flex;
				gap: 12px;
				padding: 10px 15px;
				border-bottom: 1px solid var(--border-color);
				flex-wrap: wrap;
				background: var(--fg-color);
			}
			.wfa-card {
				display: flex;
				flex-direction: column;
				padding: 10px 20px;
				background: var(--card-bg);
				border: 1px solid var(--border-color);
				border-radius: var(--border-radius-md, 6px);
				min-width: 180px;
				box-shadow: var(--shadow-xs);
				cursor: pointer;
				transition: box-shadow 0.15s ease, border-color 0.15s ease;
			}
			.wfa-card:hover {
				box-shadow: var(--shadow-sm);
				border-color: var(--primary);
			}
			.wfa-card-label {
				font-size: 11px;
				color: var(--text-muted);
				text-transform: uppercase;
				letter-spacing: 0.5px;
				font-weight: 500;
				margin-bottom: 6px;
			}
			.wfa-card-label::after {
				content: " ↗";
				opacity: 0.5;
				font-size: 10px;
			}
			.wfa-card-value {
				font-size: 20px;
				font-weight: 700;
				color: var(--text-color);
			}
			.wfa-card[data-metric="account_balance"] .wfa-card-value {
				color: var(--green-600, #28a745);
			}
			.wfa-card[data-metric="total_withdrawn"] .wfa-card-value {
				color: var(--orange-500, #e67e22);
			}
		`;
		document.head.appendChild(style);
	}

	listview.$wfa_summary_bar = $(`
		<div class="wfa-summary-bar">
			<div class="wfa-card" data-metric="account_balance">
				<div class="wfa-card-label">${__("Total Account Balance")}</div>
				<div class="wfa-card-value">—</div>
			</div>
			<div class="wfa-card" data-metric="total_withdrawn">
				<div class="wfa-card-label">${__("Total Withdrawn")}</div>
				<div class="wfa-card-value">—</div>
			</div>
		</div>
	`);

	listview.$frappe_list.prepend(listview.$wfa_summary_bar);

	// Drill-down click handlers
	listview.$wfa_summary_bar.find(".wfa-card").on("click", function () {
		_show_drilldown($(this).data("metric"));
	});
}

function _fetch_and_update(listview) {
	frappe.call({
		method: "gigworkers.gig_workers.doctype.welfare_fund_account.welfare_fund_account.get_list_summary",
		callback(r) {
			if (!r.message) return;
			const { total_account_balance, total_withdrawn } = r.message;
			const fmt = (v) =>
				"₹ " + parseFloat(v || 0).toLocaleString("en-IN", {
					minimumFractionDigits: 2,
					maximumFractionDigits: 2,
				});
			listview.$wfa_summary_bar
				.find('[data-metric="account_balance"] .wfa-card-value')
				.text(fmt(total_account_balance));
			listview.$wfa_summary_bar
				.find('[data-metric="total_withdrawn"] .wfa-card-value')
				.text(fmt(total_withdrawn));
		},
	});
}

function _show_drilldown(metric) {
	const label =
		metric === "account_balance"
			? __("Total Account Balance")
			: __("Total Withdrawn");

	const fmt = (v) =>
		"₹ " + parseFloat(v || 0).toLocaleString("en-IN", {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		});

	frappe.call({
		method: "gigworkers.gig_workers.doctype.welfare_fund_account.welfare_fund_account.get_list_breakdown",
		args: { metric },
		callback(r) {
			if (!r.message) return;
			const all_rows = r.message;

			// Reactive state
			let sort_col = metric === "account_balance" ? "transaction_date" : "withdrawal_date";
			let sort_dir = "desc";
			let search_q  = "";
			let page      = 1;
			let page_size = 25;   // default rows per page

			const fmt_date = (v) =>
				v ? frappe.datetime.str_to_user(String(v).split(" ")[0]) : "—";

			const d = new frappe.ui.Dialog({
				title: `${label} — ${__("Breakdown")}`,
				size: "extra-large",
			});

			function render() {
				// ── 1. Filter ────────────────────────────────────────────
				let rows = all_rows.filter((row) => {
					const q = search_q.toLowerCase();
					if (metric === "account_balance") {
						return (
							(row.transaction_id   || "").toLowerCase().includes(q) ||
							(row.service_category || "").toLowerCase().includes(q) ||
							(row.aggregator       || "").toLowerCase().includes(q) ||
							(row.aggregator_name  || "").toLowerCase().includes(q) ||
							(row.service_type     || "").toLowerCase().includes(q)
						);
					} else {
						return (
							(row.withdrawal_id   || "").toLowerCase().includes(q) ||
							(row.gig_worker      || "").toLowerCase().includes(q) ||
							(row.withdrawal_type || "").toLowerCase().includes(q) ||
							(row.status          || "").toLowerCase().includes(q)
						);
					}
				});

				// ── 2. Sort ──────────────────────────────────────────────
				rows.sort((a, b) => {
					const va = sort_col === "value" ? (a.value || 0)
						: (a[sort_col] || "").toString().toLowerCase();
					const vb = sort_col === "value" ? (b.value || 0)
						: (b[sort_col] || "").toString().toLowerCase();
					if (va < vb) return sort_dir === "asc" ? -1 : 1;
					if (va > vb) return sort_dir === "asc" ? 1 : -1;
					return 0;
				});

				// ── 3. Paginate ──────────────────────────────────────────
				const total_filtered = rows.length;
				const grand_total    = rows.reduce((s, r) => s + (r.value || 0), 0);
				const total_pages    = page_size === 0
					? 1
					: Math.max(1, Math.ceil(total_filtered / page_size));
				if (page > total_pages) page = total_pages;

				const display_rows = page_size === 0
					? rows
					: rows.slice((page - 1) * page_size, page * page_size);

				// Serial number offset for current page
				const serial_offset = page_size === 0 ? 0 : (page - 1) * page_size;

				// ── 4. Build HTML ────────────────────────────────────────
				const COLSPAN = 8;

				const icon = (col) => {
					if (sort_col !== col)
						return `<span style="opacity:0.35;">↕</span>`;
					return sort_dir === "asc"
						? `<span style="color:var(--primary);">▲</span>`
						: `<span style="color:var(--primary);">▼</span>`;
				};

				const tbody_html = display_rows.length
					? display_rows.map((row, i) => {
						const cells = metric === "account_balance" ? `
							<td style="padding:8px;">
								<a href="/desk#Form/Gig Transaction/${encodeURIComponent(row.transaction_id)}"
								   target="_blank"
								   style="color:var(--primary);font-weight:600;font-family:monospace;font-size:12px;">
									${frappe.utils.escape_html(row.transaction_id || "—")}
								</a>
							</td>
							<td style="padding:8px;">${frappe.utils.escape_html(row.service_category || "—")}</td>
							<td style="padding:8px;white-space:nowrap;color:var(--text-muted);">${fmt_date(row.transaction_date)}</td>
							<td style="padding:8px;">
								<div style="font-weight:500;">${frappe.utils.escape_html(row.aggregator_name || row.aggregator || "—")}</div>
								<div style="font-size:11px;color:var(--text-muted);">${frappe.utils.escape_html(row.aggregator || "")}</div>
							</td>
							<td style="padding:8px;">${frappe.utils.escape_html(row.service_type || "—")}</td>` : `
							<td style="padding:8px;">
								<a href="/desk#Form/Welfare Benefit Withdrawal/${encodeURIComponent(row.withdrawal_id || "")}"
								   target="_blank"
								   style="color:var(--primary);font-weight:600;font-family:monospace;font-size:12px;">
									${frappe.utils.escape_html(row.withdrawal_id || "—")}
								</a>
							</td>
							<td style="padding:8px;">${frappe.utils.escape_html(row.gig_worker || "—")}</td>
							<td style="padding:8px;white-space:nowrap;color:var(--text-muted);">${fmt_date(row.withdrawal_date)}</td>
							<td style="padding:8px;">${frappe.utils.escape_html(row.withdrawal_type || "—")}</td>
							<td style="padding:8px;">${frappe.utils.escape_html(row.status || "—")}</td>`;
						return `
						<tr class="wfa-dt-row" style="border-bottom:1px solid var(--border-color);">
							<td style="padding:8px;text-align:center;color:var(--text-muted);width:34px;">${serial_offset + i + 1}</td>
							${cells}
							<td style="padding:8px;text-align:right;font-weight:600;font-variant-numeric:tabular-nums;">${fmt(row.value)}</td>
						</tr>`;
					}).join("")
					: `<tr><td colspan="${COLSPAN}" style="padding:24px;text-align:center;color:var(--text-muted);">
							${__("No records match your search.")}
						</td></tr>`;

				const hdr =
					"padding:8px;color:var(--text-muted);font-weight:600;" +
					"font-size:11px;text-transform:uppercase;letter-spacing:0.5px;" +
					"cursor:pointer;user-select:none;white-space:nowrap;";

				// Pagination range label
				const range_label = page_size === 0
					? `${__("All")} ${total_filtered} ${__("records")}`
					: (() => {
						const from = total_filtered === 0 ? 0 : serial_offset + 1;
						const to   = Math.min(serial_offset + page_size, total_filtered);
						return `${from}–${to} ${__("of")} ${total_filtered}`;
					})();

				d.$body.html(`
					<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
						<input id="wfa-dt-search" type="text" class="form-control form-control-sm"
							placeholder="${__("Search ID, category, aggregator, type…")}"
							value="${frappe.utils.escape_html(search_q)}"
							style="max-width:280px;">
						<span style="font-size:12px;color:var(--text-muted);">
							${total_filtered} / ${all_rows.length} ${__("records")}
						</span>
					</div>

					<div style="display:flex;align-items:center;justify-content:space-between;
							padding:12px 18px;margin-bottom:10px;
							background:var(--primary,#1a73e8);
							border-radius:var(--border-radius-md,6px);
							box-shadow:var(--shadow-sm);">
						<div style="display:flex;align-items:center;gap:10px;">
							<span style="font-size:13px;font-weight:700;color:#fff;letter-spacing:0.3px;">
								${__("Grand Total")}
							</span>
							<span style="font-size:11px;font-weight:500;
									color:rgba(255,255,255,0.75);
									background:rgba(255,255,255,0.15);
									border-radius:20px;padding:2px 10px;">
								${total_filtered} ${__("records")}
							</span>
						</div>
						<span style="font-size:20px;font-weight:800;color:#fff;
								font-variant-numeric:tabular-nums;letter-spacing:0.5px;">
							${fmt(grand_total)}
						</span>
					</div>

					<div style="border:1px solid var(--border-color);border-radius:var(--border-radius-md,6px);overflow:hidden;">

						<div style="max-height:45vh;overflow-y:auto;">
							<table style="width:100%;border-collapse:collapse;font-size:13px;">
								<thead>
									<tr style="background:var(--subtle-fg,var(--card-bg));border-bottom:2px solid var(--border-color);">
										<th style="${hdr}text-align:center;width:34px;">#</th>
										${metric === "account_balance" ? `
											<th class="wfa-sort-hdr" data-col="transaction_id" style="${hdr}text-align:left;">
												${__("Gig Transaction ID")} ${icon("transaction_id")}
											</th>
											<th class="wfa-sort-hdr" data-col="service_category" style="${hdr}text-align:left;">
												${__("Service Category")} ${icon("service_category")}
											</th>
											<th class="wfa-sort-hdr" data-col="transaction_date" style="${hdr}text-align:left;">
												${__("Transaction Date")} ${icon("transaction_date")}
											</th>
											<th class="wfa-sort-hdr" data-col="aggregator_name" style="${hdr}text-align:left;">
												${__("Aggregator")} ${icon("aggregator_name")}
											</th>
											<th class="wfa-sort-hdr" data-col="service_type" style="${hdr}text-align:left;">
												${__("Service Type")} ${icon("service_type")}
											</th>` : `
											<th class="wfa-sort-hdr" data-col="withdrawal_id" style="${hdr}text-align:left;">
												${__("Withdrawal ID")} ${icon("withdrawal_id")}
											</th>
											<th class="wfa-sort-hdr" data-col="gig_worker" style="${hdr}text-align:left;">
												${__("Gig Worker")} ${icon("gig_worker")}
											</th>
											<th class="wfa-sort-hdr" data-col="withdrawal_date" style="${hdr}text-align:left;">
												${__("Withdrawal Date")} ${icon("withdrawal_date")}
											</th>
											<th class="wfa-sort-hdr" data-col="withdrawal_type" style="${hdr}text-align:left;">
												${__("Withdrawal Type")} ${icon("withdrawal_type")}
											</th>
											<th class="wfa-sort-hdr" data-col="status" style="${hdr}text-align:left;">
												${__("Status")} ${icon("status")}
											</th>`}
										<th class="wfa-sort-hdr" data-col="value" style="${hdr}text-align:right;">
											${__("Amount")} ${icon("value")}
										</th>
									</tr>
								</thead>
								<tbody>${tbody_html}</tbody>
							</table>
						</div>

						<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;
									border-top:1px solid var(--border-color);
									background:var(--subtle-fg,var(--card-bg));font-size:12px;">
							<span style="color:var(--text-muted);">${__("Rows per page")}:</span>
							<select id="wfa-page-size" class="form-select form-select-sm"
									style="width:auto;font-size:12px;padding:2px 6px;">
								<option value="25"  ${page_size === 25  ? "selected" : ""}>25</option>
								<option value="50"  ${page_size === 50  ? "selected" : ""}>50</option>
								<option value="100" ${page_size === 100 ? "selected" : ""}>100</option>
								<option value="0"   ${page_size === 0   ? "selected" : ""}>${__("All")}</option>
							</select>
							<span style="flex:1;text-align:center;color:var(--text-muted);">
								${range_label}
							</span>
							<button id="wfa-pg-first" class="btn btn-xs btn-default"
									${page <= 1 ? "disabled" : ""} style="padding:2px 8px;">«</button>
							<button id="wfa-pg-prev" class="btn btn-xs btn-default"
									${page <= 1 ? "disabled" : ""} style="padding:2px 8px;">‹</button>
							<span style="font-weight:600;min-width:80px;text-align:center;">
								${__("Page")} ${page} ${__("of")} ${total_pages}
							</span>
							<button id="wfa-pg-next" class="btn btn-xs btn-default"
									${page >= total_pages ? "disabled" : ""} style="padding:2px 8px;">›</button>
							<button id="wfa-pg-last" class="btn btn-xs btn-default"
									${page >= total_pages ? "disabled" : ""} style="padding:2px 8px;">»</button>
						</div>
					</div>
				`);

				// Row hover
				d.$body.find(".wfa-dt-row")
					.on("mouseenter", function () { $(this).css("background", "var(--bg-light,var(--bg-color))"); })
					.on("mouseleave", function () { $(this).css("background", ""); });

				// Search — preserve caret position
				d.$body.find("#wfa-dt-search").on("input", function () {
					search_q = this.value;
					page = 1;
					const pos = this.selectionStart;
					render();
					const $i = d.$body.find("#wfa-dt-search");
					$i.focus()[0].setSelectionRange(pos, pos);
				});

				// Sort
				d.$body.find(".wfa-sort-hdr").on("click", function () {
					const col = $(this).data("col");
					if (sort_col === col) {
						sort_dir = sort_dir === "asc" ? "desc" : "asc";
					} else {
						sort_col = col;
						sort_dir = col === "value" ? "desc" : "asc";
					}
					render();
				});

				// Page size
				d.$body.find("#wfa-page-size").on("change", function () {
					page_size = parseInt(this.value);
					page = 1;
					render();
				});

				// Pagination buttons
				d.$body.find("#wfa-pg-first").on("click", () => { page = 1;           render(); });
				d.$body.find("#wfa-pg-prev" ).on("click", () => { page--;             render(); });
				d.$body.find("#wfa-pg-next" ).on("click", () => { page++;             render(); });
				d.$body.find("#wfa-pg-last" ).on("click", () => { page = total_pages; render(); });
			}

			render();
			d.show();
		},
	});
}
