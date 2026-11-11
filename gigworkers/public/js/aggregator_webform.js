// Web forms turn child-table Link fields into Autocomplete fields whose options are
// {value, label} pairs, but the table cell prints the raw value. Service Category
// records are named by a non-meaningful ID, so rows showed the ID instead of the name.
// Give those columns a formatter that shows the label.
// Runs directly (not in frappe.ready): web form client scripts execute after page ready.
(function () {
	var tries = 0;
	(function setup() {
		var wf = frappe.web_form;
		if (!wf || !wf.fields_dict) {
			if (tries++ < 20) setTimeout(setup, 250);
			return;
		}
		Object.values(wf.fields_dict).forEach(function (f) {
			if (!f.grid) return;
			(f.grid.docfields || []).forEach(function (df) {
				if (df.fieldtype !== "Autocomplete" || !df.options) return;
				var opts = typeof df.options === "string" ? JSON.parse(df.options) : df.options;
				var labels = {};
				(opts || []).forEach(function (o) {
					if (o && typeof o === "object") labels[o.value] = o.label;
				});
				df.formatter = function (value) {
					return frappe.utils.escape_html(labels[value] || value || "");
				};
			});
			f.grid.refresh();
		});
	})();
})();
