frappe.listview_settings["Gig Worker Import Log"] = {
	onload: function (listview) {
		const is_admin =
			frappe.user_roles.includes("System Manager") ||
			frappe.session.user === "Administrator";

		if (!is_admin) return;

		listview.page.add_action_item(__("Delete"), function () {
			const selected = listview.get_checked_items();
			if (!selected.length) {
				frappe.msgprint(__("Please select at least one record to delete."));
				return;
			}

			frappe.confirm(
				__(
					"Are you sure you want to permanently delete {0} record(s)? This action cannot be undone.",
					[selected.length]
				),
				function () {
					const names = selected.map((d) => d.name);
					let deleted = 0;

					const delete_next = () => {
						if (deleted >= names.length) {
							listview.refresh();
							frappe.show_alert({
								message: __("{0} record(s) deleted.", [deleted]),
								indicator: "green",
							});
							return;
						}

						frappe
							.call({
								method: "frappe.client.delete",
								args: {
									doctype: "Gig Worker Import Log",
									name: names[deleted],
								},
							})
							.then(() => {
								deleted++;
								delete_next();
							})
							.fail(() => {
								deleted++;
								delete_next();
							});
					};

					delete_next();
				}
			);
		});
	},
};
