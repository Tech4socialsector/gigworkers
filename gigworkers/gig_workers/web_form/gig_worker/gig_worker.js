frappe.ready(function () {

	// ── Inline error helpers ──────────────────────────────────────────────────
	function showFieldError(fieldname, message) {
		let wrapper = document.querySelector(`[data-fieldname="${fieldname}"]`);
		if (!wrapper) return;
		let existing = wrapper.querySelector('.field-inline-error');
		if (existing) existing.remove();
		if (message) {
			let err = document.createElement('p');
			err.className = 'field-inline-error';
			err.style.cssText = 'color:#e74c3c;font-size:12px;margin:4px 0 0 0;';
			err.textContent = message;
			wrapper.appendChild(err);
		}
	}

	function clearFieldError(fieldname) {
		showFieldError(fieldname, null);
	}

	// ── Real-time: Phone (digits only, 10 digits, starts with 6-9) ────────────
	frappe.web_form.on('phone', (_field, value) => {
		if (!value) { clearFieldError('phone'); return; }
		let digits = value.replace(/\D/g, '');
		if (digits.length > 10) {
			digits = digits.slice(0, 10);
		}
		if (digits !== value) {
			frappe.web_form.set_value('phone', digits);
		}
		if (!/^[6-9][0-9]{9}$/.test(digits)) {
			showFieldError('phone', 'Enter a valid 10-digit mobile number starting with 6, 7, 8 or 9.');
		} else {
			clearFieldError('phone');
		}
	});

	// ── Real-time: Aadhaar (strip non-digits, exactly 12 digits) ─────────────
	frappe.web_form.on('aadhaar_number', (_field, value) => {
		if (!value) { clearFieldError('aadhaar_number'); return; }
		let digits = value.replace(/\D/g, '');
		if (digits.length > 12) {
			digits = digits.slice(0, 12);
		}
		if (digits !== value) {
			frappe.web_form.set_value('aadhaar_number', digits);
		}
		if (digits.length > 0 && digits.length < 12) {
			showFieldError('aadhaar_number', 'Aadhaar number must be exactly 12 digits.');
		} else {
			clearFieldError('aadhaar_number');
		}
	});

	// ── Real-time: Date of Birth (no future date, must be ≥ 18 years) ─────────
	frappe.web_form.on('dob', (_field, value) => {
		if (!value) { clearFieldError('dob'); return; }
		let dob_date = new Date(value);
		let today = new Date();
		today.setHours(0, 0, 0, 0);
		if (dob_date > today) {
			showFieldError('dob', 'Date of Birth cannot be a future date.');
			return;
		}
		let age = today.getFullYear() - dob_date.getFullYear();
		let m = today.getMonth() - dob_date.getMonth();
		if (m < 0 || (m === 0 && today.getDate() < dob_date.getDate())) age--;
		if (age < 18) {
			showFieldError('dob', 'Gig Worker must be at least 18 years old.');
		} else {
			clearFieldError('dob');
		}
	});

	// ── Auto-uppercase PAN on input ───────────────────────────────────────────
	frappe.web_form.on('pan_number', (_field, value) => {
		if (value) frappe.web_form.set_value('pan_number', value.toUpperCase());
	});

	// ── Auto-uppercase eShram ID on input ─────────────────────────────────────
	frappe.web_form.on('eshram_id', (_field, value) => {
		if (value) frappe.web_form.set_value('eshram_id', value.toUpperCase());
	});

	// ── after_load: maxlength + keypress/paste restrictions ──────────────────
	frappe.web_form.after_load = () => {
		setTimeout(() => {
			// Aadhaar — max 12 digits, numbers only
			let aadhaar_input = document.querySelector('[data-fieldname="aadhaar_number"] input');
			if (aadhaar_input) {
				aadhaar_input.setAttribute('maxlength', '12');
				aadhaar_input.addEventListener('input', e => {
					aadhaar_input.value = aadhaar_input.value.replace(/\D/g, '').slice(0, 12);
				});
				aadhaar_input.addEventListener('keypress', e => {
					if (!/[0-9]/.test(e.key)) e.preventDefault();
				});
				aadhaar_input.addEventListener('paste', e => {
					e.preventDefault();
					let pasted = e.clipboardData ? e.clipboardData.getData('text') : '';
					let digits = pasted.replace(/\D/g, '').slice(0, 12);
					aadhaar_input.value = digits;
					frappe.web_form.set_value('aadhaar_number', digits);
				});
			}

			// Phone — max 10 digits, numbers only
			let phone_input = document.querySelector('[data-fieldname="phone"] input');
			if (phone_input) {
				phone_input.setAttribute('maxlength', '10');
				phone_input.addEventListener('input', e => {
					phone_input.value = phone_input.value.replace(/\D/g, '').slice(0, 10);
				});
				phone_input.addEventListener('keypress', e => {
					if (!/[0-9]/.test(e.key)) e.preventDefault();
				});
				phone_input.addEventListener('paste', e => {
					e.preventDefault();
					let pasted = e.clipboardData ? e.clipboardData.getData('text') : '';
					let digits = pasted.replace(/\D/g, '').slice(0, 10);
					phone_input.value = digits;
					frappe.web_form.set_value('phone', digits);
				});
			}

			// PAN — max 10 characters
			let pan_input = document.querySelector('[data-fieldname="pan_number"] input');
			if (pan_input) pan_input.setAttribute('maxlength', '10');
		}, 500);
	};

	// ── Final validation on Save ──────────────────────────────────────────────
	frappe.web_form.validate = () => {

		// Email
		let email = frappe.web_form.get_value('email');
		if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			frappe.msgprint(__('Invalid Email Address. Please enter a valid email (e.g., worker@domain.com).'));
			return false;
		}

		// Phone
		let phone = frappe.web_form.get_value('phone');
		if (phone && !/^[6-9][0-9]{9}$/.test(phone.trim())) {
			frappe.msgprint(__('Invalid Phone Number. Enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.'));
			return false;
		}

		// Aadhaar
		let aadhaar = frappe.web_form.get_value('aadhaar_number');
		if (aadhaar && !/^[0-9]{12}$/.test(aadhaar.replace(/\s/g, ''))) {
			frappe.msgprint(__('Invalid Aadhaar Number. Please enter a valid 12-digit Aadhaar number.'));
			return false;
		}

		// PAN
		let pan = frappe.web_form.get_value('pan_number');
		if (pan) {
			if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(pan.toUpperCase())) {
				frappe.msgprint(__('Invalid PAN Format. A valid PAN should be 5 letters, 4 numbers, and 1 letter (e.g., ABCDE1234F).'));
				return false;
			}
			frappe.web_form.set_value('pan_number', pan.toUpperCase());
		}

		// eShram ID
		let eshram_id = frappe.web_form.get_value('eshram_id');
		if (eshram_id && !/^UW-[0-9]{12}$/.test(eshram_id.toUpperCase())) {
			frappe.msgprint(__('Invalid eShram ID Format. A valid eShram ID should be like: UW-123456789012'));
			return false;
		}

		// Date of Birth
		let dob = frappe.web_form.get_value('dob');
		if (dob) {
			let dob_date = new Date(dob);
			let today = new Date();
			if (dob_date > today) {
				frappe.msgprint(__('Date of Birth cannot be a future date.'));
				return false;
			}
			let age = today.getFullYear() - dob_date.getFullYear();
			let m = today.getMonth() - dob_date.getMonth();
			if (m < 0 || (m === 0 && today.getDate() < dob_date.getDate())) age--;
			if (age < 18) {
				frappe.msgprint(__('Gig Worker must be at least 18 years old.'));
				return false;
			}
		}

		return true;
	};
});
