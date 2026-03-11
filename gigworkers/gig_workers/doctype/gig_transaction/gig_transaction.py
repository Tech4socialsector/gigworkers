# Copyright (c) 2026, Jenifar and contributors
# For license information, please see license.txt

import random
import frappe
from frappe.model.document import Document
from frappe.utils import now, today


# ------------------------------------------------------------
# Helpers
# ------------------------------------------------------------

def _generate_otp():
    return str(random.randint(100000, 999999))


def _get_email(gig_worker_name):
    worker = frappe.get_doc("Gig Worker", gig_worker_name)
    email = worker.email

    if not email:
        frappe.throw(
            f"No email address found for Gig Worker {gig_worker_name}.",
            title="Missing Worker Email",
        )

    return email


def _build_otp_record(otp_code, confirmed_at, email):
    return {
        "otp_code": otp_code,
        "sent_at": confirmed_at,
        "confirmed_at": confirmed_at,
        "confirm_status": "Confirmed",
        "email_sent_to": email,
    }


# ------------------------------------------------------------
# Email Sender
# ------------------------------------------------------------

def send_confirmation_email(transaction_name, email, otp_code, confirmed_at):

    subject = "Gig Transaction Confirmed — Reference OTP"

    message = f"""
    <p>Dear Gig Worker,</p>

    <p>Your gig transaction <strong>{transaction_name}</strong> has been confirmed.</p>

    <table style="border-collapse:collapse; margin-top:12px;">
      <tr>
        <td><b>Reference OTP</b></td>
        <td>{otp_code}</td>
      </tr>
      <tr>
        <td><b>Confirmed At</b></td>
        <td>{confirmed_at}</td>
      </tr>
      <tr>
        <td><b>Transaction</b></td>
        <td>{transaction_name}</td>
      </tr>
    </table>

    <p>Please keep this OTP reference for your records.</p>

    <p>Thank you,<br>Gig Workers Team</p>
    """

    try:
        frappe.sendmail(
            recipients=[email],
            subject=subject,
            message=message,
            now=True,
        )

    except Exception as e:
        frappe.log_error(
            message=f"Email failed for {transaction_name} → {email}\n{e}",
            title="Gig Transaction Email Error",
        )


# ------------------------------------------------------------
# Document Class
# ------------------------------------------------------------

class GigTransaction(Document):

    # --------------------------------------------------------
    # MAIN VALIDATION
    # --------------------------------------------------------

    def validate(self):

        self.validate_base_payout()
        self.validate_transaction_date()
        self.prevent_duplicate_transaction()
        self.calculate_welfare_fee()

    # --------------------------------------------------------
    # Base payout validation
    # --------------------------------------------------------

    def validate_base_payout(self):

        if not self.base_payout or self.base_payout <= 0:
            frappe.throw("Base payout must be greater than zero.")

    # --------------------------------------------------------
    # Transaction date validation
    # --------------------------------------------------------

    def validate_transaction_date(self):

        if self.date and self.date > today():
            frappe.throw("Transaction date cannot be in the future.")

    # --------------------------------------------------------
    # Prevent duplicate external transaction
    # --------------------------------------------------------

    def prevent_duplicate_transaction(self):

        if not self.external_transaction_id:
            return

        existing = frappe.db.exists(
            "Gig Transaction",
            {
                "external_transaction_id": self.external_transaction_id,
                "name": ["!=", self.name],
            },
        )

        if existing:
            frappe.throw(
                f"Duplicate transaction detected for External Transaction ID: {self.external_transaction_id}"
            )

    # --------------------------------------------------------
    # Welfare Fee Calculation
    # --------------------------------------------------------

    def calculate_welfare_fee(self):

        if not self.base_payout:
            return

        # default rate
        if not self.welfare_percentage:
            self.welfare_percentage = 1

        # fetch cap from Service
        if self.service:
            self.welfare_cap = frappe.db.get_value(
                "Service",
                self.service,
                "welfare_cap",
            )

        rate_amount = (self.base_payout * self.welfare_percentage) / 100

        if self.welfare_cap:
            self.welfare_amount = min(rate_amount, self.welfare_cap)
        else:
            self.welfare_amount = rate_amount

        if self.welfare_amount < 0:
            self.welfare_amount = 0

    # --------------------------------------------------------
    # TRUST LEVEL LOGIC
    # --------------------------------------------------------

    def before_save(self):

        if self.status == "Completed":
            return

        confirmed_at = now()

        if self.trust_level == "High":

            self.status = "Completed"
            self.confirmed_at = confirmed_at

        elif self.trust_level == "Low":

            email = _get_email(self.gig_worker)
            otp_code = _generate_otp()

            self.append(
                "otp_records",
                _build_otp_record(otp_code, confirmed_at, email),
            )

            self.status = "Completed"
            self.confirmed_at = confirmed_at

            frappe.enqueue(
                "gigworkers.gig_workers.doctype.gig_transaction.gig_transaction.send_confirmation_email",
                transaction_name=self.name,
                email=email,
                otp_code=otp_code,
                confirmed_at=confirmed_at,
                is_async=False,
            )


# ------------------------------------------------------------
# Manual Confirm API
# ------------------------------------------------------------

@frappe.whitelist()
def confirm_transaction(transaction_name):

    doc = frappe.get_doc("Gig Transaction", transaction_name)

    if doc.trust_level != "Low":
        frappe.throw("Only Low Trust transactions use this flow.")

    if doc.status == "Completed":
        frappe.throw("This transaction is already confirmed.")

    email = _get_email(doc.gig_worker)

    otp_code = _generate_otp()
    confirmed_at = now()

    doc.append(
        "otp_records",
        _build_otp_record(otp_code, confirmed_at, email),
    )

    doc.status = "Completed"
    doc.confirmed_at = confirmed_at
    doc.save(ignore_permissions=True)

    send_confirmation_email(transaction_name, email, otp_code, confirmed_at)

    return {
        "message": "Transaction confirmed successfully",
        "email": email,
        "otp_reference": otp_code,
    }