// Copyright (c) 2026, Jenifar and contributors
// For license information, please see license.txt

frappe.ui.form.on("Service", {
	refresh(frm) {
		show_status_banner(frm);
		color_rate_log_rows(frm);
	},

	effective_end_date(frm) {
		show_status_banner(frm);
	},
});

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

function color_rate_log_rows(frm) {
	const colors = {
		"Active":    { bg: "#eafaf1", text: "#1e8449" },
		"Scheduled": { bg: "#fef9e7", text: "#b7770d" },
		"Expired":   { bg: "#fdedec", text: "#c0392b" },
	};

	setTimeout(function () {
		(frm.doc.rate_log || []).forEach(function (row) {
			const c = colors[row.status];
			if (!c) return;
			const $row = frm.fields_dict.rate_log.grid.grid_rows_by_docname[row.name];
			if ($row && $row.row) {
				$row.row.css({ "background-color": c.bg });
				$row.row.find("[data-fieldname='status']").css({ "color": c.text, "font-weight": "600" });
			}
		});
	}, 300);
}

function create_next_version(frm) {
	if (!frm.doc.effective_end_date) {
		frappe.msgprint(__("Please set an Effective End Date before creating the next version."));
		return;
	}

	frappe.confirm(
		__("This will create a new Service record starting from {0}. Continue?",
			[frappe.datetime.add_days(frm.doc.effective_end_date, 1)]),
		function () {
			frappe.call({
				method: "gigworkers.gig_workers.doctype.service.service.create_next_version",
				args: { docname: frm.doc.name },
				freeze: true,
				freeze_message: __("Creating next version..."),
				callback(r) {
					if (r.message) {
						frappe.show_alert({
							message: __("New version created: {0}", [r.message]),
							indicator: "green"
						}, 5);
						frappe.set_route("Form", "Service", r.message);
					}
				}
			});
		}
	);
}
