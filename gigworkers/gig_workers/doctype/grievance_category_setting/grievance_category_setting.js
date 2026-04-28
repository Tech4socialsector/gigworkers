frappe.ui.form.on("Grievance Category Setting", {
	refresh(frm) {
		frm.set_intro(
			"Configure which email address (Aggregator or Admin) receives grievance " +
			"notifications for each category. The <b>first matching rule</b> for a " +
			"category is used for email notification and auto-assignment. " +
			"Subsequent rules for the same category receive in-app notifications only.",
			"blue"
		);
	},
});
