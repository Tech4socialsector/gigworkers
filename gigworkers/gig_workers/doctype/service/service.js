// Copyright (c) 2026, Jenifar and contributors
// For license information, please see license.txt

frappe.ui.form.on("Service Rate Log", {
	effective_start_date(_frm, cdt, cdn) { recompute_log_status(cdt, cdn); },
	effective_end_date(_frm, cdt, cdn)   { recompute_log_status(cdt, cdn); },
});

function recompute_log_status(cdt, cdn) {
	const row   = locals[cdt][cdn];
	const today = frappe.datetime.get_today();
	const s     = row.effective_start_date;
	const e     = row.effective_end_date;

	let status;
	if (e && e < today)       status = "Expired";
	else if (s && s > today)  status = "Scheduled";
	else                      status = "Active";

	frappe.model.set_value(cdt, cdn, "status", status);
}

frappe.ui.form.on("Service", {
	refresh(frm) {
		show_status_banner(frm);
		color_rate_log_rows(frm);

		// Hide the Add Row / Delete Row buttons on the log grid
		frm.fields_dict.rate_log && frm.fields_dict.rate_log.grid.wrapper
			.find(".grid-add-row, .grid-remove-rows").hide();

		if (!frm.is_new()) {
			frm.add_custom_button(__("Update Rate"), function () {
				open_update_rate_dialog(frm);
			}).addClass("btn-primary");
		}
	},

	effective_end_date(frm) {
		show_status_banner(frm);
	},
});

// ── Status banner ──────────────────────────────────────────────────────────────

function show_status_banner(frm) {
	frm.dashboard.clear_headline();
	if (frm.is_new()) return;

	const today = frappe.datetime.get_today();
	const start = frm.doc.effective_start_date;
	const end   = frm.doc.effective_end_date;

	if (end && end < today) {
		frm.dashboard.set_headline(
			`<span style="color:#c0392b;font-weight:600;">
				<i class="fa fa-times-circle"></i> Expired — ended on ${end}
			</span>`
		);
	} else if (start && start > today) {
		frm.dashboard.set_headline(
			`<span style="color:#f39c12;font-weight:600;">
				<i class="fa fa-clock-o"></i> Scheduled — starts on ${start}
			</span>`
		);
	} else {
		frm.dashboard.set_headline(
			`<span style="color:#27ae60;font-weight:600;">
				<i class="fa fa-check-circle"></i> Active
				${end ? " — ends on " + end : ""}
			</span>`
		);
	}
}

// ── Color-code Rate Log rows ───────────────────────────────────────────────────

const RATE_LOG_LIMIT = 5;

function color_rate_log_rows(frm) {
	const colors = {
		"Active":    { bg: "#eafaf1", text: "#1e8449" },
		"Scheduled": { bg: "#fef9e7", text: "#b7770d" },
		"Expired":   { bg: "#fdedec", text: "#c0392b" },
	};

	const all_rows = frm.doc.rate_log || [];
	const grid     = frm.fields_dict.rate_log && frm.fields_dict.rate_log.grid;
	if (!grid) return;

	setTimeout(function () {
		// Remove stale footer from previous render
		grid.wrapper.find(".rate-log-footer").remove();

		all_rows.forEach(function (row, idx) {
			const $row = grid.grid_rows_by_docname[row.name];
			if (!$row || !$row.row) return;

			// Color coding
			const c = colors[row.status];
			if (c) {
				$row.row.css({ "background-color": c.bg });
				$row.row.find("[data-fieldname='status']").css({ "color": c.text, "font-weight": "600" });
			}

			// Lock expired rows
			if (row.status === "Expired") {
				$row.row.find(".btn-open-row").hide();
			}

			// Show only the latest RATE_LOG_LIMIT rows; hide older ones
			if (all_rows.length > RATE_LOG_LIMIT && idx < all_rows.length - RATE_LOG_LIMIT) {
				$row.row.hide();
			}
		});

		// Footer: hidden count + "View All" link
		if (all_rows.length > RATE_LOG_LIMIT) {
			const hidden = all_rows.length - RATE_LOG_LIMIT;
			grid.wrapper.find(".grid-body").append(`
				<div class="rate-log-footer" style="text-align:center;padding:8px 0 4px;">
					<span style="color:#888;font-size:12px;">
						Showing latest ${RATE_LOG_LIMIT} of ${all_rows.length} records
						(${hidden} older records hidden)
						&nbsp;|&nbsp;
						<a class="btn-view-all-history" href="#"
							style="color:#4e73df;font-weight:600;font-size:12px;">
							<i class="fa fa-history"></i> View All History
						</a>
					</span>
				</div>`);

			grid.wrapper.find(".btn-view-all-history").on("click", function (e) {
				e.preventDefault();
				frappe.set_route("query-report", "Service Rate History", { service: frm.doc.name });
			});
		}
	}, 300);
}

