frappe.pages["bulk-gig-worker-import"].on_page_load = function (wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Bulk Gig Worker Import",
		single_column: true,
	});

	new GigWorkerBulkImport(page);
};

class GigWorkerBulkImport {
	constructor(page) {
		this.page = page;
		this.import_id = null;
		this.poll_timer = null;
		this.file_url = null;
		this._log_offset = 0;
		this._log_limit = 10;
		this._render();
	}

	_render() {
		this.page.main.html(`
			<div class="gw-import-wrap" style="max-width:780px; margin:24px auto; padding:0 16px;">

				<!-- Info card -->
				<div class="card mb-4" style="border-left:4px solid #8B0000;">
					<div class="card-body">
						<h5 class="card-title" style="color:#8B0000;">High-Volume Gig Worker Import</h5>
						<p class="card-text text-muted mb-2">
							This tool imports <strong>more than 1 lakh records</strong> in background batches,
							bypassing the slow per-document pipeline. Email notifications and user account
							creation are skipped during the import to maximise throughput.
						</p>
						<ol class="mb-0 text-muted" style="font-size:13px; padding-left:18px;">
							<li>Download the CSV template and fill in your worker data.</li>
							<li>Upload the completed file (CSV or XLSX).</li>
							<li>Click <strong>Start Import</strong> and monitor progress below.</li>
						</ol>
					</div>
				</div>

				<!-- Template download -->
				<div class="mb-3">
					<button class="btn btn-default btn-sm" id="btn-download-template">
						<i class="fa fa-download"></i>&nbsp; Download CSV Template
					</button>
				</div>

				<!-- File upload -->
				<div class="form-group">
					<label class="control-label">Upload File <span class="text-danger">*</span></label>
					<div id="gw-file-area"
						style="position:relative; border:2px dashed #ccc; border-radius:6px; padding:28px 20px;
						       text-align:center; background:#fafafa; transition:border-color .2s; overflow:hidden;">
						<!-- File input overlaid on the entire zone — browser opens picker on any click -->
						<input type="file" id="gw-file-input" accept=".csv,.xlsx,.xls"
							style="position:absolute; top:0; left:0; width:100%; height:100%;
							       opacity:0; cursor:pointer; z-index:2;">
						<!-- Visual content (pointer-events:none so clicks pass through to the input) -->
						<div style="pointer-events:none;">
							<i class="fa fa-cloud-upload fa-2x text-muted"></i>
							<p class="text-muted mt-2 mb-1" id="gw-file-label">
								Click or drag &amp; drop a CSV / XLSX file here
							</p>
							<small id="gw-upload-status"></small>
						</div>
					</div>
				</div>

				<!-- Options -->
				<div class="row mb-3">
					<div class="col-sm-6">
						<div class="checkbox">
							<label>
								<input type="checkbox" id="chk-skip-duplicates" checked>
								&nbsp;Skip duplicate email / phone / aadhaar
							</label>
						</div>
					</div>
					<div class="col-sm-6">
						<div class="checkbox">
							<label>
								<input type="checkbox" id="chk-skip-email" checked>
								&nbsp;Skip registration email (faster)
							</label>
						</div>
					</div>
				</div>

				<!-- Aggregator override -->
				<div class="form-group mb-4">
					<label class="control-label">Default Aggregator <small class="text-muted">(optional — overrides CSV column)</small></label>
					<input type="text" id="inp-aggregator" class="form-control"
						placeholder="Aggregator ID, e.g. AGG-001">
				</div>

				<!-- Action buttons -->
				<div class="mb-4" style="display:flex; gap:10px; align-items:center;">
					<button class="btn btn-primary" id="btn-start-import">
						<i class="fa fa-play"></i>&nbsp; Start Import
					</button>
					<button class="btn btn-danger btn-sm" id="btn-cancel-import" style="display:none;">
						<i class="fa fa-stop"></i>&nbsp; Cancel
					</button>
					<span id="gw-btn-hint" class="text-muted" style="font-size:12px;">
						Upload a file first to begin.
					</span>
				</div>

				<!-- Progress section (hidden until job starts) -->
				<div id="gw-progress-section" style="display:none;">
					<hr>
					<h6>Import Progress</h6>

					<div class="progress mb-2" style="height:22px;">
						<div id="gw-progress-bar"
							class="progress-bar progress-bar-striped active"
							style="width:0%; transition:width .4s;">
							0%
						</div>
					</div>

					<div class="row text-center mb-3" style="font-size:13px;">
						<div class="col-sm-3">
							<div class="text-muted">Status</div>
							<strong id="stat-status">—</strong>
						</div>
						<div class="col-sm-3">
							<div class="text-muted">Total Rows</div>
							<strong id="stat-total">—</strong>
						</div>
						<div class="col-sm-3">
							<div class="text-muted">Inserted</div>
							<strong id="stat-inserted" style="color:#27ae60;">—</strong>
						</div>
						<div class="col-sm-3">
							<div class="text-muted">Skipped / Errors</div>
							<strong id="stat-skipped" style="color:#e67e22;">—</strong>
						</div>
					</div>

					<div id="gw-error-box" style="display:none;">
						<label class="control-label text-danger">Validation Errors / Skipped Rows</label>
						<textarea id="gw-error-log" class="form-control"
							rows="8" readonly
							style="font-size:12px; font-family:monospace; background:#fff8f0; border-color:#e67e22;"></textarea>
					</div>
				</div>

			</div>

			<!-- Import History -->
			<div style="margin-top:32px;">
				<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
					<h6 style="margin:0;">Import History</h6>
					<button class="btn btn-default btn-xs" id="btn-refresh-logs">
						<i class="fa fa-refresh"></i>&nbsp; Refresh
					</button>
				</div>
				<div style="overflow-x:auto;">
					<table class="table table-bordered table-hover" style="font-size:13px; margin-bottom:0;">
						<thead style="background:#343a40; color:#fff;">
							<tr>
								<th style="white-space:nowrap;">Log ID</th>
								<th style="white-space:nowrap;">Date &amp; Time</th>
								<th style="white-space:nowrap;">File</th>
								<th style="white-space:nowrap;">Status</th>
								<th style="text-align:right; white-space:nowrap;">Total</th>
								<th style="text-align:right; white-space:nowrap; color:#82e0aa;">Inserted</th>
								<th style="text-align:right; white-space:nowrap; color:#f0b27a;">Skipped</th>
								<th style="text-align:right; white-space:nowrap; color:#f1948a;">Errors</th>
								<th style="white-space:nowrap;">Imported By</th>
								<th style="white-space:nowrap;"></th>
							</tr>
						</thead>
						<tbody id="gw-log-tbody">
							<tr><td colspan="10" class="text-center text-muted" style="padding:16px;">Loading…</td></tr>
						</tbody>
					</table>
				</div>
				<div style="text-align:center; margin-top:10px;">
					<button class="btn btn-default btn-sm" id="btn-load-more-logs" style="display:none;">
						<i class="fa fa-chevron-down"></i>&nbsp; Load More
					</button>
					<small id="gw-log-count" class="text-muted"></small>
				</div>
			</div>

		</div>
		`);

		this._bind_events();
		this._load_import_logs();
	}

