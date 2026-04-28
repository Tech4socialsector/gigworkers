import frappe
from frappe.utils import now_datetime, today


def _get_role_info(user=None):
	if not user:
		user = frappe.session.user
	roles = frappe.get_roles(user)
	is_admin = "System Manager" in roles
	is_aggregator = "Aggregator" in roles and not is_admin
	is_worker = "Gig Worker" in roles and not is_admin and not is_aggregator
	return is_admin, is_aggregator, is_worker


def _get_user_display_name(user):
	full_name = frappe.db.get_value("User", user, "full_name")
	return full_name or user


def _create_notification_log(for_user, subject, content, grv):
	"""Create a Frappe in-app notification (bell icon) for the given user."""
	try:
		frappe.get_doc({
			"doctype": "Notification Log",
			"subject": subject,
			"email_content": content,
			"document_type": "Grievance",
			"document_name": grv.name,
			"from_user": frappe.session.user,
			"for_user": for_user,
			"type": "Alert",
		}).insert(ignore_permissions=True)
	except Exception:
		pass


@frappe.whitelist()
def get_portal_data():
	user = frappe.session.user
	is_admin, is_aggregator, is_worker = _get_role_info(user)

	grievances = []

	if is_admin:
		grievances = frappe.db.sql(
			"""
			SELECT
				g.name, g.title, g.category, g.other_category, g.priority, g.status,
				g.gig_worker, g.aggregator, g.submitted_date, g.description, g.owner,
				COALESCE(gw.worker_name, u.full_name, g.owner) AS gig_worker_name
			FROM `tabGrievance` g
			LEFT JOIN `tabGig Worker` gw ON gw.name = g.gig_worker
			LEFT JOIN `tabUser` u ON u.name = g.owner
			ORDER BY g.creation DESC
			""",
			as_dict=True,
		)

	elif is_aggregator:
		aggregator = frappe.db.get_value("Aggregator", {"email": user}, "name")
		if not aggregator:
			return {"grievances": [], "role": "aggregator", "aggregators": [], "has_gw_profile": False}
		grievances = frappe.db.sql(
			"""
			SELECT
				g.name, g.title, g.category, g.other_category, g.priority, g.status,
				g.gig_worker, g.aggregator, g.submitted_date, g.description, g.owner,
				COALESCE(gw.worker_name, u.full_name, g.owner) AS gig_worker_name
			FROM `tabGrievance` g
			LEFT JOIN `tabGig Worker` gw ON gw.name = g.gig_worker
			LEFT JOIN `tabUser` u ON u.name = g.owner
			WHERE g.aggregator = %(aggregator)s
				OR gw.created_by_aggregator = %(aggregator)s
			ORDER BY g.creation DESC
			""",
			{"aggregator": aggregator},
			as_dict=True,
		)

	elif is_worker:
		gig_worker = frappe.db.get_value("Gig Worker", {"email": user}, "name")
		if gig_worker:
			# Has a GW profile — match by gig_worker OR owner
			grievances = frappe.db.sql(
				"""
				SELECT
					g.name, g.title, g.category, g.other_category, g.priority, g.status,
					g.gig_worker, g.aggregator, g.submitted_date, g.description, g.owner,
					COALESCE(gw.worker_name, u.full_name, g.owner) AS gig_worker_name
				FROM `tabGrievance` g
				LEFT JOIN `tabGig Worker` gw ON gw.name = g.gig_worker
				LEFT JOIN `tabUser` u ON u.name = g.owner
				WHERE g.gig_worker = %(gig_worker)s OR g.owner = %(user)s
				ORDER BY g.creation DESC
				""",
				{"gig_worker": gig_worker, "user": user},
				as_dict=True,
			)
		else:
			# No GW profile — match by owner only
			grievances = frappe.db.sql(
				"""
				SELECT
					g.name, g.title, g.category, g.other_category, g.priority, g.status,
					g.gig_worker, g.aggregator, g.submitted_date, g.description, g.owner,
					COALESCE(u.full_name, g.owner) AS gig_worker_name
				FROM `tabGrievance` g
				LEFT JOIN `tabUser` u ON u.name = g.owner
				WHERE g.owner = %(user)s
				ORDER BY g.creation DESC
				""",
				{"user": user},
				as_dict=True,
			)

	# Get all approved aggregators for workers to tag in their grievance
	aggregators = []
	if is_worker:
		gig_worker = frappe.db.get_value("Gig Worker", {"email": user}, "name")
		if gig_worker:
			aggregators = frappe.db.sql(
				"""
				SELECT DISTINCT a.name, a.aggregator_name
				FROM `tabAggregator` a
				INNER JOIN `tabGig Worker` gw ON gw.created_by_aggregator = a.name
				WHERE gw.name = %(gig_worker)s AND a.status = 'Approved'
				""",
				{"gig_worker": gig_worker},
				as_dict=True,
			)
		if not aggregators:
			# Fall back: show all approved aggregators so worker can tag one
			aggregators = frappe.db.get_all(
				"Aggregator",
				filters={"status": "Approved"},
				fields=["name", "aggregator_name"],
				order_by="aggregator_name asc",
			)
	elif is_admin:
		aggregators = frappe.db.get_all(
			"Aggregator",
			filters={"status": "Approved"},
			fields=["name", "aggregator_name"],
			order_by="aggregator_name asc",
		)

	has_gw_profile = bool(frappe.db.get_value("Gig Worker", {"email": user}, "name")) if is_worker else True
	user_display_name = _get_user_display_name(user)
	role = "admin" if is_admin else ("aggregator" if is_aggregator else "worker")

	return {
		"grievances": grievances,
		"role": role,
		"aggregators": aggregators,
		"has_gw_profile": has_gw_profile,
		"user_display_name": user_display_name,
	}


