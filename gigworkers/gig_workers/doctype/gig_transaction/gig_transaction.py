# Copyright (c) 2026, Jenifar and contributors
# For license information, please see license.txt

import hashlib
import random
import frappe
from frappe.model.document import Document
from frappe.utils import now, today, getdate, now_datetime, add_to_date, get_datetime

# ── Status transition rules ────────────────────────────────────────────────────
_ALLOWED_TRANSITIONS = {
    "Payment pending":     {"Payment complete", "Payment Cancelled", "Suspected duplicate"},
    "Payment complete":    {"Suspected duplicate", "Payment Cancelled"},
    "Payment Cancelled":   set(),
    "Suspected duplicate": {"Duplicate", "Payment Cancelled", "Payment complete", "Payment pending"},
    "Duplicate":           set(),
    "":                    {"Payment pending", "Payment complete", "Suspected duplicate", "Payment Cancelled"},
}

OTP_EXPIRY_MINUTES = 30
OTP_MAX_ATTEMPTS   = 5


# ── OTP helpers ───────────────────────────────────────────────────────────────

def _generate_otp():
    """Return (plaintext_otp, sha256_hash)."""
    otp = str(random.randint(100000, 999999))
    return otp, hashlib.sha256(otp.encode()).hexdigest()


def _hash_otp(otp_plain):
    return hashlib.sha256(otp_plain.strip().encode()).hexdigest()


def _get_email(gig_worker_name):
    worker = frappe.get_doc("Gig Worker", gig_worker_name)
    if not worker.email:
        frappe.throw(
            f"No email address found for Gig Worker {gig_worker_name}.",
            title="Missing Worker Email",
        )
    return worker.email


def _build_otp_record(otp_hash, sent_at, email):
    return {
        "otp_code":        otp_hash,
        "sent_at":         sent_at,
        "expires_at":      add_to_date(sent_at, minutes=OTP_EXPIRY_MINUTES),
        "failed_attempts": 0,
        "confirm_status":  "OTP Sent",
        "email_sent_to":   email,
    }


# ── Welfare helpers ────────────────────────────────────────────────────────────

def _get_welfare_rate():
    try:
        records = frappe.get_all(
            "Welfare Fee Formula",
            fields=["welfare_percentage"],
            order_by="modified desc",
            limit=1,
        )
        rate = float(records[0].welfare_percentage) if records else 0.0
        return rate if rate > 0 else 1.0
    except Exception:
        return 1.0


def _create_welfare_fee_payment(transaction):
    if not transaction.welfare_amount:
        return
    payment = frappe.get_doc({
        "doctype":           "Welfare Fee Payment",
        "transaction":       transaction.name,
        "aggregator":        transaction.aggregator,
        "fee_amount":        transaction.welfare_amount,
        "payment_date":      today(),
        "payment_status":    "Pending",
        "settlement_status": "Initiated",
    })
    payment.insert(ignore_permissions=True)


# ── Email sender ───────────────────────────────────────────────────────────────

def send_confirmation_email(transaction_name, email, otp_code, confirmed_at):
    import urllib.parse
    base_url    = frappe.utils.get_url()
    encoded_tx  = urllib.parse.quote(transaction_name)
    magic_link  = (
        f"{base_url}/api/method/gigworkers.gig_workers.doctype.gig_transaction"
        f".gig_transaction.serve_confirmation_page?transaction_name={encoded_tx}"
    )
    resend_link = (
        f"{base_url}/api/method/gigworkers.gig_workers.doctype.gig_transaction"
        f".gig_transaction.resend_otp?transaction_name={encoded_tx}"
    )

    subject = "Action Required: Confirm your Gig Transaction"
    message = f"""
    <p>Dear Gig Worker,</p>
    <p>Your gig transaction <strong>{transaction_name}</strong> is pending confirmation.</p>
    <p>Use the OTP below. <b>This OTP expires in {OTP_EXPIRY_MINUTES} minutes.</b></p>
    <table style="border-collapse:collapse;margin-top:12px;">
      <tr><td><b>Reference OTP</b></td><td>{otp_code}</td></tr>
      <tr><td><b>Transaction</b></td><td>{transaction_name}</td></tr>
    </table>
    <div style="margin:30px 0;">
        <a href="{magic_link}" style="display:inline-block;background:#4CAF50;color:white;
           padding:12px 24px;text-decoration:none;border-radius:5px;font-weight:bold;">
            Confirm Transaction
        </a>
    </div>
    <p>OTP expired? <a href="{resend_link}">Request a new OTP</a></p>
    <p>If the button doesn't work: <a href="{magic_link}">{magic_link}</a></p>
    <p>Thank you,<br>Gig Workers Team</p>
    """
    try:
        frappe.sendmail(recipients=[email], subject=subject, message=message)
    except Exception as e:
        frappe.log_error(
            message=f"Email failed for {transaction_name} -> {email}\n{e}",
            title="Gig Transaction Email Error",
        )


