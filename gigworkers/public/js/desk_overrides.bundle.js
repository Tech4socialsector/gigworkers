// Gigworkers desk overrides

// Keep every user on their own role's workspace sidebar.
// Every DocType here belongs to the "Gig Workers" module and appears in more than one
// role's menu (e.g. Gig Worker is in the admin, aggregator and worker menus), so Frappe
// often switches to another role's menu on navigation or reload. Each role has one menu:
// admin → "Database Flow", aggregator → "Aggregators", gig worker → "Gig Workers".
(function () {
	const ROLE_SIDEBAR = { "System Manager": "Database Flow", Aggregator: "Aggregators", "Gig Worker": "Gig Workers" };
	// Only these menus are ever swapped; Frappe's own menus (Users, Build, …) are left alone.
	const PORTAL_SIDEBARS = [...Object.values(ROLE_SIDEBAR), "Doctypes Flow"];

	function preferred_sidebar() {
		// first match wins: an admin who is also an aggregator gets the admin menu
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
