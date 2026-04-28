frappe.pages["grievance-portal"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Grievance Portal",
		single_column: true,
	});

	$(wrapper).find(".page-content").html(`<div id="grv-root" style="padding:24px 20px;max-width:1100px;margin:0 auto;"></div>`);

	let _portal_data   = null;
	let _active_view   = "list";
	let _filter_status = "";
	let _attachment_url = "";

	// ── Global styles ────────────────────────────────────────────────────────────
	if (!document.getElementById("grv-global-styles")) {
		$("<style id='grv-global-styles'>").text(`
			.grv-btn-primary {
				background: linear-gradient(135deg,#4e73df,#3a5bbf);
				color:#fff;border:none;border-radius:8px;
				padding:10px 22px;font-size:13px;font-weight:600;cursor:pointer;
				display:inline-flex;align-items:center;gap:7px;
				transition:opacity .15s,box-shadow .15s;
			}
			.grv-btn-primary:hover { opacity:.92;box-shadow:0 4px 14px rgba(78,115,223,.4); }
			.grv-btn-primary:disabled { opacity:.6;cursor:not-allowed; }
			.grv-btn-secondary {
				background:#fff;color:#4e73df;
				border:1.5px solid #4e73df;border-radius:8px;
				padding:9px 20px;font-size:13px;font-weight:600;cursor:pointer;
				display:inline-flex;align-items:center;gap:7px;
				transition:background .15s;
			}
			.grv-btn-secondary:hover { background:#eef2ff; }
			.grv-btn-ghost {
				background:none;border:none;color:#4e73df;
				font-size:13px;font-weight:600;cursor:pointer;
				padding:0;display:inline-flex;align-items:center;gap:6px;
			}
			.grv-btn-ghost:hover { text-decoration:underline; }
			.grv-input {
				width:100%;padding:10px 13px;
				border:1.5px solid #dde1ef;border-radius:8px;
				font-size:13px;color:#333;box-sizing:border-box;
				background:#fafbff;transition:border-color .2s,box-shadow .2s;
				outline:none;
			}
			.grv-input:focus {
				border-color:#4e73df;background:#fff;
				box-shadow:0 0 0 3px rgba(78,115,223,.12);
			}
			.grv-input::placeholder { color:#b0b8d1; }
			.grv-label {
				display:block;font-size:12px;font-weight:700;
				color:#4a5568;margin-bottom:6px;letter-spacing:.3px;
				text-transform:uppercase;
			}
			.grv-req { color:#e74a3b;margin-left:2px; }
			.grv-field { margin-bottom:20px; }
			.grv-hint { font-size:11px;color:#a0aec0;margin-top:4px; }
			.grv-card-hover:hover { box-shadow:0 6px 24px rgba(0,0,0,.12) !important;transform:translateY(-1px); }
			.grv-slide { transition:opacity .2s; }
			.grv-tab-btn { transition:all .15s; }
			.grv-tab-btn:hover:not(.grv-tab-active) { background:#f0f4ff !important;color:#4e73df !important; }
		`).appendTo("head");
	}

	fetch_portal_data();

	// ── Data fetch ───────────────────────────────────────────────────────────────
	function fetch_portal_data() {
		show_loading();
		frappe.call({
			method: "gigworkers.gig_workers.page.grievance_portal.grievance_portal.get_portal_data",
			callback(r) {
				if (r.message) {
					_portal_data = r.message;
					render_list_view();
				} else {
					show_error("Failed to load grievances. Please refresh.");
				}
			},
			error() { show_error("Unable to connect. Please refresh."); },
		});
	}

	function fetch_detail(name) {
		show_loading();
		frappe.call({
			method: "gigworkers.gig_workers.page.grievance_portal.grievance_portal.get_grievance_detail",
			args: { grievance_name: name },
			callback(r) {
				if (r.message) { render_detail_view(r.message); }
				else { show_error("Failed to load grievance."); }
			},
			error() { show_error("Failed to load grievance."); },
		});
	}

	// ── Helpers ──────────────────────────────────────────────────────────────────
	function show_loading() {
		$("#grv-root").html(`
			<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
				height:260px;color:#a0aec0;gap:16px;">
				<div style="width:40px;height:40px;border:3px solid #e2e8f0;border-top-color:#4e73df;
					border-radius:50%;animation:grv-spin 0.7s linear infinite;"></div>
				<span style="font-size:14px;">Loading...</span>
			</div>
			<style>@keyframes grv-spin{to{transform:rotate(360deg)}}</style>`);
	}

	function show_error(msg) {
		$("#grv-root").html(`
			<div style="text-align:center;padding:48px;color:#e74a3b;">
				<i class="fa fa-exclamation-circle fa-2x" style="margin-bottom:12px;"></i>
				<p style="font-size:14px;margin:0;">${msg}</p>
			</div>`);
	}

	const STATUS_COLOR = { Open:"#e74a3b","In Review":"#fd7e14",Resolved:"#28a745",Closed:"#6c757d" };
	const PRIORITY_COLOR = { Low:"#28a745",Medium:"#17a2b8",High:"#fd7e14",Urgent:"#e74a3b" };
	const PRIORITY_ICON  = { Low:"fa-arrow-down",Medium:"fa-minus",High:"fa-arrow-up",Urgent:"fa-exclamation" };
	const CAT_ICON = {
		"Payment Issue":"fa-money","Service Issue":"fa-wrench","Platform Issue":"fa-desktop",
		"Welfare Fund Issue":"fa-heart","Worker Mapping Issue":"fa-users","Other":"fa-question-circle",
	};

	function status_badge(s) {
		const c = STATUS_COLOR[s] || "#6c757d";
		return `<span style="background:${c}22;color:${c};border:1px solid ${c}55;
			padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;
			white-space:nowrap;">${s || "-"}</span>`;
	}

	function priority_badge(p) {
		const c = PRIORITY_COLOR[p] || "#17a2b8";
		const i = PRIORITY_ICON[p] || "fa-minus";
		return `<span style="background:${c};color:#fff;padding:2px 9px;border-radius:20px;
			font-size:11px;font-weight:700;display:inline-flex;align-items:center;gap:4px;white-space:nowrap;">
			<i class="fa ${i}" style="font-size:9px;"></i>${p || "Medium"}
		</span>`;
	}

	function fmt_date(d) { return d ? d.substring(0, 10) : "-"; }
	function fmt_datetime(d) { return d ? d.substring(0, 16).replace("T", " ") : "-"; }

	function cat_display(cat, other_cat) {
		return cat === "Other" && other_cat ? `Other – ${other_cat}` : (cat || "-");
	}

	// ── List View ────────────────────────────────────────────────────────────────
	function render_list_view() {
		const data = _portal_data;
		const role = data.role;
		const all_grv = data.grievances || [];
		const filtered = _filter_status ? all_grv.filter(g => g.status === _filter_status) : all_grv;

		const counts = {};
		["Open","In Review","Resolved","Closed"].forEach(s => {
			counts[s] = all_grv.filter(g => g.status === s).length;
		});

		// Stat cards
		const stats_html = ["Open","In Review","Resolved","Closed"].map(s => {
			const c = STATUS_COLOR[s];
			return `<div style="flex:1;min-width:110px;background:#fff;border-radius:12px;
				padding:16px 18px;box-shadow:0 2px 10px rgba(0,0,0,.06);
				border-top:3px solid ${c};text-align:center;cursor:pointer;"
				data-filter-stat="${s}">
				<div style="font-size:26px;font-weight:800;color:${c};line-height:1;">${counts[s]}</div>
				<div style="font-size:11px;color:#a0aec0;text-transform:uppercase;letter-spacing:.5px;margin-top:4px;">${s}</div>
			</div>`;
		}).join("");

		// Filter tabs
		const tabs = [["","All",all_grv.length],...["Open","In Review","Resolved","Closed"].map(s=>[s,s,counts[s]])]
			.map(([val, label, cnt]) => {
				const active = _filter_status === val;
				const c = active ? "#4e73df" : "#718096";
				return `<button class="grv-tab-btn ${active ? "grv-tab-active" : ""}"
					data-status="${val}"
					style="background:${active ? "#4e73df" : "#fff"};color:${active ? "#fff" : c};
						border:1.5px solid ${active ? "#4e73df" : "#e2e8f0"};border-radius:20px;
						padding:5px 16px;font-size:12px;font-weight:${active?"700":"500"};
						cursor:pointer;white-space:nowrap;">
					${label}
					<span style="background:${active?"rgba(255,255,255,.25)":"#edf2f7"};
						color:${active?"#fff":c};border-radius:10px;padding:0px 7px;
						font-size:10px;margin-left:3px;">${cnt}</span>
				</button>`;
			}).join("");

		// No-profile warning banner for workers
		const warn_banner = (role === "worker" && !data.has_gw_profile)
			? `<div style="background:#fff8e1;border:1px solid #ffe082;border-radius:10px;
				padding:12px 18px;margin-bottom:20px;display:flex;align-items:center;gap:10px;">
				<i class="fa fa-info-circle" style="color:#f9a825;font-size:16px;"></i>
				<span style="font-size:13px;color:#795548;">
					Your account is not yet linked to a Gig Worker profile.
					You can still submit grievances — they will be tracked by your user account.
				</span>
			</div>` : "";

		// Cards
		const cards_html = filtered.length === 0
			? `<div style="text-align:center;padding:56px 24px;background:#fff;border-radius:14px;
				box-shadow:0 2px 10px rgba(0,0,0,.05);">
				<div style="width:64px;height:64px;background:#f0f4ff;border-radius:50%;
					display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">
					<i class="fa fa-inbox fa-2x" style="color:#4e73df;"></i>
				</div>
				<div style="font-size:15px;font-weight:600;color:#4a5568;margin-bottom:6px;">
					${_filter_status ? `No ${_filter_status} grievances` : "No grievances yet"}
				</div>
				<div style="font-size:13px;color:#a0aec0;">
					${role === "worker" ? "Click 'Submit New Grievance' to raise your first grievance." : "Nothing to show here."}
				</div>
			</div>`
			: filtered.map(g => {
				const pclr = PRIORITY_COLOR[g.priority] || "#17a2b8";
				const picon = PRIORITY_ICON[g.priority] || "fa-minus";
				const cd = cat_display(g.category, g.other_category);
				const icon = CAT_ICON[g.category] || "fa-file-text-o";
				return `
				<div class="grv-card-hover" data-grv-name="${g.name}"
					style="background:#fff;border-radius:12px;margin-bottom:12px;cursor:pointer;
						box-shadow:0 2px 10px rgba(0,0,0,.06);overflow:hidden;
						transition:box-shadow .2s,transform .2s;">
					<!-- Priority top bar -->
					<div style="height:3px;background:${pclr};"></div>
					<div style="padding:16px 20px;">
						<div style="display:flex;align-items:flex-start;gap:14px;">
							<!-- Category icon circle -->
							<div style="width:40px;height:40px;border-radius:10px;background:${pclr}18;
								display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px;">
								<i class="fa ${icon}" style="color:${pclr};font-size:15px;"></i>
							</div>
							<div style="flex:1;min-width:0;">
								<!-- Badges row -->
								<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:6px;">
									<span style="font-size:11px;font-weight:700;color:#a0aec0;">${g.name}</span>
									${status_badge(g.status)}
									${priority_badge(g.priority)}
								</div>
								<!-- Title -->
								<div style="font-size:15px;font-weight:700;color:#2d3748;margin-bottom:5px;
									white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
									${g.title}
								</div>
								<!-- Meta row -->
								<div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;font-size:12px;color:#718096;">
									<span><i class="fa ${icon}" style="margin-right:3px;"></i>${cd}</span>
									<span>·</span>
									<span><i class="fa fa-calendar" style="margin-right:3px;"></i>${fmt_date(g.submitted_date)}</span>
									${role !== "worker" && g.gig_worker_name ? `
									<span>·</span>
									<span><i class="fa fa-user" style="margin-right:3px;"></i>${g.gig_worker_name}</span>` : ""}
									${g.aggregator ? `
									<span>·</span>
									<span><i class="fa fa-building" style="margin-right:3px;"></i>${g.aggregator}</span>` : ""}
								</div>
							</div>
							<div style="flex-shrink:0;color:#cbd5e0;margin-top:8px;">
								<i class="fa fa-chevron-right"></i>
							</div>
						</div>
					</div>
				</div>`;
			}).join("");

		const html = `
		<div style="display:flex;justify-content:space-between;align-items:center;
			margin-bottom:22px;flex-wrap:wrap;gap:12px;">
			<div>
				<h3 style="font-weight:800;color:#2d3748;margin:0 0 4px;font-size:20px;">
					${{ worker:"My Grievances", aggregator:"Worker Grievances", admin:"All Grievances" }[role]}
				</h3>
				<p style="font-size:13px;color:#a0aec0;margin:0;">
					${{ worker:"Track and manage your submitted grievances",
						aggregator:"Grievances from workers on your platform",
						admin:"Manage and respond to all platform grievances" }[role]}
				</p>
			</div>
			${role === "worker" ? `
			<button id="grv-btn-new" class="grv-btn-primary">
				<i class="fa fa-plus"></i> Submit New Grievance
			</button>` : ""}
		</div>

		${warn_banner}

		<!-- Stat cards -->
		<div id="grv-stats-row" style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:22px;">
			${stats_html}
		</div>

		<!-- Filter tabs -->
		<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:18px;align-items:center;">
			<span style="font-size:11px;font-weight:700;color:#a0aec0;text-transform:uppercase;letter-spacing:.5px;margin-right:4px;">Filter</span>
			${tabs}
		</div>

		<!-- Grievance cards -->
		<div id="grv-cards">${cards_html}</div>`;

		$("#grv-root").html(html);

		// Events
		if (role === "worker") {
			$("#grv-btn-new").on("click", () => render_new_form());
		}

		$(".grv-tab-btn").on("click", function () {
			_filter_status = $(this).data("status");
			render_list_view();
		});

		$("[data-filter-stat]").on("click", function () {
			const s = $(this).data("filter-stat");
			_filter_status = _filter_status === s ? "" : s;
			render_list_view();
		});

		$("[data-grv-name]").on("click", function () {
			fetch_detail($(this).data("grv-name"));
		});
	}

	// ── New Grievance Form ───────────────────────────────────────────────────────
	function render_new_form() {
		_active_view = "new";
		_attachment_url = "";
		const aggregators = (_portal_data && _portal_data.aggregators) || [];
		const user_name = (_portal_data && _portal_data.user_display_name) || frappe.session.user_fullname || "";

		const agg_options = aggregators.map(a =>
			`<option value="${a.name}">${a.aggregator_name || a.name}</option>`
		).join("");

		const html = `
		<!-- Back nav -->
		<div style="margin-bottom:20px;">
			<button id="grv-back" class="grv-btn-ghost">
				<i class="fa fa-arrow-left"></i> Back to Grievances
			</button>
		</div>

		<!-- Form card -->
		<div style="background:#fff;border-radius:16px;overflow:hidden;
			box-shadow:0 4px 24px rgba(0,0,0,.10);max-width:780px;margin:0 auto;">

			<!-- Coloured header -->
			<div style="background:linear-gradient(135deg,#4e73df,#3657c5);padding:24px 30px;">
				<div style="display:flex;align-items:center;gap:14px;">
					<div style="width:46px;height:46px;border-radius:12px;background:rgba(255,255,255,.2);
						display:flex;align-items:center;justify-content:center;">
						<i class="fa fa-file-text-o fa-lg" style="color:#fff;"></i>
					</div>
					<div>
						<h4 style="font-weight:800;color:#fff;margin:0 0 3px;font-size:18px;">Submit New Grievance</h4>
						<p style="font-size:12px;color:rgba(255,255,255,.75);margin:0;">
							Submitted by: <strong>${user_name}</strong> &nbsp;·&nbsp; Will be notified to Admin ${aggregators.length ? "& Aggregator" : ""}
						</p>
					</div>
				</div>
			</div>

			<!-- Form body -->
			<div style="padding:28px 30px;">
				<form id="grv-form">

					<!-- Title -->
					<div class="grv-field">
						<label class="grv-label">Title <span class="grv-req">*</span></label>
						<input id="grv-f-title" class="grv-input" type="text"
							placeholder="Brief title of your grievance" maxlength="140" />
						<div style="display:flex;justify-content:space-between;margin-top:4px;">
							<span class="grv-hint">Summarise your issue in a few words</span>
							<span class="grv-hint"><span id="grv-title-cnt">0</span>/140</span>
						</div>
					</div>

					<!-- Category + Priority -->
					<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
						<div class="grv-field">
							<label class="grv-label">Category <span class="grv-req">*</span></label>
							<select id="grv-f-cat" class="grv-input">
								<option value="">-- Select Category --</option>
								<option value="Payment Issue">💳 Payment Issue</option>
								<option value="Service Issue">🔧 Service Issue</option>
								<option value="Platform Issue">🖥️ Platform Issue</option>
								<option value="Welfare Fund Issue">❤️ Welfare Fund Issue</option>
								<option value="Worker Mapping Issue">👥 Worker Mapping Issue</option>
								<option value="Other">❓ Other</option>
							</select>
						</div>
						<div class="grv-field">
							<label class="grv-label">Priority</label>
							<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;" id="grv-priority-grid">
								${[["Low","#28a745","fa-arrow-down"],["Medium","#17a2b8","fa-minus"],
								   ["High","#fd7e14","fa-arrow-up"],["Urgent","#e74a3b","fa-exclamation"]].map(([p,c,i]) => `
								<label style="display:flex;align-items:center;gap:8px;padding:8px 12px;
									border:2px solid #e2e8f0;border-radius:8px;cursor:pointer;
									transition:all .15s;" class="grv-priority-option" data-priority="${p}" data-color="${c}">
									<input type="radio" name="grv-priority" value="${p}" ${p==="Medium"?"checked":""} style="display:none;">
									<span style="width:10px;height:10px;border-radius:50%;background:${c};flex-shrink:0;"></span>
									<span style="font-size:12px;font-weight:600;color:#4a5568;">${p}</span>
								</label>`).join("")}
							</div>
						</div>
					</div>

					<!-- Other category (hidden by default) -->
					<div class="grv-field" id="grv-other-cat-wrap" style="display:none;
						background:#fffbeb;border:1.5px solid #fcd34d;border-radius:10px;padding:14px 16px;">
						<label class="grv-label" style="color:#92400e;">
							<i class="fa fa-pencil"></i> Please Specify Category <span class="grv-req">*</span>
						</label>
						<input id="grv-f-other-cat" class="grv-input" type="text"
							placeholder="e.g. App crash, Incorrect deduction, Login issue…" maxlength="100" />
					</div>

					<!-- Aggregator -->
					${agg_options ? `
					<div class="grv-field">
						<label class="grv-label">Related Aggregator <span style="font-weight:400;color:#a0aec0;">(Optional)</span></label>
						<select id="grv-f-agg" class="grv-input">
							<option value="">-- None --</option>
							${agg_options}
						</select>
						<span class="grv-hint">Select if this grievance relates to a specific platform/aggregator</span>
					</div>` : ""}

					<!-- Description -->
					<div class="grv-field">
						<label class="grv-label">Description <span class="grv-req">*</span></label>
						<textarea id="grv-f-desc" class="grv-input" rows="5"
							placeholder="Describe your grievance in detail — include dates, transaction IDs, or any relevant context."
							maxlength="2000" style="resize:vertical;line-height:1.6;"></textarea>
						<div style="display:flex;justify-content:space-between;margin-top:4px;">
							<span class="grv-hint">Be specific to help us resolve faster</span>
							<span class="grv-hint"><span id="grv-desc-cnt">0</span>/2000</span>
						</div>
					</div>

					<!-- Attachment -->
					<div class="grv-field">
						<label class="grv-label">Supporting Document <span style="font-weight:400;color:#a0aec0;">(Optional)</span></label>
						<div style="border:2px dashed #dde1ef;border-radius:10px;padding:16px 18px;
							background:#fafbff;display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
							<button type="button" id="grv-btn-attach" class="grv-btn-secondary"
								style="padding:8px 16px;font-size:12px;">
								<i class="fa fa-paperclip"></i> Attach File
							</button>
							<div style="flex:1;min-width:120px;">
								<div id="grv-attach-name" style="font-size:13px;color:#a0aec0;">
									No file selected
								</div>
								<div style="font-size:11px;color:#b0b8d1;margin-top:2px;">
									Supported: images, PDF, screenshots (max 5 MB)
								</div>
							</div>
							<button type="button" id="grv-btn-attach-rm"
								style="display:none;background:none;border:none;color:#e74a3b;cursor:pointer;font-size:13px;padding:0;">
								<i class="fa fa-times-circle"></i> Remove
							</button>
						</div>
					</div>

					<!-- Actions -->
					<div style="display:flex;justify-content:flex-end;gap:12px;
						padding-top:20px;border-top:1px solid #f0f4f8;">
						<button type="button" id="grv-btn-cancel" class="grv-btn-secondary">
							Cancel
						</button>
						<button type="submit" id="grv-btn-submit" class="grv-btn-primary">
							<i class="fa fa-paper-plane"></i> Submit Grievance
						</button>
					</div>

				</form>
			</div>
		</div>`;

		$("#grv-root").html(html);

		// Highlight selected priority option on load
		_update_priority_ui($('input[name="grv-priority"]:checked').val());

		// Priority radio selection
		$(".grv-priority-option").on("click", function () {
			const p = $(this).data("priority");
			$(this).find("input").prop("checked", true);
			_update_priority_ui(p);
		});

		function _update_priority_ui(selected) {
			$(".grv-priority-option").each(function () {
				const p = $(this).data("priority");
				const c = $(this).data("color");
				if (p === selected) {
					$(this).css({ border: `2px solid ${c}`, background: `${c}12` });
					$(this).find("span:last").css("color", c);
				} else {
					$(this).css({ border: "2px solid #e2e8f0", background: "#fff" });
					$(this).find("span:last").css("color", "#4a5568");
				}
			});
		}

		// Character counters
		$("#grv-f-title").on("input", function () { $("#grv-title-cnt").text($(this).val().length); });
		$("#grv-f-desc").on("input", function () { $("#grv-desc-cnt").text($(this).val().length); });

		// Show/hide other category
		$("#grv-f-cat").on("change", function () {
			if ($(this).val() === "Other") {
				$("#grv-other-cat-wrap").slideDown(180);
				$("#grv-f-other-cat").focus();
			} else {
				$("#grv-other-cat-wrap").slideUp(180);
				$("#grv-f-other-cat").val("");
			}
		});

		// Attach file
		$("#grv-btn-attach").on("click", function () {
			new frappe.ui.FileUploader({
				allow_multiple: false,
				restrictions: { max_file_size: 5 * 1024 * 1024 },
				on_success(file) {
					_attachment_url = file.file_url;
					const fname = file.file_name || file.file_url.split("/").pop();
					$("#grv-attach-name").html(
						`<a href="${_attachment_url}" target="_blank"
							style="color:#4e73df;font-weight:600;text-decoration:none;">
							<i class="fa fa-file" style="margin-right:4px;"></i>${fname}
						</a>`
					);
					$("#grv-btn-attach-rm").show();
					$("#grv-btn-attach").html('<i class="fa fa-refresh"></i> Change File');
				},
			});
		});

		$("#grv-btn-attach-rm").on("click", function () {
			_attachment_url = "";
			$("#grv-attach-name").text("No file selected");
			$(this).hide();
			$("#grv-btn-attach").html('<i class="fa fa-paperclip"></i> Attach File');
		});

		// Back / Cancel
		$("#grv-back, #grv-btn-cancel").on("click", function () {
			_active_view = "list";
			render_list_view();
		});

		// Submit
		$("#grv-form").on("submit", function (e) {
			e.preventDefault();

			const title        = $("#grv-f-title").val().trim();
			const category     = $("#grv-f-cat").val();
			const other_cat    = $("#grv-f-other-cat").val().trim();
			const priority     = $('input[name="grv-priority"]:checked').val() || "Medium";
			const description  = $("#grv-f-desc").val().trim();
			const aggregator   = $("#grv-f-agg").val() || "";
			const attachment   = _attachment_url || "";

			if (!title)    { _shake("#grv-f-title");   frappe.show_alert({ message:"Title is required.",indicator:"red" }); return; }
			if (!category) { _shake("#grv-f-cat");     frappe.show_alert({ message:"Please select a category.",indicator:"red" }); return; }
			if (category === "Other" && !other_cat) {
				_shake("#grv-f-other-cat");
				frappe.show_alert({ message:"Please specify the category.",indicator:"red" });
				return;
			}
			if (!description) { _shake("#grv-f-desc"); frappe.show_alert({ message:"Description is required.",indicator:"red" }); return; }

			const $btn = $("#grv-btn-submit");
			$btn.prop("disabled", true).html('<i class="fa fa-spinner fa-spin"></i> Submitting…');

			frappe.call({
				method: "gigworkers.gig_workers.page.grievance_portal.grievance_portal.submit_grievance",
				args: { title, category, description, priority, aggregator, attachment, other_category: other_cat },
				callback(r) {
					if (r.message) {
						frappe.show_alert({ message:`Grievance <strong>${r.message}</strong> submitted.`, indicator:"green" });
						_active_view = "list";
						fetch_portal_data();
					} else {
						frappe.show_alert({ message:"Failed to submit. Please try again.", indicator:"red" });
						$btn.prop("disabled", false).html('<i class="fa fa-paper-plane"></i> Submit Grievance');
					}
				},
				error(r) {
					const msg = r && r._server_messages
						? JSON.parse(r._server_messages)[0].replace(/<[^>]+>/g,"")
						: "Error submitting grievance.";
					frappe.show_alert({ message: msg, indicator:"red" });
					$btn.prop("disabled", false).html('<i class="fa fa-paper-plane"></i> Submit Grievance');
				},
			});
		});

		function _shake(sel) {
			const $el = $(sel);
			$el.css("border-color","#e74a3b");
			setTimeout(() => $el.css("border-color",""), 2000);
		}
	}

	// ── Detail View ──────────────────────────────────────────────────────────────
	function render_detail_view(grv) {
		const role = _portal_data ? _portal_data.role : "worker";
		const can_reply  = true;
		const can_status = can_reply;
		const sc = STATUS_COLOR[grv.status] || "#6c757d";
		const pc = PRIORITY_COLOR[grv.priority] || "#17a2b8";

		const status_options = ["Open","In Review","Resolved","Closed"]
			.map(s => `<option value="${s}" ${grv.status===s?"selected":""}>${s}</option>`).join("");

		const cd = cat_display(grv.category, grv.other_category);

		const replies_html = (grv.replies && grv.replies.length)
			? grv.replies.map(r => {
				const rc = r.replied_by_role === "Admin" ? "#4e73df" : r.replied_by_role === "Aggregator" ? "#1cc88a" : "#fd7e14";
				const init = (r.replied_by_name || r.replied_by || "?")[0].toUpperCase();
				return `
				<div style="display:flex;gap:12px;margin-bottom:16px;">
					<div style="width:36px;height:36px;border-radius:50%;background:${rc};
						color:#fff;display:flex;align-items:center;justify-content:center;
						font-weight:800;font-size:14px;flex-shrink:0;">${init}</div>
					<div style="flex:1;background:#f7f9ff;border-radius:0 10px 10px 10px;padding:12px 16px;
						border:1px solid #e8eef8;">
						<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;">
							<span style="font-size:13px;font-weight:700;color:#2d3748;">
								${r.replied_by_name || r.replied_by}
							</span>
							<span style="background:${rc};color:#fff;font-size:10px;font-weight:700;
								padding:1px 8px;border-radius:10px;">${r.replied_by_role}</span>
							<span style="font-size:11px;color:#a0aec0;margin-left:auto;">${fmt_datetime(r.reply_date)}</span>
						</div>
						<div style="font-size:13px;color:#4a5568;line-height:1.7;white-space:pre-wrap;">${r.reply_text}</div>
					</div>
				</div>`;
			}).join("")
			: `<div style="text-align:center;padding:28px;color:#a0aec0;">
				<i class="fa fa-comment-o fa-2x" style="margin-bottom:8px;display:block;"></i>
				<span style="font-size:13px;">No replies yet.</span>
			</div>`;

		const html = `
		<!-- Back nav -->
		<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap;">
			<button id="grv-back-detail" class="grv-btn-ghost">
				<i class="fa fa-arrow-left"></i> Back to Grievances
			</button>
			<span style="color:#e2e8f0;">|</span>
			<span style="font-size:13px;font-weight:600;color:#a0aec0;">${grv.name}</span>
			${can_status ? `
			<div style="margin-left:auto;display:flex;align-items:center;gap:8px;">
				<label style="font-size:12px;font-weight:600;color:#718096;">Status:</label>
				<select id="grv-status-sel"
					style="padding:7px 12px;border:1.5px solid #dde1ef;border-radius:8px;
						font-size:12px;font-weight:700;color:${sc};background:#fff;cursor:pointer;">
					${status_options}
				</select>
				<button id="grv-btn-update-status" class="grv-btn-primary" style="padding:7px 16px;font-size:12px;">
					Update
				</button>
			</div>` : ""}
		</div>

		<div style="background:#fff;border-radius:16px;overflow:hidden;
			box-shadow:0 4px 24px rgba(0,0,0,.09);max-width:900px;margin:0 auto;">

			<!-- Coloured header -->
			<div style="background:linear-gradient(135deg,${pc}ee,${pc}99);padding:22px 28px;">
				<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px;">
					${status_badge(grv.status)}
					${priority_badge(grv.priority)}
					<span style="font-size:12px;color:rgba(255,255,255,.8);">
						<i class="fa ${CAT_ICON[grv.category]||"fa-file-text-o"}"></i> ${cd}
					</span>
				</div>
				<h4 style="font-weight:800;color:#fff;margin:0;font-size:18px;">${grv.title}</h4>
			</div>

			<div style="padding:24px 28px;">

				<!-- Meta grid -->
				<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));
					gap:10px;margin-bottom:22px;">
					${[
						["Submitted", fmt_date(grv.submitted_date), "fa-calendar"],
						grv.gig_worker_name ? ["Worker", grv.gig_worker_name, "fa-user"] : null,
						grv.aggregator ? ["Aggregator", grv.aggregator, "fa-building"] : null,
						["Replies", (grv.replies||[]).length, "fa-comments"],
					].filter(Boolean).map(([lbl,val,icon]) => `
					<div style="background:#f7f9ff;border-radius:10px;padding:12px 14px;border:1px solid #e8eef8;">
						<div style="font-size:10px;font-weight:700;color:#a0aec0;text-transform:uppercase;
							letter-spacing:.5px;margin-bottom:4px;display:flex;align-items:center;gap:5px;">
							<i class="fa ${icon}"></i>${lbl}
						</div>
						<div style="font-size:14px;font-weight:700;color:#2d3748;">${val}</div>
					</div>`).join("")}
				</div>

				<!-- Description -->
				<div style="background:#fafbff;border-radius:10px;padding:18px 20px;
					margin-bottom:24px;border:1px solid #edf2f7;">
					<div style="font-size:11px;font-weight:700;color:#a0aec0;text-transform:uppercase;
						letter-spacing:.5px;margin-bottom:10px;">
						<i class="fa fa-align-left" style="margin-right:4px;"></i>Description
					</div>
					<div style="font-size:14px;color:#4a5568;line-height:1.8;white-space:pre-wrap;">${grv.description}</div>
					${grv.attachment ? `
					<div style="margin-top:12px;padding-top:12px;border-top:1px solid #edf2f7;">
						<a href="${grv.attachment}" target="_blank"
							style="color:#4e73df;font-size:13px;font-weight:600;text-decoration:none;">
							<i class="fa fa-paperclip" style="margin-right:4px;"></i>View Attachment
						</a>
					</div>` : ""}
				</div>

				<!-- Replies -->
				<div>
					<div style="font-size:13px;font-weight:700;color:#4a5568;margin-bottom:14px;
						display:flex;align-items:center;gap:8px;">
						<i class="fa fa-comments" style="color:#4e73df;"></i> Replies
						<span style="background:#edf2f7;color:#718096;font-size:11px;
							padding:1px 8px;border-radius:10px;">${(grv.replies||[]).length}</span>
					</div>
					<div id="grv-replies">${replies_html}</div>
				</div>

				<!-- Reply box -->
				${can_reply ? `
				<div style="margin-top:22px;padding-top:20px;border-top:2px solid #f0f4f8;">
					<div style="font-size:12px;font-weight:700;color:#4a5568;margin-bottom:10px;
						display:flex;align-items:center;gap:6px;">
						<i class="fa fa-reply" style="color:#4e73df;"></i>
						${role === "worker" ? "Follow Up" : "Add Reply"}
						<span style="font-size:11px;font-weight:400;color:#a0aec0;">
							— replying as <strong>${frappe.session.user_fullname || frappe.session.user}</strong>
							(${role === "admin" ? "Admin" : role === "aggregator" ? "Aggregator" : "Worker"})
						</span>
					</div>
					<textarea id="grv-reply-txt" class="grv-input" rows="4"
						placeholder="${role === "worker"
							? "Add a follow-up message. Admin and Aggregator will be notified."
							: "Type your reply here. The gig worker will be notified by email and in-app."
						}"
						style="resize:vertical;line-height:1.6;"></textarea>
					<div style="display:flex;justify-content:flex-end;margin-top:10px;">
						<button id="grv-btn-reply" class="grv-btn-primary">
							<i class="fa fa-paper-plane"></i> ${role === "worker" ? "Send Follow-Up" : "Send Reply"}
						</button>
					</div>
				</div>` : ""}

			</div>
		</div>`;

		$("#grv-root").html(html);

		// Back
		$("#grv-back-detail").on("click", () => { _active_view="list"; render_list_view(); });

		// Status update
		if (can_status) {
			$("#grv-status-sel").on("change", function () {
				$(this).css("color", STATUS_COLOR[$(this).val()] || "#6c757d");
			});
			$("#grv-btn-update-status").on("click", function () {
				const ns = $("#grv-status-sel").val();
				$(this).prop("disabled",true).html('<i class="fa fa-spinner fa-spin"></i>');
				frappe.call({
					method: "gigworkers.gig_workers.page.grievance_portal.grievance_portal.update_grievance_status",
					args: { grievance_name: grv.name, new_status: ns },
					callback(r) {
						if (r.message) {
							frappe.show_alert({ message:`Status updated to "${r.message.status}".`, indicator:"green" });
							fetch_detail(grv.name);
						}
					},
				});
			});
		}

		// Send reply
		if (can_reply) {
			$("#grv-btn-reply").on("click", function () {
				const txt = $("#grv-reply-txt").val().trim();
				if (!txt) { frappe.show_alert({ message:"Reply cannot be empty.",indicator:"red" }); return; }
				$(this).prop("disabled",true).html('<i class="fa fa-spinner fa-spin"></i> Sending…');
				frappe.call({
					method: "gigworkers.gig_workers.page.grievance_portal.grievance_portal.add_reply",
					args: { grievance_name: grv.name, reply_text: txt },
					callback(r) {
						if (!r.exc) {
							frappe.show_alert({ message:"Reply sent.", indicator:"green" });
							fetch_detail(grv.name);
						} else {
							frappe.show_alert({ message:"Failed to send reply.",indicator:"red" });
							const lbl = role === "worker" ? "Send Follow-Up" : "Send Reply";
							$("#grv-btn-reply").prop("disabled",false).html(`<i class="fa fa-paper-plane"></i> ${lbl}`);
						}
					},
					error() {
						frappe.show_alert({ message:"Error sending reply.",indicator:"red" });
						const lbl = role === "worker" ? "Send Follow-Up" : "Send Reply";
						$("#grv-btn-reply").prop("disabled",false).html(`<i class="fa fa-paper-plane"></i> ${lbl}`);
					},
				});
			});
		}
	}
};
