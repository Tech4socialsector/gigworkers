// Copyright (c) 2026, Jenifar and contributors
// For license information, please see license.txt

// Inject dark-theme button styles once per page load
if (!document.getElementById("wfi-dark-btn-styles")) {
	let style = document.createElement("style");
	style.id = "wfi-dark-btn-styles";
	style.textContent = `
		/* Dark theme: standalone custom buttons */
		.wfi-btn-dark {
			background-color: #2d3748 !important;
			color: #ffffff !important;
			border-color: #2d3748 !important;
		}
		.wfi-btn-dark:hover,
		.wfi-btn-dark:focus {
			background-color: #1a202c !important;
			color: #f0f0f0 !important;
			border-color: #1a202c !important;
		}

		/* Dark theme: Actions group trigger button */
		.wfi-btn-group-dark.btn-default {
			background-color: #2d3748 !important;
			color: #ffffff !important;
			border-color: #2d3748 !important;
		}
		.wfi-btn-group-dark.btn-default:hover,
		.wfi-btn-group-dark.btn-default:focus {
			background-color: #1a202c !important;
			color: #f0f0f0 !important;
			border-color: #1a202c !important;
		}

		/* Dark theme: dropdown items inside the Actions group */
		.wfi-dropdown-dark .dropdown-item {
			color: #2d3748 !important;
			font-weight: 500;
		}
		.wfi-dropdown-dark .dropdown-item:hover {
			background-color: #2d3748 !important;
			color: #ffffff !important;
		}
	`;
	document.head.appendChild(style);
}

frappe.ui.form.on("Welfare Fee Invoice", {
	refresh(frm) {
		// Auto-set quarter dates when quarter/year changes
		set_quarter_dates(frm);

		// Auto-populate aggregator for Aggregator users on new docs
		if (frm.is_new() && !frm.doc.aggregator && frappe.user.has_role("Aggregator")) {
			frappe.db.get_value("Aggregator", { email: frappe.session.user }, "name")
				.then(r => {
					const agg = r && r.message && r.message.name;
					if (agg) frm.set_value("aggregator", agg);
				});
		}

		// Add custom buttons based on status
		frm.clear_custom_buttons();

		if (!frm.is_new()) {
			// Add "Record Payment" button if invoice is not fully paid
			if (frm.doc.invoice_status !== "Fully Paid") {
				frm.add_custom_button(__("Record Payment"), function() {
					record_payment_dialog(frm);
				}, __("Actions")).addClass("wfi-btn-dark");
			}

			// Add "Send Email Reminder" button if pending or overdue
			if (["Pending", "Partially Paid", "Overdue"].includes(frm.doc.invoice_status)) {
				frm.add_custom_button(__("Send Email Reminder"), function() {
					send_email_reminder(frm);
				}, __("Actions")).addClass("wfi-btn-dark");
			}

			// Add "View Transactions" button
			frm.add_custom_button(__("View Transactions"), function() {
				frappe.route_options = {"aggregator": frm.doc.aggregator};
				frappe.set_route("List", "Gig Transaction");
			}).addClass("wfi-btn-dark");

			// Apply dark theme to the Actions group trigger and its dropdown
			setTimeout(() => {
				frm.page.wrapper
					.find(".custom-btn-group .btn-default")
					.filter((_, el) => $(el).text().trim().startsWith("Actions"))
					.addClass("wfi-btn-group-dark");

				frm.page.wrapper
					.find(".custom-btn-group .dropdown-menu")
					.addClass("wfi-dropdown-dark");
			}, 0);

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

					// Set totals directly from the returned data
					frm.set_value("total_transactions", r.message.count);
					frm.set_value("total_due_amount", r.message.total_amount);
					frm.set_value("balance_due", r.message.total_amount - (frm.doc.amount_paid || 0));
					frm.dirty();

					frappe.show_alert({
						message: __(`Fetched ${r.message.count} pending welfare fees totaling ₹${r.message.total_amount.toFixed(2)}`),
						indicator: "green"
					}, 10);
				}
			}
		});
	}
});

