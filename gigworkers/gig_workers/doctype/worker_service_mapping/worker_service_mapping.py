# Copyright (c) 2026, Jenifar and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import today


class WorkerServiceMapping(Document):

	def validate(self):
		self.check_duplicate_mapping()

	def on_update(self):
		"""Send email when status transitions to Onboarded or Offboarded."""
		previous = self.get_doc_before_save()
		prev_status = previous.status if previous else None

		if self.status == "Onboarded" and prev_status != "Onboarded":
			_notify_worker_status_change_from_doc(self, "OnBoarding")
		elif self.status == "Offboarded" and prev_status != "Offboarded":
			_notify_worker_status_change_from_doc(self, "OffBoarding")

	def after_insert(self):
		"""Send email when a new mapping is inserted directly as Onboarded."""
		if self.status == "Onboarded":
			_notify_worker_status_change_from_doc(self, "OnBoarding")

	def check_duplicate_mapping(self):
		filters = {
			"gig_worker": self.gig_worker,
			"aggregator": self.aggregator,
			"service": self.service,
		}
		if not self.is_new():
			filters["name"] = ("!=", self.name)

		existing = frappe.db.exists("Worker Service Mapping", filters)
		if existing:
			frappe.throw(
				f"A mapping for Gig Worker <b>{self.gig_worker}</b>, Aggregator <b>{self.aggregator}</b>, "
				f"and Service <b>{self.service}</b> already exists."
			)


# ------------------------------------------------------------
# Public API: Update gig worker status (onboard / offboard)
# ------------------------------------------------------------

@frappe.whitelist()
def update_gig_work_status(gigworker_id, aggregator_id, event_type, service_id=None, role_id=None):
	"""API for aggregators to report worker status changes.

	Signature matches requirements §1.4.5:
	  updateGigWorkStatus(gigworkerID, aggregatorID, event: gigWorkerStatusEvent)

	event_type: "OnBoarding" or "OffBoarding"

	OnBoarding rules:
	  - Gig worker profile status must be Active
	  - service_id must refer to an existing Service
	  - Worker must not already be Onboarded for that service+aggregator pair

	OffBoarding rules:
	  - Gig worker must currently be Onboarded with this aggregator
	"""

	# Authorization: caller must be the aggregator (or Administrator)
	if frappe.session.user != "Administrator":
		caller_agg = frappe.db.get_value(
			"Aggregator", {"email": frappe.session.user}, "name"
		)
		if caller_agg != aggregator_id:
			frappe.throw(
				"Unauthorized: You may only update status for your own aggregator.",
				frappe.PermissionError,
			)

	# Gig worker must exist and be Active
	gw = frappe.get_doc("Gig Worker", gigworker_id)
	if gw.status != "Active":
		frappe.throw(
			f"Gig Worker '{gigworker_id}' is not Active (current status: {gw.status}). "
			"Status changes are only allowed for Active workers."
		)

	if not frappe.db.exists("Aggregator", aggregator_id):
		frappe.throw(f"Aggregator '{aggregator_id}' does not exist.")

	if event_type == "OnBoarding":
		return _handle_onboarding(gw, aggregator_id, service_id, role_id)
	elif event_type == "OffBoarding":
		return _handle_offboarding(gw, aggregator_id, service_id)
	else:
		frappe.throw(
			f"Invalid event_type '{event_type}'. Must be 'OnBoarding' or 'OffBoarding'."
		)