	_bind_events() {
		// Template download
		this.page.main.find("#btn-download-template").on("click", () => this._download_template());

		// Refresh log table
		this.page.main.find("#btn-refresh-logs").on("click", () => {
			this._log_offset = 0;
			this._load_import_logs(true);
		});

		// Load more
		this.page.main.find("#btn-load-more-logs").on("click", () => this._load_import_logs(false));

		// File area drag/drop (clicking is handled natively by the overlaid input)
		const area = this.page.main.find("#gw-file-area");
		const input = this.page.main.find("#gw-file-input");

		// Drag events can land on either the area or the overlaid input
		[area, input].forEach((el) => {
			el.on("dragover", (e) => {
				e.preventDefault();
				area.css("border-color", "#8B0000");
			});
			el.on("dragleave", () => area.css("border-color", "#ccc"));
			el.on("drop", (e) => {
				e.preventDefault();
				area.css("border-color", "#ccc");
				const file = e.originalEvent.dataTransfer.files[0];
				if (file) this._handle_file(file);
			});
		});

		input.on("change", (e) => {
			const file = e.target.files[0];
			if (file) this._handle_file(file);
		});

		// Start import
		this.page.main.find("#btn-start-import").on("click", () => this._start_import());

		// Cancel
		this.page.main.find("#btn-cancel-import").on("click", () => this._cancel_import());

		// Realtime completion event — update stats directly from event payload
		frappe.realtime.on("gw_bulk_import_done", (data) => {
			if (data.import_id === this.import_id) {
				this._stop_polling();
				this._apply_stats({
					status: data.status || "Completed",
					total: data.total || 0,
					processed: data.total || 0,
					inserted: data.inserted || 0,
					skipped: data.skipped || 0,
				});
				frappe.show_alert({
					message: `Import complete — ${this._fmt(data.inserted)} inserted, ${this._fmt(data.skipped)} skipped.`,
					indicator: "green",
				}, 10);
				// Refresh history table so the new log row appears immediately
				this._load_import_logs();
			}
		});
	}

