// Copyright (c) 2026, Jenifar and contributors
// For license information, please see license.txt

frappe.ui.form.on("Board Member", {
	refresh(frm) {
		if (frm.doc.phone) {
			frm.fields_dict["phone"].$input.on("input", function () {
				let val = $(this).val().replace(/\D/g, "").substring(0, 10);
				$(this).val(val);
				frm.set_value("phone", val);
			});
		}
	},

	phone(frm) {
		if (frm.doc.phone) {
			const cleaned = frm.doc.phone.replace(/\D/g, "").substring(0, 10);
			if (frm.doc.phone !== cleaned) {
				frm.set_value("phone", cleaned);
			}
		}
	},
});