function record_payment_dialog(frm) {
	let balance_due = frm.doc.balance_due || 0;
	let total_due = frm.doc.total_due_amount || 0;
	let amount_paid_so_far = frm.doc.amount_paid || 0;

	let dialog = new frappe.ui.Dialog({
		title: __("Record Payment"),
		fields: [
			{
				fieldtype: "HTML",
				fieldname: "balance_due_banner",
				options: `
					<div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 6px; padding: 14px 16px; margin-bottom: 12px;">
						<div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
							<div style="text-align: center; flex: 1; min-width: 120px;">
								<div style="font-size: 11px; color: #856404; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">Total Invoice Amount</div>
								<div style="font-size: 18px; font-weight: 700; color: #856404;">₹${total_due.toFixed(2)}</div>
							</div>
							<div style="text-align: center; flex: 1; min-width: 120px; border-left: 1px solid #ffc107; border-right: 1px solid #ffc107; padding: 0 10px;">
								<div style="font-size: 11px; color: #155724; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">Already Paid</div>
								<div style="font-size: 18px; font-weight: 700; color: #155724;">₹${amount_paid_so_far.toFixed(2)}</div>
							</div>
							<div style="text-align: center; flex: 1; min-width: 120px;">
								<div style="font-size: 11px; color: #721c24; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">Balance Due</div>
								<div style="font-size: 22px; font-weight: 800; color: #dc3545;">₹${balance_due.toFixed(2)}</div>
							</div>
						</div>
					</div>`
			},
			{
				fieldtype: "Section Break",
				label: __("Payment Details")
			},
			{
				fieldtype: "Currency",
				label: __("Amount Paid"),
				fieldname: "amount_paid",
				reqd: 1,
				default: balance_due,
				description: __("Enter the amount being paid now (max: ₹" + balance_due.toFixed(2) + ")")
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
				default: frappe.datetime.now_time(),
				description: __("Time of the payment transaction")
			},
			{
				fieldtype: "Section Break",
				label: __("Payment Mode & Reference")
			},
			{
				fieldtype: "Select",
				label: __("Payment Mode"),
				fieldname: "payment_mode",
				options: "\nNEFT\nRTGS\nUPI\nIMPS\nCheque\nDemand Draft\nCash\nNet Banking\nOnline Transfer",
				reqd: 1,
				description: __("Select the mode used for this payment")
			},
			{
				fieldtype: "Column Break"
			},
			{
				fieldtype: "Data",
				label: __("Payment Reference / UTR Number"),
				fieldname: "payment_reference",
				description: __("Bank UTR, UPI transaction ID, cheque or DD number")
			},
			{
				fieldtype: "Section Break",
				label: __("Remarks")
			},
			{
				fieldtype: "Small Text",
				label: __("Remarks"),
				fieldname: "remarks",
				description: __("Any additional notes about this payment (optional)")
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

// Template for payment summary
frappe.templates["welfare_invoice_summary"] = `
	<div class="invoice-summary" style="padding: 12px 16px; background: #f8f9fa; border-radius: 6px;">
		<div class="row" style="margin-bottom: 12px;">
			<div class="col-sm-6">
				<div style="background: #fff; border: 1px solid #dee2e6; border-radius: 4px; padding: 10px 14px;">
					<div style="font-size: 11px; color: #6c757d; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Total Transactions</div>
					<div style="font-size: 22px; font-weight: 700; color: #212529; line-height: 1.2;">{{ doc.total_transactions }}</div>
					<div style="font-size: 11px; color: #868e96; margin-top: 3px;">Count of welfare fee items for this quarter</div>
				</div>
			</div>
			<div class="col-sm-6">
				<div style="background: #fff; border: 1px solid #dee2e6; border-radius: 4px; padding: 10px 14px;">
					<div style="font-size: 11px; color: #6c757d; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Period</div>
					<div style="font-size: 14px; font-weight: 600; color: #495057; line-height: 1.4;">{{ doc.from_date }} to {{ doc.to_date }}</div>
				</div>
			</div>
		</div>
		<div class="row">
			<div class="col-sm-4">
				<div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 4px; padding: 10px 14px;">
					<div style="font-size: 11px; color: #856404; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Total Due Amount</div>
					<div style="font-size: 20px; font-weight: 700; color: #856404; line-height: 1.2;">₹{{ doc.total_due_amount.toFixed(2) }}</div>
					<div style="font-size: 11px; color: #9a7522; margin-top: 3px;">Sum of all pending welfare fees for this quarter</div>
				</div>
			</div>
			<div class="col-sm-4">
				<div style="background: #d4edda; border: 1px solid #28a745; border-radius: 4px; padding: 10px 14px;">
					<div style="font-size: 11px; color: #155724; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Total Amount Paid</div>
					<div style="font-size: 20px; font-weight: 700; color: #155724; line-height: 1.2;">₹{{ doc.amount_paid.toFixed(2) }}</div>
					<div style="font-size: 11px; color: #1e7e34; margin-top: 3px;">Auto-calculated from payment history</div>
				</div>
			</div>
			<div class="col-sm-4">
				<div style="background: {{ doc.balance_due > 0 ? '#f8d7da' : '#d4edda' }}; border: 1px solid {{ doc.balance_due > 0 ? '#dc3545' : '#28a745' }}; border-radius: 4px; padding: 10px 14px;">
					<div style="font-size: 11px; color: {{ doc.balance_due > 0 ? '#721c24' : '#155724' }}; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Balance Due</div>
					<div style="font-size: 20px; font-weight: 700; color: {{ doc.balance_due > 0 ? '#721c24' : '#155724' }}; line-height: 1.2;">₹{{ doc.balance_due.toFixed(2) }}</div>
					<div style="font-size: 11px; color: {{ doc.balance_due > 0 ? '#8b2835' : '#1e7e34' }}; margin-top: 3px;">Remaining amount to be paid</div>
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
