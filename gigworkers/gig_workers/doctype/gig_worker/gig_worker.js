// Copyright (c) 2026, Jenifar and contributors
// For license information, please see license.txt

// ============================================================
//  gigworkers — Gig Worker Form Script
// ============================================================

frappe.ui.form.on("Gig Worker", {

	// ----------------------------------------------------------
	//  gigworkers script — Form Validate: format checks on submit
	// ----------------------------------------------------------

	validate(frm) {
		// ---- PAN Number ----
		if (frm.doc.pan_number) {
			const pan_regex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
			if (!pan_regex.test(frm.doc.pan_number)) {
				frappe.msgprint(__("❌ Invalid PAN Format. Must be 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F)."));
				frappe.validated = false;
			}
		}

		// ---- Aadhaar Number ----
		if (frm.doc.aadhaar_number) {
			const aadhaar_regex = /^\d{12}$/;
			if (!aadhaar_regex.test(frm.doc.aadhaar_number)) {
				frappe.msgprint(__("❌ Invalid Aadhaar Format. Must be exactly 12 digits."));
				frappe.validated = false;
			}
		}

		// ---- Email field — validate proper email format ----
		if (frm.doc.email) {
			const email_regex = /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/;
			if (!email_regex.test(frm.doc.email.trim())) {
				frappe.msgprint(__("❌ Invalid Email. Please enter a valid email address (e.g. worker@example.com)."));
				frappe.validated = false;
			}
		}

		// ---- Phone field — validate 10-digit Indian mobile ----
		if (frm.doc.phone) {
			const phone_regex = /^[6-9]\d{9}$/;
			if (!phone_regex.test(frm.doc.phone.trim())) {
				frappe.msgprint(__("❌ Invalid Phone Number. Must be a 10-digit Indian mobile number starting with 6, 7, 8, or 9."));
				frappe.validated = false;
			}
		}
	},

	// ----------------------------------------------------------
	//  gigworkers script — Refresh: attach live input guards
	// ----------------------------------------------------------

	refresh(frm) {
		// -- Aadhaar: digits only, max 12 --
		frm.fields_dict["aadhaar_number"].$input.on("keypress", function (e) {
			if (e.which < 48 || e.which > 57) e.preventDefault();
		});
		frm.fields_dict["aadhaar_number"].$input.on("input", function () {
			let val = $(this).val().replace(/\D/g, "").substring(0, 12);
			$(this).val(val);
			frm.set_value("aadhaar_number", val);
		});

		// -- Phone: digits only, max 10 --
		frm.fields_dict["phone"].$input.on("keypress", function (e) {
			if (e.which < 48 || e.which > 57) e.preventDefault();
		});
		frm.fields_dict["phone"].$input.on("input", function () {
			let val = $(this).val().replace(/\D/g, "").substring(0, 10);
			$(this).val(val);
			frm.set_value("phone", val);
		});
	},

	// ----------------------------------------------------------
	//  gigworkers script — Field change handlers
	// ----------------------------------------------------------

	// Aadhaar: strip non-digits on change
	aadhaar_number(frm) {
		if (frm.doc.aadhaar_number) {
			const cleaned = frm.doc.aadhaar_number.replace(/\D/g, "").substring(0, 12);
			if (frm.doc.aadhaar_number !== cleaned) {
				frm.set_value("aadhaar_number", cleaned);
			}
		}
	},

	// Phone: strip non-digits on change
	phone(frm) {
		if (frm.doc.phone) {
			const cleaned = frm.doc.phone.replace(/\D/g, "").substring(0, 10);
			if (frm.doc.phone !== cleaned) {
				frm.set_value("phone", cleaned);
			}
		}
	},

	// PAN: auto-uppercase
	pan_number(frm) {
		if (frm.doc.pan_number) {
			frm.set_value("pan_number", frm.doc.pan_number.toUpperCase());
		}
	},
});