# ── Duplicate notification ─────────────────────────────────────────────────────

def _notify_admin_duplicate(new_txn, existing_txn):
    """Create ToDo for each System Manager and send email alert."""
    admins = frappe.get_all(
        "Has Role",
        filters={"role": "System Manager", "parenttype": "User"},
        fields=["parent"],
    )
    base_url = frappe.utils.get_url()
    for admin in admins:
        if admin.parent in ("Guest", "Administrator"):
            continue
        try:
            frappe.get_doc({
                "doctype":        "ToDo",
                "owner":          admin.parent,
                "assigned_by":    "Administrator",
                "description": (
                    f"Suspected duplicate transaction detected.\n"
                    f"New: {new_txn}\nMatches: {existing_txn}\n"
                    f"Review and mark as Duplicate if confirmed."
                ),
                "reference_type": "Gig Transaction",
                "reference_name": new_txn,
                "priority":       "High",
                "date":           today(),
            }).insert(ignore_permissions=True)
        except Exception:
            frappe.log_error(frappe.get_traceback(), "Duplicate ToDo Creation Error")

    try:
        admin_emails = [a.parent for a in admins if "@" in (a.parent or "")]
        if admin_emails:
            frappe.sendmail(
                recipients=admin_emails,
                subject=f"[Action Required] Suspected Duplicate Transaction: {new_txn}",
                message=f"""
                <p>A suspected duplicate transaction has been detected.</p>
                <table style="border-collapse:collapse;margin:12px 0;">
                  <tr><td style="padding:4px 12px 4px 0"><b>New Transaction</b></td>
                      <td>{new_txn}</td></tr>
                  <tr><td style="padding:4px 12px 4px 0"><b>Matches Existing</b></td>
                      <td>{existing_txn}</td></tr>
                </table>
                <p>Please review and confirm or dismiss.</p>
                <a href="{base_url}/app/gig-transaction/{new_txn}"
                   style="display:inline-block;background:#e53935;color:#fff;
                          padding:10px 20px;border-radius:5px;text-decoration:none;font-weight:bold;">
                   Review Transaction
                </a>
                """,
            )
    except Exception as e:
        frappe.log_error(str(e), "Duplicate Notification Email Error")


# ── Document class ─────────────────────────────────────────────────────────────