@frappe.whitelist()
def get_grievance_detail(grievance_name):
	user = frappe.session.user
	is_admin, is_aggregator, is_worker = _get_role_info(user)

	grv = frappe.get_doc("Grievance", grievance_name)

	# Permission check
	if is_worker:
		gig_worker = frappe.db.get_value("Gig Worker", {"email": user}, "name")
		owner_match = grv.owner == user
		gw_match = gig_worker and grv.gig_worker == gig_worker
		if not owner_match and not gw_match:
			frappe.throw("Not permitted.", frappe.PermissionError)

	elif is_aggregator:
		aggregator = frappe.db.get_value("Aggregator", {"email": user}, "name")
		worker_agg = (
			frappe.db.get_value("Gig Worker", grv.gig_worker, "created_by_aggregator")
			if grv.gig_worker
			else None
		)
		if grv.aggregator != aggregator and worker_agg != aggregator:
			frappe.throw("Not permitted.", frappe.PermissionError)

	gig_worker_name = ""
	if grv.gig_worker:
		gig_worker_name = frappe.db.get_value("Gig Worker", grv.gig_worker, "worker_name") or grv.gig_worker
	else:
		gig_worker_name = frappe.db.get_value("User", grv.owner, "full_name") or grv.owner

	replies = []
	for r in grv.replies:
		replies.append(
			{
				"reply_text": r.reply_text,
				"replied_by": r.replied_by,
				"replied_by_name": r.replied_by_name,
				"replied_by_role": r.replied_by_role,
				"reply_date": str(r.reply_date) if r.reply_date else "",
			}
		)

	return {
		"name": grv.name,
		"title": grv.title,
		"category": grv.category,
		"other_category": grv.other_category or "",
		"priority": grv.priority,
		"status": grv.status,
		"gig_worker": grv.gig_worker,
		"gig_worker_name": gig_worker_name,
		"aggregator": grv.aggregator,
		"submitted_date": str(grv.submitted_date) if grv.submitted_date else "",
		"description": grv.description,
		"attachment": grv.attachment,
		"replies": replies,
	}


@frappe.whitelist()
def submit_grievance(
	title, category, description, priority="Medium",
	aggregator=None, attachment=None, other_category=None
):
	user = frappe.session.user
	roles = frappe.get_roles(user)

	if "Gig Worker" not in roles:
		frappe.throw("Only Gig Workers can submit grievances.")

	if category == "Other" and not other_category:
		frappe.throw("Please specify the category when 'Other' is selected.")

	# Link to GW profile if it exists; otherwise owner field tracks the submitter
	gig_worker = frappe.db.get_value("Gig Worker", {"email": user}, "name")

	grv = frappe.new_doc("Grievance")
	grv.title = title
	grv.category = category
	grv.other_category = other_category or ""
	grv.description = description
	grv.priority = priority
	grv.status = "Open"
	grv.submitted_date = today()
	if gig_worker:
		grv.gig_worker = gig_worker
	if aggregator:
		grv.aggregator = aggregator
	if attachment:
		grv.attachment = attachment
	grv.insert(ignore_permissions=True)

	_send_grievance_notifications(grv, gig_worker, user)

	return grv.name


