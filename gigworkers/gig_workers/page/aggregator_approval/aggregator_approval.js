// Aggregator Approval — the Board reviews aggregator registrations.
// Same look as the welfare dashboards (styles from public/js/welfare_dashboard.bundle.js).
// Filters → applications table (select for bulk actions) → Review panel with a KYC
// checklist and the actions: Mark under process / Ask for clarification / Approve.

const AA_API = 'gigworkers.gig_workers.page.aggregator_approval.aggregator_approval.';
const AA_STATUS = {
	'Submitted': { tone: '#8a5a00', label: __('Submitted') },
	'Under Process': { tone: '#2b4f7e', label: __('Under process') },
	'Pending with Clarification': { tone: '#b45309', label: __('Clarification asked') },
	'Approved': { tone: '#1d6b3a', label: __('Approved') }
};
const AA_SLOW_DAYS = 7;   // waiting longer than this is highlighted

frappe.pages['aggregator-approval'].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: __('Aggregator Approval'), single_column: true });
	wrapper.aa = new AggregatorApproval(page, wrapper);
};

class AggregatorApproval {
	constructor(page, wrapper) {
		this.page = page;
		this.$root = $(wrapper).find('.page-content');
		this.rows = [];
		this.filter = 'All';
		this.search = '';
		this.sort = { key: 'creation', dir: 'asc' };
		this.selected = new Set();
		this.render_shell();
		this.load();
		this.load_auto_days();
	}

	// ── helpers ──────────────────────────────────────────────────────────
	esc(v) { return frappe.utils.escape_html(v === null || v === undefined ? '' : String(v)); }
	date(d) { return d ? frappe.datetime.str_to_user(String(d).slice(0, 10)) : '—'; }
	pill(text, color) { return `<span class="wbd-pill" style="--c:${color}">${this.esc(text)}</span>`; }
	status_pill(s) { const m = AA_STATUS[s] || { tone: '#64748B', label: s }; return this.pill(m.label, m.tone); }
	waiting(days) {
		const slow = days > AA_SLOW_DAYS;
		return `<span class="aa-wait ${slow ? 'is-slow' : ''}">${days} ${days === 1 ? __('day') : __('days')}</span>`;
	}

	// KYC checks the reviewer would otherwise do by eye.
	checks(r) {
		const pan_ok = /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(r.pan_number || '');
		const gstin = (r.gstin || '').toUpperCase();
		return [
			{ ok: pan_ok, label: __('PAN in a valid format'), detail: r.pan_number || __('not given') },
			{ ok: !!gstin, label: __('GSTIN provided'), detail: gstin || __('not given') },
			{ ok: !!gstin && gstin.slice(2, 12) === (r.pan_number || '').toUpperCase(), label: __('GSTIN matches the PAN'),
				detail: gstin ? __('characters 3–12 of the GSTIN') : __('needs a GSTIN') },
			{ ok: !!(r.company_id || r.cin_number), label: __('{0} provided', [r.company_type || __('Company ID')]), detail: r.company_id || r.cin_number || __('not given') },
			{ ok: !!r.pan_file, label: __('PAN document uploaded') },
			{ ok: !!r.gstin_file, label: __('GSTIN document uploaded') },
			{ ok: (r.services || []).length > 0, label: __('Service category selected'), detail: (r.services || []).join(', ') },
		];
	}