	_handle_file(file) {
		const ok_types = ["text/csv",
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			"application/vnd.ms-excel"];
		if (!ok_types.includes(file.type) && !file.name.match(/\.(csv|xlsx|xls)$/i)) {
			frappe.msgprint(__("Please upload a CSV or XLSX file."));
			return;
		}

		this.page.main.find("#gw-file-area").css("border-color", "#ccc");
		this.page.main.find("#gw-file-label").html(
			`<strong>${file.name}</strong> &nbsp;(${this._human_size(file.size)})`
		);
		this.page.main.find("#gw-upload-status")
			.text("Uploading…")
			.css("color", "#888");

		this._upload_file(file);
	}

	_upload_file(file) {
		const btn = this.page.main.find("#btn-start-import");
		btn.prop("disabled", true).html(
			'<i class="fa fa-spinner fa-spin"></i>&nbsp; Uploading…'
		);

		const xhr = new XMLHttpRequest();
		const formData = new FormData();
		formData.append("file", file, file.name);
		formData.append("is_private", "1");
		formData.append("folder", "Home/Attachments");

		xhr.open("POST", "/api/method/upload_file");
		xhr.setRequestHeader("X-Frappe-CSRF-Token", frappe.csrf_token);
		xhr.setRequestHeader("Accept", "application/json");

		xhr.onload = () => {
			let res;
			try { res = JSON.parse(xhr.responseText); } catch (e) { res = {}; }

			if (xhr.status === 200 && res.message && res.message.file_url) {
				this.file_url = res.message.file_url;
				this.page.main.find("#gw-file-area").css("border-color", "#27ae60");
				this.page.main.find("#gw-upload-status")
					.text("File ready ✓")
					.css("color", "#27ae60");
				this.page.main.find("#gw-btn-hint").text("File uploaded. Click Start Import.");
				btn.prop("disabled", false).html(
					'<i class="fa fa-play"></i>&nbsp; Start Import'
				);
			} else {
				const msg = (res.exc_type || res.message || xhr.statusText || "Unknown error");
				this.page.main.find("#gw-upload-status")
					.text("Upload failed: " + msg)
					.css("color", "#e74c3c");
				this.page.main.find("#gw-file-area").css("border-color", "#e74c3c");
				btn.prop("disabled", false).html(
					'<i class="fa fa-play"></i>&nbsp; Start Import'
				);
				frappe.msgprint(__("File upload failed: ") + msg);
			}
		};

		xhr.onerror = () => {
			this.page.main.find("#gw-upload-status")
				.text("Network error during upload.")
				.css("color", "#e74c3c");
			btn.prop("disabled", false).html(
				'<i class="fa fa-play"></i>&nbsp; Start Import'
			);
			frappe.msgprint(__("Network error — file upload failed."));
		};

		xhr.send(formData);
	}

