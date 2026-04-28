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


def _get_category_assigned_email(category):
	"""Return the first configured email for the given category from Grievance Category Setting."""
	try:
		settings = frappe.get_single("Grievance Category Setting")
		for rule in settings.category_rules:
			if rule.category == category and rule.assigned_email:
				return rule.assigned_email
	except Exception:
		pass
	return None


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
				COALESCE(gw.worker_name, u.full_name, g.owner) AS gig_worker_name,
				a.aggregator_name
			FROM `tabGrievance` g
			LEFT JOIN `tabGig Worker` gw ON gw.name = g.gig_worker
			LEFT JOIN `tabUser` u ON u.name = g.owner
			LEFT JOIN `tabAggregator` a ON a.name = g.aggregator
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
				COALESCE(gw.worker_name, u.full_name, g.owner) AS gig_worker_name,
				a.aggregator_name
			FROM `tabGrievance` g
			LEFT JOIN `tabGig Worker` gw ON gw.name = g.gig_worker
			LEFT JOIN `tabUser` u ON u.name = g.owner
			LEFT JOIN `tabAggregator` a ON a.name = g.aggregator
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
			grievances = frappe.db.sql(
				"""
				SELECT
					g.name, g.title, g.category, g.other_category, g.priority, g.status,
					g.gig_worker, g.aggregator, g.submitted_date, g.description, g.owner,
					COALESCE(gw.worker_name, u.full_name, g.owner) AS gig_worker_name,
					a.aggregator_name
				FROM `tabGrievance` g
				LEFT JOIN `tabGig Worker` gw ON gw.name = g.gig_worker
				LEFT JOIN `tabUser` u ON u.name = g.owner
				LEFT JOIN `tabAggregator` a ON a.name = g.aggregator
				WHERE g.gig_worker = %(gig_worker)s OR g.owner = %(user)s
				ORDER BY g.creation DESC
				""",
				{"gig_worker": gig_worker, "user": user},
				as_dict=True,
			)
		else:
			grievances = frappe.db.sql(
				"""
				SELECT
					g.name, g.title, g.category, g.other_category, g.priority, g.status,
					g.gig_worker, g.aggregator, g.submitted_date, g.description, g.owner,
					COALESCE(u.full_name, g.owner) AS gig_worker_name,
					a.aggregator_name
				FROM `tabGrievance` g
				LEFT JOIN `tabUser` u ON u.name = g.owner
				LEFT JOIN `tabAggregator` a ON a.name = g.aggregator
				WHERE g.owner = %(user)s
				ORDER BY g.creation DESC
				""",
				{"user": user},
				as_dict=True,
			)

	# All approved aggregators — needed by workers (tagging) and by admin/aggregator (reassignment)
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
			aggregators = frappe.db.get_all(
				"Aggregator",
				filters={"status": "Approved"},
				fields=["name", "aggregator_name"],
				order_by="aggregator_name asc",
			)
	else:
		# Admin and Aggregator both need the full list for reassignment
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

	aggregator_name = ""
	if grv.aggregator:
		aggregator_name = frappe.db.get_value("Aggregator", grv.aggregator, "aggregator_name") or grv.aggregator

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
		"aggregator_name": aggregator_name,
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


def _build_grievance_email_body(grv, submitter_name, action_label="A new grievance has been submitted."):
	cat_display = (
		f"Other – {grv.other_category}"
		if grv.category == "Other" and grv.other_category
		else grv.category
	)
	portal_url = f"/app/grievance-portal#{grv.name}"
	return f"""
	<p>{action_label}</p>
	<table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:13px;">
		<tr style="background:#f7f9ff;">
			<td style="padding:8px 12px;font-weight:600;color:#4a5568;width:160px;">Grievance ID</td>
			<td style="padding:8px 12px;color:#2d3748;">{grv.name}</td>
		</tr>
		<tr>
			<td style="padding:8px 12px;font-weight:600;color:#4a5568;">Title</td>
			<td style="padding:8px 12px;color:#2d3748;">{grv.title}</td>
		</tr>
		<tr style="background:#f7f9ff;">
			<td style="padding:8px 12px;font-weight:600;color:#4a5568;">Category</td>
			<td style="padding:8px 12px;color:#2d3748;">{cat_display}</td>
		</tr>
		<tr>
			<td style="padding:8px 12px;font-weight:600;color:#4a5568;">Priority</td>
			<td style="padding:8px 12px;color:#2d3748;">{grv.priority}</td>
		</tr>
		<tr style="background:#f7f9ff;">
			<td style="padding:8px 12px;font-weight:600;color:#4a5568;">Submitted By</td>
			<td style="padding:8px 12px;color:#2d3748;">{submitter_name}</td>
		</tr>
		<tr>
			<td style="padding:8px 12px;font-weight:600;color:#4a5568;">Status</td>
			<td style="padding:8px 12px;color:#2d3748;">{grv.status}</td>
		</tr>
		<tr style="background:#f7f9ff;">
			<td style="padding:8px 12px;font-weight:600;color:#4a5568;vertical-align:top;">Description</td>
			<td style="padding:8px 12px;color:#2d3748;">{grv.description}</td>
		</tr>
	</table>
	<p style="margin-top:16px;">
		<a href="{portal_url}"
			style="background:#4e73df;color:#fff;padding:9px 18px;border-radius:6px;
				text-decoration:none;font-size:13px;font-weight:600;">
			View in Grievance Portal
		</a>
	</p>
	"""