def _handle_onboarding(gw, aggregator_id, service_id, role_id):
	"""Create or update a Worker Service Mapping to Onboarded state."""
	if not service_id:
		frappe.throw("service_id is required for OnBoarding.")

	if not frappe.db.exists("Service", service_id):
		frappe.throw(f"Service '{service_id}' does not exist.")

	already_onboarded = frappe.db.exists(
		"Worker Service Mapping",
		{"gig_worker": gw.name, "aggregator": aggregator_id, "service": service_id, "status": "Onboarded"},
	)
	if already_onboarded:
		frappe.throw(
			f"Gig Worker '{gw.name}' is already Onboarded with aggregator "
			f"'{aggregator_id}' for service '{service_id}'."
		)

	mapping_name = frappe.db.get_value(
		"Worker Service Mapping",
		{"gig_worker": gw.name, "aggregator": aggregator_id, "service": service_id},
		"name",
	)

	if mapping_name:
		mapping = frappe.get_doc("Worker Service Mapping", mapping_name)
		mapping.status = "Onboarded"
		mapping.start_date = today()
		mapping.end_date = None
		if role_id:
			mapping.role = role_id
		mapping.save(ignore_permissions=True)
	else:
		mapping = frappe.get_doc({
			"doctype": "Worker Service Mapping",
			"gig_worker": gw.name,
			"aggregator": aggregator_id,
			"service": service_id,
			"role": role_id,
			"status": "Onboarded",
			"start_date": today(),
		})
		mapping.insert(ignore_permissions=True)

	_notify_worker_status_change(gw, aggregator_id, service_id, "OnBoarding")

	return {
		"status": "success",
		"event": "OnBoarding",
		"mapping": mapping.name,
		"message": f"Gig Worker '{gw.name}' onboarded to service '{service_id}'.",
	}


def _handle_offboarding(gw, aggregator_id, service_id):
	"""Set an existing Onboarded mapping to Offboarded."""
	filters = {"gig_worker": gw.name, "aggregator": aggregator_id, "status": "Onboarded"}
	if service_id:
		filters["service"] = service_id

	mapping_name = frappe.db.get_value("Worker Service Mapping", filters, "name")

	if not mapping_name:
		suffix = f" for service '{service_id}'" if service_id else ""
		frappe.throw(
			f"Gig Worker '{gw.name}' is not currently Onboarded with "
			f"aggregator '{aggregator_id}'{suffix}."
		)

	mapping = frappe.get_doc("Worker Service Mapping", mapping_name)
	mapping.status = "Offboarded"
	mapping.end_date = today()
	mapping.save(ignore_permissions=True)

	_notify_worker_status_change(gw, aggregator_id, mapping.service, "OffBoarding")

	return {
		"status": "success",
		"event": "OffBoarding",
		"mapping": mapping.name,
		"message": f"Gig Worker '{gw.name}' offboarded from aggregator '{aggregator_id}'.",
	}


def _notify_worker_status_change_from_doc(mapping_doc, event_type):
	"""Called from on_update/after_insert hooks (manual UI saves)."""
	if not mapping_doc.gig_worker:
		return
	gw = frappe.get_doc("Gig Worker", mapping_doc.gig_worker)
	_notify_worker_status_change(gw, mapping_doc.aggregator, mapping_doc.service, event_type)


def _notify_worker_status_change(gw, aggregator_id, service_id, event_type):
	"""Send email to gig worker about their onboarding / offboarding."""
	if not gw.email:
		return

	agg_name = frappe.db.get_value("Aggregator", aggregator_id, "aggregator_name") or aggregator_id
	svc_name = frappe.db.get_value("Service", service_id, "service_name") or service_id

	if event_type == "OnBoarding":
		subject = f"You have been onboarded – {agg_name}"
		body = f"""
		<p>Dear {gw.worker_name},</p>
		<p>You have been <b>onboarded</b> to the following service on the Gig Workers Welfare Portal:</p>
		<ul>
			<li><b>Aggregator:</b> {agg_name}</li>
			<li><b>Service:</b> {svc_name}</li>
		</ul>
		<p>You are now eligible to receive welfare fee contributions for transactions through this service.</p>
		<p>If you did not expect this, please contact the portal admin immediately.</p>
		<p>Thank you,<br>Gig Workers Welfare Team</p>
		"""
	else:
		subject = f"You have been offboarded – {agg_name}"
		body = f"""
		<p>Dear {gw.worker_name},</p>
		<p>You have been <b>offboarded</b> from the following service:</p>
		<ul>
			<li><b>Aggregator:</b> {agg_name}</li>
			<li><b>Service:</b> {svc_name}</li>
		</ul>
		<p>No further welfare contributions will be made for this service. Your existing balance is unaffected.</p>
		<p>If you believe this is an error, please contact the aggregator or portal admin.</p>
		<p>Thank you,<br>Gig Workers Welfare Team</p>
		"""

	try:
		frappe.sendmail(recipients=[gw.email], subject=subject, message=body, now=True)
	except Exception as e:
		frappe.log_error(
			message=f"Status change email failed for {gw.name}: {e}",
			title="Worker Status Change Email Error",
		)
