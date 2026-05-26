// Copyright (c) 2026, Jenifar and contributors
// For license information, please see license.txt

frappe.listview_settings["Gig Transaction"] = {

	additional_fields: ["adjustment_count"],

	get_indicator(doc) {
		if ((doc.adjustment_count || 0) > 0) {
			return [__("Adjusted"), "orange", "adjustment_count,>,0"];
		}
	},

	onload(listview) {

		if (!frappe.user.has_role("Gig Worker")) {
			listview.page.add_button(__("Bulk Import"), function () {
				frappe.set_route("bulk-gig-transaction-import");
			}, { icon: "upload" });
		}

		if (frappe.user_roles.includes("System Manager")) {
			_dark_btn(listview.page.add_inner_button(__("Set Adjustment Limit"), function () {

				frappe.call({
					method: "gigworkers.gig_workers.doctype.gig_transaction.gig_transaction.get_max_adjustment_attempts_setting",
					freeze: true,
					freeze_message: __("Loading settings..."),
					callback(r) {
						const current_limit = (r && r.message) ? r.message : 3;

						const d = new frappe.ui.Dialog({
							title: __("Set Adjustment Attempt Limit"),
							fields: [
								{
									fieldtype: "HTML",
									options: `<div style="margin-bottom:12px;padding:10px 14px;border-radius:5px;
									              background:#1a1a2e;color:#d0d0d0;font-size:13px;">
									    Controls how many times an Aggregator can adjust a Gig Transaction
									    after import. Currently set to <b>${current_limit}</b>.
									</div>`
								},
								{
									label: __("Max Adjustment Attempts"),
									fieldname: "max_adjustment_attempts",
									fieldtype: "Int",
									reqd: 1,
									default: current_limit,
									description: __("Must be a positive number (minimum 1).")
								}
							],
							primary_action_label: __("Save"),
							primary_action(values) {
								const new_limit = values.max_adjustment_attempts;

								if (!Number.isInteger(new_limit) || new_limit < 1) {
									frappe.msgprint({
										title: __("Invalid Value"),
										indicator: "red",
										message: __("Adjustment limit must be a whole number of at least 1.")
									});
									return;
								}

								frappe.call({
									method: "gigworkers.gig_workers.doctype.gig_transaction.gig_transaction.set_max_adjustment_attempts_setting",
									args: { value: new_limit },
									freeze: true,
									freeze_message: __("Saving limit..."),
									callback(r) {
										if (!r.exc) {
											frappe.show_alert({
												message: __(`Adjustment limit updated to <b>${new_limit}</b>.`),
												indicator: "green"
											}, 5);
											d.hide();
										}
									}
								});
							}
						});

						d.show();
						_dark_dialog_btn(d);
					}
				});
			}));
		}

		if (frappe.user.has_role("System Manager") || frappe.user.has_role("Aggregator")) {
			_dark_btn(listview.page.add_inner_button(
				__("Gig Adjustment Transaction"),
				() => _adjustment_entry(listview)
			));
		}
	}
};


function _adjustment_entry(listview) {

	const selected = listview.get_checked_items();

	if (selected.length > 0) {
		_process_names(selected.map(r => r.name), listview);
		return;
	}

	if (frappe.user.has_role("System Manager")) {
		_show_transaction_picker(null, listview);
	} else {
		frappe.db.get_value("Aggregator", { email: frappe.session.user }, "name")
			.then(r => {
				const agg = r && r.message && r.message.name;
				_show_transaction_picker(agg || null, listview);
			})
			.catch(() => _show_transaction_picker(null, listview));
	}
}


function _show_transaction_picker(agg_name, listview) {

	const d = new frappe.ui.Dialog({
		title: __("Select Transaction to Adjust"),
		fields: [
			{
				fieldtype: "HTML",
				options: `<div style="padding:10px 14px 6px;border-radius:5px;
				              background:#1a1a2e;color:#d0d0d0;font-size:13px;margin-bottom:10px;">
				    Search and select the Gig Transaction you want to adjust.
				    <br><small style="color:#888;">
				        Tip: tick checkboxes in the list first for bulk adjustments.
				    </small>
				</div>`
			},
			{
				label: "Gig Transaction",
				fieldname: "transaction_name",
				fieldtype: "Link",
				options: "Gig Transaction",
				reqd: 1,
				get_query: agg_name
					? () => ({ filters: { aggregator: agg_name } })
					: undefined
			}
		],
		primary_action_label: __("Next"),
		primary_action(values) {
			d.hide();
			_process_names([values.transaction_name], listview);
		}
	});

	d.show();
	_dark_dialog_btn(d);
}


function _process_names(names, listview) {

	frappe.call({
		method: "gigworkers.gig_workers.doctype.gig_transaction.gig_transaction.get_adjustment_info",
		args: { transaction_names: JSON.stringify(names) },
		freeze: true,
		freeze_message: __("Checking adjustment limits..."),
		callback(r) {
			if (r.exc) return;

			const info = r.message;

			if (info.adjustable.length === 0) {
				frappe.msgprint({
					title: __("Adjustment Limit Reached"),
					indicator: "red",
					message: __(
						`All selected transaction(s) have used the maximum of <b>${info.max_attempts}</b> ` +
						`adjustment(s). A System Manager can increase it via <b>Set Adjustment Limit</b>.`
					)
				});
				return;
			}

			if (info.blocked.length > 0) {
				frappe.msgprint({
					title: __("Partial Adjustment"),
					indicator: "orange",
					message: __(
						`<b>${info.blocked.length}</b> transaction(s) have reached their ` +
						`limit of <b>${info.max_attempts}</b> and will be skipped:<br><br>` +
						info.blocked.map(n => `• ${n}`).join("<br>")
					)
				});
			}

			if (info.adjustable.length === 1) {
				frappe.db.get_doc("Gig Transaction", info.adjustable[0]).then(doc => {
					_show_adjustment_dialog(info.adjustable, info, doc, listview);
				});
			} else {
				_show_adjustment_dialog(info.adjustable, info, null, listview);
			}
		}
	});
}


