/**
 * Gigworkers Desk Overrides
 *
 * Redirects any navigation attempt to a raw Grievance DocType form
 * to the custom Grievance Portal page instead. Handles both:
 *   - frappe.set_route("Form", "Grievance", name) calls (e.g. notification bell clicks)
 *   - Direct <a href="…/grievance/GRV-…"> anchor clicks (e.g. email links opened in desk)
 *
 * The target grievance name is passed to the portal via sessionStorage so the
 * portal can auto-open the correct detail view on load.
 */
frappe.ready(function () {
	"use strict";

	frappe.provide("gigworkers.desk");

	gigworkers.desk = {
		init: function () {
			this._patch_set_route();
			this._patch_anchor_clicks();
		},

		/**
		 * Wraps frappe.set_route to intercept ("Form", "Grievance", name) calls.
		 * Any such call is silently redirected to the grievance-portal page and the
		 * grievance name is stored in sessionStorage for the portal to pick up.
		 */
		_patch_set_route: function () {
			var _orig = frappe.set_route.bind(frappe);

			frappe.set_route = function () {
				var args = Array.prototype.slice.call(arguments);
				if (
					args.length >= 3 &&
					args[0] === "Form" &&
					args[1] === "Grievance" &&
					args[2]
				) {
					sessionStorage.setItem("grv_portal_doc", args[2]);
					return _orig.call(frappe, "grievance-portal");
				}
				return _orig.apply(frappe, args);
			};
		},

		/**
		 * Intercepts clicks on anchor tags whose href contains a Grievance document
		 * URL pattern (e.g. /app/grievance/GRV-2026-00003 or /desk/grievance/GRV-…).
		 * Prevents the default navigation and routes to the portal instead.
		 */
		_patch_anchor_clicks: function () {
			$(document).on("click", "a[href]", function (e) {
				var href = $(this).attr("href") || "";
				var match = href.match(/\/grievance\/(GRV-[\w-]+)/);
				if (match) {
					e.preventDefault();
					e.stopImmediatePropagation();
					sessionStorage.setItem("grv_portal_doc", match[1]);
					frappe.set_route("grievance-portal");
				}
			});
		},
	};

	gigworkers.desk.init();
});
