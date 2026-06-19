frappe.pages["aggregator-approval"].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({
		parent: wrapper,
		title: "Aggregator Approval",
		single_column: true,
	});

	let _rows = [];
	let _dt   = null;

	// ── Styles ────────────────────────────────────────────────────────────────
	const style = document.createElement("style");
	style.textContent = `
		#aa-page { padding: 20px 24px; font-family: var(--font-stack, 'Inter', sans-serif); }

		/* Stat strip */
		.aa-stats {
			display: flex; gap: 1px;
			background: #e2e8f0;
			border: 1px solid #e2e8f0;
			border-radius: 8px;
			overflow: hidden;
			margin-bottom: 18px;
		}
		.aa-stat {
			flex: 1; background: #fff;
			padding: 14px 20px;
			cursor: pointer;
			transition: background .12s;
			border-bottom: 3px solid transparent;
		}
		.aa-stat:hover { background: #f8fafc; }
		.aa-stat.active { border-bottom-color: #1e40af; background: #f0f4ff; }
		.aa-stat.active.s { border-bottom-color: #d97706; background: #fffbeb; }
		.aa-stat.active.u { border-bottom-color: #0369a1; background: #f0f9ff; }
		.aa-stat.active.c { border-bottom-color: #b45309; background: #fffbeb; }
		.aa-stat-num  { font-size: 24px; font-weight: 700; color: #0f172a; line-height: 1; }
		.aa-stat.active   .aa-stat-num { color: #1e40af; }
		.aa-stat.active.s .aa-stat-num { color: #d97706; }
		.aa-stat.active.u .aa-stat-num { color: #0369a1; }
		.aa-stat.active.c .aa-stat-num { color: #b45309; }
		.aa-stat-lbl  { font-size: 11px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: .5px; margin-top: 3px; }

		/* Toolbar */
		.aa-toolbar {
			display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
			margin-bottom: 16px;
		}
		.aa-search {
			padding: 7px 12px 7px 32px; border: 1px solid #cbd5e1;
			border-radius: 6px; font-size: 13px; width: 260px; outline: none;
			background: #fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' fill='none' stroke='%2394a3b8' stroke-width='2' viewBox='0 0 24 24'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cpath stroke-linecap='round' d='M21 21l-4.35-4.35'/%3E%3C/svg%3E") 10px center no-repeat;
			transition: border-color .15s;
		}
		.aa-search:focus { border-color: #1e40af; }
		.aa-spacer { flex: 1; }

		/* Buttons */
		.aa-btn {
			display: inline-flex; align-items: center; gap: 5px;
			padding: 7px 14px; border: 1px solid transparent;
			border-radius: 6px; font-size: 12px; font-weight: 600;
			cursor: pointer; font-family: inherit; transition: opacity .12s;
			white-space: nowrap;
		}
		.aa-btn:hover:not(:disabled) { opacity: .85; }
		.aa-btn:disabled { opacity: .38; cursor: not-allowed; }
		.aa-btn-default  { background: #f1f5f9; color: #475569; border-color: #e2e8f0; }
		.aa-btn-process  { background: #eff6ff; color: #1e40af; border-color: #bfdbfe; }
		.aa-btn-approve  { background: #f0fdf4; color: #166534; border-color: #bbf7d0; }
		.aa-btn-clarify  { background: #fffbeb; color: #92400e; border-color: #fde68a; }

		/* Table card */
		.aa-card {
			background: #fff; border: 1px solid #e2e8f0;
			border-radius: 8px; overflow: hidden;
		}
		.aa-card-head {
			padding: 12px 18px; border-bottom: 1px solid #e2e8f0;
			display: flex; align-items: center; justify-content: space-between;
			background: #f8fafc;
		}
		.aa-card-title { font-size: 12px; font-weight: 700; color: #374151; text-transform: uppercase; letter-spacing: .5px; }
		.aa-sel-count  { font-size: 12px; color: #6b7280; }
		.aa-sel-count b { color: #1e40af; }

		/* DataTable */
		table#aa-dt { width: 100% !important; border-collapse: collapse; font-size: 13px; }
		table#aa-dt thead th {
			background: #f8fafc !important; color: #374151 !important;
			font-size: 11px !important; font-weight: 700 !important;
			text-transform: uppercase !important; letter-spacing: .5px !important;
			padding: 11px 14px !important; border-bottom: 1px solid #e2e8f0 !important;
			white-space: nowrap;
		}
		table#aa-dt thead th:first-child { width: 36px; text-align: center !important; }
		table#aa-dt tbody tr { border-bottom: 1px solid #f1f5f9 !important; }
		table#aa-dt tbody tr:last-child { border-bottom: none !important; }
		table#aa-dt tbody tr:hover { background: #f8fafc !important; }
		table#aa-dt td { padding: 11px 14px !important; vertical-align: middle !important; }
		table#aa-dt td:first-child { text-align: center; }

		.aa-id-link {
			color: #1e40af; font-weight: 600; cursor: pointer;
			text-decoration: none;
		}
		.aa-id-link:hover { text-decoration: underline; }
		.aa-muted { color: #6b7280; }

		/* Status badge */
		.aa-badge {
			display: inline-block; padding: 3px 10px; border-radius: 20px;
			font-size: 11px; font-weight: 600; letter-spacing: .3px;
		}
		.aa-badge.sub { background: #fef3c7; color: #92400e; }
		.aa-badge.und { background: #dbeafe; color: #1e40af; }
		.aa-badge.app { background: #dcfce7; color: #166534; }
		.aa-badge.pwc { background: #fef3c7; color: #92400e; }

		/* Row action buttons */
		.aa-ra { display: flex; gap: 5px; justify-content: center; }
		.aa-ra-btn {
			padding: 3px 10px; border: 1px solid transparent;
			border-radius: 5px; font-size: 11px; font-weight: 600;
			cursor: pointer; font-family: inherit; transition: opacity .12s;
		}
		.aa-ra-btn:hover { opacity: .8; }
		.aa-ra-btn.p { background: #eff6ff; color: #1e40af; border-color: #bfdbfe; }
		.aa-ra-btn.a { background: #f0fdf4; color: #166534; border-color: #bbf7d0; }
		.aa-ra-btn.c { background: #fffbeb; color: #92400e; border-color: #fde68a; }

		/* DT controls */
		.dt-top    { display: flex; align-items: center; gap: 12px; padding: 12px 16px 8px; }
		.dt-bottom { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px 12px; flex-wrap: wrap; gap: 6px; }
		div.dataTables_length select,
		div.dataTables_filter input {
			border: 1px solid #cbd5e1 !important; border-radius: 5px !important;
			padding: 5px 8px !important; font-size: 12px !important;
			outline: none !important; background: #fff !important;
		}
		div.dataTables_filter input:focus { border-color: #1e40af !important; }
		div.dataTables_info { font-size: 12px; color: #6b7280; }
		div.dataTables_paginate .paginate_button {
			padding: 4px 10px !important; border-radius: 5px !important;
			border: 1px solid #e2e8f0 !important; margin: 0 2px !important;
			font-size: 12px !important; color: #374151 !important;
			cursor: pointer; background: #fff !important;
		}
		div.dataTables_paginate .paginate_button.current {
			background: #1e40af !important; color: #fff !important; border-color: #1e40af !important;
		}
		div.dataTables_paginate .paginate_button:hover:not(.current) {
			background: #f0f4ff !important; border-color: #1e40af !important; color: #1e40af !important;
		}
		div.dataTables_paginate .paginate_button.disabled { opacity: .4; cursor: default !important; }
	`;
	document.head.appendChild(style);

	// ── HTML ──────────────────────────────────────────────────────────────────
	$(wrapper).find(".page-content").html(`
		<div id="aa-page">

			<div class="aa-stats">
				<div class="aa-stat active" data-filter="All">
					<div class="aa-stat-num" id="stat-all">—</div>
					<div class="aa-stat-lbl">All Pending</div>
				</div>
				<div class="aa-stat s" data-filter="Submitted">
					<div class="aa-stat-num" id="stat-sub">—</div>
					<div class="aa-stat-lbl">Submitted</div>
				</div>
				<div class="aa-stat u" data-filter="Under Process">
					<div class="aa-stat-num" id="stat-und">—</div>
					<div class="aa-stat-lbl">Under Process</div>
				</div>
				<div class="aa-stat c" data-filter="Pending with Clarification">
					<div class="aa-stat-num" id="stat-pwc">—</div>
					<div class="aa-stat-lbl">Pending Clarification</div>
				</div>
			</div>

			<div class="aa-toolbar">
				<input class="aa-search" id="aa-search" type="text" placeholder="Search name, email, mobile, ID…" />
				<div class="aa-spacer"></div>
				<button class="aa-btn aa-btn-default" id="aa-refresh">&#x21bb; Refresh</button>
				<button class="aa-btn aa-btn-process" id="aa-bulk-process" disabled>Mark Under Process</button>
				<button class="aa-btn aa-btn-approve" id="aa-bulk-approve" disabled>&#10003; Approve Selected</button>
				<button class="aa-btn aa-btn-clarify" id="aa-bulk-clarify" disabled>&#9432; Pending with Clarification</button>
			</div>

			<div class="aa-card">
				<div class="aa-card-head">
					<span class="aa-card-title">Pending Applications</span>
					<span class="aa-sel-count" id="aa-sel-info"></span>
				</div>
				<table id="aa-dt" style="width:100%">
					<thead>
						<tr>
							<th><input type="checkbox" id="aa-select-all" style="width:14px;height:14px;cursor:pointer;" /></th>
							<th>ID</th>
							<th>Name</th>
							<th>Email</th>
							<th>Mobile</th>
							<th>Status</th>
							<th>Submitted On</th>
							<th>Actions</th>
						</tr>
					</thead>
					<tbody id="aa-tbody"></tbody>
				</table>
			</div>

		</div>
	`);

	// ── Helpers ────────────────────────────────────────────────────────────────
	function badge(s) {
		const m = { Submitted: "sub", "Under Process": "und", Approved: "app", "Pending with Clarification": "pwc" };
		return `<span class="aa-badge ${m[s] || ""}">${s || "—"}</span>`;
	}

	function fmt_date(dt) {
		if (!dt) return "—";
		return new Date(dt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
	}

	function get_selected() {
		return [...document.querySelectorAll(".aa-row-check:checked")].map(c => c.dataset.id);
	}

	function sync_bulk_buttons() {
		const n = get_selected().length;
		["aa-bulk-process", "aa-bulk-approve", "aa-bulk-clarify"].forEach(id => {
			document.getElementById(id).disabled = n === 0;
		});
		const el = document.getElementById("aa-sel-info");
		el.innerHTML = n > 0 ? `<b>${n}</b> selected` : "";
	}

	// ── Render ─────────────────────────────────────────────────────────────────
	function render(rows) {
		document.getElementById("stat-all").textContent = rows.length;
		document.getElementById("stat-sub").textContent = rows.filter(r => r.status === "Submitted").length;
		document.getElementById("stat-und").textContent = rows.filter(r => r.status === "Under Process").length;
		document.getElementById("stat-pwc").textContent = rows.filter(r => r.status === "Pending with Clarification").length;

		if (_dt) { try { _dt.destroy(); } catch (_) {} _dt = null; }

		document.getElementById("aa-tbody").innerHTML = rows.map(r => `
			<tr>
				<td><input type="checkbox" class="aa-row-check" data-id="${r.name}" style="width:14px;height:14px;cursor:pointer;" /></td>
				<td><a class="aa-id-link" onclick="frappe.set_route('Form','Aggregator','${r.name}')">${r.name}</a></td>
				<td style="font-weight:600;color:#0f172a;">${frappe.utils.escape_html(r.aggregator_name || "—")}</td>
				<td class="aa-muted">${frappe.utils.escape_html(r.email || "—")}</td>
				<td class="aa-muted">${frappe.utils.escape_html(r.mobile || "—")}</td>
				<td>${badge(r.status)}</td>
				<td class="aa-muted">${fmt_date(r.creation)}</td>
				<td>
					<div class="aa-ra">
						${r.status === "Submitted" ? `<button class="aa-ra-btn p" data-id="${r.name}" data-action="Under Process">Under Process</button>` : ""}
						<button class="aa-ra-btn a" data-id="${r.name}" data-action="Approved">Approve</button>
						${r.status !== "Pending with Clarification" ? `<button class="aa-ra-btn c" data-id="${r.name}" data-action="Pending with Clarification">Pending Clarification</button>` : ""}
						${r.clarification_response ? `<span title="${frappe.utils.escape_html(r.clarification_response)}" style="cursor:help;color:#b45309;font-size:11px;font-weight:600;">&#9432; Response received</span>` : ""}
					</div>
				</td>
			</tr>
		`).join("");

		if ($.fn.DataTable) {
			_dt = $("#aa-dt").DataTable({
				pageLength: 15,
				lengthMenu: [10, 15, 25, 50],
				order: [[6, "asc"]],
				columnDefs: [{ orderable: false, targets: [0, 7] }, { searchable: false, targets: [0, 7] }],
				language: {
					search: "", searchPlaceholder: "Quick filter…",
					lengthMenu: "Show _MENU_",
					info: "Showing _START_–_END_ of _TOTAL_",
					emptyTable: "No pending applications",
					paginate: { previous: "← Prev", next: "Next →" },
				},
				dom: '<"dt-top"lf>rt<"dt-bottom"ip>',
			});
		}

		// Checkboxes
		document.getElementById("aa-tbody").querySelectorAll(".aa-row-check").forEach(cb => {
			cb.addEventListener("change", () => {
				sync_bulk_buttons();
				const all = document.getElementById("aa-select-all");
				const total   = document.querySelectorAll(".aa-row-check").length;
				const checked = document.querySelectorAll(".aa-row-check:checked").length;
				all.indeterminate = checked > 0 && checked < total;
				all.checked = checked === total && total > 0;
			});
		});

		// Row action buttons
		document.getElementById("aa-tbody").querySelectorAll(".aa-ra-btn[data-action]").forEach(btn => {
			btn.addEventListener("click", function () {
				do_single(this.dataset.id, this.dataset.action, this);
			});
		});

		sync_bulk_buttons();
	}

	// ── API ────────────────────────────────────────────────────────────────────
	function load_data() {
		if (_dt) { try { _dt.destroy(); } catch (_) {} _dt = null; }
		document.getElementById("aa-tbody").innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:#94a3b8;font-size:13px;">Loading…</td></tr>`;
		frappe.call({
			method: "gigworkers.gig_workers.page.aggregator_approval.aggregator_approval.get_pending_aggregators",
			callback(r) {
				_rows = r.message || [];
				render(_rows);
			},
		});
	}

	function do_single(id, new_status, btn) {
		if (new_status === "Pending with Clarification") {
			show_clarification_dialog(function(comments) {
				btn.disabled = true;
				frappe.call({
					method: "gigworkers.gig_workers.page.aggregator_approval.aggregator_approval.update_aggregator_status",
					args: { aggregator_id: id, new_status, clarification_comments: comments },
					callback() {
						frappe.show_alert({ message: `${id} → Pending with Clarification`, indicator: "orange" });
						load_data();
					},
					error() { btn.disabled = false; },
				});
			});
			return;
		}
		btn.disabled = true;
		frappe.call({
			method: "gigworkers.gig_workers.page.aggregator_approval.aggregator_approval.update_aggregator_status",
			args: { aggregator_id: id, new_status },
			callback() {
				frappe.show_alert({ message: `${id} → ${new_status}`, indicator: "green" });
				load_data();
			},
			error() { btn.disabled = false; },
		});
	}

	function show_clarification_dialog(on_confirm) {
		const d = new frappe.ui.Dialog({
			title: "Pending with Clarification",
			fields: [
				{
					fieldname: "clarification_comments",
					fieldtype: "Small Text",
					label: "Clarification Comments",
					reqd: 1,
					description: "Describe what information or documents the applicant needs to provide.",
				},
			],
			primary_action_label: "Send to Applicant",
			primary_action(values) {
				if (!values.clarification_comments || !values.clarification_comments.trim()) {
					frappe.msgprint("Clarification comments are required.");
					return;
				}
				d.hide();
				on_confirm(values.clarification_comments.trim());
			},
		});
		d.show();
	}

	function do_bulk(new_status) {
		const ids = get_selected();
		if (!ids.length) return;
		if (new_status === "Pending with Clarification") {
			show_clarification_dialog(function(comments) {
				frappe.call({
					method: "gigworkers.gig_workers.page.aggregator_approval.aggregator_approval.bulk_update_status",
					args: { aggregator_ids: JSON.stringify(ids), new_status, clarification_comments: comments },
					callback(r) {
						const res = r.message || {};
						frappe.show_alert({
							message: `${res.updated || 0} updated` + (res.errors?.length ? `, ${res.errors.length} failed` : ""),
							indicator: res.errors?.length ? "orange" : "green",
						});
						load_data();
					},
				});
			});
			return;
		}
		frappe.confirm(
			`Set <b>${ids.length}</b> application(s) to <b>${new_status}</b>?`,
			() => frappe.call({
				method: "gigworkers.gig_workers.page.aggregator_approval.aggregator_approval.bulk_update_status",
				args: { aggregator_ids: JSON.stringify(ids), new_status },
				callback(r) {
					const res = r.message || {};
					frappe.show_alert({
						message: `${res.updated || 0} updated` + (res.errors?.length ? `, ${res.errors.length} failed` : ""),
						indicator: res.errors?.length ? "orange" : "green",
					});
					load_data();
				},
			})
		);
	}

	// ── Events ────────────────────────────────────────────────────────────────
	document.querySelectorAll(".aa-stat").forEach(card => {
		card.addEventListener("click", function () {
			document.querySelectorAll(".aa-stat").forEach(c => c.classList.remove("active"));
			this.classList.add("active");
			const f = this.dataset.filter;
			render(f === "All" ? _rows : _rows.filter(r => r.status === f));
		});
	});

	document.getElementById("aa-search").addEventListener("input", function () {
		if (_dt) _dt.search(this.value).draw();
	});

	document.getElementById("aa-select-all").addEventListener("change", function () {
		document.querySelectorAll(".aa-row-check").forEach(cb => (cb.checked = this.checked));
		sync_bulk_buttons();
	});

	document.getElementById("aa-refresh").addEventListener("click", load_data);
	document.getElementById("aa-bulk-process").addEventListener("click", () => do_bulk("Under Process"));
	document.getElementById("aa-bulk-approve").addEventListener("click", () => do_bulk("Approved"));
	document.getElementById("aa-bulk-clarify").addEventListener("click", () => do_bulk("Pending with Clarification"));

	// ── Init ──────────────────────────────────────────────────────────────────
	function load_datatables(cb) {
		if ($.fn.DataTable) { cb(); return; }
		$("<link>").attr({ rel: "stylesheet", href: "https://cdn.datatables.net/1.13.7/css/jquery.dataTables.min.css" }).appendTo("head");
		$.getScript("https://cdn.datatables.net/1.13.7/js/jquery.dataTables.min.js", cb);
	}

	load_datatables(load_data);
};