	_start_import() {
		if (!this.file_url) {
			frappe.msgprint({
				title: __("No File Selected"),
				message: __("Please upload a CSV or XLSX file before starting the import."),
				indicator: "orange",
			});
			return;
		}

		const skip_duplicates = this.page.main.find("#chk-skip-duplicates").is(":checked") ? 1 : 0;
		const skip_email = this.page.main.find("#chk-skip-email").is(":checked") ? 1 : 0;
		const aggregator = this.page.main.find("#inp-aggregator").val().trim() || null;

		this.page.main.find("#btn-start-import").prop("disabled", true).html(
			'<i class="fa fa-spinner fa-spin"></i>&nbsp; Starting…'
		);

		frappe.call({
			method: "gigworkers.gig_workers.page.bulk_gig_worker_import.bulk_gig_worker_import.start_import",
			args: {
				file_url: this.file_url,
				skip_duplicates,
				skip_email,
				created_by_aggregator: aggregator,
			},
			callback: (r) => {
				if (r.message && r.message.import_id) {
					this.import_id = r.message.import_id;
					this._show_progress_section();
					this._start_polling();
					frappe.show_alert({
						message: __("Import job started in background."),
						indicator: "blue",
					}, 5);
				} else {
					this.page.main.find("#btn-start-import")
						.prop("disabled", false)
						.html('<i class="fa fa-play"></i>&nbsp; Start Import');
				}
			},
			error: () => {
				this.page.main.find("#btn-start-import")
					.prop("disabled", false)
					.html('<i class="fa fa-play"></i>&nbsp; Start Import');
			},
		});
	}

	_cancel_import() {
		if (!this.import_id) return;
		frappe.call({
			method: "gigworkers.gig_workers.page.bulk_gig_worker_import.bulk_gig_worker_import.cancel_import",
			args: { import_id: this.import_id },
			callback: () => {
				frappe.show_alert({
					message: __("Cancel signal sent. Import will stop after the current batch."),
					indicator: "orange",
				}, 6);
			},
		});
	}

	_show_progress_section() {
		this.page.main.find("#gw-progress-section").show();
		this.page.main.find("#btn-start-import").hide();
		this.page.main.find("#gw-btn-hint").hide();
		this.page.main.find("#btn-cancel-import").show();
	}

	_start_polling() {
		this.poll_timer = setInterval(() => this._refresh_progress(), 2000);
	}

	_stop_polling() {
		if (this.poll_timer) {
			clearInterval(this.poll_timer);
			this.poll_timer = null;
		}
		this.page.main.find("#btn-cancel-import").hide();
		this.page.main.find("#btn-start-import")
			.show()
			.prop("disabled", false)
			.html('<i class="fa fa-play"></i>&nbsp; Start Another Import');
		this.page.main.find("#gw-btn-hint").show().text("Upload a new file to import again.");
		// Reset for next import
		this.file_url = null;
	}

	_refresh_progress() {
		if (!this.import_id) return;
		frappe.call({
			method: "gigworkers.gig_workers.page.bulk_gig_worker_import.bulk_gig_worker_import.get_import_progress",
			args: { import_id: this.import_id },
			callback: (r) => {
				if (!r.message) return;
				this._apply_stats(r.message);
				if (r.message.errors && r.message.errors.length) {
					this.page.main.find("#gw-error-box").show();
					this.page.main.find("#gw-error-log").val(r.message.errors.join("\n"));
				}
				if (["Completed", "Failed", "Cancelled"].includes(r.message.status)) {
					this._stop_polling();
				}
			},
		});
	}