def _send_grievance_notifications(grv, gig_worker, user):
	if gig_worker:
		submitter_name = frappe.db.get_value("Gig Worker", gig_worker, "worker_name") or gig_worker
	else:
		submitter_name = frappe.db.get_value("User", user, "full_name") or user

	subject = f"New Grievance: {grv.title} [{grv.name}]"
	cat_display = f"Other – {grv.other_category}" if grv.category == "Other" and grv.other_category else grv.category
	message = f"""
	<p>A new grievance has been submitted.</p>
	<table style="border-collapse:collapse;width:100%">
		<tr><td style="padding:6px;font-weight:bold;">Grievance ID</td><td style="padding:6px;">{grv.name}</td></tr>
		<tr><td style="padding:6px;font-weight:bold;">Title</td><td style="padding:6px;">{grv.title}</td></tr>
		<tr><td style="padding:6px;font-weight:bold;">Category</td><td style="padding:6px;">{cat_display}</td></tr>
		<tr><td style="padding:6px;font-weight:bold;">Priority</td><td style="padding:6px;">{grv.priority}</td></tr>
		<tr><td style="padding:6px;font-weight:bold;">Submitted By</td><td style="padding:6px;">{submitter_name}</td></tr>
		<tr><td style="padding:6px;font-weight:bold;">Description</td><td style="padding:6px;">{grv.description}</td></tr>
	</table>
	<p><a href="/app/grievance/{grv.name}">View Grievance</a></p>
	"""

	admin_users = frappe.db.sql(
		"""
		SELECT DISTINCT u.name, u.email FROM `tabUser` u
		INNER JOIN `tabHas Role` hr ON hr.parent = u.name
		WHERE hr.role = 'System Manager' AND u.enabled = 1
		AND u.name != 'Administrator'
		""",
		as_dict=True,
	)
	for admin in admin_users:
		if admin.email:
			frappe.sendmail(recipients=[admin.email], subject=subject, message=message, now=True)
		_create_notification_log(admin.name, subject, message, grv)

	if grv.aggregator:
		agg_email = frappe.db.get_value("Aggregator", grv.aggregator, "email")
		if agg_email:
			frappe.sendmail(recipients=[agg_email], subject=subject, message=message, now=True)
			agg_user = frappe.db.get_value("User", {"email": agg_email}, "name")
			if agg_user:
				_create_notification_log(agg_user, subject, message, grv)


@frappe.whitelist()
def add_reply(grievance_name, reply_text):
	user = frappe.session.user
	is_admin, is_aggregator, is_worker = _get_role_info(user)

	grv = frappe.get_doc("Grievance", grievance_name)

	# Workers can only reply to their own grievances
	if is_worker:
		gig_worker = frappe.db.get_value("Gig Worker", {"email": user}, "name")
		if grv.owner != user and (not gig_worker or grv.gig_worker != gig_worker):
			frappe.throw("Not permitted to reply to this grievance.")

	elif is_aggregator:
		aggregator = frappe.db.get_value("Aggregator", {"email": user}, "name")
		worker_agg = (
			frappe.db.get_value("Gig Worker", grv.gig_worker, "created_by_aggregator")
			if grv.gig_worker
			else None
		)
		if grv.aggregator != aggregator and worker_agg != aggregator:
			frappe.throw("Not permitted to reply to this grievance.")

	display_name = _get_user_display_name(user)
	if is_admin:
		role_label = "Admin"
	elif is_aggregator:
		role_label = "Aggregator"
	else:
		role_label = "Worker"

	grv.append(
		"replies",
		{
			"reply_text": reply_text,
			"replied_by": user,
			"replied_by_name": display_name,
			"replied_by_role": role_label,
			"reply_date": now_datetime(),
		},
	)

	if grv.status == "Open":
		grv.status = "In Review"

	grv.save(ignore_permissions=True)

	if is_worker:
		_notify_staff_on_worker_reply(grv, display_name, reply_text)
	else:
		_notify_worker_reply(grv, display_name, role_label, reply_text)

	return {"status": grv.status}


