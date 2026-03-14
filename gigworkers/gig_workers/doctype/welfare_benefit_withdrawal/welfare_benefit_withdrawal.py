# Copyright (c) 2026, Jenifar and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class WelfareBenefitWithdrawal(Document):

	def before_insert(self):
		if not self.gig_worker:
			worker = frappe.db.get_value("Gig Worker", {"email": frappe.session.user}, "name")
			if worker:
				self.gig_worker = worker
		self.status = "Requested"

	def after_insert(self):
		self._notify_worker("Requested")

	def on_update(self):
		"""React to status transitions:
		  Approved → validate balance, notify worker of approval
		  Paid     → debit welfare fund account, notify worker of disbursement
		  Rejected → notify worker of rejection
		"""
		previous = self.get_doc_before_save()
		prev_status = previous.status if previous else None

		if self.status == "Approved" and prev_status != "Approved":
			self._process_approval()

		elif self.status == "Paid" and prev_status != "Paid":
			self._process_payment()

		elif self.status == "Rejected" and prev_status != "Rejected":
			self._notify_worker("Rejected")

	# --------------------------------------------------------

	def _process_approval(self):
		"""Check sufficient balance exists before approving; notify worker."""
		if not self.gig_worker or not self.amount:
			return

		account_name = frappe.db.get_value(
			"Welfare Fund Account", {"gig_worker": self.gig_worker}, "name"
		)
		if not account_name:
			frappe.throw("No welfare fund account found for this gig worker.")

		balance = frappe.db.get_value("Welfare Fund Account", account_name, "account_balance") or 0
		if balance < self.amount:
			frappe.throw(
				f"Insufficient welfare fund balance. "
				f"Available: &#8377;{balance:.2f}, Requested: &#8377;{self.amount:.2f}"
			)

		self._notify_worker("Approved")

	def _process_payment(self):
		"""Debit the welfare fund account when the withdrawal is paid out."""
		if not self.gig_worker or not self.amount:
			return

		from gigworkers.gig_workers.doctype.welfare_fund_account.welfare_fund_account import WelfareFundAccount
		account = WelfareFundAccount.get_or_create(self.gig_worker)
		account.debit(self.amount)

		self._notify_worker("Paid")

	def _notify_worker(self, status):
		"""Send an email to the gig worker about their withdrawal request status."""
		if not self.gig_worker:
			return

		worker = frappe.get_doc("Gig Worker", self.gig_worker)
		if not worker.email:
			return

		messages = {
			"Requested": (
				"Welfare Benefit Withdrawal – Request Received",
				f"""<p>Dear {worker.worker_name},</p>
				<p>Your welfare benefit withdrawal request has been <b>received</b> and is under review.</p>
				<ul>
					<li><b>Amount Requested:</b> &#8377;{self.amount:.2f}</li>
					<li><b>Reason:</b> {self.reason or 'Not specified'}</li>
				</ul>
				<p>You will be notified once it is reviewed.</p>
				<p>Thank you,<br>Gig Workers Welfare Team</p>"""
			),
			"Approved": (
				"Welfare Benefit Withdrawal – Approved",
				f"""<p>Dear {worker.worker_name},</p>
				<p>Your welfare benefit withdrawal request has been <b>approved</b>.</p>
				<ul>
					<li><b>Amount:</b> &#8377;{self.amount:.2f}</li>
					<li><b>Reason:</b> {self.reason or 'Not specified'}</li>
				</ul>
				<p>The amount will be disbursed to your registered bank account shortly.</p>
				<p>Thank you,<br>Gig Workers Welfare Team</p>"""
			),
			"Paid": (
				"Welfare Benefit – Amount Disbursed",
				f"""<p>Dear {worker.worker_name},</p>
				<p>Your welfare benefit of <b>&#8377;{self.amount:.2f}</b> has been disbursed.</p>
				<p>Your updated welfare fund balance is reflected in the portal.</p>
				<p>Thank you,<br>Gig Workers Welfare Team</p>"""
			),
			"Rejected": (
				"Welfare Benefit Withdrawal – Rejected",
				f"""<p>Dear {worker.worker_name},</p>
				<p>Your welfare benefit withdrawal request has been <b>rejected</b>.</p>
				<ul>
					<li><b>Amount Requested:</b> &#8377;{self.amount:.2f}</li>
					<li><b>Reason:</b> {self.reason or 'Not specified'}</li>
				</ul>
				<p>Please contact the portal admin for more information.</p>
				<p>Thank you,<br>Gig Workers Welfare Team</p>"""
			),
		}

		subject, body = messages.get(status, (None, None))
		if not subject:
			return

		try:
			frappe.sendmail(recipients=[worker.email], subject=subject, message=body, now=True)
		except Exception as e:
			frappe.log_error(
				message=f"Withdrawal notification failed for {self.gig_worker}: {e}",
				title="Welfare Withdrawal Email Error",
			)
