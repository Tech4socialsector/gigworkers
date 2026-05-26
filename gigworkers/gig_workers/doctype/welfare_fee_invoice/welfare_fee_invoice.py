# Copyright (c) 2026, Jenifar and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import today, getdate, add_days, get_first_day, get_last_day, nowdate


class WelfareFeeInvoice(Document):

	def validate(self):
		"""Validate invoice data before save."""
		self.calculate_totals()
		self.update_status()

	def calculate_totals(self):
		"""Calculate total transactions, total due amount, and balance due."""
		self.total_transactions = len(self.welfare_fee_items or [])
		self.total_due_amount = sum(item.fee_amount or 0 for item in self.welfare_fee_items)

		# Calculate total amount paid from payment history
		self.amount_paid = sum(payment.amount or 0 for payment in (self.payment_history or []))

		# Calculate balance due
		self.balance_due = self.total_due_amount - self.amount_paid

	def update_status(self):
		"""Update invoice status based on payment and due date."""
		if not self.invoice_status or self.invoice_status == "Draft":
			return

		# Check if fully paid
		if self.balance_due <= 0:
			self.invoice_status = "Fully Paid"
		# Check if partially paid
		elif self.amount_paid > 0:
			self.invoice_status = "Partially Paid"
		# Check if overdue
		elif self.due_date and getdate(self.due_date) < getdate(today()):
			self.invoice_status = "Overdue"
		# Otherwise pending
		else:
			self.invoice_status = "Pending"

	def on_update(self):
		"""Handle status transitions and notifications."""
		previous = self.get_doc_before_save()
		if not previous:
			return

		# If just transitioned to Fully Paid, settle all linked welfare fee payments
		if self.invoice_status == "Fully Paid" and previous.invoice_status != "Fully Paid":
			self.settle_welfare_fee_payments()
			self.send_payment_confirmation_email()

	def settle_welfare_fee_payments(self):
		"""Mark all linked Welfare Fee Payments as Completed and credit each gig worker's Welfare Fund Account."""
		from gigworkers.gig_workers.doctype.welfare_fund_account.welfare_fund_account import WelfareFundAccount

		for item in self.welfare_fee_items:
			if not item.welfare_fee_payment:
				continue

			wfp = frappe.get_doc("Welfare Fee Payment", item.welfare_fee_payment)
			if wfp.payment_status == "Completed":
				continue

			wfp.payment_status = "Completed"
			wfp.payment_date = self.last_payment_date or today()
			wfp.mode_of_payment = self.payment_mode or "Online"
			wfp.bank_reference = self.payment_reference or ""
			wfp.save(ignore_permissions=True)

			# Credit the gig worker's Welfare Fund Account with the paid fee amount
			if item.gig_worker and item.fee_amount:
				wfa = WelfareFundAccount.get_or_create(item.gig_worker)
				wfa.credit(
					amount=item.fee_amount,
					reference_doctype="Welfare Fee Invoice",
					reference_name=self.name,
					remarks=f"Welfare fee from invoice {self.name} – {self.quarter} {self.year}",
					gig_transaction=item.transaction,
				)

			frappe.db.commit()

	def send_payment_confirmation_email(self):
		"""Send payment confirmation email to aggregator."""
		if not self.email:
			return

		try:
			frappe.sendmail(
				recipients=[self.email],
				sender="nishanthclintona@gmail.com",
				subject=f"Payment Confirmation - Welfare Fee Invoice {self.name}",
				message=f"""
				<p>Dear {self.aggregator_name},</p>
				<p>Your payment for the quarterly welfare fee invoice has been successfully processed.</p>
				<table style="border-collapse:collapse;margin-top:12px;border:1px solid #ddd;">
				  <tr style="background:#f8f9fa;">
				    <th style="padding:8px;text-align:left;border:1px solid #ddd;">Invoice Details</th>
				    <th style="padding:8px;text-align:left;border:1px solid #ddd;">Amount</th>
				  </tr>
				  <tr>
				    <td style="padding:8px;border:1px solid #ddd;"><b>Invoice Number</b></td>
				    <td style="padding:8px;border:1px solid #ddd;">{self.name}</td>
				  </tr>
				  <tr>
				    <td style="padding:8px;border:1px solid #ddd;"><b>Period</b></td>
				    <td style="padding:8px;border:1px solid #ddd;">{self.quarter} {self.year} ({self.from_date} to {self.to_date})</td>
				  </tr>
				  <tr>
				    <td style="padding:8px;border:1px solid #ddd;"><b>Total Due</b></td>
				    <td style="padding:8px;border:1px solid #ddd;">&#8377;{self.total_due_amount:,.2f}</td>
				  </tr>
				  <tr>
				    <td style="padding:8px;border:1px solid #ddd;"><b>Amount Paid</b></td>
				    <td style="padding:8px;border:1px solid #ddd;">&#8377;{self.amount_paid:,.2f}</td>
				  </tr>
				  <tr style="background:#d4edda;">
				    <td style="padding:8px;border:1px solid #ddd;"><b>Balance Due</b></td>
				    <td style="padding:8px;border:1px solid #ddd;"><b>&#8377;{self.balance_due:,.2f}</b></td>
				  </tr>
				</table>
				<p><b>Payment Details:</b></p>
				<ul>
				  <li>Payment Date: {self.last_payment_date}</li>
				  <li>Payment Mode: {self.payment_mode}</li>
				  <li>Reference Number: {self.payment_reference or 'N/A'}</li>
				  <li>Total Transactions: {self.total_transactions}</li>
				</ul>
				<p>All welfare fees have been settled to the respective workers' welfare fund accounts.</p>
				<p>Thank you for your timely payment.</p>
				<p>Best regards,<br>Karnataka Gig Workers Welfare Board</p>
				""",
			)
		except Exception as e:
			frappe.log_error(
				message=f"Payment confirmation email failed for invoice {self.name}: {e}",
				title="Welfare Fee Invoice Email Error",
			)