class GigTransaction(Document):

    def before_insert(self):
        if not self.aggregator:
            aggregator = frappe.db.get_value(
                "Aggregator", {"email": frappe.session.user}, "name"
            )
            if aggregator:
                self.aggregator = aggregator

    def after_insert(self):
        self.db_set("transaction_id", self.name)
        self._check_duplicate_on_insert()

    def _check_duplicate_on_insert(self):
        """Detect duplicate by duplicate_key, flag both transactions, notify admin."""
        if not self.duplicate_key:
            return
        existing = frappe.db.get_value(
            "Gig Transaction",
            {
                "duplicate_key": self.duplicate_key,
                "name": ["!=", self.name],
                "status": ["not in", ["Payment Cancelled", "Duplicate"]],
            },
            "name",
        )
        if not existing:
            return

        # Flag the new transaction
        frappe.db.set_value("Gig Transaction", self.name, {
            "suspected_duplicate": 1,
            "status": "Suspected duplicate",
            "duplicate_of": existing,
        })

        # Flag the existing transaction if not already flagged
        existing_status = frappe.db.get_value("Gig Transaction", existing, "status")
        if existing_status not in ("Suspected duplicate", "Duplicate"):
            frappe.db.set_value("Gig Transaction", existing, {
                "suspected_duplicate": 1,
                "status": "Suspected duplicate",
            })
        else:
            frappe.db.set_value("Gig Transaction", existing, "suspected_duplicate", 1)

        _notify_admin_duplicate(self.name, existing)

    def validate(self):
        self.validate_status_transition()
        self.validate_base_payout()
        self.validate_transaction_date()
        self.prevent_duplicate_transaction()
        self.calculate_welfare_fee()
        self.calculate_net_payout()
        self.set_duplicate_key()

    def validate_status_transition(self):
        """Prevent illegal backward / unauthorized status changes."""
        previous = self.get_doc_before_save()
        if not previous:
            return
        prev_status = previous.status or ""
        new_status  = self.status
        if prev_status == new_status:
            return
        allowed = _ALLOWED_TRANSITIONS.get(prev_status, set())
        if new_status not in allowed:
            frappe.throw(
                f"Status cannot be changed from <b>{prev_status}</b> to <b>{new_status}</b>.",
                title="Invalid Status Transition",
            )

    def set_duplicate_key(self):
        self.duplicate_key = (
            f"{self.get('gig_worker') or ''} | "
            f"{self.get('aggregator') or ''} | "
            f"{self.get('service_category') or self.get('service') or ''} | "
            f"{self.get('date') or ''} | "
            f"{self.get('amount') or 0}"
        )

    def validate_base_payout(self):
        if not self.base_payout or self.base_payout <= 0:
            frappe.throw("Base payout must be greater than zero.")

    def validate_transaction_date(self):
        if self.date and getdate(self.date) > getdate(today()):
            frappe.throw("Date cannot be in the future. Please select today or a past date.")
        if self.transaction_date and getdate(self.transaction_date) > getdate(today()):
            frappe.throw("Transaction Date cannot be in the future.")

    def prevent_duplicate_transaction(self):
        if not self.external_transaction_id:
            return
        existing = frappe.db.exists(
            "Gig Transaction",
            {"external_transaction_id": self.external_transaction_id, "name": ["!=", self.name]},
        )
        if existing:
            frappe.throw(
                f"Duplicate transaction for External Transaction ID: {self.external_transaction_id}"
            )

    def calculate_welfare_fee(self):
        if not self.base_payout or not self.service:
            return
        service_data = frappe.db.get_value(
            "Service", self.service,
            ["category", "vehicle_type", "welfare_percentage_", "welfare_cap"],
            as_dict=True,
        )
        if not service_data:
            return
        if service_data.category:
            self.service_category = (
                frappe.db.get_value("Service Category", service_data.category, "category_name")
                or service_data.category
            )
        if service_data.vehicle_type:
            self.service_type = (
                frappe.db.get_value("Vehicle Type", service_data.vehicle_type, "vehicle_type")
                or service_data.vehicle_type
            )
        self.welfare_percentage = service_data.welfare_percentage_ or 0
        self.welfare_cap        = service_data.welfare_cap
        if not self.welfare_percentage:
            return
        rate_amount = (self.base_payout * self.welfare_percentage) / 100
        self.welfare_amount = (
            min(rate_amount, self.welfare_cap) if self.welfare_cap else rate_amount
        )
        if self.welfare_amount < 0:
            self.welfare_amount = 0

    def calculate_net_payout(self):
        base    = self.base_payout or 0
        inc     = self.incentives or 0
        ded     = self.deduction or 0
        self.net_payout_to_worker = base + inc - ded

    def before_save(self):
        if self.flags.get("is_adjustment"):
            return

        previous    = self.get_doc_before_save()
        prev_status = previous.status if previous else None

        if self.status not in ("Payment complete", "Suspected duplicate", "Payment Cancelled"):
            confirmed_at = now()

            if self.trust_level == "High":
                self.status       = "Payment complete"
                self.confirmed_at = confirmed_at

            elif self.trust_level == "Low":
                email         = _get_email(self.gig_worker)
                otp, otp_hash = _generate_otp()

                self.append("otp_records", _build_otp_record(otp_hash, confirmed_at, email))
                self.status       = "Payment complete"
                self.confirmed_at = confirmed_at

                frappe.enqueue(
                    "gigworkers.gig_workers.doctype.gig_transaction"
                    ".gig_transaction.send_confirmation_email",
                    transaction_name=self.name,
                    email=email,
                    otp_code=otp,
                    confirmed_at=confirmed_at,
                    is_async=True,
                )

        if self.status == "Payment complete" and prev_status != "Payment complete":
            self.flags.create_welfare_payment = True

    def on_update(self):
        if self.flags.get("create_welfare_payment"):
            _create_welfare_fee_payment(self)


# ── Public API: register transaction ──────────────────────────────────────────

