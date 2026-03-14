# Copyright (c) 2026, Jenifar and contributors
# For license information, please see license.txt

import random
import frappe
from frappe.model.document import Document
from frappe.utils import now, today, getdate


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


def _build_otp_record(otp_code, sent_at, email):
    return {
        "otp_code": otp_code,
        "sent_at": sent_at,
        "confirm_status": "OTP Sent",
        "email_sent_to": email,
    }


# ------------------------------------------------------------
# Email Sender
# ------------------------------------------------------------

def send_confirmation_email(transaction_name, email, otp_code, confirmed_at):

    # Generate Magic Link to Web Form
    import urllib.parse
    base_url = frappe.utils.get_url()
    encoded_tx = urllib.parse.quote(transaction_name)
    magic_link = f"{base_url}/api/method/gigworkers.gig_workers.doctype.gig_transaction.gig_transaction.serve_confirmation_page?transaction_name={encoded_tx}"

    subject = "Action Required: Confirm your Gig Transaction"

    message = f"""
    <p>Dear Gig Worker,</p>

    <p>Your gig transaction <strong>{transaction_name}</strong> is pending confirmation.</p>

    <p>Please use the following OTP reference to confirm your transaction:</p>

    <table style="border-collapse:collapse; margin-top:12px;">
      <tr>
        <td><b>Reference OTP</b></td>
        <td>{otp_code}</td>
      </tr>
      <tr>
        <td><b>Transaction</b></td>
        <td>{transaction_name}</td>
      </tr>
    </table>

    <div style="margin: 30px 0;">
        <a href="{magic_link}" style="display: inline-block; background-color: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">
            Confirm Transaction
        </a>
    </div>

    <p>If the button above does not work, please use this link:<br>
    <a href="{magic_link}">{magic_link}</a></p>

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

    def before_insert(self):
        # Auto-set aggregator when created by an Aggregator user
        if not self.aggregator:
            aggregator = frappe.db.get_value(
                "Aggregator", {"email": frappe.session.user}, "name"
            )
            if aggregator:
                self.aggregator = aggregator

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

        if self.date and getdate(self.date) > getdate(today()):
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
    sent_at = now()

    doc.append(
        "otp_records",
        _build_otp_record(otp_code, sent_at, email),
    )

    doc.save(ignore_permissions=True)

    frappe.enqueue(
        "gigworkers.gig_workers.doctype.gig_transaction.gig_transaction.send_confirmation_email",
        transaction_name=doc.name,
        email=email,
        otp_code=otp_code,
        confirmed_at=sent_at,
        is_async=False,
    )

    return {
        "message": "OTP sent successfully",
        "otp_reference": otp_code,
    }


# ------------------------------------------------------------
# Verify OTP
# ------------------------------------------------------------
@frappe.whitelist(allow_guest=True)
def verify_otp(transaction_name, otp):

    doc = frappe.get_doc("Gig Transaction", transaction_name)

    for row in doc.otp_records:

        if row.otp_code == otp and row.confirm_status == "OTP Sent":

            row.confirm_status = "Confirmed"
            row.confirmed_at = now()

            doc.status = "Completed"
            doc.confirmed_at = row.confirmed_at

            doc.save(ignore_permissions=True)

            return {
                "success": True,
                "message": "OTP verified. Transaction confirmed."
            }

    return {
        "success": False,
        "message": "Invalid OTP entered. Please try again."
    }


# ------------------------------------------------------------
# Serve Confirmation Web Page
# ------------------------------------------------------------
@frappe.whitelist(allow_guest=True)
def serve_confirmation_page(transaction_name):

    try:
        frappe.get_doc("Gig Transaction", transaction_name)
    except frappe.DoesNotExistError:
        frappe.respond_as_web_page(
            "Transaction Not Found",
            f"The transaction {transaction_name} could not be found.",
            indicator_color="red",
            http_status_code=404
        )
        return

    csrf_token = frappe.sessions.get_csrf_token()

    html_content = f"""
    <div style="max-width: 400px; margin: 40px auto; padding: 20px; font-family: sans-serif; border: 1px solid #ddd; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
        <h2 style="text-align: center; color: #333;">Confirm Transaction</h2>
        <p style="text-align: center; color: #666; font-size: 14px;">Enter the 6-digit OTP sent to your email to confirm transaction <b>{transaction_name}</b>.</p>
        
        <div id="alert-box" style="display: none; padding: 10px; margin-bottom: 15px; border-radius: 4px; font-size: 14px;"></div>

        <form id="otp-form" onsubmit="submitOTP(event)">
            <input type="hidden" id="transaction_name" value="{transaction_name}">
            
            <div style="margin-bottom: 15px;">
                <label for="otp" style="display: block; margin-bottom: 5px; color: #444; font-weight: bold;">OTP Code</label>
                <input type="text" id="otp" name="otp" required pattern="[0-9]{{6}}" maxlength="6" 
                       style="width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 16px; box-sizing: border-box; text-align: center; letter-spacing: 2px;" 
                       placeholder="XXXXXX">
            </div>

            <button type="submit" id="submit-btn" style="width: 100%; padding: 10px; background-color: #4CAF50; color: white; border: none; border-radius: 4px; font-size: 16px; font-weight: bold; cursor: pointer;">
                Confirm
            </button>
        </form>
    </div>

    <script>
    function showMessage(msg, isError) {{
        var box = document.getElementById('alert-box');
        box.style.display = 'block';
        box.textContent = msg;
        if (isError) {{
            box.style.backgroundColor = '#f8d7da';
            box.style.color = '#721c24';
            box.style.border = '1px solid #f5c6cb';
        }} else {{
            box.style.backgroundColor = '#d4edda';
            box.style.color = '#155724';
            box.style.border = '1px solid #c3e6cb';
        }}
    }}

    function submitOTP(e) {{
        e.preventDefault();
        var btn = document.getElementById('submit-btn');
        var tx = document.getElementById('transaction_name').value;
        var otp = document.getElementById('otp').value;

        btn.disabled = true;
        btn.textContent = 'Verifying...';
        btn.style.backgroundColor = '#888';

        fetch('/api/method/gigworkers.gig_workers.doctype.gig_transaction.gig_transaction.verify_otp', {{
            method: 'POST',
            headers: {{
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-Frappe-CSRF-Token': '{csrf_token}'
            }},
            body: JSON.stringify({{
                transaction_name: tx,
                otp: otp
            }})
        }})
        .then(response => response.json())
        .then(data => {{
            if (data.exc) {{
                // Parse exception message
                var errorMsg = "Verification failed.";
                try {{
                    var excData = JSON.parse(data.exc);
                    if (excData.length > 0) {{
                        errorMsg = excData[0];
                    }}
                }} catch(e) {{
                     if (data._server_messages) {{
                        try {{
                            var msgs = JSON.parse(data._server_messages);
                            if (msgs.length > 0) {{
                                var msgObj = JSON.parse(msgs[0]);
                                errorMsg = msgObj.message || errorMsg;
                            }}
                        }} catch (e2) {{}}
                     }}
                }}
                showMessage(errorMsg, true);
                btn.disabled = false;
                btn.textContent = 'Confirm';
                btn.style.backgroundColor = '#4CAF50';
            }} else if (data.message) {{
                if (data.message.success) {{
                    showMessage(data.message.message + " You can close this tab.", false);
                    document.getElementById('otp-form').style.display = 'none';
                }} else {{
                    showMessage(data.message.message, true);
                    btn.disabled = false;
                    btn.textContent = 'Confirm';
                    btn.style.backgroundColor = '#4CAF50';
                }}
            }} else {{
                showMessage("An unknown error occurred.", true);
                btn.disabled = false;
                btn.textContent = 'Confirm';
                btn.style.backgroundColor = '#4CAF50';
            }}
        }})
        .catch(error => {{
            showMessage("Network error occurred.", true);
            btn.disabled = false;
            btn.textContent = 'Confirm';
            btn.style.backgroundColor = '#4CAF50';
        }});
    }}
    </script>
    """

    frappe.respond_as_web_page(
        "Confirm Gig Transaction",
        html_content,
        fullpage=True
    )