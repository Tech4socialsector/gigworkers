// Copyright (c) 2026, Jenifar and contributors
// For license information, please see license.txt

frappe.ui.form.on("Aggregator", {
    refresh(frm) {
        // Mask aadhaar display — show only last 4 digits
        if (frm.doc.aadhaar_number) {
            frm.set_df_property("aadhaar_number", "read_only", 1);
            frm.fields_dict["aadhaar_number"].$wrapper
                .find(".control-value")
                .text("XXXX-XXXX-" + frm.doc.aadhaar_number.slice(-4));
        }
    },

    validate: function (frm) {
        if (frm.doc.pan) {
            let pan_regex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
            if (!pan_regex.test(frm.doc.pan)) {
                frappe.msgprint(__('Invalid PAN Format. A valid PAN should be 5 letters, 4 numbers, and 1 letter (e.g., ABCDE1234F).'));
                frappe.validated = false;
            }
        }
    },
    pan: function (frm) {
        if (frm.doc.pan) {
            frm.set_value('pan', frm.doc.pan.toUpperCase());
        }
    }
});
