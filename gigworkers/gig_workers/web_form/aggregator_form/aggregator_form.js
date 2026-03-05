// -------------------------------
// PAN Validation
// ------------------------------------
frappe.ready(function () {
	frappe.web_form.validate = () => {
		let pan = frappe.web_form.get_value('pan');
		if (pan) {
			let pan_regex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
			if (!pan_regex.test(pan.toUpperCase())) {
				frappe.msgprint(__('Invalid PAN Format. A valid PAN should be 5 letters, 4 numbers, and 1 letter (e.g., ABCDE1234F).'));
				return false;
			}
			// Also force uppercase in the form before submission
			frappe.web_form.set_value('pan', pan.toUpperCase());
		}
		return true;
	};

	// bind events here
	frappe.web_form.on('pan', (field, value) => {
		if (value) {
			frappe.web_form.set_value('pan', value.toUpperCase());
		}
	});
});