def _send_grievance_notifications(grv, gig_worker, user):
	if gig_worker:
		submitter_name = frappe.db.get_value("Gig Worker", gig_worker, "worker_name") or gig_worker
	else:
		submitter_name = frappe.db.get_value("User", user, "full_name") or user

	subject = f"New Grievance: {grv.title} [{grv.name}]"
	message = _build_grievance_email_body(grv, submitter_name)

	# ── Category-based assignment ─────────────────────────────────────────────
	assigned_email = _get_category_assigned_email(grv.category)

	if assigned_email:
		# Auto-assign the grievance to the matching aggregator if not already set
		if not grv.aggregator:
			matched_agg = frappe.db.get_value(
				"Aggregator", {"email": assigned_email, "status": "Approved"}, "name"
			)
			if matched_agg:
				grv.aggregator = matched_agg
				grv.db_set("aggregator", matched_agg, update_modified=False)

		# Email goes ONLY to the first configured category assignee
		frappe.sendmail(recipients=[assigned_email], subject=subject, message=message, now=True)
		assigned_user = frappe.db.get_value("User", {"email": assigned_email}, "name")
		if assigned_user:
			_create_notification_log(assigned_user, subject, message, grv)

		# Admins get in-app notifications but NOT a separate email (already notified via category rule)
		admin_users = frappe.db.sql(
			"""
			SELECT DISTINCT u.name FROM `tabUser` u
			INNER JOIN `tabHas Role` hr ON hr.parent = u.name
			WHERE hr.role = 'System Manager' AND u.enabled = 1
			AND u.name != 'Administrator'
			""",
			as_dict=True,
		)
		for admin in admin_users:
			_create_notification_log(admin.name, subject, message, grv)

	else:
		# No category rule — fall back to emailing all admins + the tagged aggregator
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
def reassign_grievance(grievance_name, new_aggregator):
	"""Reassign a grievance to a different aggregator."""
	user = frappe.session.user
	is_admin, is_aggregator, _ = _get_role_info(user)

	if not is_admin and not is_aggregator:
		frappe.throw("Only Admin or Aggregator can reassign grievances.")

	if not frappe.db.exists("Aggregator", new_aggregator):
		frappe.throw("Invalid aggregator selected.")

	grv = frappe.get_doc("Grievance", grievance_name)

	# Aggregators may only reassign grievances in their own queue
	if is_aggregator:
		aggregator = frappe.db.get_value("Aggregator", {"email": user}, "name")
		worker_agg = (
			frappe.db.get_value("Gig Worker", grv.gig_worker, "created_by_aggregator")
			if grv.gig_worker
			else None
		)
		if grv.aggregator != aggregator and worker_agg != aggregator:
			frappe.throw("Not permitted to reassign this grievance.")

	old_aggregator = grv.aggregator
	grv.aggregator = new_aggregator
	grv.save(ignore_permissions=True)

	_notify_aggregator_reassigned(grv, new_aggregator, old_aggregator)

	new_agg_name = (
		frappe.db.get_value("Aggregator", new_aggregator, "aggregator_name") or new_aggregator
	)
	return {"aggregator": new_aggregator, "aggregator_name": new_agg_name}


def _notify_aggregator_reassigned(grv, new_aggregator, old_aggregator):
	reassigned_by = _get_user_display_name(frappe.session.user)
	portal_url = f"/app/grievance-portal#{grv.name}"

	subject = f"Grievance Assigned to You: {grv.title} [{grv.name}]"
	message = f"""
	<p>A grievance has been assigned to your queue.</p>
	<table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:13px;">
		<tr style="background:#f7f9ff;">
			<td style="padding:8px 12px;font-weight:600;color:#4a5568;width:160px;">Grievance ID</td>
			<td style="padding:8px 12px;color:#2d3748;">{grv.name}</td>
		</tr>
		<tr>
			<td style="padding:8px 12px;font-weight:600;color:#4a5568;">Title</td>
			<td style="padding:8px 12px;color:#2d3748;">{grv.title}</td>
		</tr>
		<tr style="background:#f7f9ff;">
			<td style="padding:8px 12px;font-weight:600;color:#4a5568;">Category</td>
			<td style="padding:8px 12px;color:#2d3748;">{grv.category}</td>
		</tr>
		<tr>
			<td style="padding:8px 12px;font-weight:600;color:#4a5568;">Status</td>
			<td style="padding:8px 12px;color:#2d3748;">{grv.status}</td>
		</tr>
		<tr style="background:#f7f9ff;">
			<td style="padding:8px 12px;font-weight:600;color:#4a5568;">Reassigned By</td>
			<td style="padding:8px 12px;color:#2d3748;">{reassigned_by}</td>
		</tr>
	</table>
	<p style="margin-top:16px;">
		<a href="{portal_url}"
			style="background:#4e73df;color:#fff;padding:9px 18px;border-radius:6px;
				text-decoration:none;font-size:13px;font-weight:600;">
			View in Grievance Portal
		</a>
	</p>
	"""

	new_agg_email = frappe.db.get_value("Aggregator", new_aggregator, "email")
	if new_agg_email:
		frappe.sendmail(recipients=[new_agg_email], subject=subject, message=message, now=True)
		new_agg_user = frappe.db.get_value("User", {"email": new_agg_email}, "name")
		if new_agg_user:
			_create_notification_log(new_agg_user, subject, message, grv)

	# Notify old aggregator in-app (no email) that the ticket was moved
	if old_aggregator and old_aggregator != new_aggregator:
		old_subject = f"Grievance Reassigned: {grv.title} [{grv.name}]"
		old_message = (
			f"<p>Grievance <strong>{grv.name}</strong> — <em>{grv.title}</em> "
			f"has been reassigned to another aggregator by <strong>{reassigned_by}</strong>.</p>"
		)
		old_agg_email = frappe.db.get_value("Aggregator", old_aggregator, "email")
		if old_agg_email:
			old_agg_user = frappe.db.get_value("User", {"email": old_agg_email}, "name")
			if old_agg_user:
				_create_notification_log(old_agg_user, old_subject, old_message, grv)