@frappe.whitelist()
def register_gig_transaction(
    gig_worker_id,
    aggregator_id,
    service_id,
    amount,
    base_payout,
    role=None,
    date=None,
    incentives=0,
    trust_level="High",
    external_transaction_id=None,
):
    if frappe.session.user != "Administrator":
        caller_agg = frappe.db.get_value("Aggregator", {"email": frappe.session.user}, "name")
        if caller_agg != aggregator_id:
            frappe.throw(
                "Unauthorized: You may only register transactions for your own aggregator.",
                frappe.PermissionError,
            )

    gw_status = frappe.db.get_value("Gig Worker", gig_worker_id, "status")
    if gw_status != "Active":
        frappe.throw(f"Gig Worker '{gig_worker_id}' is not active.")

    mapping = frappe.db.exists(
        "Worker Service Mapping",
        {"gig_worker": gig_worker_id, "aggregator": aggregator_id,
         "service": service_id, "status": "Onboarded"},
    )
    if not mapping:
        frappe.throw(
            f"Gig Worker '{gig_worker_id}' is not onboarded with aggregator "
            f"'{aggregator_id}' for service '{service_id}'."
        )

    doc = frappe.get_doc({
        "doctype":                "Gig Transaction",
        "gig_worker":             gig_worker_id,
        "aggregator":             aggregator_id,
        "service":                service_id,
        "amount":                 float(amount),
        "base_payout":            float(base_payout),
        "incentives":             float(incentives) if incentives else 0,
        "role":                   role,
        "date":                   date or today(),
        "trust_level":            trust_level,
        "external_transaction_id":external_transaction_id,
        "status":                 "Payment pending",
    })
    doc.insert(ignore_permissions=True)

    from gigworkers.gig_workers.doctype.worker_mapping_log.worker_mapping_log import create_mapping_log
    create_mapping_log(
        gig_worker=gig_worker_id,
        event_type="Transaction Registered",
        aggregator=aggregator_id,
        service=service_id,
        worker_status="Active",
        reference_doctype="Gig Transaction",
        reference_name=doc.name,
        remarks=f"Transaction Rs.{amount} registered for service {service_id}",
    )

    return {
        "transaction_id":     doc.name,
        "welfare_amount":     doc.welfare_amount,
        "welfare_percentage": doc.welfare_percentage,
        "status":             doc.status,
        "message":            "Gig transaction registered successfully.",
    }


# ── Resend OTP (guest-accessible via magic link page) ─────────────────────────

@frappe.whitelist(allow_guest=True)
def resend_otp(transaction_name):
    doc = frappe.get_doc("Gig Transaction", transaction_name)

    if doc.trust_level != "Low":
        frappe.throw("OTP is only used for Low Trust transactions.")

    email = _get_email(doc.gig_worker)

    # Expire all currently active OTP rows
    for row in doc.otp_records:
        if row.confirm_status == "OTP Sent":
            row.confirm_status = "Expired"

    otp, otp_hash = _generate_otp()
    sent_at = now()
    doc.append("otp_records", _build_otp_record(otp_hash, sent_at, email))
    doc.save(ignore_permissions=True)

    frappe.enqueue(
        "gigworkers.gig_workers.doctype.gig_transaction.gig_transaction.send_confirmation_email",
        transaction_name=doc.name,
        email=email,
        otp_code=otp,
        confirmed_at=sent_at,
        is_async=True,
    )

    return {"message": "A new OTP has been sent to your registered email."}


# ── Manual confirm / resend (admin / aggregator) ───────────────────────────────

@frappe.whitelist()
def confirm_transaction(transaction_name):
    doc = frappe.get_doc("Gig Transaction", transaction_name)

    if doc.trust_level != "Low":
        frappe.throw("Only Low Trust transactions use this flow.")
    if doc.status == "Payment complete":
        frappe.throw("This transaction is already confirmed.")

    email = _get_email(doc.gig_worker)

    for row in doc.otp_records:
        if row.confirm_status == "OTP Sent":
            row.confirm_status = "Expired"

    otp, otp_hash = _generate_otp()
    sent_at = now()
    doc.append("otp_records", _build_otp_record(otp_hash, sent_at, email))
    doc.save(ignore_permissions=True)

    frappe.enqueue(
        "gigworkers.gig_workers.doctype.gig_transaction.gig_transaction.send_confirmation_email",
        transaction_name=doc.name,
        email=email,
        otp_code=otp,
        confirmed_at=sent_at,
        is_async=True,
    )

    return {"message": "OTP sent successfully"}


# ── Verify OTP ─────────────────────────────────────────────────────────────────

