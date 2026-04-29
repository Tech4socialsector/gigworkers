// Copyright (c) 2026, Jenifar and contributors
// For license information, please see license.txt

frappe.ui.form.on("Welfare Fee Invoice", {
	refresh(frm) {
		// Auto-set quarter dates when quarter/year changes
		set_quarter_dates(frm);

		// Add custom buttons based on status
		frm.clear_custom_buttons();

		if (!frm.is_new()) {
			// Add "Record Payment" button if invoice is not fully paid
			if (frm.doc.invoice_status !== "Fully Paid") {
				frm.add_custom_button(__("Record Payment"), function() {
					record_payment_dialog(frm);
				}, __("Actions")).addClass("btn-primary");
			}

			// Add "Send Email Reminder" button if pending or overdue
			if (["Pending", "Partially Paid", "Overdue"].includes(frm.doc.invoice_status)) {
				frm.add_custom_button(__("Send Email Reminder"), function() {
					send_email_reminder(frm);
				}, __("Actions"));
			}

			// Add "View Transactions" button
			frm.add_custom_button(__("View Transactions"), function() {
				frappe.route_options = {"aggregator": frm.doc.aggregator};
				frappe.set_route("List", "Gig Transaction");
			});

			// Add color indicators based on status
			set_status_indicator(frm);
		}
	},

	amount_paid(frm) {
		// Auto-calculate balance due
		frm.set_value("balance_due", frm.doc.total_due_amount - frm.doc.amount_paid);
	},

	quarter(frm) {
		set_quarter_dates(frm);
	},

	year(frm) {
		set_quarter_dates(frm);
	},

	fetch_welfare_fees(frm) {
		// Fetch all pending welfare fees for the selected aggregator, quarter, and year
		if (!frm.doc.aggregator) {
			frappe.msgprint(__("Please select an Aggregator first"));
			return;
		}
		if (!frm.doc.quarter || !frm.doc.year) {
			frappe.msgprint(__("Please select Quarter and Year"));
			return;
		}

		frappe.call({
			method: "gigworkers.gig_workers.doctype.welfare_fee_invoice.welfare_fee_invoice.fetch_pending_welfare_fees",
			args: {
				aggregator: frm.doc.aggregator,
				quarter: frm.doc.quarter,
				year: frm.doc.year,
				from_date: frm.doc.from_date,
				to_date: frm.doc.to_date
			},
			freeze: true,
			freeze_message: __("Fetching pending welfare fees..."),
			callback(r) {
				if (r.message && r.message.success) {
					// Clear existing items
					frm.clear_table("welfare_fee_items");

					// Add fetched items
					r.message.items.forEach(item => {
						let row = frm.add_child("welfare_fee_items");
						row.welfare_fee_payment = item.welfare_fee_payment;
						row.transaction = item.transaction;
						row.transaction_date = item.transaction_date;
						row.gig_worker = item.gig_worker;
						row.fee_amount = item.fee_amount;
						row.payment_status = item.payment_status;
					});

					frm.refresh_field("welfare_fee_items");
					frm.dirty();

					// Show success message
					frappe.show_alert({
						message: __(`Fetched ${r.message.count} pending welfare fees totaling ₹${r.message.total_amount.toFixed(2)}`),
						indicator: "green"
					}, 10);

					// Auto-calculate totals
					frm.trigger("validate");
				}
			}
		});
	}
});

