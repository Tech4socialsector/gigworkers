// My Dashboard — one gig worker's own transactions, welfare fees, fund and withdrawals.
// Built by public/js/welfare_dashboard.js; admins pick the worker (?worker=GW001).
frappe.pages['gig-worker-dashboard'].on_page_load = function (wrapper) {
	wbd_make_page(wrapper, {
		view: 'worker',
		title: __('My Dashboard'),
		picker: { label: 'Gig Worker', doctype: 'Gig Worker', url_arg: 'worker' }
	});
};