// ── Update Rate dialog ────────────────────────────────────────────────────────

function open_update_rate_dialog(frm) {
	const d = new frappe.ui.Dialog({
		title: __("Update Rate for {0} — {1}", [frm.doc.category, frm.doc.vehicle_type]),
		fields: [
			{
				fieldtype: "Section Break",
				label: __("Current Rate (will be saved to history)"),
			},
			{
				fieldtype: "HTML",
				options: `
					<div style="background:#f8f9fa;border-radius:6px;padding:10px 14px;margin-bottom:8px;font-size:13px;color:#555;">
						<b>Welfare %:</b> ${frm.doc.welfare_percentage_} &nbsp;&nbsp;
						<b>Welfare Cap:</b> ₹${frm.doc.welfare_cap} &nbsp;&nbsp;
						<b>Period:</b> ${frm.doc.effective_start_date} → ${frm.doc.effective_end_date || "No end date"}
					</div>`,
			},
			{
				fieldtype: "Section Break",
				label: __("New Rate Details"),
			},
			{
				fieldname: "new_welfare_percentage",
				fieldtype: "Float",
				label:     __("New Welfare Percentage (%)"),
				reqd:      1,
				default:   frm.doc.welfare_percentage_,
				description: "e.g. 1.0 = 1%",
			},
			{
				fieldname: "new_welfare_cap",
				fieldtype: "Currency",
				label:     __("New Welfare Cap"),
				reqd:      1,
				default:   frm.doc.welfare_cap,
			},
			{ fieldtype: "Column Break" },
			{
				fieldname: "new_start_date",
				fieldtype: "Date",
				label:     __("New Effective Start Date"),
				reqd:      1,
				description: "Must be after the Close Current Rate On date",
			},
			{
				fieldname: "new_end_date",
				fieldtype: "Date",
				label:     __("New Effective End Date"),
				description: "Leave blank if no end date",
			},
			{
				fieldtype: "Section Break",
			},
			{
				fieldname: "close_current_on",
				fieldtype: "Date",
				label:     __("Close Current Rate On"),
				reqd:      1,
				default:   frm.doc.effective_end_date || "",
				description: "Current rate will end on this date (cannot be before " + frm.doc.effective_start_date + ")",
			},
		],
		primary_action_label: __("Save & Update"),
		primary_action(values) {
			if (values.close_current_on < frm.doc.effective_start_date) {
				frappe.msgprint(__("Close Current Rate On cannot be before the current Start Date ({0}).", [frm.doc.effective_start_date]));
				return;
			}
			if (values.new_start_date <= values.close_current_on) {
				frappe.msgprint(__("New Start Date must be after the Close Current Rate On date ({0}).", [values.close_current_on]));
				return;
			}
			if (values.new_end_date && values.new_end_date <= values.new_start_date) {
				frappe.msgprint(__("New End Date must be after the New Start Date."));
				return;
			}

			frappe.call({
				method: "gigworkers.gig_workers.doctype.service.service.update_rate",
				args: {
					docname:              frm.doc.name,
					close_current_on:     values.close_current_on,
					new_welfare_percentage: values.new_welfare_percentage,
					new_welfare_cap:      values.new_welfare_cap,
					new_start_date:       values.new_start_date,
					new_end_date:         values.new_end_date || "",
				},
				freeze: true,
				freeze_message: __("Updating rate..."),
				callback(r) {
					if (!r.exc) {
						d.hide();
						frappe.show_alert({ message: __("Rate updated and logged successfully."), indicator: "green" }, 5);
						frm.reload_doc();
					}
				},
			});
		},
	});

	d.show();
}
