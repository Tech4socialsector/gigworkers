// Copyright (c) 2026, Jenifar and contributors
// For license information, please see license.txt

frappe.ui.form.on("Gig Transaction", {

	// ----------------------------------------------------------
	// FORM REFRESH
	// ----------------------------------------------------------

	refresh(frm) {

		frm.clear_custom_buttons();

		if (frm.is_new()) return;

		const trustLevel = frm.doc.trust_level;
		const status = frm.doc.status;


		// ----------------------------------------------------------
		// HIGH TRUST FLOW
		// ----------------------------------------------------------

		if (trustLevel === "High" && status !== "Completed") {

			frm.add_custom_button(__("Auto Confirm"), function () {

				frappe.confirm(
					"This transaction has <b>High Trust Level</b>.<br>" +
					"It will be auto-confirmed immediately. Proceed?",

					function () {

						frm.save().then(() => {

							frappe.show_alert({
								message: __("Transaction auto-confirmed successfully!"),
								indicator: "green",
							}, 5);

							frm.reload_doc();
						});

					}
				);

			}, __("Trust Level Actions")).addClass("btn-success");

		}


		// ----------------------------------------------------------
		// LOW TRUST FLOW
		// ----------------------------------------------------------

		// ----------------------------------------------------------
		// DUPLICATE REVIEW ACTIONS (System Manager only)
		// ----------------------------------------------------------

		const isAdmin = frappe.user.has_role("System Manager");

		if (isAdmin && status === "Suspected Duplicate") {

			frm.add_custom_button(__("Mark as Duplicate"), function () {
				frappe.prompt(
					[{
						label: "Duplicate Of (Transaction ID)",
						fieldname: "duplicate_of",
						fieldtype: "Link",
						options: "Gig Transaction",
						default: frm.doc.duplicate_of || "",
						description: "Select the original transaction this is a duplicate of"
					}],
					function (values) {
						frappe.call({
							method: "gigworkers.gig_workers.doctype.gig_transaction.gig_transaction.mark_as_duplicate",
							args: {
								transaction_name: frm.doc.name,
								duplicate_of: values.duplicate_of || ""
							},
							freeze: true,
							freeze_message: __("Marking as Duplicate..."),
							callback(r) {
								if (!r.exc) {
									frappe.show_alert({ message: __(r.message.message), indicator: "red" }, 5);
									frm.reload_doc();
								}
							}
						});
					},
					__("Confirm Duplicate"),
					__("Mark as Duplicate")
				);
			}, __("Duplicate Actions")).addClass("btn-danger");

			frm.add_custom_button(__("Dismiss (Not a Duplicate)"), function () {
				frappe.confirm(
					"Clear the suspected duplicate flag? This transaction will be restored to its previous status.",
					function () {
						frappe.call({
							method: "gigworkers.gig_workers.doctype.gig_transaction.gig_transaction.dismiss_suspected_duplicate",
							args: { transaction_name: frm.doc.name },
							freeze: true,
							freeze_message: __("Clearing flag..."),
							callback(r) {
								if (!r.exc) {
									frappe.show_alert({ message: __(r.message.message), indicator: "green" }, 5);
									frm.reload_doc();
								}
							}
						});
					}
				);
			}, __("Duplicate Actions")).addClass("btn-warning");

		}

		if (trustLevel === "Low" && status !== "Completed") {

			// -----------------------------
			// CONFIRM TRANSACTION (SEND OTP)
			// -----------------------------

			frm.add_custom_button(__("Confirm Transaction"), function () {

				frappe.confirm(

					`<b>Confirm this transaction?</b><br><br>
					This will:<br>
					📧 Send OTP to worker email<br>
					📋 Record OTP in OTP table`,

					function () {

						frappe.call({

							method: "gigworkers.gig_workers.doctype.gig_transaction.gig_transaction.confirm_transaction",

							args: {
								transaction_name: frm.doc.name
							},

							freeze: true,
							freeze_message: __("Sending OTP..."),

							callback(r) {

								if (!r.exc && r.message) {

									const otp = r.message.otp_reference || "";

									frappe.show_alert({
										message: __("OTP sent successfully (Ref: " + otp + ")"),
										indicator: "green",
									}, 5);

									frm.reload_doc();
								}

							}

						});

					}

				);

			}, __("Trust Level Actions")).addClass("btn-primary");


			// -----------------------------
			// VERIFY OTP
			// -----------------------------

			frm.add_custom_button(__("Verify OTP"), function () {

				frappe.prompt(

					[
						{
							label: "Enter OTP",
							fieldname: "otp",
							fieldtype: "Data",
							reqd: 1
						}
					],

					function (values) {

						frappe.call({

							method: "gigworkers.gig_workers.doctype.gig_transaction.gig_transaction.verify_otp",

							args: {
								transaction_name: frm.doc.name,
								otp: values.otp
							},

							freeze: true,
							freeze_message: __("Verifying OTP..."),

							callback(r) {

								if (!r.exc && r.message) {

									if (r.message.success) {
										frappe.show_alert({
											message: __(r.message.message),
											indicator: "green",
										}, 5);

										frm.reload_doc();
									} else {
										frappe.msgprint({
											title: __('Verification Failed'),
											indicator: 'red',
											message: __(r.message.message)
										});
									}

								}

							}

						});

					},

					__("Verify OTP")

				);

			}, __("Trust Level Actions")).addClass("btn-success");

		}

	},


	// ----------------------------------------------------------
	// SERVICE CHANGE HANDLER
	// ----------------------------------------------------------

	service(frm) {
		if (!frm.doc.service) {
			frm.set_value("service_category", "");
			frm.set_value("service_type", "");
			frm.set_value("welfare_percentage", 0);
			frm.set_value("welfare_cap", 0);
			frm.set_value("welfare_amount", 0);
			return;
		}

		frappe.db.get_value("Service", frm.doc.service,
			["category", "vehicle_type", "welfare_percentage_", "welfare_cap"],
			function (r) {
				if (!r) return;

				// Resolve human-readable display names from the linked doctypes
				if (r.category) {
					frappe.db.get_value("Service Category", r.category, "category_name", function (cat) {
						frm.set_value("service_category", (cat && cat.category_name) || r.category);
					});
				}
				if (r.vehicle_type) {
					frappe.db.get_value("Vehicle Type", r.vehicle_type, "vehicle_type", function (vt) {
						frm.set_value("service_type", (vt && vt.vehicle_type) || r.vehicle_type);
					});
				}

				frm.set_value("welfare_percentage", r.welfare_percentage_ || 0);
				frm.set_value("welfare_cap", r.welfare_cap || 0);

				const base_payout = frm.doc.base_payout || 0;
				if (base_payout && r.welfare_percentage_) {
					const rate_amount = (base_payout * r.welfare_percentage_) / 100;
					const welfare_amount = r.welfare_cap
						? Math.min(rate_amount, r.welfare_cap)
						: rate_amount;
					frm.set_value("welfare_amount", welfare_amount);
				}
			}
		);
	},

	base_payout(frm) {
		if (!frm.doc.service || !frm.doc.welfare_percentage || !frm.doc.base_payout) return;
		const rate_amount = (frm.doc.base_payout * frm.doc.welfare_percentage) / 100;
		const welfare_amount = frm.doc.welfare_cap
			? Math.min(rate_amount, frm.doc.welfare_cap)
			: rate_amount;
		frm.set_value("welfare_amount", welfare_amount);
	},

	// ----------------------------------------------------------
	// TRUST LEVEL CHANGE HANDLER
	// ----------------------------------------------------------

	trust_level(frm) {

		frm.trigger("refresh");

		if (frm.doc.trust_level === "High") {

			frappe.show_alert({
				message: __("High Trust — transaction will auto-confirm on save."),
				indicator: "green",
			}, 5);

		}

		if (frm.doc.trust_level === "Low") {

			frappe.show_alert({
				message: __("Low Trust — OTP verification required."),
				indicator: "orange",
			}, 5);

		}

	}

});