@frappe.whitelist(allow_guest=True)
def verify_otp(transaction_name, otp):
    doc      = frappe.get_doc("Gig Transaction", transaction_name)
    otp_hash = _hash_otp(otp)

    active_row = None
    for row in doc.otp_records:
        if row.confirm_status == "OTP Sent":
            active_row = row
            break

    if not active_row:
        return {"success": False, "message": "No active OTP found. Please request a new OTP."}

    # Check lock
    if (active_row.failed_attempts or 0) >= OTP_MAX_ATTEMPTS:
        active_row.confirm_status = "Locked"
        doc.save(ignore_permissions=True)
        return {"success": False, "message": "Too many failed attempts. Please request a new OTP.", "locked": True}

    # Check expiry
    if active_row.expires_at and now_datetime() > get_datetime(active_row.expires_at):
        active_row.confirm_status = "Expired"
        doc.save(ignore_permissions=True)
        return {"success": False, "message": "OTP has expired. Please request a new OTP.", "expired": True}

    # Correct OTP
    if active_row.otp_code == otp_hash:
        active_row.confirm_status = "Confirmed"
        active_row.confirmed_at   = now()
        doc.status       = "Payment complete"
        doc.confirmed_at = active_row.confirmed_at
        doc.save(ignore_permissions=True)
        return {"success": True, "message": "OTP verified. Transaction confirmed."}

    # Wrong OTP — increment failed attempts
    active_row.failed_attempts = (active_row.failed_attempts or 0) + 1
    remaining = OTP_MAX_ATTEMPTS - active_row.failed_attempts
    if remaining <= 0:
        active_row.confirm_status = "Locked"
        doc.save(ignore_permissions=True)
        return {"success": False, "message": "Too many failed attempts. Please request a new OTP.", "locked": True}

    doc.save(ignore_permissions=True)
    return {"success": False, "message": f"Invalid OTP. {remaining} attempt(s) remaining."}


# ── Admin: mark suspected duplicates ──────────────────────────────────────────

@frappe.whitelist()
def mark_as_suspected_duplicate(transaction_name):
    frappe.only_for("System Manager")
    doc = frappe.get_doc("Gig Transaction", transaction_name)
    doc.status = "Suspected duplicate"
    doc.save(ignore_permissions=True)
    return {"message": f"{transaction_name} marked as Suspected Duplicate."}


@frappe.whitelist()
def mark_multiple_as_suspected_duplicate(transaction_names):
    frappe.only_for("System Manager")
    import json
    names = json.loads(transaction_names) if isinstance(transaction_names, str) else transaction_names
    if len(names) > 1000:
        frappe.throw("Cannot bulk-mark more than 1000 transactions at once.")
    updated = 0
    for name in names:
        try:
            doc = frappe.get_doc("Gig Transaction", name)
            if doc.status not in ("Payment Cancelled",):
                doc.status = "Suspected duplicate"
                doc.save(ignore_permissions=True)
                updated += 1
        except Exception:
            frappe.log_error(frappe.get_traceback(), f"Failed to mark {name} as Suspected Duplicate")
    return {"message": f"{updated} transaction(s) marked as Suspected Duplicate."}


@frappe.whitelist()
def mark_as_duplicate(transaction_name, duplicate_of=None):
    """Admin confirms a suspected duplicate. Reverses welfare credit if Completed."""
    frappe.only_for("System Manager")
    doc = frappe.get_doc("Gig Transaction", transaction_name)

    if doc.status == "Duplicate":
        frappe.throw("Transaction is already marked as Duplicate.")
    if doc.status == "Payment Cancelled":
        frappe.throw("Cannot mark a Cancelled transaction as Duplicate.")

    was_completed = doc.status == "Payment complete"

    doc.status = "Duplicate"
    if duplicate_of:
        doc.duplicate_of = duplicate_of
    doc.suspected_duplicate = 1
    doc.save(ignore_permissions=True)

    # Reverse welfare fund credit if transaction was already Completed
    if was_completed and doc.welfare_amount:
        wfp_name = frappe.db.get_value(
            "Welfare Fee Payment", {"transaction": transaction_name}, "name"
        )
        if wfp_name:
            wfp_doc = frappe.get_doc("Welfare Fee Payment", wfp_name)
            if wfp_doc.payment_status == "Completed":
                # Debit back from welfare fund
                acc_name = frappe.db.get_value(
                    "Welfare Fund Account", {"gig_worker": doc.gig_worker}, "name"
                )
                if acc_name:
                    acc_doc = frappe.get_doc("Welfare Fund Account", acc_name)
                    acc_doc.debit(
                        doc.welfare_amount,
                        reference_doctype="Gig Transaction",
                        reference_name=transaction_name,
                        remarks=f"Reversal: transaction {transaction_name} marked as duplicate",
                    )
            frappe.db.set_value("Welfare Fee Payment", wfp_name, "payment_status", "Cancelled")

    return {"message": f"Transaction {transaction_name} marked as Duplicate."}


