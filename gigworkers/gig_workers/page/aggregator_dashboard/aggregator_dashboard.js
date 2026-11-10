// Aggregator Dashboard — one aggregator's own workers, transactions, fees and invoices.
// Built by public/js/welfare_dashboard.bundle.js; admins pick the aggregator (?aggregator=AG001).
// The shared script is loaded once per browser tab; a tab opened before an app update
// may hold an older copy. Say so instead of failing silently.
function wbd_outdated(wrapper, title) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title, single_column: true });
	$(page.body).html(`<div style="padding:80px 20px;text-align:center;color:var(--text-muted)">
		<p style="font-size:15px;margin-bottom:14px">${__('This page was updated. Reload to load the latest version.')}</p>
		<button class="btn btn-primary btn-sm">${__('Reload')}</button></div>`)
		.find('button').on('click', () => window.location.reload());
}

frappe.pages['aggregator-dashboard'].on_page_load = function (wrapper) {
	if (typeof wbd_make_page !== 'function') return wbd_outdated(wrapper, __('Aggregator Dashboard'));
	wbd_make_page(wrapper, {
		view: 'aggregator',
		title: __('Aggregator Dashboard'),
		picker: { label: 'Aggregator', doctype: 'Aggregator', url_arg: 'aggregator' }
	});
};