# ============================================================================
# PUBLIC API METHODS
# ============================================================================

@frappe.whitelist()
def fetch_pending_welfare_fees(aggregator, quarter, year, from_date, to_date):
	"""
	Fetch all pending welfare fee payments for an aggregator in a given quarter.
	This is called when user clicks "Fetch Pending Welfare Fees" button.

	Args:
		aggregator: Aggregator name
		quarter: Quarter (Q1/Q2/Q3/Q4)
		year: Year
		from_date: Start date of quarter
		to_date: End date of quarter

	Returns:
		dict: List of pending welfare fee items
	"""
	# Get all pending welfare fee payments for this aggregator in the date range
	welfare_fees = frappe.db.sql("""
		SELECT
			wfp.name as welfare_fee_payment,
			wfp.transaction,
			wfp.fee_amount,
			wfp.payment_date,
			wfp.payment_status,
			gt.date as transaction_date,
			gt.gig_worker
		FROM `tabWelfare Fee Payment` wfp
		LEFT JOIN `tabGig Transaction` gt ON wfp.transaction = gt.name
		WHERE wfp.aggregator = %s
		  AND wfp.payment_status = 'Pending'
		  AND wfp.payment_date >= %s
		  AND wfp.payment_date <= %s
		ORDER BY wfp.payment_date ASC
	""", (aggregator, from_date, to_date), as_dict=True)

	total_amount = sum(wf.fee_amount or 0 for wf in welfare_fees)

	return {
		"success": True,
		"count": len(welfare_fees),
		"total_amount": total_amount,
		"items": welfare_fees
	}