	// ── layout ───────────────────────────────────────────────────────────
	render_shell() {
		const css = typeof WBD_CSS === 'string' ? WBD_CSS : '';
		this.$root.html(`<style>${css}${AA_CSS}</style>
			<div class="wbd-root aa-root">
				<div class="aa-kpis" id="aa-kpis"></div>
				<div class="wbd-filters aa-toolbar">
					<div class="wbd-search aa-search"><input type="search" id="aa-search" placeholder="${__('Search company, person, email, mobile, ID…')}"></div>
					<div class="aa-auto" title="${__('Submitted applications with no action from the Board are approved automatically after this many days. 0 turns it off.')}">
						<span>${__('Auto-approve untouched applications after')}</span>
						<input type="number" id="aa-auto-days" min="0" step="1">
						<span>${__('days')}</span>
						<button class="btn btn-default btn-xs" id="aa-auto-save">${__('Save')}</button>
						<span class="wbd-muted" id="aa-auto-note"></span>
					</div>
					<button class="btn btn-default btn-xs" id="aa-refresh">⟳ ${__('Refresh')}</button>
				</div>
				<div class="aa-bulk" id="aa-bulk" hidden>
					<span><b id="aa-bulk-n">0</b> ${__('selected')}</span>
					<button class="btn btn-default btn-sm" data-bulk="Under Process">${__('Mark under process')}</button>
					<button class="btn btn-default btn-sm aa-btn-clarify" data-bulk="Pending with Clarification">${__('Ask for clarification')}</button>
					<button class="btn btn-primary btn-sm aa-btn-approve" data-bulk="Approved">✓ ${__('Approve')}</button>
					<a class="aa-bulk-clear">${__('Clear selection')}</a>
				</div>
				<div class="wbd-panel">
					<div class="wbd-panel-head"><div>
						<div class="wbd-panel-title" id="aa-title">${__('Pending applications')}</div>
						<div class="wbd-panel-sub">${__('Oldest first · click Review to see the full application and decide')}</div>
					</div></div>
					<div class="wbd-table-scroll" id="aa-table"><div class="wbd-empty">${__('Loading…')}</div></div>
				</div>
			</div>`);

		const $r = this.$root;
		$r.find('#aa-search').on('input', (e) => { this.search = e.target.value.trim().toLowerCase(); this.render_table(); });
		$r.find('#aa-refresh').on('click', () => this.load());
		$r.find('#aa-auto-save').on('click', () => this.save_auto_days());
		$r.find('[data-bulk]').on('click', (e) => this.bulk(String($(e.currentTarget).data('bulk'))));
		$r.find('.aa-bulk-clear').on('click', () => { this.selected.clear(); this.render_table(); });
	}

	// ── data ─────────────────────────────────────────────────────────────
	load() {
		this.$root.find('.aa-root').addClass('wbd-loading');
		frappe.xcall(AA_API + 'get_pending_aggregators').then((rows) => {
			this.rows = rows || [];
			const names = new Set(this.rows.map(r => r.name));
			this.selected.forEach(n => { if (!names.has(n)) this.selected.delete(n); });
			this.$root.find('.aa-root').removeClass('wbd-loading');
			this.render_kpis();
			this.render_table();
		}).catch(() => this.$root.find('.aa-root').removeClass('wbd-loading'));
	}

	render_kpis() {
		const count = (s) => this.rows.filter(r => r.status === s).length;
		const oldest = this.rows.reduce((m, r) => Math.max(m, r.days_waiting || 0), 0);
		const kpi = (key, label, value, sub, tone) => `
			<div class="wbd-kpi is-click ${this.filter === key ? 'is-on' : ''}" data-filter="${key}" tabindex="0" role="button" style="--t:${tone}">
				<div class="wbd-kpi-top"><span class="wbd-kpi-label"><span class="wbd-dot" style="--c:${tone}"></span>${label}</span></div>
				<div class="wbd-kpi-value">${value}</div><div class="wbd-kpi-sub">${sub}</div>
			</div>`;
		const $k = this.$root.find('#aa-kpis').html(
			kpi('All', __('All pending'), this.rows.length, __('waiting for a decision'), '#920c24')
			+ kpi('Submitted', __('Submitted'), count('Submitted'), __('not picked up yet'), AA_STATUS['Submitted'].tone)
			+ kpi('Under Process', __('Under process'), count('Under Process'), __('being reviewed'), AA_STATUS['Under Process'].tone)
			+ kpi('Pending with Clarification', __('Clarification asked'), count('Pending with Clarification'), __('waiting on the aggregator'), AA_STATUS['Pending with Clarification'].tone)
			+ `<div class="wbd-kpi aa-kpi-static" style="--t:${oldest > AA_SLOW_DAYS ? '#a4161a' : '#6B6560'}">
				<div class="wbd-kpi-top"><span class="wbd-kpi-label">${__('Oldest waiting')}</span></div>
				<div class="wbd-kpi-value" style="color:var(--t)">${oldest} <small class="aa-kpi-unit">${__('days')}</small></div>
				<div class="wbd-kpi-sub">${oldest > AA_SLOW_DAYS ? __('over {0} days — review soon', [AA_SLOW_DAYS]) : __('within {0} days', [AA_SLOW_DAYS])}</div>
			</div>`);
		$k.find('[data-filter]').on('click keydown', (e) => {
			if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
			this.filter = String($(e.currentTarget).data('filter'));
			this.render_kpis();
			this.render_table();
		});
	}

