// Copyright (c) 2026, Jenifar and contributors
// For license information, please see license.txt

frappe.ui.form.on("Board Meeting Minutes", {
	refresh(frm) {
		// Show/hide approval fields based on status
		frm.set_df_property("approved_by", "hidden", frm.doc.status !== "Approved" ? 1 : 0);
		frm.set_df_property("approved_date", "hidden", frm.doc.status !== "Approved" ? 1 : 0);

		// Auto-populate attendees from active board members if new and attendees table is empty
		if (frm.is_new() && (!frm.doc.attendees || frm.doc.attendees.length === 0)) {
			frappe.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Board Member",
					filters: { status: "Active" },
					fields: ["name", "member_name", "designation"],
					limit_page_length: 100,
				},
				callback(r) {
					if (r.message && r.message.length) {
						r.message.forEach(function (member) {
							let row = frappe.model.add_child(frm.doc, "Meeting Attendee", "attendees");
							row.board_member = member.name;
							row.member_name = member.member_name;
							row.designation = member.designation;
							row.attended = 1;
						});
						frm.refresh_field("attendees");
					}
				},
			});
		}
	},

	status(frm) {
		frm.set_df_property("approved_by", "hidden", frm.doc.status !== "Approved" ? 1 : 0);
		frm.set_df_property("approved_date", "hidden", frm.doc.status !== "Approved" ? 1 : 0);
	},

	meeting_agenda(frm) {
		if (frm.doc.meeting_agenda && frm.is_new()) {
			frappe.db.get_doc("Board Meeting Agenda", frm.doc.meeting_agenda).then(agenda => {
				frm.set_value("title", agenda.title);
				frm.set_value("meeting_date", agenda.meeting_date);
				frm.set_value("venue", agenda.venue);

				// Clear and repopulate minutes items from agenda
				frm.clear_table("minutes_items");
				(agenda.agenda_items || []).forEach(item => {
					let row = frappe.model.add_child(frm.doc, "Minutes Item", "minutes_items");
					row.agenda_item = item.agenda_item;
				});
				frm.refresh_field("minutes_items");
			});
		}
	},
});