@frappe.whitelist()
def generate_quarterly_invoices(year=None, quarter=None):
	"""
	Generate quarterly welfare fee invoices for all aggregators.
	Can be called manually or via scheduled job.

	Args:
		year: Year (defaults to current year)
		quarter: Quarter Q1/Q2/Q3/Q4 (defaults to previous quarter)

	Returns:
		dict: Summary of invoices generated
	"""
	frappe.only_for("System Manager")

	if not year or not quarter:
		# Auto-detect previous quarter
		year, quarter = _get_previous_quarter()

	from_date, to_date = _get_quarter_dates(year, quarter)
	due_date = add_days(to_date, 30)  # Due 30 days after quarter end

	# Get all aggregators with pending welfare fee payments in this period
	aggregators = frappe.db.sql("""
		SELECT DISTINCT wfp.aggregator
		FROM `tabWelfare Fee Payment` wfp
		WHERE wfp.payment_status = 'Pending'
		  AND wfp.payment_date >= %s
		  AND wfp.payment_date <= %s
		ORDER BY wfp.aggregator
	""", (from_date, to_date), as_dict=True)

	invoices_created = []
	errors = []

	for agg_row in aggregators:
		try:
			invoice_name = _generate_invoice_for_aggregator(
				agg_row.aggregator, year, quarter, from_date, to_date, due_date
			)
			if invoice_name:
				invoices_created.append(invoice_name)
		except Exception as e:
			errors.append(f"Error for {agg_row.aggregator}: {str(e)}")
			frappe.log_error(
				message=f"Failed to generate invoice for {agg_row.aggregator}: {e}",
				title="Quarterly Invoice Generation Error"
			)

	return {
		"success": True,
		"invoices_created": len(invoices_created),
		"invoice_list": invoices_created,
		"errors": errors,
		"quarter": quarter,
		"year": year,
		"period": f"{from_date} to {to_date}"
	}


@frappe.whitelist()
def record_payment(invoice_name, amount_paid, payment_date, payment_mode, payment_reference=None, payment_time=None, remarks=None):
	"""
	Record a payment against a welfare fee invoice.

	Args:
		invoice_name: Name of the invoice
		amount_paid: Amount paid
		payment_date: Date of payment
		payment_mode: Mode of payment (NEFT/RTGS/UPI/etc)
		payment_reference: Bank reference number
		payment_time: Time of payment
		remarks: Any remarks

	Returns:
		dict: Updated invoice details
	"""
	invoice = frappe.get_doc("Welfare Fee Invoice", invoice_name)

	# Check permissions
	if not frappe.has_permission("Welfare Fee Invoice", "write", invoice):
		frappe.throw("You do not have permission to record payment for this invoice.", frappe.PermissionError)

	# Add payment to payment history
	invoice.append("payment_history", {
		"payment_date": payment_date,
		"payment_time": payment_time or nowdate(),
		"amount": float(amount_paid),
		"payment_mode": payment_mode,
		"payment_reference": payment_reference or "",
		"collected_by": frappe.session.user,
		"remarks": remarks or ""
	})

	invoice.save(ignore_permissions=True)

	return {
		"success": True,
		"invoice": invoice.name,
		"total_paid": invoice.amount_paid,
		"balance_due": invoice.balance_due,
		"status": invoice.invoice_status,
		"payment_count": len(invoice.payment_history or [])
	}