@frappe.whitelist()
def dismiss_suspected_duplicate(transaction_name):
    """Admin clears the suspected duplicate flag (transaction is legitimate)."""
    frappe.only_for("System Manager")
    doc = frappe.get_doc("Gig Transaction", transaction_name)
    if doc.status != "Suspected duplicate":
        frappe.throw("Transaction is not in Suspected Duplicate status.")
    # Restore to previous logical status based on whether it was completed
    doc.suspected_duplicate = 0
    doc.duplicate_of = None
    doc.status = "Payment complete" if doc.confirmed_at else "Payment pending"
    doc.save(ignore_permissions=True)
    return {"message": f"Suspected duplicate flag cleared for {transaction_name}."}


# ── Gig Adjustment Transaction ────────────────────────────────────────────────

def _ensure_gig_settings():
    """Insert default row into tabSingles if not present.
    Uses direct SQL to avoid DoesNotExistError from get_single_value on a brand-new install.
    """
    has_row = frappe.db.sql(
        "SELECT COUNT(*) FROM `tabSingles` WHERE `doctype` = 'Gig Transaction Settings'",
        as_list=True,
    )[0][0]
    if not has_row:
        frappe.db.sql(
            "INSERT INTO `tabSingles` (`doctype`, `field`, `value`) "
            "VALUES ('Gig Transaction Settings', 'max_adjustment_attempts', '3')"
        )
        frappe.db.commit()


def _get_max_adjustment_attempts():
    try:
        _ensure_gig_settings()
        val = frappe.db.get_single_value("Gig Transaction Settings", "max_adjustment_attempts")
        return int(val) if val else 3
    except Exception:
        return 3


@frappe.whitelist()
def get_max_adjustment_attempts_setting():
    """Return max_adjustment_attempts, auto-creating the settings row if missing."""
    _ensure_gig_settings()
    val = frappe.db.get_single_value("Gig Transaction Settings", "max_adjustment_attempts")
    return int(val) if val else 3


@frappe.whitelist()
def set_max_adjustment_attempts_setting(value):
    """Persist max_adjustment_attempts for System Managers."""
    frappe.only_for("System Manager")
    value = int(value)
    if value < 1:
        frappe.throw("Adjustment limit must be at least 1.")
    _ensure_gig_settings()
    frappe.db.sql(
        "UPDATE `tabSingles` SET `value` = %s "
        "WHERE `doctype` = 'Gig Transaction Settings' AND `field` = 'max_adjustment_attempts'",
        (str(value),),
    )
    frappe.db.commit()


@frappe.whitelist()
def get_adjustment_info(transaction_names):
    """Return which transactions can still be adjusted vs those that hit the limit."""
    import json
    names = json.loads(transaction_names) if isinstance(transaction_names, str) else transaction_names

    max_attempts = _get_max_adjustment_attempts()
    adjustable = []
    blocked = []

    for name in names:
        count = frappe.db.get_value("Gig Transaction", name, "adjustment_count") or 0
        if int(count) >= max_attempts:
            blocked.append(name)
        else:
            adjustable.append(name)

    return {"adjustable": adjustable, "blocked": blocked, "max_attempts": max_attempts}


def _build_log_entry(doc, adjustment_number):
    """Snapshot the current doc values before an adjustment is applied."""
    return {
        "adjustment_number":        adjustment_number,
        "adjusted_at":              now(),
        "adjusted_by":              frappe.session.user,
        "old_amount":               doc.amount or 0,
        "old_base_payout":          doc.base_payout or 0,
        "old_incentives":           doc.incentives or 0,
        "old_deduction":            doc.deduction or 0,
        "old_net_payout":           doc.net_payout_to_worker or 0,
        "old_date":                 str(doc.date) if doc.date else "",
        "old_external_transaction_id": doc.external_transaction_id or "",
        "old_status_of_order":      doc.status_of_order or "",
    }


