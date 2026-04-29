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
	// Inject styles once per page
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
				transition: box-shadow 0.15s ease;
			}
			.wfa-card:hover {
				box-shadow: var(--shadow-sm);
			}
			.wfa-card-label {
				font-size: 11px;
				color: var(--text-muted);
				text-transform: uppercase;
				letter-spacing: 0.5px;
				font-weight: 500;
				margin-bottom: 6px;
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