@frappe.whitelist()
def get_aggregator_invoice_summary(aggregator=None):
	"""
	Get quarterly invoice summary for an aggregator.

	Args:
		aggregator: Aggregator name (optional, defaults to current user's aggregator)

	Returns:
		dict: Invoice summary with current and past quarter details
	"""
	# Get aggregator from user if not specified
	if not aggregator:
		user = frappe.session.user
		if "System Manager" not in frappe.get_roles(user):
			aggregator = frappe.db.get_value("Aggregator", {"email": user}, "name")
			if not aggregator:
				frappe.throw("No Aggregator profile found for this user.")

	if not aggregator:
		frappe.throw("Aggregator is required.")

	# Get current quarter info
	current_year, current_quarter = _get_current_quarter()

	# Get all invoices for this aggregator
	invoices = frappe.get_all(
		"Welfare Fee Invoice",
		filters={"aggregator": aggregator},
		fields=["name", "year", "quarter", "total_due_amount", "amount_paid", "balance_due",
		        "invoice_status", "due_date", "from_date", "to_date"],
		order_by="year desc, quarter desc",
		limit=8  # Last 8 quarters (2 years)
	)

	# Calculate totals
	total_outstanding = sum(inv.balance_due for inv in invoices if inv.invoice_status not in ["Fully Paid"])
	total_paid_this_year = sum(inv.amount_paid for inv in invoices if inv.year == current_year)

	# Get current quarter invoice
	current_invoice = next(
		(inv for inv in invoices if inv.year == current_year and inv.quarter == current_quarter),
		None
	)

	# Get pending welfare fee amount for current quarter (not yet invoiced)
	from_date, to_date = _get_quarter_dates(current_year, current_quarter)
	pending_current_quarter = frappe.db.sql("""
		SELECT COALESCE(SUM(fee_amount), 0) as pending
		FROM `tabWelfare Fee Payment`
		WHERE aggregator = %s
		  AND payment_status = 'Pending'
		  AND payment_date >= %s
		  AND payment_date <= %s
	""", (aggregator, from_date, to_date), as_dict=True)[0].pending

	return {
		"aggregator": aggregator,
		"current_quarter": {
			"year": current_year,
			"quarter": current_quarter,
			"invoice": current_invoice,
			"pending_amount": pending_current_quarter
		},
		"invoices": invoices,
		"summary": {
			"total_outstanding": total_outstanding,
			"total_paid_this_year": total_paid_this_year,
			"invoice_count": len(invoices)
		}
	}


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def _generate_invoice_for_aggregator(aggregator, year, quarter, from_date, to_date, due_date):
	"""Generate a single invoice for an aggregator for a given quarter."""

	# Check if invoice already exists
	existing = frappe.db.exists("Welfare Fee Invoice", {
		"aggregator": aggregator,
		"year": year,
		"quarter": quarter
	})

	if existing:
		frappe.msgprint(f"Invoice already exists for {aggregator} - {quarter} {year}")
		return existing

	# Get all pending welfare fee payments for this period
	welfare_fees = frappe.get_all(
		"Welfare Fee Payment",
		filters={
			"aggregator": aggregator,
			"payment_status": "Pending",
			"payment_date": ["between", [from_date, to_date]]
		},
		fields=["name", "transaction", "fee_amount", "payment_date", "payment_status"],
		order_by="payment_date asc"
	)

	if not welfare_fees:
		return None  # No pending fees, skip

	# Create invoice
	invoice = frappe.get_doc({
		"doctype": "Welfare Fee Invoice",
		"aggregator": aggregator,
		"quarter": quarter,
		"year": year,
		"from_date": from_date,
		"to_date": to_date,
		"due_date": due_date,
		"invoice_status": "Pending",
		"amount_paid": 0
	})

	# Add items
	for wfp in welfare_fees:
		# Get transaction date and gig worker
		txn_data = frappe.db.get_value(
			"Gig Transaction",
			wfp.transaction,
			["date", "gig_worker"],
			as_dict=True
		)

		invoice.append("welfare_fee_items", {
			"welfare_fee_payment": wfp.name,
			"transaction": wfp.transaction,
			"transaction_date": txn_data.date if txn_data else None,
			"gig_worker": txn_data.gig_worker if txn_data else None,
			"fee_amount": wfp.fee_amount,
			"payment_status": wfp.payment_status
		})

	invoice.insert(ignore_permissions=True)

	# Send invoice notification email
	_send_invoice_notification(invoice)

	return invoice.name