@frappe.whitelist()
def apply_adjustment(transaction_name, amount=None, base_payout=None,
                     incentives=None, deduction=None, date=None,
                     external_transaction_id=None, status_of_order=None):
    """Apply a single adjustment to a Gig Transaction (max attempts enforced)."""
    doc = frappe.get_doc("Gig Transaction", transaction_name)

    if "System Manager" not in frappe.get_roles():
        caller_agg = frappe.db.get_value("Aggregator", {"email": frappe.session.user}, "name")
        if caller_agg != doc.aggregator:
            frappe.throw(
                "Unauthorized: You can only adjust your own transactions.",
                frappe.PermissionError,
            )

    max_attempts = _get_max_adjustment_attempts()
    current_count = int(doc.adjustment_count or 0)
    if current_count >= max_attempts:
        frappe.throw(
            f"This transaction has reached the maximum adjustment limit of {max_attempts}."
        )

    # Capture the before-state BEFORE making any changes
    doc.append("adjustment_log", _build_log_entry(doc, current_count + 1))

    if amount is not None:
        doc.amount = float(amount)
    if base_payout is not None:
        doc.base_payout = float(base_payout)
    if incentives is not None:
        doc.incentives = float(incentives)
    if deduction is not None:
        doc.deduction = float(deduction)
    if date is not None:
        doc.date = date
    if external_transaction_id is not None:
        doc.external_transaction_id = external_transaction_id
    if status_of_order is not None:
        doc.status_of_order = status_of_order

    doc.adjustment_count = current_count + 1
    doc.flags.is_adjustment = True
    doc.save(ignore_permissions=True)

    remaining = max_attempts - doc.adjustment_count
    return {
        "message": (
            f"Transaction adjusted successfully. "
            f"Adjustment {doc.adjustment_count} of {max_attempts} used "
            f"({remaining} remaining)."
        ),
        "adjustment_count": doc.adjustment_count,
        "remaining_attempts": remaining,
    }


@frappe.whitelist()
def apply_bulk_adjustment(transaction_names, data):
    """Apply the same field changes across multiple Gig Transactions."""
    import json
    names = json.loads(transaction_names) if isinstance(transaction_names, str) else transaction_names
    values = json.loads(data) if isinstance(data, str) else data

    max_attempts = _get_max_adjustment_attempts()
    allowed_fields = {"amount", "base_payout", "incentives", "deduction",
                      "date", "external_transaction_id", "status_of_order"}

    updated = 0
    skipped = 0

    for name in names:
        try:
            doc = frappe.get_doc("Gig Transaction", name)

            if "System Manager" not in frappe.get_roles():
                caller_agg = frappe.db.get_value("Aggregator", {"email": frappe.session.user}, "name")
                if caller_agg != doc.aggregator:
                    skipped += 1
                    continue

            current_count = int(doc.adjustment_count or 0)
            if current_count >= max_attempts:
                skipped += 1
                continue

            # Capture before-state for each transaction
            doc.append("adjustment_log", _build_log_entry(doc, current_count + 1))

            for field, value in values.items():
                if field not in allowed_fields:
                    continue
                if field in ("amount", "base_payout", "incentives", "deduction"):
                    setattr(doc, field, float(value))
                else:
                    setattr(doc, field, value)

            doc.adjustment_count = current_count + 1
            doc.flags.is_adjustment = True
            doc.save(ignore_permissions=True)
            updated += 1
        except Exception:
            frappe.log_error(frappe.get_traceback(), f"Bulk adjustment failed for {name}")
            skipped += 1

    msg = f"{updated} transaction(s) adjusted successfully."
    if skipped:
        msg += f" {skipped} skipped (limit reached or unauthorized)."

    return {"message": msg, "updated": updated, "skipped": skipped}


# ── Serve OTP confirmation web page ───────────────────────────────────────────

