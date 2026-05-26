// Copyright (c) 2026, Jenifar and contributors
// For license information, please see license.txt

// ============================================================
//  gigworkers — Gig Worker List View Script
//  Hides the "Add Gig Worker" primary button (top-right) and
//  the empty-state centre "Create your first Gig Worker" button
//  so that new records can only be created through the
//  designated registration/import workflow.
// ============================================================

frappe.listview_settings["Gig Worker"] = {

	onload(listview) {
		// 1. Override can_create so Frappe never re-adds the button
		listview.can_create = false;

		// 2. Remove the primary button already added by setup_page_head()
		listview.page.clear_primary_action();

		// 3. Bulk Import button — navigates to the custom import page
		if (!frappe.user.has_role("Gig Worker")) {
			listview.page.add_button(__("Bulk Import"), function () {
				frappe.set_route("bulk-gig-worker-import");
			}, { icon: "upload" });
		}

		// 3. Nuclear-option CSS: hides the buttons no matter when
		//    Frappe re-renders them. Scoped to this page's DOM only.
		if (!document.getElementById("_gw_hide_add_btn")) {
			const style = document.createElement("style");
			style.id = "_gw_hide_add_btn";
			style.textContent = [
				// Top-right "Add Gig Worker" primary action button
				".page-actions .standard-actions .btn.primary-action[data-label='Add Gig Worker']",
				// Empty-state centre "Create your first Gig Worker" button
				".no-result .btn-new-doc",
			].join(", ") + " { display: none !important; }";
			document.head.appendChild(style);
		}
	},

	refresh(listview) {
		// Re-assert after every data reload cycle
		listview.can_create = false;
		listview.page.clear_primary_action();

		// Remove any .btn-new-doc already in the no-result area
		if (listview.$no_result) {
			listview.$no_result.find(".btn-new-doc").remove();
		}
	},
};
