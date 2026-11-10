// Aggregator Dashboard — one aggregator's own workers, transactions, fees and invoices.
// Built by public/js/welfare_dashboard.js; admins pick the aggregator (?aggregator=AG001).
frappe.pages['aggregator-dashboard'].on_page_load = function (wrapper) {
	wbd_make_page(wrapper, {
		view: 'aggregator',
		title: __('Aggregator Dashboard'),
		picker: { label: 'Aggregator', doctype: 'Aggregator', url_arg: 'aggregator' }
	});
};
