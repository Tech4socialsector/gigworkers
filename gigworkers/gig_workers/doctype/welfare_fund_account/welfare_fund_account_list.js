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
				"$ " +
				parseFloat(v || 0).toLocaleString("en-US", {
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
		"$ " +
		parseFloat(v || 0).toLocaleString("en-US", {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		});

	frappe.call({
		method: "gigworkers.gig_workers.doctype.welfare_fund_account.welfare_fund_account.get_list_breakdown",
		args: { metric },
		callback(r) {
			if (!r.message) return;
			const all_rows = r.message;

			if (!all_rows.length) {
				frappe.msgprint(__("No data found."));
				return;
			}

			// Reactive state
			let sort_col = "value";
			let sort_dir = "desc";
			let search_q = "";

			const d = new frappe.ui.Dialog({
				title: `${label} — ${__("Breakdown")}`,
				size: "large",
			});

			function render() {
				// Filter
				let rows = all_rows.filter((row) =>
					(row.gig_worker || row.name)
						.toLowerCase()
						.includes(search_q.toLowerCase())
				);

				// Sort
				rows.sort((a, b) => {
					const va =
						sort_col === "value"
							? a.value || 0
							: (a.gig_worker || "").toLowerCase();
					const vb =
						sort_col === "value"
							? b.value || 0
							: (b.gig_worker || "").toLowerCase();
					if (va < vb) return sort_dir === "asc" ? -1 : 1;
					if (va > vb) return sort_dir === "asc" ? 1 : -1;
					return 0;
				});

				const total = rows.reduce((s, row) => s + (row.value || 0), 0);

				const icon = (col) => {
					if (sort_col !== col) return `<span style="opacity:0.35;">↕</span>`;
					return sort_dir === "asc"
						? `<span style="color:var(--primary);">▲</span>`
						: `<span style="color:var(--primary);">▼</span>`;
				};

				const tbody_html = rows.length
					? rows
							.map(
								(row, i) => `
						<tr class="wfa-dt-row" style="border-bottom:1px solid var(--border-color);">
							<td style="padding:9px 12px;text-align:center;color:var(--text-muted);width:42px;">${i + 1}</td>
							<td style="padding:9px 12px;">
								<a href="/desk#Form/Welfare Fund Account/${encodeURIComponent(row.name)}"
								   target="_blank" style="color:var(--primary);font-weight:500;">
									${frappe.utils.escape_html(row.gig_worker || row.name)}
								</a>
							</td>
							<td style="padding:9px 12px;text-align:right;font-weight:600;font-variant-numeric:tabular-nums;">
								${fmt(row.value)}
							</td>
						</tr>`
							)
							.join("")
					: `<tr><td colspan="3" style="padding:24px;text-align:center;color:var(--text-muted);">
							${__("No records match your search.")}
						</td></tr>`;

				const hdr_style =
					"padding:9px 12px;color:var(--text-muted);font-weight:600;" +
					"font-size:11px;text-transform:uppercase;letter-spacing:0.5px;" +
					"cursor:pointer;user-select:none;white-space:nowrap;";

				d.$body.html(`
					<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
						<input id="wfa-dt-search" type="text" class="form-control form-control-sm"
							placeholder="${__("Search gig worker…")}"
							value="${frappe.utils.escape_html(search_q)}"
							style="max-width:220px;">
						<span style="font-size:12px;color:var(--text-muted);">
							${rows.length} / ${all_rows.length} ${__("records")}
						</span>
					</div>
					<div style="border:1px solid var(--border-color);border-radius:var(--border-radius-md,6px);overflow:hidden;">
						<div style="max-height:52vh;overflow-y:auto;">
							<table style="width:100%;border-collapse:collapse;font-size:13px;">
								<thead>
									<tr style="background:var(--subtle-fg,var(--card-bg));border-bottom:2px solid var(--border-color);">
										<th style="${hdr_style}text-align:center;width:42px;">#</th>
										<th class="wfa-sort-hdr" data-col="gig_worker"
											style="${hdr_style}text-align:left;">
											${__("Gig Worker")} ${icon("gig_worker")}
										</th>
										<th class="wfa-sort-hdr" data-col="value"
											style="${hdr_style}text-align:right;">
											${label} ${icon("value")}
										</th>
									</tr>
								</thead>
								<tbody>${tbody_html}</tbody>
								<tfoot>
									<tr style="background:var(--subtle-fg,var(--card-bg));border-top:2px solid var(--border-color);">
										<td style="padding:9px 12px;"></td>
										<td style="padding:9px 12px;font-weight:700;">
											${__("Total")}
											<span style="font-weight:400;color:var(--text-muted);font-size:11px;">
												(${rows.length})
											</span>
										</td>
										<td style="padding:9px 12px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums;">
											${fmt(total)}
										</td>
									</tr>
								</tfoot>
							</table>
						</div>
					</div>
				`);

				// Row hover
				d.$body.find(".wfa-dt-row").on("mouseenter", function () {
					$(this).css("background", "var(--bg-light,var(--bg-color))");
				}).on("mouseleave", function () {
					$(this).css("background", "");
				});

				// Search — preserve focus + cursor position
				d.$body.find("#wfa-dt-search").on("input", function () {
					search_q = this.value;
					const pos = this.selectionStart;
					render();
					const $inp = d.$body.find("#wfa-dt-search");
					$inp.focus()[0].setSelectionRange(pos, pos);
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
			}

			render();
			d.show();
		},
	});
}