@frappe.whitelist(allow_guest=True)
def serve_confirmation_page(transaction_name):
    try:
        frappe.get_doc("Gig Transaction", transaction_name)
    except frappe.DoesNotExistError:
        frappe.respond_as_web_page(
            "Transaction Not Found",
            f"The transaction {transaction_name} could not be found.",
            indicator_color="red",
            http_status_code=404,
        )
        return

    csrf_token = frappe.sessions.get_csrf_token()
    import urllib.parse
    encoded_tx = urllib.parse.quote(transaction_name)

    html_content = f"""
    <div style="max-width:420px;margin:40px auto;padding:24px;font-family:sans-serif;
                border:1px solid #ddd;border-radius:10px;box-shadow:0 4px 12px rgba(0,0,0,0.1);">
        <h2 style="text-align:center;color:#333;">Confirm Transaction</h2>
        <p style="text-align:center;color:#666;font-size:14px;">
            Enter the 6-digit OTP sent to your email to confirm<br>
            <b>{transaction_name}</b>
        </p>
        <p style="text-align:center;font-size:12px;color:#e74a3b;">
            OTP expires in {OTP_EXPIRY_MINUTES} minutes.
        </p>

        <div id="alert-box" style="display:none;padding:10px;margin-bottom:15px;border-radius:4px;font-size:14px;"></div>

        <form id="otp-form" onsubmit="submitOTP(event)">
            <input type="hidden" id="transaction_name" value="{transaction_name}">
            <div style="margin-bottom:15px;">
                <label style="display:block;margin-bottom:5px;color:#444;font-weight:bold;">OTP Code</label>
                <input type="text" id="otp" name="otp" required pattern="[0-9]{{6}}" maxlength="6"
                       style="width:100%;padding:12px;border:1px solid #ccc;border-radius:6px;
                              font-size:20px;box-sizing:border-box;text-align:center;letter-spacing:6px;"
                       placeholder="------">
            </div>
            <button type="submit" id="submit-btn"
                style="width:100%;padding:12px;background:#4CAF50;color:white;
                       border:none;border-radius:6px;font-size:16px;font-weight:bold;cursor:pointer;">
                Confirm
            </button>
        </form>

        <div style="text-align:center;margin-top:16px;">
            <a href="javascript:void(0)" onclick="requestNewOtp()"
               style="font-size:13px;color:#4e73df;text-decoration:underline;cursor:pointer;">
                OTP expired or not received? Request a new OTP
            </a>
        </div>
        <div id="resend-msg" style="display:none;text-align:center;margin-top:10px;font-size:13px;color:#28a745;"></div>
    </div>

    <script>
    function showMessage(msg, isError) {{
        var box = document.getElementById('alert-box');
        box.style.display = 'block'; box.textContent = msg;
        box.style.backgroundColor = isError ? '#f8d7da' : '#d4edda';
        box.style.color            = isError ? '#721c24' : '#155724';
        box.style.border           = isError ? '1px solid #f5c6cb' : '1px solid #c3e6cb';
    }}

    function requestNewOtp() {{
        var div = document.getElementById('resend-msg');
        div.style.display = 'block'; div.style.color = '#28a745';
        div.textContent = 'Sending new OTP...';
        fetch('/api/method/gigworkers.gig_workers.doctype.gig_transaction.gig_transaction.resend_otp', {{
            method: 'POST',
            headers: {{'Content-Type':'application/json','X-Frappe-CSRF-Token':'{csrf_token}'}},
            body: JSON.stringify({{transaction_name: '{transaction_name}'}})
        }})
        .then(r => r.json())
        .then(d => {{
            div.textContent = (d.message && d.message.message) ? d.message.message : 'New OTP sent to your email.';
        }})
        .catch(() => {{ div.style.color='#e74a3b'; div.textContent='Failed to resend. Please try again.'; }});
    }}

    function submitOTP(e) {{
        e.preventDefault();
        var btn = document.getElementById('submit-btn');
        var otp = document.getElementById('otp').value;
        btn.disabled = true; btn.textContent = 'Verifying...'; btn.style.backgroundColor = '#888';

        fetch('/api/method/gigworkers.gig_workers.doctype.gig_transaction.gig_transaction.verify_otp', {{
            method: 'POST',
            headers: {{'Content-Type':'application/json','Accept':'application/json','X-Frappe-CSRF-Token':'{csrf_token}'}},
            body: JSON.stringify({{transaction_name: '{transaction_name}', otp: otp}})
        }})
        .then(r => r.json())
        .then(data => {{
            if (data.exc) {{
                showMessage('Verification failed. Please try again.', true);
                btn.disabled=false; btn.textContent='Confirm'; btn.style.backgroundColor='#4CAF50';
            }} else if (data.message) {{
                var msg = data.message;
                if (msg.success) {{
                    showMessage(msg.message + ' You may close this tab.', false);
                    document.getElementById('otp-form').style.display = 'none';
                }} else if (msg.locked || msg.expired) {{
                    showMessage(msg.message, true);
                    document.getElementById('otp-form').style.display = 'none';
                    var d = document.getElementById('resend-msg');
                    d.style.display='block'; d.textContent='Click above to request a new OTP.';
                }} else {{
                    showMessage(msg.message, true);
                    btn.disabled=false; btn.textContent='Confirm'; btn.style.backgroundColor='#4CAF50';
                }}
            }}
        }})
        .catch(() => {{
            showMessage('Network error. Please try again.', true);
            btn.disabled=false; btn.textContent='Confirm'; btn.style.backgroundColor='#4CAF50';
        }});
    }}
    </script>
    """

    frappe.respond_as_web_page("Confirm Gig Transaction", html_content, fullpage=True)