	// Single place that writes progress data to the DOM
	_apply_stats(d) {
		const total = parseInt(d.total) || 0;
		const processed = parseInt(d.processed) || 0;
		const inserted = parseInt(d.inserted) || 0;
		const skipped = parseInt(d.skipped) || 0;
		const status = d.status || "Running";
		const pct = total > 0 ? Math.round((processed / total) * 100) : (status === "Completed" ? 100 : 0);

		const bar = this.page.main.find("#gw-progress-bar");
		bar.css("width", pct + "%").text(pct + "%");

		if (status === "Completed") {
			bar.removeClass("active").css("background-color", "#27ae60");
		} else if (status === "Failed") {
			bar.removeClass("active").css("background-color", "#e74c3c");
		} else if (status === "Cancelled") {
			bar.removeClass("active").css("background-color", "#e67e22");
		}

		this.page.main.find("#stat-status").text(status);
		this.page.main.find("#stat-total").text(total > 0 ? this._fmt(total) : (status === "Running" ? "Loading…" : "—"));
		this.page.main.find("#stat-inserted").text(this._fmt(inserted));
		this.page.main.find("#stat-skipped").text(this._fmt(skipped));
	}

	// Simple number formatter — no Frappe dependency, avoids silent failures
	_fmt(n) {
		return Number(n || 0).toLocaleString();
	}

	_load_import_logs(reset = true) {
		const tbody = this.page.main.find("#gw-log-tbody");
		const loadMoreBtn = this.page.main.find("#btn-load-more-logs");
		const countEl = this.page.main.find("#gw-log-count");

		if (reset) {
			this._log_offset = 0;
			tbody.html('<tr><td colspan="10" class="text-center text-muted" style="padding:16px;">Loading…</td></tr>');
			loadMoreBtn.hide();
			countEl.text("");
		}

		frappe.call({
			method: "gigworkers.gig_workers.page.bulk_gig_worker_import.bulk_gig_worker_import.get_import_logs",
			args: { limit: this._log_limit, offset: this._log_offset },
			callback: (r) => {
				const data = r.message || {};
				const logs = data.logs || [];
				const total = data.total || 0;

				if (reset && !logs.length) {
					tbody.html('<tr><td colspan="10" class="text-center text-muted" style="padding:20px;">No import history yet.</td></tr>');
					countEl.text("");
					loadMoreBtn.hide();
					return;
				}

				const statusColor = { Completed: "#27ae60", Failed: "#e74c3c", Cancelled: "#e67e22" };
				const rows = logs.map((log) => {
					const color = statusColor[log.status] || "#888";
					const dot = `<span style="color:${color};">●</span>`;
					const badge = `${dot} <span style="font-weight:600;">${log.status || "—"}</span>`;
					const dt = log.import_date ? frappe.datetime.str_to_user(log.import_date) : "—";
					const errStyle = (log.error_count || 0) > 0 ? "color:#e74c3c; font-weight:600;" : "";
					const insertedStyle = (log.inserted || 0) > 0 ? "color:#27ae60; font-weight:600;" : "";
					return `<tr>
						<td style="font-family:monospace; font-size:12px;">${log.name || "—"}</td>
						<td style="white-space:nowrap;">${dt}</td>
						<td style="max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"
							title="${log.file_name || ""}">${log.file_name || "—"}</td>
						<td>${badge}</td>
						<td style="text-align:right;">${this._fmt(log.total_rows)}</td>
						<td style="text-align:right; ${insertedStyle}">${this._fmt(log.inserted)}</td>
						<td style="text-align:right; color:#e67e22;">${this._fmt(log.skipped)}</td>
						<td style="text-align:right; ${errStyle}">${this._fmt(log.error_count)}</td>
						<td style="max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"
							title="${log.imported_by || ""}">${log.imported_by || "—"}</td>
						<td style="text-align:center;">
							<button class="btn btn-xs btn-default btn-view-detail"
								data-name="${log.name}"
								style="padding:2px 8px; font-size:11px; white-space:nowrap;">
								<i class="fa fa-eye"></i> Details
							</button>
						</td>
					</tr>`;
				});

				if (reset) {
					tbody.html(rows.join(""));
				} else {
					tbody.append(rows.join(""));
				}

				// Wire up detail buttons (delegated so it works after append too)
				tbody.find(".btn-view-detail").off("click").on("click", (e) => {
					this._show_log_detail($(e.currentTarget).data("name"));
				});

				this._log_offset += logs.length;
				const shown = this._log_offset;

				if (shown < total) {
					loadMoreBtn.show();
					countEl.text(`Showing ${shown} of ${total}`);
				} else {
					loadMoreBtn.hide();
					countEl.text(total > 0 ? `All ${total} record(s) shown` : "");
				}
			},
		});
	}

