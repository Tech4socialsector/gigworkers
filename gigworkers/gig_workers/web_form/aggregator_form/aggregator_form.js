frappe.ready(function () {
	frappe.web_form.validate = () => {
		// Email Validation
		let email = frappe.web_form.get_value('email');
		if (email) {
			let email_regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
			if (!email_regex.test(email)) {
				frappe.msgprint(__('Invalid Email Address. Please enter a valid email (e.g., example@domain.com).'));
				return false;
			}
		}

		// PAN Validation
		let pan = frappe.web_form.get_value('pan');
		if (pan) {
			let pan_regex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
			if (!pan_regex.test(pan.toUpperCase())) {
				frappe.msgprint(__('Invalid PAN Format. A valid PAN should be 5 letters, 4 numbers, and 1 letter (e.g., ABCDE1234F).'));
				return false;
			}
			frappe.web_form.set_value('pan', pan.toUpperCase());
		}

		// Mobile Validation — 10-digit Indian mobile number starting with 6-9
		let mobile = frappe.web_form.get_value('mobile');
		if (mobile) {
			let mobile_regex = /^[6-9][0-9]{9}$/;
			if (!mobile_regex.test(mobile)) {
				frappe.msgprint(__('Invalid Mobile Number. Please enter a valid 10-digit Indian mobile number (e.g., 9876543210).'));
				return false;
			}
		}

		// GSTIN Validation (if provided)
		let gstin = frappe.web_form.get_value('gstin');
		if (gstin) {
			let gstin_regex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
			if (!gstin_regex.test(gstin.toUpperCase())) {
				frappe.msgprint(__('Invalid GSTIN Format. A valid GSTIN should be 15 characters (e.g., 22ABCDE1234F1Z5).'));
				return false;
			}
			frappe.web_form.set_value('gstin', gstin.toUpperCase());
		}

		// Company ID Validation based on Company Type
		let company_type = frappe.web_form.get_value('company_type');
		let company_id = frappe.web_form.get_value('company_id');
		if (company_type && company_id) {
			if (company_type === 'CIN') {
				// CIN format: L12345AB2020PLC123456 (21 chars)
				let cin_regex = /^[LUu][0-9]{5}[A-Za-z]{2}[0-9]{4}[Pp][Ll][Cc][0-9]{6}$/;
				if (!cin_regex.test(company_id)) {
					frappe.msgprint(__('Invalid CIN Format. A valid CIN should be like: L12345AB2020PLC123456'));
					return false;
				}
			} else if (company_type === 'LLPIN') {
				// LLPIN format: AAA-1234
				let llpin_regex = /^[A-Z]{3}-[0-9]{4}$/;
				if (!llpin_regex.test(company_id.toUpperCase())) {
					frappe.msgprint(__('Invalid LLPIN Format. A valid LLPIN should be like: AAA-1234'));
					return false;
				}
			}
		}

		// Website URL Validation (if provided)
		let website_url = frappe.web_form.get_value('website_url');
		if (website_url) {
			let url_regex = /^(https?:\/\/)?([\w-]+\.)+[\w-]+(\/[\w\-./?%&=]*)?$/i;
			if (!url_regex.test(website_url)) {
				frappe.msgprint(__('Invalid Website URL. Please enter a valid URL (e.g., https://example.com).'));
				return false;
			}
		}

		// App URL Validation (if provided)
		let app_url = frappe.web_form.get_value('app_url');
		if (app_url) {
			let url_regex = /^(https?:\/\/)?([\w-]+\.)+[\w-]+(\/[\w\-./?%&=]*)?$/i;
			if (!url_regex.test(app_url)) {
				frappe.msgprint(__('Invalid App URL. Please enter a valid URL (e.g., https://play.google.com/store/apps/...).'));
				return false;
			}
		}

		return true;
	};

	// Auto-uppercase PAN on input
	frappe.web_form.on('pan', (_field, value) => {
		if (value) {
			frappe.web_form.set_value('pan', value.toUpperCase());
		}
	});

	// Auto-uppercase GSTIN on input
	frappe.web_form.on('gstin', (_field, value) => {
		if (value) {
			frappe.web_form.set_value('gstin', value.toUpperCase());
		}
	});
});
