// Gigworkers desk overrides

// Keep portal users on their own workspace sidebar.
// Every DocType here belongs to the "Gig Workers" module, so whenever Frappe can't keep
// the current sidebar (page reload, direct link, new tab) it falls back to the sidebar
// named after the module — the gig worker's "Gig Workers" menu — even for aggregators.
(function () {
	const ROLE_SIDEBAR = { Aggregator: "Aggregators", "Gig Worker": "Gig Workers" };
	const PORTAL_SIDEBARS = Object.values(ROLE_SIDEBAR);

	function preferred_sidebar() {
		if (frappe.user.has_role("System Manager")) return null;
		for (const [role, sidebar] of Object.entries(ROLE_SIDEBAR)) {
			if (frappe.user.has_role(role)) return sidebar;
		}
		return null;
	}

	function enforce_sidebar() {
		const sidebar = frappe.app && frappe.app.sidebar;
		const wanted = preferred_sidebar();
		if (!sidebar || !wanted || sidebar.sidebar_title === wanted) return;
		if (!frappe.boot.workspace_sidebar_item?.[wanted.toLowerCase()]) return;
		// Only swap one portal sidebar for the other; leave Wiki etc. alone
		if (!PORTAL_SIDEBARS.includes(sidebar.sidebar_title)) return;

		sidebar.setup(wanted);
		sidebar.set_active_workspace_item();
	}

	// Run after Frappe's own router/page-change handlers have picked a sidebar
	$(document).on("page-change", () => setTimeout(enforce_sidebar, 0));
	$(document).on("form-refresh", () => setTimeout(enforce_sidebar, 0));
})();