	_show_log_detail(log_name) {
		frappe.call({
			method: "gigworkers.gig_workers.page.bulk_gig_worker_import.bulk_gig_worker_import.get_log_detail",
			args: { log_name },
			freeze: true,
			freeze_message: __("Loading details…"),
			callback: (r) => {
				if (!r.message) return;
				const d = r.message;
				const fmt = (n) => Number(n || 0).toLocaleString();
				const statusColor = { Completed: "#27ae60", Failed: "#e74c3c", Cancelled: "#e67e22" };
				const sc = statusColor[d.status] || "#888";

				const summary_html = `
					<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px 24px; margin-bottom:16px;">
						<div><span class="text-muted" style="font-size:12px;">Log ID</span><br>
							<b style="font-family:monospace;">${d.name}</b></div>
						<div><span class="text-muted" style="font-size:12px;">Status</span><br>
							<b style="color:${sc};">● ${d.status || "—"}</b></div>
						<div><span class="text-muted" style="font-size:12px;">Import Date</span><br>
							<b>${d.import_date ? frappe.datetime.str_to_user(d.import_date) : "—"}</b></div>
						<div><span class="text-muted" style="font-size:12px;">Imported By</span><br>
							<b>${d.imported_by || "—"}</b></div>
						<div><span class="text-muted" style="font-size:12px;">File</span><br>
							<b style="word-break:break-all;">${d.file_name || "—"}</b></div>
						<div><span class="text-muted" style="font-size:12px;">Import ID</span><br>
							<b style="font-family:monospace; font-size:12px;">${d.import_id || "—"}</b></div>
					</div>
					<div style="display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-bottom:16px;">
						<div style="background:#f8f9fa; border-radius:6px; padding:10px; text-align:center;">
							<div style="font-size:11px; color:#888;">Total Rows</div>
							<div style="font-size:20px; font-weight:700;">${fmt(d.total_rows)}</div>
						</div>
						<div style="background:#eafaf1; border-radius:6px; padding:10px; text-align:center;">
							<div style="font-size:11px; color:#27ae60;">Inserted</div>
							<div style="font-size:20px; font-weight:700; color:#27ae60;">${fmt(d.inserted)}</div>
						</div>
						<div style="background:#fef9e7; border-radius:6px; padding:10px; text-align:center;">
							<div style="font-size:11px; color:#e67e22;">Skipped</div>
							<div style="font-size:20px; font-weight:700; color:#e67e22;">${fmt(d.skipped)}</div>
						</div>
						<div style="background:#fdedec; border-radius:6px; padding:10px; text-align:center;">
							<div style="font-size:11px; color:#e74c3c;">Errors</div>
							<div style="font-size:20px; font-weight:700; color:#e74c3c;">${fmt(d.error_count)}</div>
						</div>
					</div>
					${d.error_log ? `
					<div>
						<label style="font-size:12px; color:#e74c3c; font-weight:600;">Error / Skip Details</label>
						<textarea class="form-control" rows="10" readonly
							style="font-size:11px; font-family:monospace; background:#fff8f0;
							       border-color:#e67e22; resize:vertical;">${frappe.utils.escape_html(d.error_log)}</textarea>
					</div>` : `<p class="text-muted" style="text-align:center; padding:8px;">No errors recorded.</p>`}
				`;

				const dlg = new frappe.ui.Dialog({
					title: __("Import Log — ") + d.name,
					size: "large",
					fields: [{ fieldtype: "HTML", options: summary_html }],
				});
				dlg.show();
			},
		});
	}

	_download_template() {
		window.open(
			"/api/method/gigworkers.gig_workers.page.bulk_gig_worker_import.bulk_gig_worker_import.get_import_template",
			"_blank"
		);
	}

	_human_size(bytes) {
		if (bytes < 1024) return bytes + " B";
		if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
		return (bytes / 1048576).toFixed(1) + " MB";
	}
}
