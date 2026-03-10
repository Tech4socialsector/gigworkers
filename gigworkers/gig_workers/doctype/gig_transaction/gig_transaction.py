# Copyright (c) 2026, Jenifar and contributors
# For license information, please see license.txt

import random

import frappe
from frappe.model.document import Document
from frappe.utils import now


# ------------------------------------------------------------
#  Helpers
# ------------------------------------------------------------

def _generate_otp() -> str:
	return str(random.randint(100000, 999999))


def _get_email(gig_worker_name: str) -> str:
	worker = frappe.get_doc("Gig Worker", gig_worker_name)
	email  = worker.email
	if not email:
		frappe.throw(
			f"No email address found for Gig Worker {gig_worker_name}.",
			title="Missing Worker Email",
		)
	return email


def _build_otp_record(otp_code: str, confirmed_at: str, email: str) -> dict:
	return {
		"otp_code":       otp_code,
		"sent_at":        confirmed_at,
		"confirmed_at":   confirmed_at,
		"confirm_status": "Confirmed",
		"email_sent_to":  email,
	}


# ------------------------------------------------------------
#  Standalone email sender — called via frappe.enqueue
#  so it runs AFTER the document is committed to DB
# ------------------------------------------------------------

def send_confirmation_email(transaction_name: str, email: str, otp_code: str, confirmed_at: str):
	"""
	Standalone function (not a method) so frappe.enqueue can call it.
	Sends confirmation email to the gig worker.
	"""
	subject = "✅ Gig Transaction Confirmed — Reference OTP"
	message = f"""
	<p>Dear Gig Worker,</p>
	<p>Your gig transaction <strong>{transaction_name}</strong> has been
	   <strong style="color:#16a34a;">confirmed</strong>.</p>
	<table style="border-collapse:collapse; margin-top:12px; font-family:sans-serif;">
	  <tr>
	    <td style="padding:8px 16px; background:#f0fdf4; border:1px solid #bbf7d0;"><b>Reference OTP</b></td>
	    <td style="padding:8px 16px; border:1px solid #bbf7d0;
	               font-size:1.4em; letter-spacing:8px; color:#2563eb; font-weight:bold;">{otp_code}</td>
	  </tr>
	  <tr>
	    <td style="padding:8px 16px; background:#f0fdf4; border:1px solid #bbf7d0;"><b>Confirmed At</b></td>
	    <td style="padding:8px 16px; border:1px solid #bbf7d0;">{confirmed_at}</td>
	  </tr>
	  <tr>
	    <td style="padding:8px 16px; background:#f0fdf4; border:1px solid #bbf7d0;"><b>Transaction</b></td>
	    <td style="padding:8px 16px; border:1px solid #bbf7d0;">{transaction_name}</td>
	  </tr>
	</table>
	<p style="margin-top:16px;">Please keep this OTP reference for your records.</p>
	<p>Thank you,<br>Gig Workers Team</p>
	"""

	try:
		frappe.sendmail(
			recipients     = [email],
			subject        = subject,
			message        = message,
			now            = True,
			with_container = True,
		)
	except Exception as e:
		frappe.log_error(
			message = f"Email failed for {transaction_name} → {email}:\n{e}",
			title   = "Gig Transaction Email Error",
		)


# ------------------------------------------------------------
#  Document Class
# ------------------------------------------------------------

class GigTransaction(Document):

	def before_save(self):
		"""
		Runs on every save — manual, import, API.
		Confirms the transaction and queues the email.
		"""
		# Already completed — do nothing
		if self.status == "Completed":
			return

		confirmed_at = now()

		if self.trust_level == "High":
			# Auto-confirm silently, no email needed
			self.status       = "Completed"
			self.confirmed_at = confirmed_at

		elif self.trust_level == "Low":
			email = _get_email(self.gig_worker)
			otp_code     = _generate_otp()

			# Append OTP audit record
			self.append("otp_records", _build_otp_record(otp_code, confirmed_at, email))

			self.status       = "Completed"
			self.confirmed_at = confirmed_at

			# Queue email to fire AFTER this DB transaction commits
			# is_async=False → works even without bench worker running
			frappe.enqueue(
				"gigworkers.gig_workers.doctype.gig_transaction.gig_transaction.send_confirmation_email",
				transaction_name=self.name,
				email=email,
				otp_code=otp_code,
				confirmed_at=confirmed_at,
				is_async=False,
			)


# ------------------------------------------------------------
#  API — Manual Confirm fallback (optional button)
# ------------------------------------------------------------

@frappe.whitelist()
def confirm_transaction(transaction_name: str) -> dict:
	doc = frappe.get_doc("Gig Transaction", transaction_name)

	if doc.trust_level != "Low":
		frappe.throw("Only Low Trust transactions use this flow.", title="Trust Level Mismatch")

	if doc.status == "Completed":
		frappe.throw("This transaction is already confirmed.", title="Already Confirmed")

	email = _get_email(doc.gig_worker)
	otp_code     = _generate_otp()
	confirmed_at = now()

	doc.append("otp_records", _build_otp_record(otp_code, confirmed_at, email))
	doc.status       = "Completed"
	doc.confirmed_at = confirmed_at
	doc.save(ignore_permissions=True)

	send_confirmation_email(transaction_name, email, otp_code, confirmed_at)

	return {
		"message":       "Transaction confirmed successfully",
		"email":  email,
		"otp_reference": otp_code,
	}