// Copyright (c) 2026, Jenifar and contributors
// For license information, please see license.txt

frappe.listview_settings["Welfare Fee Payment"] = {

	refresh(listview) {

		// ----------------------------------------------------------
		// BULK UPDATE: PAYMENT STATUS
		// ----------------------------------------------------------

		listview.page.add_actions_menu_item(__("Update Payment Status"), function () {

			const selected = listview.get_checked_items();

			if (!selected.length) {
				frappe.msgprint(__("Please select at least one record."));
				return;
			}

			frappe.prompt(
				[
					{
						label: __("Payment Status"),
						fieldname: "payment_status",
						fieldtype: "Select",
						options: "\nPending\nCompleted\nFailed",
						reqd: 1
					}
				],
				function (values) {

					const promises = selected.map(row =>
						frappe.db.set_value("Welfare Fee Payment", row.name, "payment_status", values.payment_status)
					);

					Promise.all(promises).then(() => {
						frappe.show_alert({
							message: __("Payment Status updated for {0} record(s).", [selected.length]),
							indicator: "green"
						}, 5);
						listview.refresh();
					});

				},
				__("Update Payment Status"),
				__("Update")
			);

		});


		// ----------------------------------------------------------
		// BULK UPDATE: SETTLEMENT STATUS
		// ----------------------------------------------------------

		listview.page.add_actions_menu_item(__("Update Settlement Status"), function () {

			const selected = listview.get_checked_items();

			if (!selected.length) {
				frappe.msgprint(__("Please select at least one record."));
				return;
			}

			frappe.prompt(
				[
					{
						label: __("Settlement Status"),
						fieldname: "settlement_status",
						fieldtype: "Select",
						options: "\nInitiated\nSuccess\nFailed",
						reqd: 1
					}
				],
				function (values) {

					const promises = selected.map(row =>
						frappe.db.set_value("Welfare Fee Payment", row.name, "settlement_status", values.settlement_status)
					);

					Promise.all(promises).then(() => {
						frappe.show_alert({
							message: __("Settlement Status updated for {0} record(s).", [selected.length]),
							indicator: "green"
						}, 5);
						listview.refresh();
					});

				},
				__("Update Settlement Status"),
				__("Update")
			);

		});

	}

};
