# Copyright (c) 2026, Jenifar and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class WelfareFeePayment(Document):

	def on_update(self):
		"""When payment is both Completed and settlement is Success, credit the
		gig worker's welfare fund account and notify them (requirements §1.5.2)."""
		previous = self.get_doc_before_save()
		if not previous:
			return

		just_settled = (
			self.payment_status == "Completed"
			and self.settlement_status == "Success"
			and not (
				previous.payment_status == "Completed"
				and previous.settlement_status == "Success"
			)
		)

		if just_settled:
			self._settle_to_welfare_fund()

	def _settle_to_welfare_fund(self):
		"""Credit welfare fund account and mark the linked transaction as Settled."""
		if not self.transaction or not self.fee_amount:
			return

		gig_worker = frappe.db.get_value("Gig Transaction", self.transaction, "gig_worker")
		if not gig_worker:
			return

		# Credit welfare fund account (creates one if it doesn't exist)
		from gigworkers.gig_workers.doctype.welfare_fund_account.welfare_fund_account import WelfareFundAccount
		account = WelfareFundAccount.get_or_create(gig_worker)
		account.credit(self.fee_amount)

		# Mark the source transaction as fully settled
		frappe.db.set_value("Gig Transaction", self.transaction, "settlement_status", "Settled")

		# Notify the gig worker
		worker = frappe.get_doc("Gig Worker", gig_worker)
		if worker.email:
			try:
				frappe.sendmail(
					recipients=[worker.email],
					subject="Welfare Fee Settled to Your Account",
					message=f"""
					<p>Dear {worker.worker_name},</p>
					<p>A welfare fee has been settled to your welfare fund account.</p>
					<table style="border-collapse:collapse;margin-top:12px;">
					  <tr><td style="padding:4px 16px 4px 0"><b>Payment Reference</b></td><td>{self.name}</td></tr>
					  <tr><td style="padding:4px 16px 4px 0"><b>Transaction</b></td><td>{self.transaction}</td></tr>
					  <tr><td style="padding:4px 16px 4px 0"><b>Amount Credited</b></td><td>&#8377;{self.fee_amount:.2f}</td></tr>
					  <tr><td style="padding:4px 16px 4px 0"><b>Payment Date</b></td><td>{self.payment_date}</td></tr>
					</table>
					<p>Log in to the portal to view your updated welfare fund balance.</p>
					<p>Thank you,<br>Gig Workers Welfare Team</p>
					""",
					now=True,
				)
			except Exception as e:
				frappe.log_error(
					message=f"Settlement notification failed for {gig_worker}: {e}",
					title="Welfare Fee Settlement Email Error",
				)