function record_payment_dialog(frm) {
	let dialog = new frappe.ui.Dialog({
		title: __("Record Payment"),
		fields: [
			{
				fieldtype: "Currency",
				label: __("Amount Paid"),
				fieldname: "amount_paid",
				reqd: 1,
				default: frm.doc.balance_due,
				description: __("Balance Due: ₹" + frm.doc.balance_due.toFixed(2))
			},
			{
				fieldtype: "Column Break"
			},
			{
				fieldtype: "Date",
				label: __("Payment Date"),
				fieldname: "payment_date",
				reqd: 1,
				default: frappe.datetime.get_today()
			},
			{
				fieldtype: "Time",
				label: __("Payment Time"),
				fieldname: "payment_time",
				default: frappe.datetime.now_time()
			},
			{
				fieldtype: "Section Break"
			},
			{
				fieldtype: "Select",
				label: __("Payment Mode"),
				fieldname: "payment_mode",
				options: "\nNEFT\nRTGS\nUPI\nIMPS\nCheque\nCash\nOnline Transfer",
				reqd: 1
			},
			{
				fieldtype: "Column Break"
			},
			{
				fieldtype: "Data",
				label: __("Payment Reference/UTR Number"),
				fieldname: "payment_reference",
				description: __("Bank transaction reference or cheque number")
			},
			{
				fieldtype: "Section Break"
			},
			{
				fieldtype: "Small Text",
				label: __("Remarks"),
				fieldname: "remarks"
			}
		],
		primary_action_label: __("Record Payment"),
		primary_action(values) {
			frappe.call({
				method: "gigworkers.gig_workers.doctype.welfare_fee_invoice.welfare_fee_invoice.record_payment",
				args: {
					invoice_name: frm.doc.name,
					amount_paid: values.amount_paid,
					payment_date: values.payment_date,
					payment_time: values.payment_time,
					payment_mode: values.payment_mode,
					payment_reference: values.payment_reference,
					remarks: values.remarks
				},
				freeze: true,
				freeze_message: __("Recording payment..."),
				callback(r) {
					if (!r.exc && r.message.success) {
						frappe.show_alert({
							message: __("Payment of ₹" + values.amount_paid.toFixed(2) + " recorded successfully. Total payments: " + r.message.payment_count),
							indicator: "green"
						}, 5);
						frm.reload_doc();
						dialog.hide();
					}
				}
			});
		}
	});

	dialog.show();
}

function send_email_reminder(frm) {
	frappe.confirm(
		__("Send payment reminder email to {0}?", [frm.doc.email]),
		function() {
			frappe.call({
				method: "frappe.core.doctype.communication.email.make",
				args: {
					recipients: frm.doc.email,
					subject: "Payment Reminder - Welfare Fee Invoice " + frm.doc.name,
					content: get_reminder_email_content(frm.doc),
					doctype: frm.doc.doctype,
					name: frm.doc.name,
					send_email: 1
				},
				callback(r) {
					if (!r.exc) {
						frappe.show_alert({
							message: __("Reminder email sent"),
							indicator: "green"
						}, 5);
					}
				}
			});
		}
	);
}

function get_reminder_email_content(doc) {
	let days_overdue = "";
	if (doc.invoice_status === "Overdue") {
		let due = frappe.datetime.get_day_diff(frappe.datetime.get_today(), doc.due_date);
		days_overdue = ` (${due} days overdue)`;
	}

	return `
		<p>Dear ${doc.aggregator_name},</p>
		<p>This is a reminder regarding your pending welfare fee payment${days_overdue}.</p>
		<table style="border-collapse:collapse;margin-top:12px;border:1px solid #ddd;">
		  <tr style="background:#f8f9fa;">
		    <th style="padding:8px;text-align:left;border:1px solid #ddd;">Invoice Details</th>
		    <th style="padding:8px;text-align:left;border:1px solid #ddd;">Amount</th>
		  </tr>
		  <tr>
		    <td style="padding:8px;border:1px solid #ddd;"><b>Invoice Number</b></td>
		    <td style="padding:8px;border:1px solid #ddd;">${doc.name}</td>
		  </tr>
		  <tr>
		    <td style="padding:8px;border:1px solid #ddd;"><b>Period</b></td>
		    <td style="padding:8px;border:1px solid #ddd;">${doc.quarter} ${doc.year}</td>
		  </tr>
		  <tr>
		    <td style="padding:8px;border:1px solid #ddd;"><b>Total Due</b></td>
		    <td style="padding:8px;border:1px solid #ddd;">₹${doc.total_due_amount.toFixed(2)}</td>
		  </tr>
		  <tr>
		    <td style="padding:8px;border:1px solid #ddd;"><b>Amount Paid</b></td>
		    <td style="padding:8px;border:1px solid #ddd;">₹${doc.amount_paid.toFixed(2)}</td>
		  </tr>
		  <tr style="background:#fff3cd;">
		    <td style="padding:8px;border:1px solid #ddd;"><b>Balance Due</b></td>
		    <td style="padding:8px;border:1px solid #ddd;"><b>₹${doc.balance_due.toFixed(2)}</b></td>
		  </tr>
		  <tr>
		    <td style="padding:8px;border:1px solid #ddd;"><b>Due Date</b></td>
		    <td style="padding:8px;border:1px solid #ddd;">${doc.due_date}</td>
		  </tr>
		</table>
		<p>Please arrange payment at your earliest convenience.</p>
		<p>Best regards,<br>Karnataka Gig Workers Welfare Board</p>
	`;
}

