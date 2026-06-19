import frappe
from frappe.model.document import Document
from frappe.utils import now_datetime


class WorkerMappingLog(Document):
	pass


def create_mapping_log(
	gig_worker: str,
	event_type: str,
	aggregator: str = None,
	service: str = None,
	worker_status: str = None,
	reference_doctype: str = None,
	reference_name: str = None,
	remarks: str = None,
):
	"""Insert a Worker Mapping Log entry.

	Designed to be called from other controllers; always uses
	``ignore_permissions=True`` so it works regardless of the
	calling user's role.

	Args:
	    gig_worker:        Gig Worker document name (e.g. ``GW001``).
	    event_type:        One of the Select options defined on the DocType
	                       (Worker Registered / Worker Activated / Onboarded /
	                       Offboarded / Transaction Registered / Status Changed).
	    aggregator:        Aggregator document name — leave blank if unknown.
	    service:           Service document name — leave blank for non-service events.
	    worker_status:     Current status of the Gig Worker at log time.
	    reference_doctype: Source DocType that triggered this event.
	    reference_name:    Source document name.
	    remarks:           Free-text note.
	"""
	try:
		if worker_status is None:
			worker_status = frappe.db.get_value("Gig Worker", gig_worker, "status") or ""

		doc = frappe.get_doc(
			{
				"doctype": "Worker Mapping Log",
				"gig_worker": gig_worker,
				"aggregator": aggregator,
				"service": service,
				"event_type": event_type,
				"worker_status": worker_status,
				"log_datetime": now_datetime(),
				"logged_by": frappe.session.user,
				"reference_doctype": reference_doctype,
				"reference_name": reference_name,
				"remarks": remarks,
			}
		)
		doc.insert(ignore_permissions=True)
		frappe.db.commit()
	except Exception:
		frappe.log_error(frappe.get_traceback(), "WorkerMappingLog: failed to write log")
