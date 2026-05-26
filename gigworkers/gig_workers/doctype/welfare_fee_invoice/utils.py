# Copyright (c) 2026, Jenifar and contributors
# For license information, please see license.txt

"""
Utility functions for Welfare Fee Invoice scheduled tasks
"""

import frappe
from frappe.utils import today, getdate, add_days


def check_overdue_invoices():
	"""
	Scheduled task to check for overdue invoices and send reminders.
	Runs daily.
	"""
	today_date = getdate(today())

	# Get all overdue invoices
	overdue_invoices = frappe.get_all(
		"Welfare Fee Invoice",
		filters={
			"invoice_status": ["in", ["Pending", "Partially Paid"]],
			"due_date": ["<", today_date]
		},
		fields=["name", "aggregator", "aggregator_name", "email", "total_due_amount",
		        "amount_paid", "balance_due", "due_date", "quarter", "year"]
	)

	for invoice in overdue_invoices:
		# Update status to Overdue
		frappe.db.set_value("Welfare Fee Invoice", invoice.name, "invoice_status", "Overdue")

		# Send reminder email (only if not sent in last 7 days)
		last_reminder = frappe.db.get_value(
			"Communication",
			{
				"reference_doctype": "Welfare Fee Invoice",
				"reference_name": invoice.name,
				"subject": ["like", "%Overdue%"]
			},
			"creation",
			order_by="creation desc"
		)

		# Send reminder if no reminder sent in last 7 days
		if not last_reminder or getdate(last_reminder) < add_days(today_date, -7):
			send_overdue_reminder(invoice)

	frappe.db.commit()

	return f"Checked {len(overdue_invoices)} overdue invoices"


def send_overdue_reminder(invoice):
	"""Send overdue payment reminder email to aggregator."""
	if not invoice.email:
		return

	days_overdue = frappe.utils.date_diff(today(), invoice.due_date)

	try:
		frappe.sendmail(
			recipients=[invoice.email],
			sender="nishanthclintona@gmail.com",
			subject=f"OVERDUE: Welfare Fee Payment - {invoice.name}",
			message=f"""
			<p>Dear {invoice.aggregator_name},</p>
			<p><b style="color:#dc3545;">PAYMENT OVERDUE NOTICE</b></p>
			<p>Your welfare fee invoice is now <b>{days_overdue} days overdue</b>. Immediate payment is requested.</p>
			<table style="border-collapse:collapse;margin-top:12px;border:2px solid #dc3545;">
			  <tr style="background:#f8d7da;">
			    <th style="padding:10px;text-align:left;border:1px solid #dc3545;">Invoice Details</th>
			    <th style="padding:10px;text-align:left;border:1px solid #dc3545;">Amount</th>
			  </tr>
			  <tr>
			    <td style="padding:8px;border:1px solid #ddd;"><b>Invoice Number</b></td>
			    <td style="padding:8px;border:1px solid #ddd;">{invoice.name}</td>
			  </tr>
			  <tr>
			    <td style="padding:8px;border:1px solid #ddd;"><b>Period</b></td>
			    <td style="padding:8px;border:1px solid #ddd;">{invoice.quarter} {invoice.year}</td>
			  </tr>
			  <tr style="background:#fff3cd;">
			    <td style="padding:8px;border:1px solid #ddd;"><b>Balance Due</b></td>
			    <td style="padding:8px;border:1px solid #ddd;"><b style="font-size:18px;color:#dc3545;">₹{invoice.balance_due:,.2f}</b></td>
			  </tr>
			  <tr>
			    <td style="padding:8px;border:1px solid #ddd;"><b>Original Due Date</b></td>
			    <td style="padding:8px;border:1px solid #ddd;">{invoice.due_date}</td>
			  </tr>
			  <tr style="background:#f8d7da;">
			    <td style="padding:8px;border:1px solid #ddd;"><b>Days Overdue</b></td>
			    <td style="padding:8px;border:1px solid #ddd;"><b>{days_overdue} days</b></td>
			  </tr>
			</table>
			<p><b>Action Required:</b></p>
			<p>Please arrange payment immediately to avoid any penalties or service disruptions.</p>
			<ol>
			  <li>Log in to the Gig Workers Portal</li>
			  <li>Navigate to Welfare Fee Invoices</li>
			  <li>Record your payment for invoice {invoice.name}</li>
			</ol>
			<p>If you have already made the payment, please contact us with payment details.</p>
			<p><b>Contact Support:</b> support@gigworkers.karnataka.gov.in</p>
			<p>Best regards,<br>Karnataka Gig Workers Welfare Board</p>
			""",
			reference_doctype="Welfare Fee Invoice",
			reference_name=invoice.name
		)
	except Exception as e:
		frappe.log_error(
			message=f"Overdue reminder email failed for {invoice.name}: {e}",
			title="Overdue Reminder Email Error",
		)
