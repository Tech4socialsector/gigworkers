// Welfare Board Dashboard (admin) — the whole scheme. Built by public/js/welfare_dashboard.js.
frappe.pages['welfare-board-dashboard'].on_page_load = function (wrapper) {
	wbd_make_page(wrapper, { view: 'admin', title: __('Welfare Board Dashboard') });
};