function _show_adjustment_dialog(adjustable_names, info, prefill_doc, listview) {

	const is_single  = adjustable_names.length === 1 && prefill_doc;
	const tx_count   = is_single ? (prefill_doc.adjustment_count || 0) : 0;
	const after_this = is_single ? (info.max_attempts - tx_count - 1) : null;

	const alert_html = is_single
		? `<div style="margin-bottom:12px;padding:10px 14px;border-radius:5px;
		              background:#1a1a2e;color:#e0e0e0;border-left:4px solid #f0a500;font-size:13px;">
		       <b>Adjustment ${tx_count + 1} of ${info.max_attempts}</b> for this transaction
		       &nbsp;·&nbsp;
		       <span style="color:#f0a500;">${after_this} remaining after this</span>
		   </div>`
		: `<div style="margin-bottom:12px;padding:10px 14px;border-radius:5px;
		              background:#1a1a2e;color:#e0e0e0;border-left:4px solid #4da6ff;font-size:13px;">
		       Adjusting <b>${adjustable_names.length}</b> transactions
		       &nbsp;·&nbsp;
		       <span style="color:#4da6ff;">Limit: ${info.max_attempts} per transaction</span><br>
		       <small style="color:#888;">Leave a field blank to keep its current value.</small>
		   </div>`;

	const d = new frappe.ui.Dialog({
		title: is_single
			? __("Adjust: " + adjustable_names[0])
			: __("Bulk Adjust " + adjustable_names.length + " Transactions"),
		size: "large",
		fields: [
			{ fieldtype: "HTML", options: alert_html },
			{
				label: "Total Bill Amount", fieldname: "amount", fieldtype: "Currency",
				default: is_single ? prefill_doc.amount : undefined,
				reqd:    is_single ? 1 : 0
			},
			{
				label: "Base Payout", fieldname: "base_payout", fieldtype: "Currency",
				default: is_single ? prefill_doc.base_payout : undefined,
				reqd:    is_single ? 1 : 0
			},
			{
				label: "Incentives", fieldname: "incentives", fieldtype: "Currency",
				default: is_single ? prefill_doc.incentives : undefined
			},
			{
				label: "Deduction", fieldname: "deduction", fieldtype: "Currency",
				default: is_single ? prefill_doc.deduction : undefined
			},
			{ fieldtype: "Column Break" },
			{
				label: "Date", fieldname: "date", fieldtype: "Date",
				default: is_single ? prefill_doc.date : undefined
			},
			{
				label: "External Transaction ID", fieldname: "external_transaction_id",
				fieldtype: "Data",
				default: is_single ? prefill_doc.external_transaction_id : undefined
			},
			{
				label: "Status of Order", fieldname: "status_of_order",
				fieldtype: "Select",
				options: "\nOrder delivered\nOrder cancelled",
				default: is_single ? prefill_doc.status_of_order : undefined
			}
		],
		primary_action_label: __("Save Adjustment"),
		primary_action(values) {

			if (!is_single) {
				Object.keys(values).forEach(k => {
					if (values[k] === null || values[k] === undefined || values[k] === "") delete values[k];
				});
				if (!Object.keys(values).length) {
					frappe.msgprint(__("Please fill at least one field to update."));
					return;
				}
			}

			if (is_single) {
				frappe.call({
					method: "gigworkers.gig_workers.doctype.gig_transaction.gig_transaction.apply_adjustment",
					args: { transaction_name: adjustable_names[0], ...values },
					freeze: true,
					freeze_message: __("Saving adjustment..."),
					callback(r) {
						if (!r.exc) {
							frappe.show_alert({ message: __(r.message.message), indicator: "green" }, 6);
							d.hide();
							listview.refresh();
						}
					}
				});
			} else {
				frappe.call({
					method: "gigworkers.gig_workers.doctype.gig_transaction.gig_transaction.apply_bulk_adjustment",
					args: {
						transaction_names: JSON.stringify(adjustable_names),
						data: JSON.stringify(values)
					},
					freeze: true,
					freeze_message: __("Applying adjustments..."),
					callback(r) {
						if (!r.exc) {
							frappe.show_alert({ message: __(r.message.message), indicator: "green" }, 6);
							d.hide();
							listview.refresh();
						}
					}
				});
			}
		}
	});

	d.show();
	_dark_dialog_btn(d);
}


function _dark_btn($btn) {
	if ($btn && $btn.length) {
		$btn.removeClass("btn-default btn-secondary")
			.addClass("btn-dark")
			.css({ "background-color": "#343a40", "border-color": "#343a40", color: "#fff" });
	}
}


function _dark_dialog_btn(d) {
	d.$wrapper.find(".modal-footer .btn-primary")
		.removeClass("btn-primary")
		.addClass("btn-dark")
		.css({ "background-color": "#343a40", "border-color": "#343a40", color: "#fff" });
}
