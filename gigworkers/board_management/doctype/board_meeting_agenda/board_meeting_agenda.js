// Copyright (c) 2026, Jenifar and contributors
// For license information, please see license.txt

frappe.ui.form.on("Board Meeting Agenda", {
	refresh(frm) {
		if (!frm.is_new() && frm.doc.status === "Confirmed") {
			frm.add_custom_button(__("Create Meeting Minutes"), function () {
				frappe.model.open_mapped_doc({
					method: "gigworkers.board_management.doctype.board_meeting_agenda.board_meeting_agenda.make_meeting_minutes",
					frm: frm,
				});
			}, __("Actions"));
		}
	},
});