	visible_rows() {
		const q = this.search;
		const rows = this.rows.filter(r => (this.filter === 'All' || r.status === this.filter)
			&& (!q || [r.name, r.aggregator_name, r.name1, r.email, r.mobile, r.company_id, r.pan_number]
				.some(v => String(v || '').toLowerCase().includes(q))));
		const { key, dir } = this.sort;
		const val = (r) => key === 'days' ? r.days_waiting : String(r[key] || '').toLowerCase();
		rows.sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * (dir === 'asc' ? 1 : -1));
		return rows;
	}

	render_table() {
		const rows = this.visible_rows();
		const label = this.filter === 'All' ? __('Pending applications') : (AA_STATUS[this.filter] || {}).label;
		this.$root.find('#aa-title').html(`${this.esc(label)} <span class="aa-count">${rows.length}</span>`);
		const $t = this.$root.find('#aa-table');
		if (!rows.length) {
			$t.html(`<div class="aa-empty"><span>✓</span><b>${this.rows.length ? __('No applications match') : __('No pending applications')}</b>
				<small>${this.rows.length ? __('Try another filter or search.') : __('Every registration has been decided.')}</small></div>`);
			this.sync_bulk();
			return;
		}
		const th = (key, text) => {
			const on = this.sort.key === key;
			return `<th class="is-sort" data-sort="${key}">${text}<span class="wbd-arrow">${on ? (this.sort.dir === 'asc' ? ' ▲' : ' ▼') : ' ↕'}</span></th>`;
		};
		const all = rows.every(r => this.selected.has(r.name));
		const body = rows.map(r => `
			<tr class="${this.selected.has(r.name) ? 'is-sel' : ''}">
				<td class="aa-check"><input type="checkbox" data-id="${this.esc(r.name)}" ${this.selected.has(r.name) ? 'checked' : ''}></td>
				<td><div class="aa-co"><b>${this.esc(r.aggregator_name)}</b>
					<a class="wbd-idlink" href="/desk/aggregator/${encodeURIComponent(r.name)}" target="_blank">${this.esc(r.name)} ↗</a></div>
					<div class="aa-services">${(r.services || []).map(s => this.pill(s, '#3d4a5c')).join(' ')}</div></td>
				<td><div>${this.esc(r.name1 || '—')}</div><small class="wbd-muted">${this.esc(r.desigination || '')}</small></td>
				<td><div class="aa-contact">${this.esc(r.email)}</div><small class="wbd-muted">${this.esc(r.mobile)}</small></td>
				<td>${this.status_pill(r.status)}${r.clarification_response ? `<div style="margin-top:4px">${this.pill(__('Reply received'), '#1d6b3a')}</div>` : ''}</td>
				<td>${this.waiting(r.days_waiting)}<small class="wbd-muted aa-sub">${this.esc(this.date(r.creation))}</small></td>
				<td class="aa-actions">
					<button class="btn btn-primary btn-xs" data-review="${this.esc(r.name)}">${__('Review')}</button>
					${r.status === 'Submitted' ? `<button class="btn btn-default btn-xs" data-act="Under Process" data-id="${this.esc(r.name)}">${__('Pick up')}</button>` : ''}
				</td>
			</tr>`).join('');
		$t.html(`<table class="wbd-table aa-table"><thead><tr>
			<th class="aa-check"><input type="checkbox" id="aa-all" ${all ? 'checked' : ''}></th>
			${th('aggregator_name', __('Application'))}${th('name1', __('Authorised person'))}<th>${__('Contact')}</th>
			${th('status', __('Status'))}${th('days', __('Waiting'))}<th>${__('Actions')}</th>
		</tr></thead><tbody>${body}</tbody></table>`);

		$t.find('th[data-sort]').on('click', (e) => {
			const key = String($(e.currentTarget).data('sort'));
			this.sort = { key, dir: this.sort.key === key && this.sort.dir === 'asc' ? 'desc' : 'asc' };
			this.render_table();
		});
		$t.find('#aa-all').on('change', (e) => { rows.forEach(r => e.target.checked ? this.selected.add(r.name) : this.selected.delete(r.name)); this.render_table(); });
		$t.find('tbody input[type=checkbox]').on('change', (e) => {
			const id = String($(e.target).data('id'));
			e.target.checked ? this.selected.add(id) : this.selected.delete(id);
			$(e.target).closest('tr').toggleClass('is-sel', e.target.checked);
			$t.find('#aa-all').prop('checked', rows.every(r => this.selected.has(r.name)));
			this.sync_bulk();
		});
		$t.find('[data-review]').on('click', (e) => this.review(String($(e.currentTarget).data('review'))));
		$t.find('[data-act]').on('click', (e) => this.act([String($(e.currentTarget).data('id'))], String($(e.currentTarget).data('act'))));
		this.sync_bulk();
	}

	sync_bulk() {
		const n = this.selected.size;
		this.$root.find('#aa-bulk').prop('hidden', !n);
		this.$root.find('#aa-bulk-n').text(n);
	}

	// ── review panel ─────────────────────────────────────────────────────
	review(name) {
		const r = this.rows.find(x => x.name === name);
		if (!r) return;
		const field = (label, value, mono) => `<div class="aa-field"><span>${label}</span><b class="${mono ? 'aa-mono' : ''}">${value || '<i class="wbd-muted">' + __('Not given') + '</i>'}</b></div>`;
		const link = (url) => url ? `<a href="${this.esc(url)}" target="_blank" rel="noopener">${this.esc(url.replace(/^https?:\/\//, ''))} ↗</a>` : '';
		const doc = (label, url) => `<div class="aa-doc ${url ? '' : 'is-missing'}">${frappe.utils.icon(url ? 'file-text' : 'file-x', 'sm')}
			<span>${label}</span>${url ? `<a href="${this.esc(url)}" target="_blank">${__('Open')} ↗</a>` : `<em>${__('Not uploaded')}</em>`}</div>`;
		const checks = this.checks(r);
		const passed = checks.filter(c => c.ok).length;
		const check_html = checks.map(c => `<div class="aa-chk ${c.ok ? 'ok' : 'no'}"><span>${c.ok ? '✓' : '✕'}</span>
			<div><b>${this.esc(c.label)}</b>${c.detail ? `<small>${this.esc(c.detail)}</small>` : ''}</div></div>`).join('');

		const d = new frappe.ui.Dialog({ title: __('Review application · {0}', [r.name]), size: 'extra-large' });
		d.$wrapper.find('.modal-dialog').addClass('wbd-modal');
		d.$body.html(`<style>${typeof WBD_CSS === 'string' ? WBD_CSS : ''}${AA_CSS}</style><div class="wbd-root wbd-in-modal aa-review">
			<div class="wbd-tlp-head">
				<div class="wbd-tlp-who"><div class="wbd-tlp-avatar" style="--c:${(AA_STATUS[r.status] || {}).tone || '#920c24'}">${this.esc(String(r.aggregator_name || '?').charAt(0))}</div>
					<div><div class="wbd-tlp-name">${this.esc(r.aggregator_name)}
						<a class="wbd-idlink" target="_blank" href="/desk/aggregator/${encodeURIComponent(r.name)}">${this.esc(r.name)} ↗</a></div>
					<div class="wbd-tlp-pills">${this.status_pill(r.status)} ${(r.services || []).map(s => this.pill(s, '#3d4a5c')).join(' ')}
						<span class="wbd-muted">${__('Submitted {0} · waiting {1} days', [this.date(r.creation), r.days_waiting])}</span></div></div>
				</div>
			</div>
			${r.status === 'Pending with Clarification' || r.clarification_comments ? `
				<div class="aa-clar">
					<div><span>${__('Board asked')}</span><p>${this.esc(r.clarification_comments || '—')}</p></div>
					<div><span>${__('Aggregator replied')}</span><p>${r.clarification_response ? this.esc(r.clarification_response) : `<i class="wbd-muted">${__('No reply yet')}</i>`}</p></div>
				</div>` : ''}
			<div class="aa-review-grid">
				<div>
					<div class="wbd-section-title"><span>${__('Company')}</span></div>
					<div class="aa-fields">
						${field(__('Registered name'), this.esc(r.aggregator_name))}
						${field(r.company_type === 'LLPIN' ? __('LLPIN') : __('CIN'), this.esc(r.company_id || r.cin_number), true)}
						${field(__('PAN'), this.esc(r.pan_number), true)}
						${field(__('GSTIN'), this.esc(r.gstin), true)}
						${field(__('Registered address'), this.esc(r.registered_address))}
						${field(__('Website'), link(r.website_url))}
						${field(__('App'), link(r.app_url))}
					</div>
					<div class="wbd-section-title"><span>${__('Authorised person')}</span></div>
					<div class="aa-fields">
						${field(__('Name'), this.esc(r.name1))}
						${field(__('Designation'), this.esc(r.desigination))}
						${field(__('Email'), this.esc(r.email))}
						${field(__('Mobile'), this.esc(r.mobile))}
					</div>
				</div>
				<div>
					<div class="wbd-section-title"><span>${__('KYC checklist')}</span><span class="wbd-section-note">${passed} / ${checks.length} ${__('passed')}</span></div>
					<div class="aa-checks">${check_html}</div>
					<div class="wbd-section-title"><span>${__('Documents')}</span></div>
					<div class="aa-docs">${doc(__('PAN card'), r.pan_file)}${doc(__('GSTIN certificate'), r.gstin_file)}${doc(__('Aadhaar of authorised person'), r.aadhaar_file)}</div>
				</div>
			</div>
			<div class="aa-review-actions">
				<a class="btn btn-default btn-sm" href="/desk/aggregator/${encodeURIComponent(r.name)}" target="_blank">${__('Open full record')} ↗</a>
				<span class="aa-spacer"></span>
				${r.status === 'Submitted' ? `<button class="btn btn-default btn-sm" data-do="Under Process">${__('Mark under process')}</button>` : ''}
				<button class="btn btn-default btn-sm aa-btn-clarify" data-do="Pending with Clarification">${__('Ask for clarification')}</button>
				<button class="btn btn-primary btn-sm aa-btn-approve" data-do="Approved">✓ ${__('Approve')}</button>
			</div>
		</div>`);
		d.$body.find('[data-do]').on('click', (e) => {
			const status = String($(e.currentTarget).data('do'));
			this.act([r.name], status, () => d.hide());
		});
		d.show();
	}

	// ── actions ──────────────────────────────────────────────────────────
	act(ids, status, done) {
		const names = ids.map(id => (this.rows.find(r => r.name === id) || {}).aggregator_name || id);
		const who = ids.length === 1 ? `<b>${this.esc(names[0])}</b>` : `<b>${ids.length}</b> ${__('applications')}`;
		const run = (comments) => {
			const single = ids.length === 1;
			frappe.call({
				method: AA_API + (single ? 'update_aggregator_status' : 'bulk_update_status'),
				args: single ? { aggregator_id: ids[0], new_status: status, clarification_comments: comments }
					: { aggregator_ids: JSON.stringify(ids), new_status: status, clarification_comments: comments },
				freeze: true,
				freeze_message: __('Updating…'),
				callback: (r) => {
					const res = r.message || {};
					const failed = (res.errors || []).length;
					frappe.show_alert({ message: single ? __('{0} → {1}', [names[0], (AA_STATUS[status] || {}).label || status])
						: __('{0} updated', [res.updated || 0]) + (failed ? `, ${failed} ${__('failed')}` : ''), indicator: failed ? 'orange' : 'green' });
					ids.forEach(id => this.selected.delete(id));
					if (done) done();
					this.load();
				}
			});
		};
		if (status === 'Pending with Clarification') {
			const dlg = new frappe.ui.Dialog({
				title: __('Ask for clarification'),
				fields: [
					{ fieldtype: 'HTML', options: `<p class="text-muted">${__('Sent to')} ${who}. ${__('They reply from the portal; the application then returns to Under process.')}</p>` },
					{ fieldname: 'comments', fieldtype: 'Small Text', label: __('What do they need to provide?'), reqd: 1 }
				],
				primary_action_label: __('Send'),
				primary_action: (v) => { dlg.hide(); run(v.comments.trim()); }
			});
			dlg.show();
			return;
		}
		// Approving with failed KYC checks is allowed, but never by accident.
		const failed = status === 'Approved' ? ids.flatMap(id => {
			const r = this.rows.find(x => x.name === id);
			return r ? this.checks(r).filter(c => !c.ok).map(c => ids.length > 1 ? `${r.aggregator_name}: ${c.label}` : c.label) : [];
		}) : [];
		const warn = failed.length ? `<div class="alert alert-warning" style="margin-top:10px">${__('Not all KYC checks passed:')}<ul style="margin:6px 0 0">${failed.slice(0, 8).map(f => `<li>${this.esc(f)}</li>`).join('')}</ul></div>` : '';
		const msg = status === 'Approved'
			? __('Approve {0}? They get portal access, an Aggregator ID and their registration certificate by email.', [who]) + warn
			: __('Mark {0} as under process? The aggregator is told their application is being reviewed.', [who]);
		frappe.confirm(msg, () => run());
	}

	bulk(status) {
		if (this.selected.size) this.act([...this.selected], status);
	}

	// ── auto-approve setting ─────────────────────────────────────────────
	load_auto_days() {
		frappe.xcall(AA_API + 'get_auto_approve_days').then((days) => this.show_auto_days(days || 0));
	}
	show_auto_days(days) {
		this.$root.find('#aa-auto-days').val(days);
		this.$root.find('#aa-auto-note').text(days ? '' : __('(off)'));
	}
	save_auto_days() {
		const val = parseInt(this.$root.find('#aa-auto-days').val(), 10);
		if (isNaN(val) || val < 0) { frappe.msgprint(__('Enter a whole number of days (0 or more).')); return; }
		frappe.xcall(AA_API + 'set_auto_approve_days', { days: val }).then((r) => {
			const d = (r || {}).auto_approve_days || 0;
			this.show_auto_days(d);
			frappe.show_alert({ message: d ? __('Untouched applications auto-approve after {0} days.', [d]) : __('Auto-approval turned off.'), indicator: 'green' });
		});
	}
}

