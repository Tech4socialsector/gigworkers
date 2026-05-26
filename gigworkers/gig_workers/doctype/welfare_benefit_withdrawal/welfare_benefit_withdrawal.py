# Copyright (c) 2026, Jenifar and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import today


class WelfareBenefitWithdrawal(Document):

	def before_insert(self):
		if not self.gig_worker:
			worker = frappe.db.get_value("Gig Worker", {"email": frappe.session.user}, "name")
			if worker:
				self.gig_worker = worker
		self.status = "Requested"
		if not self.requested_date:
			self.requested_date = today()

	def after_insert(self):
		self._notify_worker("Requested")

	def on_update(self):
		"""React to status transitions:
		  Approved → validate balance, stamp reviewer, notify worker
		  Paid     → debit (or credit if refund) welfare fund, stamp payment date, notify worker
		  Rejected → stamp reviewer, notify worker of rejection
		"""
		previous = self.get_doc_before_save()
		prev_status = previous.status if previous else None

		if self.status == "Approved" and prev_status != "Approved":
			self._process_approval()

		elif self.status == "Paid" and prev_status != "Paid":
			if self.is_refund:
				self._process_refund_payment()
			else:
				self._process_payment()

		elif self.status == "Rejected" and prev_status != "Rejected":
			self._stamp_reviewer()
			self._notify_worker("Rejected")

	# --------------------------------------------------------

	def _stamp_reviewer(self):
		"""Record who reviewed this request and when."""
		frappe.db.set_value(
			"Welfare Benefit Withdrawal", self.name,
			{"reviewed_by": frappe.session.user, "review_date": today()},
			update_modified=False,
		)
		self.reviewed_by = frappe.session.user
		self.review_date = today()

	def _process_approval(self):
		"""Check sufficient balance exists before approving; stamp reviewer; notify worker."""
		if not self.gig_worker or not self.amount:
			return

		if not self.is_refund:
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

		self._stamp_reviewer()
		self._notify_worker("Approved")

	def _process_payment(self):
		"""Debit the welfare fund account when the withdrawal is paid out."""
		if not self.gig_worker or not self.amount:
			return

		from gigworkers.gig_workers.doctype.welfare_fund_account.welfare_fund_account import WelfareFundAccount
		account = WelfareFundAccount.get_or_create(self.gig_worker)
		account.debit(
			self.amount,
			reference_doctype="Welfare Benefit Withdrawal",
			reference_name=self.name,
			remarks=f"Welfare benefit paid out - {self.reason or 'Withdrawal'}",
		)

		frappe.db.set_value(
			"Welfare Benefit Withdrawal", self.name,
			{"payment_date": today()},
			update_modified=False,
		)
		self.payment_date = today()
		self._notify_worker("Paid")

	def _process_refund_payment(self):
		"""Credit the welfare fund account when a refund is processed."""
		if not self.gig_worker or not self.amount:
			return

		from gigworkers.gig_workers.doctype.welfare_fund_account.welfare_fund_account import WelfareFundAccount
		account = WelfareFundAccount.get_or_create(self.gig_worker)
		account.credit(
			self.amount,
			reference_doctype="Welfare Benefit Withdrawal",
			reference_name=self.name,
			remarks=f"Refund processed - {self.refund_reason or self.reason or 'Refund'}",
		)

		frappe.db.set_value(
			"Welfare Benefit Withdrawal", self.name,
			{"refund_date": today(), "payment_date": today()},
			update_modified=False,
		)
		self.refund_date = today()
		self.payment_date = today()
		self._notify_worker("Refunded")

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
					<li><b>Type:</b> {self.withdrawal_type or 'Not specified'}</li>
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
					<li><b>Type:</b> {self.withdrawal_type or 'Not specified'}</li>
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
				<ul>
					<li><b>Payment Date:</b> {self.payment_date or today()}</li>
					<li><b>Reference No.:</b> {self.payment_reference or 'N/A'}</li>
				</ul>
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
					<li><b>Rejection Reason:</b> {self.rejection_reason or 'Not specified'}</li>
				</ul>
				<p>Please contact the portal admin for more information.</p>
				<p>Thank you,<br>Gig Workers Welfare Team</p>"""
			),
			"Refunded": (
				"Welfare Benefit – Refund Processed",
				f"""<p>Dear {worker.worker_name},</p>
				<p>A refund of <b>&#8377;{self.amount:.2f}</b> has been credited back to your welfare fund.</p>
				<ul>
					<li><b>Refund Reason:</b> {self.refund_reason or self.reason or 'Not specified'}</li>
					<li><b>Refund Date:</b> {self.refund_date or today()}</li>
					<li><b>Original Withdrawal:</b> {self.original_withdrawal or 'N/A'}</li>
				</ul>
				<p>Your updated welfare fund balance is reflected in the portal.</p>
				<p>Thank you,<br>Gig Workers Welfare Team</p>"""
			),
		}

		subject, body = messages.get(status, (None, None))
		if not subject:
			return

		try:
			frappe.sendmail(recipients=[worker.email], sender="nishanthclintona@gmail.com", subject=subject, message=body)
		except Exception as e:
			frappe.log_error(
				message=f"Withdrawal notification failed for {self.gig_worker}: {e}",
				title="Welfare Withdrawal Email Error",
			)