def _send_invoice_notification(invoice):
	"""Send email notification to aggregator about new invoice."""
	if not invoice.email:
		return

	try:
		frappe.sendmail(
			recipients=[invoice.email],
			sender="nishanthclintona@gmail.com",
			subject=f"New Welfare Fee Invoice - {invoice.quarter} {invoice.year}",
			message=f"""
			<p>Dear {invoice.aggregator_name},</p>
			<p>Your quarterly welfare fee invoice has been generated.</p>
			<table style="border-collapse:collapse;margin-top:12px;border:1px solid #ddd;">
			  <tr style="background:#f8f9fa;">
			    <th style="padding:8px;text-align:left;border:1px solid #ddd;">Invoice Details</th>
			    <th style="padding:8px;text-align:left;border:1px solid #ddd;">Value</th>
			  </tr>
			  <tr>
			    <td style="padding:8px;border:1px solid #ddd;"><b>Invoice Number</b></td>
			    <td style="padding:8px;border:1px solid #ddd;">{invoice.name}</td>
			  </tr>
			  <tr>
			    <td style="padding:8px;border:1px solid #ddd;"><b>Period</b></td>
			    <td style="padding:8px;border:1px solid #ddd;">{invoice.quarter} {invoice.year} ({invoice.from_date} to {invoice.to_date})</td>
			  </tr>
			  <tr>
			    <td style="padding:8px;border:1px solid #ddd;"><b>Total Transactions</b></td>
			    <td style="padding:8px;border:1px solid #ddd;">{invoice.total_transactions}</td>
			  </tr>
			  <tr style="background:#fff3cd;">
			    <td style="padding:8px;border:1px solid #ddd;"><b>Total Amount Due</b></td>
			    <td style="padding:8px;border:1px solid #ddd;"><b>&#8377;{invoice.total_due_amount:,.2f}</b></td>
			  </tr>
			  <tr>
			    <td style="padding:8px;border:1px solid #ddd;"><b>Due Date</b></td>
			    <td style="padding:8px;border:1px solid #ddd;">{invoice.due_date}</td>
			  </tr>
			</table>
			<p>Please log in to the portal to view the detailed invoice and make payment.</p>
			<p><b>Payment Instructions:</b></p>
			<ol>
			  <li>Log in to the Gig Workers Portal</li>
			  <li>Navigate to Dashboard → Welfare Fee Invoices</li>
			  <li>Click on invoice {invoice.name}</li>
			  <li>Record your payment with transaction details</li>
			</ol>
			<p>For any queries, please contact us.</p>
			<p>Best regards,<br>Karnataka Gig Workers Welfare Board</p>
			""",
		)
	except Exception as e:
		frappe.log_error(
			message=f"Invoice notification email failed for {invoice.name}: {e}",
			title="Invoice Notification Email Error",
		)


def _get_current_quarter():
	"""Get current year and quarter."""
	from datetime import datetime
	now = datetime.now()
	year = now.year
	month = now.month

	if month <= 3:
		quarter = "Q4"
		year = year - 1  # Q4 of previous year
	elif month <= 6:
		quarter = "Q1"
	elif month <= 9:
		quarter = "Q2"
	else:
		quarter = "Q3"

	return year, quarter


def _get_previous_quarter():
	"""Get previous quarter's year and quarter."""
	year, quarter = _get_current_quarter()

	quarter_map = {"Q1": ("Q4", year - 1), "Q2": ("Q1", year), "Q3": ("Q2", year), "Q4": ("Q3", year)}
	return quarter_map[quarter]


def _get_quarter_dates(year, quarter):
	"""Get start and end dates for a quarter."""
	quarter_dates = {
		"Q1": (f"{year}-04-01", f"{year}-06-30"),
		"Q2": (f"{year}-07-01", f"{year}-09-30"),
		"Q3": (f"{year}-10-01", f"{year}-12-31"),
		"Q4": (f"{year}-01-01", f"{year}-03-31")
	}

	if quarter == "Q4":
		# Q4 is Jan-Mar of next year
		year = year + 1
		return (f"{year}-01-01", f"{year}-03-31")

	return quarter_dates.get(quarter, (f"{year}-01-01", f"{year}-03-31"))