const AA_CSS = `
.aa-kpis { display:grid; grid-template-columns:repeat(5, minmax(0,1fr)); gap:12px; margin-bottom:16px; }
@media (max-width:1100px) { .aa-kpis { grid-template-columns:repeat(3, minmax(0,1fr)); } }
@media (max-width:600px) { .aa-kpis { grid-template-columns:repeat(2, minmax(0,1fr)); } }
.aa-kpis .wbd-kpi { border-top:3px solid var(--t); }
.aa-kpis .wbd-kpi.is-on { background:color-mix(in srgb, var(--t) 7%, var(--bg)); box-shadow:inset 0 0 0 1px var(--t); }
.aa-kpi-unit { font-size:14px; font-weight:600; margin-left:4px; }
.aa-toolbar { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.aa-search { flex:1 1 300px; }
.aa-auto { display:flex; align-items:center; gap:6px; font-size:12px; color:var(--text-2); flex-wrap:wrap; }
.aa-auto input { width:56px; height:28px; border:1px solid var(--border); border-radius:6px; text-align:center; background:var(--bg); color:var(--text); }
.aa-bulk { position:sticky; top:0; z-index:15; display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:10px 16px; margin-bottom:12px;
	background:color-mix(in srgb, var(--brand) 6%, var(--bg)); border:1px solid color-mix(in srgb, var(--brand) 30%, var(--border)); border-radius:10px; }
.aa-bulk[hidden] { display:none; }
.aa-bulk > span { font-size:13px; margin-right:6px; }
.aa-bulk-clear { margin-left:auto; font-size:12px; color:var(--link); cursor:pointer; }
.aa-btn-approve { background:#1d6b3a !important; border-color:#1d6b3a !important; color:#fff !important; }
.aa-btn-clarify { color:#8a5a00 !important; border-color:color-mix(in srgb, #8a5a00 40%, transparent) !important; }
.aa-count { display:inline-grid; place-items:center; min-width:22px; height:20px; padding:0 7px; margin-left:6px; border-radius:10px;
	background:var(--bg-soft); border:1px solid var(--border); font-size:11px; color:var(--text-2); vertical-align:2px; }
.aa-table td { white-space:normal; vertical-align:top; padding:12px 10px; }
.aa-table th.aa-check, .aa-table td.aa-check { width:34px; text-align:center; }
.aa-table tr.is-sel td { background:color-mix(in srgb, var(--brand) 5%, var(--bg)); }
.aa-co { display:flex; align-items:baseline; gap:8px; flex-wrap:wrap; }
.aa-co b { font-size:13.5px; }
.aa-services { margin-top:5px; display:flex; gap:4px; flex-wrap:wrap; }
.aa-contact { overflow-wrap:anywhere; }
.aa-sub { display:block; margin-top:2px; }
.aa-wait { font-weight:700; font-variant-numeric:tabular-nums; }
.aa-wait.is-slow { color:#a4161a; }
.aa-actions { white-space:nowrap !important; }
.aa-actions .btn + .btn { margin-left:4px; }
.aa-empty { display:flex; flex-direction:column; align-items:center; gap:4px; padding:48px 16px; text-align:center; }
.aa-empty span { width:36px; height:36px; border-radius:50%; display:grid; place-items:center; background:color-mix(in srgb, #1d6b3a 14%, var(--bg)); color:#1d6b3a; font-weight:700; margin-bottom:6px; }
.aa-empty small { color:var(--muted); }
.aa-clar { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:14px; }
.aa-clar > div { border:1px solid var(--border); border-left:3px solid #b45309; border-radius:8px; padding:10px 14px; background:color-mix(in srgb, #b45309 4%, var(--bg)); }
.aa-clar > div + div { border-left-color:#1d6b3a; background:color-mix(in srgb, #1d6b3a 4%, var(--bg)); }
.aa-clar span { font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); }
.aa-clar p { margin:4px 0 0; font-size:13px; color:var(--text); }
.aa-review-grid { display:grid; grid-template-columns:minmax(0,1.2fr) minmax(0,1fr); gap:24px; }
@media (max-width:900px) { .aa-review-grid, .aa-clar { grid-template-columns:minmax(0,1fr); } }
.aa-fields { display:flex; flex-direction:column; border:1px solid var(--border); border-radius:8px; margin-bottom:6px; }
.aa-field { display:grid; grid-template-columns:150px minmax(0,1fr); gap:12px; padding:8px 12px; border-bottom:1px solid var(--border-soft); font-size:13px; }
.aa-field:last-child { border-bottom:0; }
.aa-field span { color:var(--muted); font-size:12px; }
.aa-field b { font-weight:600; color:var(--text); overflow-wrap:anywhere; }
.aa-mono { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing:.02em; }
.aa-checks { display:flex; flex-direction:column; gap:6px; margin-bottom:6px; }
.aa-chk { display:grid; grid-template-columns:22px minmax(0,1fr); gap:10px; align-items:start; padding:7px 10px; border-radius:8px; border:1px solid var(--border-soft); }
.aa-chk > span { width:22px; height:22px; border-radius:50%; display:grid; place-items:center; font-size:12px; font-weight:700; color:#fff; }
.aa-chk.ok > span { background:#1d6b3a; }
.aa-chk.no > span { background:#a4161a; }
.aa-chk.no { background:color-mix(in srgb, #a4161a 4%, var(--bg)); }
.aa-chk b { display:block; font-size:12.5px; }
.aa-chk small { font-size:11.5px; color:var(--muted); overflow-wrap:anywhere; }
.aa-docs { display:flex; flex-direction:column; gap:6px; }
.aa-doc { display:flex; align-items:center; gap:10px; padding:8px 12px; border:1px solid var(--border); border-radius:8px; font-size:13px; }
.aa-doc span { flex:1; }
.aa-doc a { font-size:12px; color:var(--link); font-weight:600; }
.aa-doc.is-missing { color:var(--muted); border-style:dashed; }
.aa-doc.is-missing em { font-size:12px; color:#a4161a; font-style:normal; font-weight:600; }
.aa-review-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:18px; padding-top:14px; border-top:1px solid var(--border); }
.aa-spacer { flex:1; }
`;
