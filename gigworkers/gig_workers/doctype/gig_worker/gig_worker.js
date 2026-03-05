// Copyright (c) 2026, Jenifar and contributors
// For license information, please see license.txt

frappe.ui.form.on("Gig Worker", {
    validate: function (frm) {
        if (frm.doc.pan_number) {
            let pan_regex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
            if (!pan_regex.test(frm.doc.pan_number)) {
                frappe.msgprint(__('Invalid PAN Format. A valid PAN should be 5 letters, 4 numbers, and 1 letter (e.g., ABCDE1234F).'));
                frappe.validated = false;
            }
        }

        if (frm.doc.aadhaar_number) {
            let aadhaar_regex = /^\d{12}$/;
            if (!aadhaar_regex.test(frm.doc.aadhaar_number)) {
                frappe.msgprint(__('Invalid Aadhaar Format. A valid Aadhaar should be exactly 12 digits.'));
                frappe.validated = false;
            }
        }

        if (frm.doc.email) {
            let mobile_regex = /^\d{10}$/;
            if (!mobile_regex.test(frm.doc.email)) {
                frappe.msgprint(__('Invalid Mobile Format. A valid Mobile number should be exactly 10 digits.'));
                frappe.validated = false;
            }
        }
    },
    refresh: function (frm) {
        frm.fields_dict['aadhaar_number'].$input.on('keypress', function (e) {
            // Only allow numbers (0-9)
            if (e.which < 48 || e.which > 57) {
                e.preventDefault();
            }
        });
        frm.fields_dict['email'].$input.on('keypress', function (e) {
            // Only allow numbers (0-9)
            if (e.which < 48 || e.which > 57) {
                e.preventDefault();
            }
        });
        frm.fields_dict['aadhaar_number'].$input.on('input', function (e) {
            // Further restrict to 12 digits max
            let val = $(this).val();
            if (val.length > 12) {
                $(this).val(val.substring(0, 12));
                frm.set_value('aadhaar_number', val.substring(0, 12));
            }
        });
        frm.fields_dict['email'].$input.on('input', function (e) {
            // Further restrict to 10 digits max
            let val = $(this).val();
            if (val.length > 10) {
                $(this).val(val.substring(0, 10));
                frm.set_value('email', val.substring(0, 10));
            }
        });
    },
    aadhaar_number: function (frm) {
        if (frm.doc.aadhaar_number) {
            let numericVal = frm.doc.aadhaar_number.replace(/\D/g, '').substring(0, 12);
            if (frm.doc.aadhaar_number !== numericVal) {
                frm.set_value('aadhaar_number', numericVal);
            }
        }
    },
    email: function (frm) {
        if (frm.doc.email) {
            let numericVal = frm.doc.email.replace(/\D/g, '').substring(0, 10);
            if (frm.doc.email !== numericVal) {
                frm.set_value('email', numericVal);
            }
        }
    },
    pan_number: function (frm) {
        if (frm.doc.pan_number) {
            frm.set_value('pan_number', frm.doc.pan_number.toUpperCase());
        }
    }
});
