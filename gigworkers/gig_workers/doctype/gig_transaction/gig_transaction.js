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

								if (!r.exc) {

									frappe.show_alert({
										message: __("OTP verified. Transaction completed."),
										indicator: "green",
									}, 5);

									frm.reload_doc();
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