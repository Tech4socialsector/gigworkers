frappe.ui.form.on("Grievance", {
	refresh(frm) {
		// Only Admin and Aggregator can change status and add replies via this form
		const roles = frappe.user_roles;
		const is_worker = roles.includes("Gig Worker") && !roles.includes("System Manager");

		if (is_worker) {
			frm.set_df_property("status", "read_only", 1);
			frm.set_df_property("replies", "read_only", 1);
		}

		// Show reply button for Admin and Aggregator on saved docs
		if (!frm.is_new() && !is_worker) {
			frm.add_custom_button("Add Reply", function () {
				frappe.prompt(
					[{ fieldname: "reply_text", fieldtype: "Long Text", label: "Your Reply", reqd: 1 }],
					function (values) {
						frappe.call({
							method: "gigworkers.gig_workers.page.grievance_portal.grievance_portal.add_reply",
							args: { grievance_name: frm.doc.name, reply_text: values.reply_text },
							callback(r) {
								if (!r.exc) {
									frappe.show_alert({ message: "Reply added successfully.", indicator: "green" });
									frm.reload_doc();
								}
							},
						});
					},
					"Add Reply to Grievance",
					"Submit Reply"
				);
			}, "Actions");
		}
	},
});
