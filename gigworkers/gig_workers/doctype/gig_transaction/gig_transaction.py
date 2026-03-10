# Copyright (c) 2026, Jenifar and contributors
# For license information, please see license.txt

# ============================================================
#  gigworkers — Gig Transaction Controller
# ============================================================

import random

import frappe
from frappe.model.document import Document
from frappe.utils import now, now_datetime


# ------------------------------------------------------------
#  Document Class
# ------------------------------------------------------------

class GigTransaction(Document):

	# --------------------------------------------------------
	#  Lifecycle Hooks
	# --------------------------------------------------------

	def before_save(self):
		"""
		gigworkers auto-confirm logic:
		  - trust_level = High  → auto-confirm on save (no message here,
		                          JS handles the user notification)
		  - trust_level = Low   → requires aggregator to click
		                          the 'Confirm Transaction' button
		"""
		if self.trust_level == "High" and self.status != "Completed":
			self.status = "Completed"
			self.confirmed_at = now()


# ------------------------------------------------------------
#  gigworkers API — Confirm Transaction (Low Trust)
# ------------------------------------------------------------

@frappe.whitelist()
def confirm_transaction(transaction_name):
	"""
	gigworkers api code — Single-click confirm for Low trust transactions.

	When the aggregator clicks 'Confirm Transaction':
	  1. Generates a 6-digit OTP (audit reference)
	  2. Records OTP, sent time, confirmed time, and confirm status
	     in the OTP child table for a full audit trail
	  3. Immediately marks the transaction as Completed
	  4. Enqueues an email notification to the worker (background)

	No manual OTP entry required — designed for bulk upload scenarios.

	Args:
	    transaction_name (str): Name of the Gig Transaction document.

	Returns:
	    dict: Success message and worker email.
	"""
	doc = frappe.get_doc("Gig Transaction", transaction_name)

	# ---- Guard: only Low trust transactions go through this flow ----
	if doc.trust_level != "Low":
		frappe.throw(
			"This confirmation flow is only for Low Trust Level transactions.",
			title="Trust Level Mismatch",
		)

	if doc.status == "Completed":
		frappe.throw(
			"This transaction is already confirmed.",
			title="Already Confirmed",
		)

	# ---- Fetch worker email ----
	worker = frappe.get_doc("Gig Worker", doc.gig_worker)
	worker_email = worker.email  # 'email' fieldname = Email label
	if not worker_email:
		frappe.throw(
			f"No email address found for Gig Worker {doc.gig_worker}.",
			title="Missing Worker Email",
		)

	# ---- Generate OTP as audit reference ----
	otp_code  = str(random.randint(100000, 999999))
	confirmed = now()

	# ---- Append full audit record to child table ----
	doc.append("otp_records", {
		"otp_code":       otp_code,
		"sent_at":        confirmed,
		"confirmed_at":   confirmed,
		"confirm_status": "Confirmed",
		"email_sent_to":  worker_email,
	})

	# ---- Confirm the transaction ----
	doc.status       = "Completed"
	doc.confirmed_at = confirmed
	doc.save(ignore_permissions=True)

	# ---- Enqueue email notification to worker (background) ----
	frappe.enqueue(
		_send_confirmation_email,
		transaction_name=transaction_name,
		worker_email=worker_email,
		otp_code=otp_code,
		confirmed=confirmed,
		queue="short",
		now=frappe.flags.in_test,   # immediate in tests, queued in production
	)

	return {
		"message": f"Transaction confirmed successfully",
		"worker_email": worker_email,
		"otp_reference": otp_code,
	}


# ------------------------------------------------------------
#  gigworkers Helper — Email Notification (background)
# ------------------------------------------------------------

def _send_confirmation_email(transaction_name, worker_email, otp_code, confirmed):
	"""
	gigworkers helper — sends confirmation email to the worker.
	Called in background via frappe.enqueue.
	"""
	subject = "✅ Gig Transaction Confirmed"
	message = f"""
	<p>Dear Gig Worker,</p>
	<p>Your gig transaction <strong>{transaction_name}</strong> has been
	   <strong style="color:#16a34a;">confirmed</strong> by the aggregator.</p>
	<table style="border-collapse:collapse; margin-top:12px;">
	  <tr>
	    <td style="padding:6px 12px; background:#f0fdf4; border:1px solid #bbf7d0;">
	      <b>Reference OTP</b>
	    </td>
	    <td style="padding:6px 12px; border:1px solid #bbf7d0;
	               font-size:1.3em; letter-spacing:6px; color:#2563eb;">
	      {otp_code}
	    </td>
	  </tr>
	  <tr>
	    <td style="padding:6px 12px; background:#f0fdf4; border:1px solid #bbf7d0;">
	      <b>Confirmed At</b>
	    </td>
	    <td style="padding:6px 12px; border:1px solid #bbf7d0;">{confirmed}</td>
	  </tr>
	</table>
	<p style="margin-top:16px;">Please keep this reference for your records.</p>
	<p>Thank you,<br>Gig Workers Team</p>
	"""

	try:
		frappe.sendmail(
			recipients=[worker_email],
			subject=subject,
			message=message,
			now=True,
		)
	except Exception as e:
		frappe.log_error(
			message=f"Failed to send confirmation email to {worker_email}: {e}",
			title="Gig Transaction — Email Error",
		)
