// Service Category records are named by a random ID; load their names so the
// "Categories of business" rows on the registration web form show the name, not the ID.
frappe.ready(function () {
	frappe.call({
		method: "gigworkers.gig_workers.web_form.aggregator_form.aggregator_form.get_service_category_titles",
		callback: function (r) {
			(r.message || []).forEach(function (c) {
				frappe.utils.add_link_title("Service Category", c.name, c.category_name);
			});
			var refresh = function () {
				var wf = frappe.web_form;
				if (!wf || !wf.fields_dict) return false;
				Object.values(wf.fields_dict).forEach(function (f) {
					if (f.grid) f.grid.refresh();
				});
				return true;
			};
			if (!refresh()) setTimeout(refresh, 500);
		},
	});
});