function set_status_indicator(frm) {
	const status_colors = {
		"Draft": "gray",
		"Pending": "orange",
		"Partially Paid": "blue",
		"Fully Paid": "green",
		"Overdue": "red"
	};

	frm.dashboard.set_headline_alert(
		`<div class="row">
			<div class="col-xs-12">
				<span class="indicator ${status_colors[frm.doc.invoice_status]}">
					${frm.doc.invoice_status}
				</span>
			</div>
		</div>`
	);

	// Add summary in dashboard
	if (frm.doc.invoice_status !== "Draft") {
		frm.dashboard.add_section(
			frappe.render_template("welfare_invoice_summary", {doc: frm.doc}),
			__("Payment Summary")
		);
	}
}

// Template for payment summary (if needed)
frappe.templates["welfare_invoice_summary"] = `
	<div class="invoice-summary" style="padding: 10px;">
		<div class="row">
			<div class="col-sm-6">
				<div class="form-group">
					<label>Total Transactions:</label>
					<div class="value"><strong>{{ doc.total_transactions }}</strong></div>
				</div>
			</div>
			<div class="col-sm-6">
				<div class="form-group">
					<label>Period:</label>
					<div class="value"><strong>{{ doc.from_date }} to {{ doc.to_date }}</strong></div>
				</div>
			</div>
		</div>
		<hr style="margin: 10px 0;">
		<div class="row">
			<div class="col-sm-4">
				<div class="form-group">
					<label>Total Due:</label>
					<div class="value" style="font-size: 18px; color: #333;">
						<strong>₹{{ doc.total_due_amount.toFixed(2) }}</strong>
					</div>
				</div>
			</div>
			<div class="col-sm-4">
				<div class="form-group">
					<label>Paid:</label>
					<div class="value" style="font-size: 18px; color: #28a745;">
						<strong>₹{{ doc.amount_paid.toFixed(2) }}</strong>
					</div>
				</div>
			</div>
			<div class="col-sm-4">
				<div class="form-group">
					<label>Balance:</label>
					<div class="value" style="font-size: 18px; color: {{ doc.balance_due > 0 ? '#dc3545' : '#28a745' }};">
						<strong>₹{{ doc.balance_due.toFixed(2) }}</strong>
					</div>
				</div>
			</div>
		</div>
	</div>
`;

// Helper function to set quarter dates automatically
function set_quarter_dates(frm) {
	if (!frm.doc.quarter || !frm.doc.year) {
		return;
	}

	const quarter_dates = {
		"Q1": [`${frm.doc.year}-04-01`, `${frm.doc.year}-06-30`],
		"Q2": [`${frm.doc.year}-07-01`, `${frm.doc.year}-09-30`],
		"Q3": [`${frm.doc.year}-10-01`, `${frm.doc.year}-12-31`],
		"Q4": [`${parseInt(frm.doc.year)}-01-01`, `${parseInt(frm.doc.year)}-03-31`]
	};

	let year = parseInt(frm.doc.year);
	if (frm.doc.quarter === "Q4") {
		year = year + 1; // Q4 is Jan-Mar of next year
	}

	const dates = quarter_dates[frm.doc.quarter];
	if (dates) {
		if (frm.doc.quarter === "Q4") {
			frm.set_value("from_date", `${year}-01-01`);
			frm.set_value("to_date", `${year}-03-31`);
			frm.set_value("due_date", `${year}-04-30`); // Due 30 days after quarter end
		} else {
			frm.set_value("from_date", dates[0]);
			frm.set_value("to_date", dates[1]);
			// Set due date 30 days after quarter end
			let to_date = frappe.datetime.str_to_obj(dates[1]);
			let due_date = frappe.datetime.add_days(to_date, 30);
			frm.set_value("due_date", frappe.datetime.obj_to_str(due_date));
		}
	}
}