@frappe.whitelist()
def add_reply(grievance_name, reply_text):
	user = frappe.session.user
	is_admin, is_aggregator, is_worker = _get_role_info(user)

	grv = frappe.get_doc("Grievance", grievance_name)

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
	portal_url = f"/app/grievance-portal#{grv.name}"
	message = f"""
	<p>The gig worker has added a follow-up to their grievance.</p>
	<table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:13px;">
		<tr style="background:#f7f9ff;">
			<td style="padding:8px 12px;font-weight:600;color:#4a5568;width:160px;">Grievance ID</td>
			<td style="padding:8px 12px;color:#2d3748;">{grv.name}</td>
		</tr>
		<tr>
			<td style="padding:8px 12px;font-weight:600;color:#4a5568;">Title</td>
			<td style="padding:8px 12px;color:#2d3748;">{grv.title}</td>
		</tr>
		<tr style="background:#f7f9ff;">
			<td style="padding:8px 12px;font-weight:600;color:#4a5568;">Replied By</td>
			<td style="padding:8px 12px;color:#2d3748;">{worker_name} (Worker)</td>
		</tr>
		<tr>
			<td style="padding:8px 12px;font-weight:600;color:#4a5568;vertical-align:top;">Reply</td>
			<td style="padding:8px 12px;color:#2d3748;">{reply_text}</td>
		</tr>
		<tr style="background:#f7f9ff;">
			<td style="padding:8px 12px;font-weight:600;color:#4a5568;">Current Status</td>
			<td style="padding:8px 12px;color:#2d3748;">{grv.status}</td>
		</tr>
	</table>
	<p style="margin-top:16px;">
		<a href="{portal_url}"
			style="background:#4e73df;color:#fff;padding:9px 18px;border-radius:6px;
				text-decoration:none;font-size:13px;font-weight:600;">
			View in Grievance Portal
		</a>
	</p>
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
	"""Notify the gig worker (email + in-app) when Admin or Aggregator replies."""
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
	portal_url = f"/app/grievance-portal#{grv.name}"
	message = f"""
	<p>You have received a reply on your grievance.</p>
	<table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:13px;">
		<tr style="background:#f7f9ff;">
			<td style="padding:8px 12px;font-weight:600;color:#4a5568;width:160px;">Grievance ID</td>
			<td style="padding:8px 12px;color:#2d3748;">{grv.name}</td>
		</tr>
		<tr>
			<td style="padding:8px 12px;font-weight:600;color:#4a5568;">Title</td>
			<td style="padding:8px 12px;color:#2d3748;">{grv.title}</td>
		</tr>
		<tr style="background:#f7f9ff;">
			<td style="padding:8px 12px;font-weight:600;color:#4a5568;">Replied By</td>
			<td style="padding:8px 12px;color:#2d3748;">{replied_by_name} ({replied_by_role})</td>
		</tr>
		<tr>
			<td style="padding:8px 12px;font-weight:600;color:#4a5568;vertical-align:top;">Reply</td>
			<td style="padding:8px 12px;color:#2d3748;">{reply_text}</td>
		</tr>
		<tr style="background:#f7f9ff;">
			<td style="padding:8px 12px;font-weight:600;color:#4a5568;">Current Status</td>
			<td style="padding:8px 12px;color:#2d3748;">{grv.status}</td>
		</tr>
	</table>
	<p style="margin-top:16px;">
		<a href="{portal_url}"
			style="background:#4e73df;color:#fff;padding:9px 18px;border-radius:6px;
				text-decoration:none;font-size:13px;font-weight:600;">
			View Your Grievances
		</a>
	</p>
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