def _notify_staff_on_worker_reply(grv, worker_name, reply_text):
	"""Notify Admin and Aggregator (email + in-app) when a worker adds a reply."""
	subject = f"Worker Replied on Grievance: {grv.title} [{grv.name}]"
	message = f"""
	<p>The gig worker has replied to their grievance.</p>
	<table style="border-collapse:collapse;width:100%">
		<tr><td style="padding:6px;font-weight:bold;">Grievance ID</td><td style="padding:6px;">{grv.name}</td></tr>
		<tr><td style="padding:6px;font-weight:bold;">Title</td><td style="padding:6px;">{grv.title}</td></tr>
		<tr><td style="padding:6px;font-weight:bold;">Replied By</td><td style="padding:6px;">{worker_name} (Worker)</td></tr>
		<tr><td style="padding:6px;font-weight:bold;">Reply</td><td style="padding:6px;">{reply_text}</td></tr>
		<tr><td style="padding:6px;font-weight:bold;">Current Status</td><td style="padding:6px;">{grv.status}</td></tr>
	</table>
	<p><a href="/app/grievance/{grv.name}">View Grievance</a></p>
	"""

	admin_users = frappe.db.sql(
		"""
		SELECT DISTINCT u.name, u.email FROM `tabUser` u
		INNER JOIN `tabHas Role` hr ON hr.parent = u.name
		WHERE hr.role = 'System Manager' AND u.enabled = 1
		AND u.name != 'Administrator'
		""",
		as_dict=True,
	)
	for admin in admin_users:
		if admin.email:
			frappe.sendmail(recipients=[admin.email], subject=subject, message=message, now=True)
		_create_notification_log(admin.name, subject, message, grv)

	if grv.aggregator:
		agg_email = frappe.db.get_value("Aggregator", grv.aggregator, "email")
		if agg_email:
			frappe.sendmail(recipients=[agg_email], subject=subject, message=message, now=True)
			agg_user = frappe.db.get_value("User", {"email": agg_email}, "name")
			if agg_user:
				_create_notification_log(agg_user, subject, message, grv)


def _notify_worker_reply(grv, replied_by_name, replied_by_role, reply_text):
	# Determine worker email and user account — fall back to owner
	worker_email = None
	worker_user = None
	if grv.gig_worker:
		worker_email = frappe.db.get_value("Gig Worker", grv.gig_worker, "email")
	if worker_email:
		worker_user = frappe.db.get_value("User", {"email": worker_email}, "name")
	if not worker_email and grv.owner:
		worker_user = grv.owner
		worker_email = frappe.db.get_value("User", grv.owner, "email")
	if not worker_email:
		return

	subject = f"Reply on Your Grievance: {grv.title} [{grv.name}]"
	message = f"""
	<p>You have received a reply on your grievance.</p>
	<table style="border-collapse:collapse;width:100%">
		<tr><td style="padding:6px;font-weight:bold;">Grievance ID</td><td style="padding:6px;">{grv.name}</td></tr>
		<tr><td style="padding:6px;font-weight:bold;">Title</td><td style="padding:6px;">{grv.title}</td></tr>
		<tr><td style="padding:6px;font-weight:bold;">Replied By</td><td style="padding:6px;">{replied_by_name} ({replied_by_role})</td></tr>
		<tr><td style="padding:6px;font-weight:bold;">Reply</td><td style="padding:6px;">{reply_text}</td></tr>
		<tr><td style="padding:6px;font-weight:bold;">Current Status</td><td style="padding:6px;">{grv.status}</td></tr>
	</table>
	<p><a href="/app/grievance-portal">View Your Grievances</a></p>
	"""
	frappe.sendmail(recipients=[worker_email], subject=subject, message=message, now=True)
	if worker_user:
		_create_notification_log(worker_user, subject, message, grv)


@frappe.whitelist()
def update_grievance_status(grievance_name, new_status):
	user = frappe.session.user
	is_admin, is_aggregator, _ = _get_role_info(user)

	if not is_admin and not is_aggregator:
		frappe.throw("Only Admin or Aggregator can update status.")

	grv = frappe.get_doc("Grievance", grievance_name)

	if is_aggregator:
		aggregator = frappe.db.get_value("Aggregator", {"email": user}, "name")
		worker_agg = (
			frappe.db.get_value("Gig Worker", grv.gig_worker, "created_by_aggregator")
			if grv.gig_worker
			else None
		)
		if grv.aggregator != aggregator and worker_agg != aggregator:
			frappe.throw("Not permitted.")

	valid_statuses = ["Open", "In Review", "Resolved", "Closed"]
	if new_status not in valid_statuses:
		frappe.throw(f"Invalid status: {new_status}")

	grv.status = new_status
	grv.save(ignore_permissions=True)
	return {"status": grv.status}
