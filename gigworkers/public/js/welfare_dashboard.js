// Welfare dashboards — shared by three desk pages (loaded via app_include_js):
//   /desk/welfare-board-dashboard  (view: admin — the whole scheme)
//   /desk/aggregator-dashboard     (view: aggregator — one aggregator's own data)
//   /desk/gig-worker-dashboard     (view: worker — one gig worker's own data)
// Whose data is shown is decided on the server from the logged-in user; only a
// System Manager may pick an aggregator / worker (page-header picker).
//
// Layout follows the Uniquad Overall Dashboard
//
// The whole gig worker welfare scheme in one place — aggregators, gig workers,
// transactions, welfare fees, quarterly invoices, the welfare fund and benefit
// withdrawals — laid out like the Uniquad Overall Dashboard: filters →
// headline money flow → a board of single / paired cards (one section per
// area) → Timeline tab (one worker or aggregator, start to end) → Analytics tab.
//
// Every card and number opens a centred drilldown (per-aggregator cards, then
// a server-paged, sortable, searchable table with "Export all (CSV)").
// Clicking a worker or aggregator opens their timeline. All numbers come from
// admin-only server calls; every value rendered into HTML goes through esc().

const WBD_API = 'gigworkers.gig_workers.page.welfare_board_dashboard.welfare_board_dashboard.';
const WBD_STORE_KEY = 'wbd-filters-v1';
const WBD_LIST_FILTERS = ['aggregators', 'service_categories', 'districts', 'genders', 'worker_statuses'];

// Tone = what a colour means (same everywhere on the page).
const WBD_TONES = {
	good: '#1d6b3a', bad: '#a4161a', action: '#8a5a00', info: '#2b4f7e', neutral: '#6B6560', time: '#920c24'
};
const WBD_STATUS_COLORS = {
	'Approved': '#1d6b3a', 'Active': '#1d6b3a', 'Payment complete': '#1d6b3a', 'Completed': '#1d6b3a', 'Success': '#1d6b3a',
	'Settled': '#1d6b3a', 'Fully Paid': '#1d6b3a', 'Paid': '#1d6b3a',
	'Submitted': '#8a5a00', 'Under Process': '#2b4f7e', 'Pending with Clarification': '#8a5a00', 'Pending': '#8a5a00',
	'Payment pending': '#8a5a00', 'Initiated': '#2b4f7e', 'Confirmed': '#2b4f7e', 'Partially Paid': '#8a5a00', 'Requested': '#8a5a00',
	'Overdue': '#a4161a', 'Failed': '#a4161a', 'Rejected': '#a4161a', 'Suspected duplicate': '#a4161a', 'Inactive': '#a4161a', 'Deceased': '#6B6560',
	'Payment Cancelled': '#6B6560', 'Cancelled': '#6B6560', 'Draft': '#6B6560'
};
// Categorical slots for aggregators (assigned in name order, always shown with the name).
const WBD_PALETTE = ['#920c24', '#2b4f7e', '#0f6b63', '#8a5a00', '#6d3b8c', '#3d4a5c', '#b0476b', '#4f7a28', '#c2541a', '#5b6b7a'];
const WBD_KIND_COLORS = {
	registration: '#920c24', status: '#6B7A8A', workers: '#2b4f7e', import: '#3d4a5c', transaction: '#2b4f7e', adjustment: '#8a5a00',
	fee: '#0f6b63', invoice: '#6d3b8c', payment: '#1d6b3a', credit: '#1d6b3a', debit: '#a4161a', withdrawal: '#c2541a'
};

// Build a dashboard page. opts: { view, title, picker: { label, doctype, url_arg } }
function wbd_make_page(wrapper, opts) {
	if (!document.getElementById('wbd-font')) {
		$('head').append('<link id="wbd-font" rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Merriweather:opsz,wght@18..144,300..900&display=swap">');
	}
	const page = frappe.ui.make_app_page({ parent: wrapper, title: opts.title, single_column: true });
	wrapper.wbd = new WelfareBoardDashboard(page, wrapper, opts);
}

class WelfareBoardDashboard {
	constructor(page, wrapper, opts = {}) {
		this.page = page;
		this.opts = opts;
		this.view = opts.view || 'admin';
		this.$root = $(wrapper).find('.page-content');
		this.meta = null;
		this.data = null;
		this.analytics = null;
		this.filters = null;
		this.ms = {};
		this.tab = 'dash';
		this.tl = { people: 'worker' };
		this.is_admin = frappe.user.has_role('System Manager');
		// Only an admin chooses whose dashboard to see; everyone else always gets their own.
		this.subject = this.is_admin && opts.picker ? (frappe.utils.get_url_arg(opts.picker.url_arg) || null) : null;
		this.render_shell();
		if (this.is_admin && opts.picker) this.add_picker();
		if (this.is_admin && opts.picker && !this.subject) {
			this.$root.find('.wbd-root').html(`<div class="wbd-empty" style="padding:80px 20px;font-size:14px">${__('Select {0} above to view their dashboard.', [opts.picker.label.toLowerCase()])}</div>`);
			return;
		}
		this.boot();
	}

	// Server calls carry the view (and an admin's chosen subject); the server decides the scope.
	ctx(args = {}) { return Object.assign({ view: this.view, subject: this.subject }, args); }

	add_picker() {
		const p = this.opts.picker;
		const field = this.page.add_field({
			fieldname: 'wbd_subject', label: __(p.label), fieldtype: 'Link', options: p.doctype, default: this.subject,
			change: () => {
				const value = field.get_value();
				if (!value || value === this.subject) return;
				const url = new URL(window.location.href);
				url.searchParams.set(p.url_arg, value);
				window.location.href = url.toString();
			}
		});
	}

	boot() {
		frappe.xcall(WBD_API + 'get_meta', this.ctx()).then((meta) => {
			this.meta = meta;
			this.apply_view();
			WBD_LIST_FILTERS.forEach(k => this.ms[k].set_options(meta.options[k] || []));
			const saved = this.read_saved() || {};
			WBD_LIST_FILTERS.forEach(k => this.ms[k].set_value(saved[k] || []));
			const [from_date, to_date] = this.preset_range('year');
			this.$root.find('#wbd-from').val(from_date);
			this.$root.find('#wbd-to').val(to_date);
			this.load(this.current_filters());
		});
	}

	// Show only the filters, tabs and analytics panels this view has.
	apply_view() {
		const m = this.meta;
		this.page.set_title(m.title);
		WBD_LIST_FILTERS.forEach(k => { this.$root.find(`#wbd-ms-${k}`).closest('.wbd-f').toggle(m.filters.includes(k)); });
		if (m.subject_label && this.view !== 'admin') this.$root.find('#wbd-sub').before(`<span class="wbd-pill" style="--c:#920c24">${this.esc(m.subject_label)}</span>`);
		if (!m.people.length) this.$root.find('.wbd-tab[data-tab="timeline"]').text(__('My timeline'));
		this.$root.find('[data-panel]').each((_i, el) => {
			const key = $(el).data('panel');
			$(el).toggle(m.analytics.includes(key) || (key === 'profile' && m.analytics.includes('work')));
		});
		// a pair with one panel left takes the full width
		this.$root.find('.wbd-pane[data-pane="analytics"] .wbd-grid-2').each((_i, el) => {
			const visible = $(el).children('[data-panel]').filter((_j, c) => $(c).css('display') !== 'none');
			$(el).toggle(visible.length > 0);
			visible.css('grid-column', visible.length === 1 ? '1 / -1' : '');
		});
		if (this.view === 'worker') {
			this.$root.find('[data-panel="profile"] .wbd-panel-title').text(__('Where I work'));
			this.$root.find('[data-panel="profile"] .wbd-panel-sub').text(__('Earnings by aggregator, services and districts of my transactions · click a slice or bar for its list'));
			this.$root.find('[data-panel="flow"] .wbd-panel-title').text(__('Where my welfare money is'));
		}
		if (this.view === 'aggregator') {
			this.$root.find('[data-panel="flow"] .wbd-panel-sub').text(__('From fees raised on your transactions to credits in your workers\' welfare funds · click a step for its list'));
		}
	}

	// ── helpers ────────────────────────────────────────────────────────────
	esc(v) { return frappe.utils.escape_html(v === null || v === undefined ? '' : String(v)); }
	n(v) { return v === null || v === undefined ? '—' : Number(v).toLocaleString('en-IN'); }
	money(v) { return format_currency(v || 0, 'INR', 2); }
	pct_txt(a, b) {
		if (!b) return '0%';
		const p = (a / b) * 100;
		return a && p < 0.1 ? '<0.1%' : `${Math.round(p * 10) / 10}%`;
	}
	fmt_date(d) { return d ? frappe.datetime.str_to_user(String(d).slice(0, 10)) : ''; }
	fmt_dt(d) { return d ? frappe.datetime.str_to_user(String(d)).replace(/(\d{1,2}:\d{2}):\d{2}(\.\d+)?$/, '$1') : ''; }
	agg_name(a) { return (this.meta && this.meta.aggregator_names[a]) || a || __('Not set'); }
	agg_color(a) {
		const names = Object.keys((this.meta && this.meta.aggregator_names) || {}).sort();
		const i = names.indexOf(a);
		return i < 0 ? '#64748B' : WBD_PALETTE[i % WBD_PALETTE.length];
	}
	agg_pill(a) { return a ? `<span class="wbd-pill" style="--c:${this.agg_color(a)}">${this.esc(this.agg_name(a))}</span>` : ''; }
	status_pill(s) { return s ? `<span class="wbd-pill" style="--c:${WBD_STATUS_COLORS[s] || '#64748B'}">${this.esc(s)}</span>` : ''; }
	slug(dt) { return String(dt || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
	desk_link(dt, name) { return `/desk/${this.slug(dt)}/${encodeURIComponent(name)}`; }

	read_saved() {
		try { return JSON.parse(localStorage.getItem(WBD_STORE_KEY) || 'null'); } catch (e) { return null; }
	}
	// Dates are deliberately not remembered: the page always opens on "This year".
	save_filters(f) {
		try {
			const keep = {};
			WBD_LIST_FILTERS.forEach(k => { keep[k] = f[k] || []; });
			localStorage.setItem(WBD_STORE_KEY, JSON.stringify(keep));
		} catch (e) { /* private mode etc. */ }
	}

	// ── layout ─────────────────────────────────────────────────────────────
	render_shell() {
		const ms = (k, label, ph) => `<div class="wbd-f"><label>${label}</label><div class="wbd-ms" id="wbd-ms-${k}" data-placeholder="${ph}"></div></div>`;
		const panel = (id, title, sub, tools = '', body = `<div class="wbd-panel-body" id="${id}"></div>`) => `
			<div class="wbd-panel" data-panel="${id.replace('wbd-', '')}">
				<div class="wbd-panel-head"><div><div class="wbd-panel-title">${title}</div><div class="wbd-panel-sub">${sub}</div></div>${tools}</div>
				${body}
			</div>`;
		this.$root.html(`
			<style>${WBD_CSS}</style>
			<div class="wbd-root">
				<div class="wbd-tabs" role="tablist">
					<button class="wbd-tab is-on" data-tab="dash" role="tab">${__('Dashboard')}</button>
					<button class="wbd-tab" data-tab="timeline" role="tab">${__('Timeline')}</button>
					<button class="wbd-tab" data-tab="analytics" role="tab">${__('Welfare Analytics')}</button>
				</div>
				<div class="wbd-filters">
					<div class="wbd-topbar">
						<div class="wbd-presets">
							${[['month', __('This month')], ['last30', __('Last 30 days')], ['last90', __('Last 90 days')],
								['year', __('This year')], ['all', __('All time')]]
								.map(([k, l]) => `<button class="wbd-preset" data-p="${k}">${l}</button>`).join('')}
						</div>
						<div class="wbd-topbar-right">
							<span class="wbd-muted" title="${__('Ignores every filter')}">${__('All-time transactions')}: <b id="wbd-alltime">—</b></span>
							<span class="wbd-muted" id="wbd-sub"></span>
							<button class="btn btn-default btn-xs" id="wbd-guide">ⓘ ${__('Card guide')}</button>
							<button class="btn btn-default btn-xs" id="wbd-refresh">⟳ ${__('Refresh')}</button>
						</div>
					</div>
					<div class="wbd-filter-row">
						<div class="wbd-f"><label>${__('From')}</label><input type="date" id="wbd-from"></div>
						<div class="wbd-f"><label>${__('To')}</label><input type="date" id="wbd-to"></div>
						${ms('aggregators', __('Aggregator'), __('All aggregators'))}
						${ms('service_categories', __('Service category'), __('All services'))}
						${ms('districts', __('District'), __('All districts'))}
						${ms('genders', __('Gender'), __('All genders'))}
						${ms('worker_statuses', __('Worker status'), __('All statuses'))}
						<div class="wbd-f wbd-f-btns">
							<button class="btn btn-primary btn-sm" id="wbd-apply">${__('Apply')}</button>
							<button class="btn btn-default btn-sm" id="wbd-reset">${__('Reset')}</button>
						</div>
					</div>
				</div>

				<div class="wbd-pane" data-pane="dash">
					<div class="wbd-jump" id="wbd-jump"></div>
					<div id="wbd-overview"></div>
					<div class="wbd-section-title wbd-headline-title"><span>${__('Welfare money flow')}</span></div>
					<div class="wbd-cards" id="wbd-cards"></div>
					<div class="wbd-board" id="wbd-board"></div>
				</div>

				<div class="wbd-pane" data-pane="timeline" hidden>
					<div class="wbd-panel">
						<div class="wbd-panel-head"><div>
							<div class="wbd-panel-title">${__('Journey timeline')}</div>
							<div class="wbd-panel-sub">${__('Everyone matching the filters above · search, then click a name to open their timeline, start to end')}</div>
						</div></div>
						<div class="wbd-tl-tools" id="wbd-tl-tools"></div>
						<div id="wbd-tl-list"></div>
					</div>
				</div>

				<div class="wbd-pane" data-pane="analytics" hidden>
					${panel('wbd-flow', __('Where the welfare money is'), __('From fees raised on transactions to benefits paid out · bar length = share of fees raised · click a step for its list'))}
					${panel('wbd-aggs', __('Aggregator summary'), __('Workers, transactions, welfare fees and invoice balance per aggregator · every number opens its list'),
						`<div class="wbd-panel-tools"><button class="btn btn-default btn-xs" id="wbd-export-aggs">${__('Export CSV')}</button></div>`,
						'<div class="wbd-table-scroll" id="wbd-aggs"></div>')}
					<div class="wbd-grid-2">
						${panel('wbd-trend', __('Transactions per week'), __('Week starting Monday · last 26 weeks with data · click a bar for that week'))}
						${panel('wbd-months', __('Welfare fees per month'), __('Raised vs paid by aggregators · click a bar for that month'))}
					</div>
					${panel('wbd-profile', __('Who the workers are'), __('Gender and status of registered workers, and where transactions happen · click a bar or slice for its list'))}
					<div class="wbd-grid-2">
						${panel('wbd-invoices', __('Invoices by status'), __('Quarterly welfare fee invoices in scope · click a slice for its list'))}
						${panel('wbd-wds', __('Benefit withdrawals by type'), __('Withdrawal requests in scope · click a slice for its list'))}
					</div>
				</div>
				<div class="wbd-tip" id="wbd-tip"></div>
			</div>
		`);

		const $c = this.$root;
		WBD_LIST_FILTERS.forEach(k => { this.ms[k] = this.make_multiselect($c.find(`#wbd-ms-${k}`)); });
		$c.find('#wbd-apply').on('click', () => { this.load(this.current_filters()); });
		$c.find('#wbd-refresh').on('click', () => { this.load(this.filters || this.current_filters()); });
		$c.find('#wbd-reset').on('click', () => {
			Object.values(this.ms).forEach(m => m.clear());
			const [f, t] = this.preset_range('year');
			$c.find('#wbd-from').val(f);
			$c.find('#wbd-to').val(t);
			this.load(this.current_filters());
		});
		// A preset is one click = the user is done choosing → apply at once.
		$c.find('.wbd-preset').on('click', (e) => {
			const [f, t] = this.preset_range($(e.currentTarget).data('p'));
			$c.find('#wbd-from').val(f || '');
			$c.find('#wbd-to').val(t || '');
			this.load(this.current_filters());
		});
		$c.find('#wbd-guide').on('click', () => { this.open_guide(); });
		$c.find('#wbd-export-aggs').on('click', () => { this.export_aggs(); });
		$c.find('.wbd-tab').on('click', (e) => { this.show_tab(String($(e.currentTarget).data('tab'))); });
		$(document).on('click.wbd', (e) => {
			if (!$(e.target).closest('.wbd-ms').length) $('.wbd-ms.open').removeClass('open');
		});
		this.bind_tip($c);
	}

	preset_range(p) {
		const today = frappe.datetime.get_today();
		const d = frappe.datetime;
		if (p === 'month') return [d.month_start(), today];
		if (p === 'last30') return [d.add_days(today, -29), today];
		if (p === 'last90') return [d.add_days(today, -89), today];
		if (p === 'year') return [today.slice(0, 4) + '-01-01', today];
		return ['', ''];
	}
	current_filters() {
		const f = { from_date: this.$root.find('#wbd-from').val() || null, to_date: this.$root.find('#wbd-to').val() || null };
		WBD_LIST_FILTERS.forEach(k => { f[k] = this.ms[k].get_value(); });
		return f;
	}
	mark_preset() {
		const f = this.filters || {};
		let on = null;
		['month', 'last30', 'last90', 'year', 'all'].forEach(p => {
			const [a, b] = this.preset_range(p);
			if ((a || null) === (f.from_date || null) && (b || null) === (f.to_date || null)) on = p;
		});
		this.$root.find('.wbd-preset').each((_i, el) => { $(el).toggleClass('is-on', $(el).data('p') === on); });
	}

	// Searchable multi-select with chips.
	make_multiselect($el) {
		const ph = $el.data('placeholder');
		let options = [];
		let value = [];
		$el.html(`<div class="wbd-ms-box"></div>
			<div class="wbd-ms-panel">
				<div class="wbd-ms-search"><input type="text" placeholder="${__('Search')}"></div>
				<div class="wbd-ms-actions"><a data-a="all">${__('Select all')}</a><a data-a="none">${__('Clear')}</a></div>
				<div class="wbd-ms-list"></div>
			</div>`);
		const $box = $el.find('.wbd-ms-box');
		const $list = $el.find('.wbd-ms-list');
		const $q = $el.find('.wbd-ms-search input');
		const label_of = (v) => (options.find(o => o.value === v) || { label: v }).label;
		const draw_box = () => {
			if (!value.length) { $box.html(`<span class="wbd-ms-ph">${this.esc(ph)}</span>`); return; }
			const chips = value.slice(0, 2).map(v => `<span class="wbd-ms-chip"><span class="txt">${this.esc(label_of(v))}</span><span class="x" data-v="${this.esc(v)}">×</span></span>`).join('');
			$box.html(chips + (value.length > 2 ? `<span class="wbd-ms-more">+${value.length - 2}</span>` : ''));
		};
		const draw_list = () => {
			const q = ($q.val() || '').toLowerCase();
			const shown = options.filter(o => !q || String(o.label).toLowerCase().includes(q) || String(o.value).toLowerCase().includes(q));
			$list.html(shown.length ? shown.map(o => `<label class="wbd-ms-opt"><input type="checkbox" value="${this.esc(o.value)}" ${value.includes(o.value) ? 'checked' : ''}> ${this.esc(o.label)}</label>`).join('')
				: `<div class="wbd-ms-empty">${__('No matches')}</div>`);
		};
		$box.on('click', (e) => {
			const $x = $(e.target).closest('.x');
			if ($x.length) {
				value = value.filter(v => v !== String($x.data('v')));
				draw_box(); draw_list();
				e.stopPropagation();
				return;
			}
			$('.wbd-ms.open').not($el).removeClass('open');
			$el.toggleClass('open');
			if ($el.hasClass('open')) { draw_list(); $q.trigger('focus'); }
		});
		$q.on('input', () => { draw_list(); });
		$list.on('change', 'input', (e) => {
			const v = e.target.value;
			value = e.target.checked ? value.concat([v]) : value.filter(x => x !== v);
			draw_box();
		});
		$el.find('.wbd-ms-actions a').on('click', (e) => {
			const a = $(e.currentTarget).data('a');
			value = a === 'all' ? options.map(o => o.value) : [];
			draw_box(); draw_list();
		});
		draw_box();
		return {
			set_options: (o) => { options = o || []; value = value.filter(v => options.some(x => x.value === v)); draw_box(); },
			set_value: (v) => { value = (v || []).filter(x => options.some(o => o.value === x)); draw_box(); },
			get_value: () => value.slice(),
			clear: () => { value = []; draw_box(); }
		};
	}

	// ── data ───────────────────────────────────────────────────────────────
	load(filters) {
		this.filters = filters;
		this.save_filters(filters);
		this.mark_preset();
		this.analytics = null;
		const $r = this.$root.find('.wbd-root').addClass('wbd-loading');
		frappe.xcall(WBD_API + 'get_dashboard_data', this.ctx({ filters })).then((data) => {
			this.data = data;
			$r.removeClass('wbd-loading');
			this.$root.find('#wbd-alltime').text(this.n(data.alltime_txn));
			this.$root.find('#wbd-sub').text(`${__('Updated')} ${data.updated}`);
			this.render_cards();
			this.render_board();
			if (this.tab === 'timeline') this.render_timeline_tab();
			if (this.tab === 'analytics') this.render_analytics_tab();
		}).catch(() => { $r.removeClass('wbd-loading'); });
	}

	show_tab(tab) {
		this.tab = tab;
		this.$root.find('.wbd-tab').each((_i, el) => { $(el).toggleClass('is-on', $(el).data('tab') === tab); });
		this.$root.find('.wbd-pane').each((_i, el) => { el.hidden = $(el).data('pane') !== tab; });
		if (!this.data) return;
		if (tab === 'timeline') this.render_timeline_tab();
		if (tab === 'analytics' && !this.analytics) this.render_analytics_tab();
	}

	// ── dashboard tab ──────────────────────────────────────────────────────
	card_data(key) { return (this.data.cards || {})[key]; }
	card_count(key) { const d = this.card_data(key); return d ? d.total : null; }
	sub_of(c) {
		const d = this.card_data(c.key);
		const parts = [];
		if (c.sum && d && d.amount !== null && d.amount !== undefined) parts.push(this.money(d.amount));
		if (c.any_date) parts.push(__('any date'));
		return parts.join(' · ');
	}
	info_html(text) {
		return text ? `<span class="wbd-info" data-tip="${this.esc(text)}" tabindex="0" aria-label="${this.esc(text)}">i</span>` : '';
	}
	share_html(c, v) {
		if (!c.base || v === null) return '';
		const base = this.card_count(c.base);
		return base ? `<span class="wbd-share">${this.pct_txt(v, base)}</span>` : '';
	}
	dot(card) {
		return ['good', 'bad'].includes(card.tone) ? `<span class="wbd-dot" style="--c:${WBD_TONES[card.tone]}"></span>` : '';
	}

	render_cards() {
		const html = this.meta.headline.map((c) => {
			const v = this.card_count(c.key);
			const aside = c.key === 'wd_paid' ? ' is-aside' : '';
			return `<div class="wbd-kpi is-click${aside}" data-card="${c.key}" tabindex="0" role="button">
				<div class="wbd-kpi-top"><span class="wbd-kpi-label">${this.dot(c)}${this.esc(c.label)}</span>${this.info_html(c.guide)}</div>
				<div class="wbd-kpi-value" style="${c.tone === 'action' || c.tone === 'time' ? `color:${WBD_TONES[c.tone]}` : ''}">${this.n(v)}${this.share_html(c, v)}</div>
				<div class="wbd-kpi-sub">${this.esc(this.sub_of(c))}</div>
			</div>`;
		}).join('');
		const $c = this.$root.find('#wbd-cards').html(`<div class="wbd-headline is-funnel">${html}</div>`);
		this.bind_click($c.find('[data-card]'), (el) => this.drill_card($(el).data('card')));
	}

	render_board() {
		const section_html = (sec) => `<div class="wbd-section" id="wbd-sec-${sec.key}"><div class="wbd-section-title"><span>${this.esc(sec.title)}</span></div>
			<div class="wbd-tiles">${sec.tiles.map(t => this.tile_html(t)).join('')}</div></div>`;
		// "At a glance" sits above the money flow; every other section below it.
		const $o = this.$root.find('#wbd-overview').html(this.meta.board.filter(sec => sec.key === 'overview').map(section_html).join(''));
		$o.find('.wbd-section').first().css('margin-top', 0);
		this.bind_click($o.find('[data-card]'), (el) => this.drill_card($(el).data('card')));
		const $b = this.$root.find('#wbd-board').html(this.meta.board.filter(sec => sec.key !== 'overview').map(section_html).join(''));
		this.bind_click($b.find('[data-card]'), (el) => this.drill_card($(el).data('card')));
		const chips = this.meta.modules.map(m => `<button class="wbd-jump-chip" data-sec="${m.key}">${this.esc(m.label)}</button>`).join('');
		const $j = this.$root.find('#wbd-jump').html(`<span class="wbd-jump-label">${__('Jump to')}</span>${chips}`);
		$j.find('.wbd-jump-chip').on('click', (e) => {
			const el = this.$root.find(`#wbd-sec-${$(e.currentTarget).data('sec')}`)[0];
			if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
		});
	}

	tile_html(t) {
		const guide = t.cards.map(c => `${c.label}: ${c.guide || ''}`).join('\n');
		if (t.cards.length === 1) {
			const c = t.cards[0];
			const v = this.card_count(c.key);
			const color = ['action', 'time'].includes(c.tone) && v ? `color:${WBD_TONES[c.tone]}` : '';
			return `<div class="wbd-tile wbd-tile-1 is-click" data-card="${c.key}" tabindex="0" role="button">
				<div class="wbd-tile-head"><span class="wbd-tile-title">${this.esc(t.title)}</span>${this.info_html(guide)}</div>
				<div class="wbd-kpi-value" style="${color}">${this.n(v)}${this.share_html(c, v)}</div>
				<div class="wbd-kpi-sub">${this.esc(this.sub_of(c))}</div>
			</div>`;
		}
		const halves = t.cards.map(c => {
			const v = this.card_count(c.key);
			const live = !!v;
			const color = ['action', 'bad'].includes(c.tone) && live ? `color:${WBD_TONES[c.tone]}` : '';
			const flag = c.tone === 'action' && live ? `<span class="wbd-flag">${__('Action')}</span>` : '';
			const sub = this.sub_of(c);
			return `<div class="wbd-half is-click" data-card="${c.key}" tabindex="0" role="button">
				<div class="wbd-half-label"><span class="wbd-dot" style="--c:${WBD_TONES[c.tone] || WBD_TONES.neutral}"></span>${this.esc(c.label)}${flag}</div>
				<div class="wbd-kpi-value" style="${color}">${this.n(v)}${this.share_html(c, v)}</div>
				${sub ? `<div class="wbd-kpi-sub">${this.esc(sub)}</div>` : ''}
			</div>`;
		}).join('');
		return `<div class="wbd-tile wbd-tile-2">
			<div class="wbd-tile-head"><span class="wbd-tile-title">${this.esc(t.title)}</span>${this.info_html(guide)}</div>
			<div class="wbd-halves">${halves}</div>
		</div>`;
	}

	bind_click($els, open) {
		$els.on('click', (e) => {
			if ($(e.target).closest('.wbd-info').length) return;
			e.stopPropagation();
			open(e.currentTarget);
		});
		$els.on('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e.currentTarget); }
		});
	}

	find_card(key) {
		for (const c of this.meta.headline) if (c.key === key) return c;
		for (const s of this.meta.board) for (const t of s.tiles) for (const c of t.cards) if (c.key === key) return c;
		return null;
	}
	honours_note(kind) {
		const src = this.meta.sources[kind] || {};
		return (src.honours || []).length ? ` ${__('Filters applied')}: ${src.honours.join(', ')}.` : ` ${__('The filters above do not apply to these records.')}`;
	}
	drill_card(key) {
		const c = this.find_card(key);
		if (!c) return;
		this.drill(c.label, c.kind, { card: key }, (c.guide || '') + this.honours_note(c.kind));
	}

	// ── drilldown popup ────────────────────────────────────────────────────
	drill(title, kind, extra = {}, note = '') {
		const d = new frappe.ui.Dialog({ title, size: 'extra-large' });
		d.$wrapper.find('.modal-dialog').addClass('wbd-modal');
		d.$body.html(`<style>${WBD_CSS}</style><div class="wbd-root wbd-in-modal">
			${note ? `<div class="wbd-muted wbd-dd-note">${this.esc(note)}</div>` : ''}
			<div class="wbd-dd-units"></div><div class="wbd-dd-table"></div><div class="wbd-tip" id="wbd-tip"></div></div>`);
		this.bind_tip(d.$body, d.$body.find('#wbd-tip'));
		const state = { unit: '__all__' };
		const draw_units = (units) => {
			const total = Object.values(units || {}).reduce((a, b) => a + b, 0);
			const keys = Object.keys(units || {}).sort((a, b) => units[b] - units[a]);
			if (keys.length < 2) { d.$body.find('.wbd-dd-units').empty(); return; }
			const card = (k, label, v) => `<button class="wbd-dd-unit ${state.unit === k ? 'is-on' : ''}" data-u="${this.esc(k)}">
				<span class="wbd-dd-unit-name">${label}</span>
				<span class="wbd-dd-unit-v"><b>${this.n(v)}</b><small>${this.pct_txt(v, total)}</small></span></button>`;
			d.$body.find('.wbd-dd-units').html(card('__all__', __('All aggregators'), total)
				+ keys.map(k => card(k, this.esc(this.agg_name(k)), units[k])).join(''));
		};
		const run = (first) => {
			this.server_table(d.$body.find('.wbd-dd-table'), kind, Object.assign({}, extra, { unit: state.unit, with_units: first ? 1 : 0 }), {
				export_name: title,
				on_data: (r) => { if (r.units) draw_units(r.units); }
			});
		};
		d.$body.on('click', '.wbd-dd-unit', (e) => {
			state.unit = String($(e.currentTarget).data('u'));
			d.$body.find('.wbd-dd-unit').removeClass('is-on');
			$(e.currentTarget).addClass('is-on');
			run(false);
		});
		run(true);
		d.show();
	}

	// Server-paged table: search, sort, page size, pager, export all.
	server_table($el, kind, extra = {}, opts = {}) {
		const st = { search: '', sort: opts.sort || null, order: 'desc', page: 1, page_size: opts.page_size || 50 };
		// The same container is re-used on every filter change: drop old handlers first.
		$el.off();
		$el.html(`<div class="wbd-tt">
			<div class="wbd-tt-tools">
				<div class="wbd-search"><input type="search" placeholder="${__('Search name, ID, partner ID…')}"></div>
				<span class="wbd-muted wbd-tt-count"></span>
				<button class="btn btn-default btn-xs wbd-tt-export">⬇ ${__('Export all (CSV)')}</button>
			</div>
			<div class="wbd-table-scroll wbd-tt-body"></div>
			<div class="wbd-tt-pager"></div>
		</div>`);
		const $body = $el.find('.wbd-tt-body');
		const args = () => this.ctx({ kind, filters: this.filters, extra, search: st.search, sort: st.sort, order: st.order, page: st.page, page_size: st.page_size });
		const fetch = () => {
			$body.addClass('wbd-st-loading');
			frappe.xcall(WBD_API + 'get_table', args()).then((r) => {
				$body.removeClass('wbd-st-loading');
				st.sort = r.sort; st.order = r.order;
				if (opts.on_data) opts.on_data(r);
				const from = r.total ? (r.page - 1) * r.page_size + 1 : 0;
				const to = Math.min(r.page * r.page_size, r.total);
				$el.find('.wbd-tt-count').text(`${__('Rows')} ${this.n(from)}–${this.n(to)} ${__('of')} ${this.n(r.total)}`);
				$body.html(this.table_html(r));
				const pages = Math.max(1, Math.ceil(r.total / r.page_size));
				$el.find('.wbd-tt-pager').html(`
					<label class="wbd-muted">${__('Rows per page')} <select class="wbd-ps">${[25, 50, 100, 250].map(n => `<option ${n === r.page_size ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
					<div class="wbd-pages">
						<button class="wbd-pg" data-g="1" ${r.page <= 1 ? 'disabled' : ''}>«</button>
						<button class="wbd-pg" data-g="${r.page - 1}" ${r.page <= 1 ? 'disabled' : ''}>‹</button>
						<span class="wbd-muted">${__('Page')} <b>${this.n(r.page)}</b> ${__('of')} ${this.n(pages)}</span>
						<button class="wbd-pg" data-g="${r.page + 1}" ${r.page >= pages ? 'disabled' : ''}>›</button>
						<button class="wbd-pg" data-g="${pages}" ${r.page >= pages ? 'disabled' : ''}>»</button>
					</div>`);
			}).catch(() => { $body.removeClass('wbd-st-loading'); });
		};
		let timer = null;
		$el.find('.wbd-search input').on('input', (e) => {
			clearTimeout(timer);
			timer = setTimeout(() => { st.search = e.target.value; st.page = 1; fetch(); }, 300);
		});
		$el.on('click', 'th[data-sort]', (e) => {
			const f = String($(e.currentTarget).data('sort'));
			st.order = st.sort === f && st.order === 'desc' ? 'asc' : 'desc';
			st.sort = f; st.page = 1;
			fetch();
		});
		$el.on('click', '.wbd-pg', (e) => { st.page = Number($(e.currentTarget).data('g')) || 1; fetch(); });
		$el.on('change', '.wbd-ps', (e) => { st.page_size = Number(e.target.value) || 50; st.page = 1; fetch(); });
		$el.find('.wbd-tt-export').on('click', () => {
			const q = $.param({ kind, filters: JSON.stringify(this.filters), extra: JSON.stringify(extra), search: st.search,
				sort: st.sort || '', order: st.order, name: opts.export_name || kind, view: this.view, subject: this.subject || '' });
			window.open(`/api/method/${WBD_API}export_table?${q}`);
		});
		$el.on('click', '.wbd-person', (e) => {
			if (e.ctrlKey || e.metaKey || e.button === 1) return;
			// Stop here too: Frappe's router follows any desk href that reaches the document.
			e.preventDefault();
			e.stopPropagation();
			const $a = $(e.currentTarget);
			this.open_timeline(String($a.data('k')), String($a.data('id')));
		});
		fetch();
	}

	table_html(r) {
		if (!r.rows.length) return `<div class="wbd-empty">${__('Nothing here for these filters.')}</div>`;
		const worker_link = (id, text) => id ? `<a class="wbd-idlink wbd-person" data-k="worker" data-id="${this.esc(id)}" href="${this.desk_link('Gig Worker', id)}">${this.esc(text || id)}</a>` : this.esc(text);
		const agg_link = (id, text) => id ? `<a class="wbd-cand wbd-person" data-k="agg" data-id="${this.esc(id)}" href="${this.desk_link('Aggregator', id)}">${this.esc(text || id)}</a>` : this.esc(text);
		const head = r.columns.map(c => {
			const arrow = r.sort === c.field ? (r.order === 'asc' ? ' ▲' : ' ▼') : (c.sortable ? ' ↕' : '');
			return `<th ${c.sortable ? `data-sort="${c.field}"` : ''} class="${c.sortable ? 'is-sort' : ''}">${this.esc(c.label)}<span class="wbd-arrow">${arrow}</span></th>`;
		}).join('');
		const worker_id_of = (row) => r.kind === 'worker' ? row.name : row.gig_worker;
		const cell = (row, c) => {
			const v = row[c.field];
			switch (c.type) {
				case 'id': return v ? `<a class="wbd-idlink" target="_blank" href="${this.desk_link(r.doctype, v)}">${this.esc(v)} ↗</a>` : '';
				case 'txn_id': return v ? `<a class="wbd-idlink" target="_blank" href="${this.desk_link('Gig Transaction', v)}">${this.esc(v)} ↗</a>` : '';
				case 'worker_id': return worker_link(v, v);
				case 'worker': return worker_link(worker_id_of(row), v);
				case 'agg_id': return agg_link(v, v);
				case 'agg_person': return agg_link(row.name, v);
				case 'aggregator': return this.agg_pill(v);
				case 'status': return this.status_pill(v);
				case 'currency': return `<span class="wbd-num-cell">${this.esc(this.money(v))}</span>`;
				case 'int': return `<span class="wbd-num-cell">${this.n(v)}</span>`;
				case 'date': return this.esc(this.fmt_date(v));
				case 'datetime': return this.esc(this.fmt_dt(v));
				default: return `<span class="wbd-trunc" title="${this.esc(v)}">${this.esc(v)}</span>`;
			}
		};
		const body = r.rows.map(row => `<tr>${r.columns.map(c => `<td>${cell(row, c)}</td>`).join('')}</tr>`).join('');
		return `<table class="wbd-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
	}

	// ── timeline tab ───────────────────────────────────────────────────────
	render_timeline_tab() {
		const people = this.meta.people;
		const $list = this.$root.find('#wbd-tl-list');
		if (!people.length) {
			// A gig worker has exactly one timeline — their own — shown right here.
			this.$root.find('#wbd-tl-tools').hide();
			this.$root.find('.wbd-pane[data-pane="timeline"] .wbd-panel-title').text(__('My journey'));
			this.$root.find('.wbd-pane[data-pane="timeline"] .wbd-panel-sub').text(__('Everything that happened to your work and welfare money, start to end'));
			$list.html(`<div class="wbd-empty">${__('Loading…')}</div>`).css('padding', '14px');
			frappe.xcall(WBD_API + 'get_timeline', this.ctx({ kind: 'worker', name: this.meta.subject })).then((t) => {
				$list.html(this.timeline_html(t));
				$list.off('click.wbdtl').on('click.wbdtl', '.wbd-tlf', (e) => this.filter_timeline($list, e));
			});
			return;
		}
		const t = this.tl;
		if (!people.includes(t.people)) t.people = people[0];
		const labels = { worker: __('Gig workers'), agg: __('Aggregators') };
		const $tools = this.$root.find('#wbd-tl-tools').html(`<label class="wbd-tl-tool"><span>${__('People')}</span>
			<select data-k="people">${people
				.map(v => `<option value="${v}" ${t.people === v ? 'selected' : ''}>${labels[v]}</option>`).join('')}</select></label>`);
		$tools.find('select').on('change', (e) => { t.people = e.target.value; this.render_timeline_tab(); });
		this.server_table($list, t.people, {}, { export_name: 'timeline' });
	}

	filter_timeline($scope, e) {
		const k = String($(e.currentTarget).data('k'));
		$scope.find('.wbd-tlf').removeClass('is-on');
		$(e.currentTarget).addClass('is-on');
		$scope.find('.wbd-tli').each((_i, el) => { $(el).toggleClass('is-hidden', k !== 'all' && $(el).data('kind') !== k); });
		$scope.find('.wbd-tlg').each((_i, el) => { $(el).toggleClass('is-hidden', !$(el).find('.wbd-tli:not(.is-hidden)').length); });
	}

	open_timeline(kind, name) {
		const d = new frappe.ui.Dialog({ title: kind === 'agg' ? __('Aggregator timeline') : __('Gig worker timeline'), size: 'extra-large' });
		d.$wrapper.find('.modal-dialog').addClass('wbd-modal-tl');
		d.$body.html(`<style>${WBD_CSS}</style><div class="wbd-root wbd-in-modal"><div class="wbd-empty">${__('Loading…')}</div></div>`);
		d.show();
		frappe.xcall(WBD_API + 'get_timeline', this.ctx({ kind, name })).then((t) => {
			d.$body.find('.wbd-root').html(this.timeline_html(t));
			d.$body.on('click', '.wbd-tlf', (e) => {
				const k = String($(e.currentTarget).data('k'));
				d.$body.find('.wbd-tlf').removeClass('is-on');
				$(e.currentTarget).addClass('is-on');
				d.$body.find('.wbd-tli').each((_i, el) => { $(el).toggleClass('is-hidden', k !== 'all' && $(el).data('kind') !== k); });
				d.$body.find('.wbd-tlg').each((_i, el) => { $(el).toggleClass('is-hidden', !$(el).find('.wbd-tli:not(.is-hidden)').length); });
			});
		}).catch(() => { d.hide(); });
	}

	timeline_html(t) {
		const h = t.head || {};
		const c = WBD_STATUS_COLORS[h.status] || '#920c24';
		const initial = String(h.name || '?').trim().charAt(0).toUpperCase();
		const doctype = h.kind === 'agg' ? 'Aggregator' : 'Gig Worker';
		const id = `<a class="wbd-idlink" target="_blank" href="${this.desk_link(doctype, h.id)}">${this.esc(h.id)} ↗</a>`;
		const stats = (t.stats || []).map(s => `<div style="--c:${WBD_TONES[s.tone] || '#6B7A8A'}"><span>${this.esc(s.label)}</span><b>${this.esc(s.value)}</b></div>`).join('');
		const journey = (t.journey || []).map(s => `<div class="wbd-step ${s.done ? 'is-done' : ''} ${s.bad ? 'is-bad' : ''}">
			<span class="wbd-step-dot">${s.bad ? '✕' : s.done ? '✓' : ''}</span><span class="wbd-step-l">${this.esc(s.label)}</span></div>`).join('');

		const kinds = {};
		(t.events || []).forEach(e => { kinds[e.kind] = (kinds[e.kind] || 0) + 1; });
		const filt = `<div class="wbd-tlp-filter"><button class="wbd-tlf is-on" data-k="all">${__('Everything')}<span>${(t.events || []).length}</span></button>
			${Object.keys(kinds).map(k => `<button class="wbd-tlf" data-k="${k}" style="--k:${WBD_KIND_COLORS[k] || '#6B7A8A'}"><span class="wbd-dot" style="--c:${WBD_KIND_COLORS[k] || '#6B7A8A'}"></span>${this.esc(frappe.utils.to_title_case(k))}<span>${kinds[k]}</span></button>`).join('')}</div>`;

		const groups = {};
		(t.events || []).forEach(e => { (groups[e.when.slice(0, 10)] = groups[e.when.slice(0, 10)] || []).push(e); });
		const today = frappe.datetime.get_today();
		let today_drawn = false;
		const body = Object.keys(groups).sort().map(day => {
			let marker = '';
			if (!today_drawn && day > today) { marker = `<div class="wbd-tl-today"><span>${__('Today')}</span></div>`; today_drawn = true; }
			const dt = frappe.datetime.str_to_obj(day);
			const items = groups[day].map(e => {
				const k = WBD_TONES[e.tone] || WBD_KIND_COLORS[e.kind] || '#6B7A8A';
				const time = e.when.length > 10 && e.when.slice(11, 16) !== '00:00' ? e.when.slice(11, 16) : '';
				const flow = e.flow && e.flow.length ? `<div class="wbd-tli-flow">${e.flow.map(x => `<span class="wbd-pill" style="--c:${WBD_STATUS_COLORS[x] || k}">${this.esc(x)}</span>`).join('<span class="wbd-tli-arrow">→</span>')}</div>` : '';
				return `<div class="wbd-tli ${day > today ? 'is-future' : ''}" data-kind="${this.esc(e.kind)}" style="--k:${k}">
					<div class="wbd-tli-time">${time}</div>
					<div class="wbd-tli-card">
						<div class="wbd-tli-top"><span class="wbd-tli-kind">${this.esc(e.kind)}</span><span class="wbd-tli-title">${this.esc(e.title)}</span>
							${e.doctype && e.name ? `<a class="wbd-tli-doc" target="_blank" href="${this.desk_link(e.doctype, e.name)}">${this.esc(e.name)} ↗</a>` : ''}</div>
						${flow}${e.meta ? `<div class="wbd-tli-meta">${this.esc(e.meta)}</div>` : ''}
					</div></div>`;
			}).join('');
			return `${marker}<div class="wbd-tlg"><div class="wbd-tlg-date"><b>${dt.getDate()} ${dt.toLocaleString('en', { month: 'short' })}</b><span>${dt.getFullYear()}</span></div>
				<div class="wbd-tlg-items">${items}</div></div>`;
		}).join('');

		return `<div class="wbd-tlp-head">
				<div class="wbd-tlp-who"><div class="wbd-tlp-avatar" style="--c:${c}">${this.esc(initial)}</div>
					<div><div class="wbd-tlp-name">${this.esc(h.name || '—')} ${id}</div>
					<div class="wbd-tlp-pills">${h.aggregator ? this.agg_pill(h.aggregator) : ''}${this.status_pill(h.status)}
						${h.gender ? `<span class="wbd-muted">${this.esc(h.gender)}</span>` : ''}${h.phone ? `<span class="wbd-muted">${this.esc(h.phone)}</span>` : ''}
						${h.email ? `<span class="wbd-muted">${this.esc(h.email)}</span>` : ''}</div></div>
				</div>
			</div>
			<div class="wbd-tlp-stats">${stats}</div>
			<div class="wbd-journey">${journey}</div>
			${filt}
			<div class="wbd-tlp-scroll">${body || `<div class="wbd-empty">${__('No dated events recorded yet.')}</div>`}</div>`;
	}

	// ── analytics tab ──────────────────────────────────────────────────────
	render_analytics_tab() {
		const $p = this.$root.find('#wbd-flow, #wbd-aggs, #wbd-trend, #wbd-months, #wbd-profile, #wbd-invoices, #wbd-wds').addClass('wbd-st-loading');
		frappe.xcall(WBD_API + 'get_analytics', this.ctx({ filters: this.filters })).then((a) => {
			this.analytics = a;
			$p.removeClass('wbd-st-loading');
			this.render_flow();
			this.render_aggs();
			this.render_trend();
			this.render_months();
			this.render_profile();
			this.render_small_donuts();
		}).catch(() => { $p.removeClass('wbd-st-loading'); });
	}

	render_flow() {
		const steps = this.analytics.flow;
		const base = (steps[0] && steps[0].value) || 0;
		const rows = steps.map((s, i) => {
			const prev = i ? steps[i - 1].value : null;
			const lost = prev !== null && prev > s.value ? `${this.money(prev - s.value)} ${__('not yet here')}` : '';
			return `<div class="wbd-fun-row is-click" data-card="${s.key}" tabindex="0" role="button">
				<span class="wbd-fun-label">${this.esc(s.label)}</span>
				<span class="wbd-fun-track"><span class="wbd-fun-bar" style="width:${base ? Math.max((s.value / base) * 100, s.value ? 1 : 0) : 0}%"></span></span>
				<span class="wbd-fun-val"><b>${this.esc(this.money(s.value))}</b></span>
				<span class="wbd-fun-pct">${i ? `${this.pct_txt(s.value, base)} ${__('of raised')}` : ''}</span>
				<span class="wbd-fun-pct">${prev !== null ? `${this.pct_txt(s.value, prev)} ${__('of step before')}` : ''}</span>
				<span class="wbd-fun-lost">${lost}</span>
			</div>`;
		}).join('');
		const $f = this.$root.find('#wbd-flow').html(`<div class="wbd-fun">${rows}</div>`);
		this.bind_click($f.find('[data-card]'), (el) => this.drill_card($(el).data('card')));
	}

	render_aggs() {
		if (!this.analytics.aggregators) return;   // admin-only panel
		const rows = this.analytics.aggregators;
		if (!rows.length) { this.$root.find('#wbd-aggs').html(`<div class="wbd-empty">${__('No aggregator activity for these filters.')}</div>`); return; }
		const num = (v, kind, agg, card) => `<a class="wbd-num" data-kind="${kind}" data-agg="${this.esc(agg)}" ${card ? `data-card="${card}"` : ''}>${this.n(v || 0)}</a>`;
		const cash = (v, kind, agg, card) => `<a class="wbd-num" data-kind="${kind}" data-agg="${this.esc(agg)}" ${card ? `data-card="${card}"` : ''}>${this.esc(this.money(v || 0))}</a>`;
		const body = rows.map(r => `<tr>
			<td>${r.aggregator ? `<a class="wbd-cand wbd-agg-tl" data-id="${this.esc(r.aggregator)}">${this.esc(r.aggregator_name)}</a>` : this.esc(r.aggregator_name)}</td>
			<td>${num(r.workers, 'worker', r.aggregator)}</td>
			<td>${num(r.txns, 'txn', r.aggregator)}</td>
			<td>${cash(r.txn_amount, 'txn', r.aggregator)}</td>
			<td>${cash(r.fees, 'fee', r.aggregator)}</td>
			<td>${cash(r.fees_paid, 'fee', r.aggregator, 'fee_completed')}</td>
			<td>${cash(r.balance_due, 'invoice', r.aggregator, 'inv_due')}</td>
			<td>${r.overdue ? `<span class="wbd-pill" style="--c:${WBD_TONES.bad}">${this.n(r.overdue)}</span>` : '<span class="wbd-muted">0</span>'}</td>
		</tr>`).join('');
		const $t = this.$root.find('#wbd-aggs').html(`<table class="wbd-table"><thead><tr>
			<th>${__('Aggregator')}</th><th>${__('Workers')}</th><th>${__('Transactions')}</th><th>${__('Transaction value')}</th>
			<th>${__('Welfare fees raised')}</th><th>${__('Fees paid')}</th><th>${__('Invoice balance due')}</th><th>${__('Overdue invoices')}</th>
		</tr></thead><tbody>${body}</tbody></table>`);
		$t.find('.wbd-num').on('click', (e) => {
			const $a = $(e.currentTarget);
			const kind = String($a.data('kind'));
			const agg = String($a.data('agg') || '');
			const card = $a.data('card');
			const label = `${this.agg_name(agg)} · ${(this.meta.sources[kind] || {}).label || kind}`;
			this.drill(label, kind, card ? { card, unit: agg } : { unit: agg }, this.honours_note(kind));
		});
		$t.find('.wbd-agg-tl').on('click', (e) => { this.open_timeline('agg', String($(e.currentTarget).data('id'))); });
	}

	export_aggs() {
		if (!this.analytics) return;
		this.export_csv('aggregator-summary', [
			{ key: 'aggregator', label: __('Aggregator ID') }, { key: 'aggregator_name', label: __('Aggregator') },
			{ key: 'workers', label: __('Workers') }, { key: 'txns', label: __('Transactions') },
			{ key: 'txn_amount', label: __('Transaction value') }, { key: 'fees', label: __('Welfare fees raised') },
			{ key: 'fees_paid', label: __('Fees paid') }, { key: 'balance_due', label: __('Invoice balance due') },
			{ key: 'overdue', label: __('Overdue invoices') }
		], this.analytics.aggregators || []);
	}

	render_trend() {
		const w = this.analytics.txn_weeks || [];
		const cats = w.map(x => frappe.datetime.str_to_user(x.week).slice(0, 5));
		const $t = this.$root.find('#wbd-trend').html(w.length
			? this.svg_bars(cats, [{ key: 'n', label: __('Transactions'), color: '#2b4f7e' }], w, { click: (i) => ({ week: w[i].week }), compact: true })
			: `<div class="wbd-empty">${__('No transactions for these filters.')}</div>`);
		this.bind_svg_clicks($t, 'txn', __('Transactions in week'));
	}

	render_months() {
		const m = this.analytics.fee_months || [];
		const cats = m.map(x => moment(x.month + '-01').format('MMM YY'));
		const series = [{ key: 'raised', label: __('Raised'), color: '#920c24' }, { key: 'paid', label: __('Paid'), color: '#1d6b3a' }];
		const legend = `<div class="wbd-legend" style="margin-bottom:6px">${series.map(s => `<span><i style="background:${s.color}"></i>${s.label}</span>`).join('')}</div>`;
		const $t = this.$root.find('#wbd-months').html(m.length
			? legend + this.svg_bars(cats, series, m, { click: (i) => ({ month: m[i].month }), money: true })
			: `<div class="wbd-empty">${__('No welfare fees for these filters.')}</div>`);
		this.bind_svg_clicks($t, 'fee', __('Welfare fees in'));
	}

	donut_items(rows, empty_label) {
		return (rows || []).map((r, i) => ({ key: r.key, label: r.key || empty_label, value: r.value,
			color: WBD_STATUS_COLORS[r.key] || WBD_PALETTE[i % WBD_PALETTE.length] }));
	}

	render_profile() {
		const a = this.analytics;
		const chart = (title, kind, field, rows) => `<div class="wbd-tl-chart" data-kind="${kind}"><div class="wbd-tl-chart-title">${title}</div>${this.svg_donut(this.donut_items(rows, __('Not recorded')), field)}</div>`;
		const dist = a.txn_district || [];
		const max = Math.max(1, ...dist.map(r => r.value));
		const bars = dist.map(r => `<div class="wbd-bar-row is-click" data-field="district" data-value="${this.esc(r.key)}" tabindex="0" role="button">
			<span class="wbd-bar-label">${this.esc(r.key || __('Not recorded'))}</span>
			<span class="wbd-bar-track"><span class="wbd-bar-fill" style="width:${(r.value / max) * 100}%"></span></span>
			<span class="wbd-bar-val"><b>${this.n(r.value)}</b></span></div>`).join('');
		const earnings = (a.txn_aggregator || []).map(r => ({ key: r.key, value: Math.round(r.value) }));
		const $p = this.$root.find('#wbd-profile').html(`<div class="wbd-grid-2">
			${a.worker_gender ? chart(__('Worker gender'), 'worker', 'gender', a.worker_gender) : ''}
			${a.worker_status ? chart(__('Worker status'), 'worker', 'status', a.worker_status) : ''}
			${a.txn_aggregator ? `<div class="wbd-tl-chart" data-kind="txn"><div class="wbd-tl-chart-title">${__('Earnings by aggregator (₹)')}</div>${this.svg_donut(earnings.map((r, i) => ({ key: r.key, label: this.agg_name(r.key), value: r.value, color: this.agg_color(r.key) })), 'aggregator')}</div>` : ''}
			${chart(__('Transactions by service'), 'txn', 'service_category', a.txn_service)}
			<div class="wbd-tl-chart" data-kind="txn"><div class="wbd-tl-chart-title">${__('Transactions by district')} <small class="wbd-muted">${__('top 12')}</small></div>
				<div class="wbd-bars">${bars || `<div class="wbd-empty">${__('No data')}</div>`}</div></div>
		</div>`);
		this.bind_chart_drill($p);
	}

	render_small_donuts() {
		const a = this.analytics;
		const chart = (kind, field, rows) => `<div data-kind="${kind}" class="wbd-chart-scope">${this.svg_donut(this.donut_items(rows, __('Not set')), field)}</div>`;
		if (a.invoice_status) this.bind_chart_drill(this.$root.find('#wbd-invoices').html(chart('invoice', 'invoice_status', a.invoice_status)));
		if (a.wd_type) this.bind_chart_drill(this.$root.find('#wbd-wds').html(a.wd_type.length
			? chart('wd', 'withdrawal_type', a.wd_type)
			: `<div class="wbd-empty">${__('No benefit withdrawals requested for these filters yet.')}</div>`));
	}

	bind_chart_drill($scope) {
		this.bind_click($scope.find('[data-field]'), (el) => {
			const $e = $(el);
			const kind = String($e.closest('[data-kind]').data('kind'));
			const title = $e.closest('.wbd-tl-chart').find('.wbd-tl-chart-title').first().text() || (this.meta.sources[kind] || {}).label;
			const field = String($e.data('field'));
			const value = String($e.data('value') || '');
			// an aggregator slice narrows by aggregator (the drilldown's unit), not by a column
			const extra = field === 'aggregator' ? { unit: value } : { field, value };
			const label = field === 'aggregator' ? this.agg_name(value) : (value || __('Not recorded'));
			this.drill(`${title}: ${label}`, kind, extra, this.honours_note(kind));
		});
	}

	bind_svg_clicks($scope, kind, title) {
		$scope.find('[data-x]').filter('g, rect').on('click', (e) => {
			const x = JSON.parse($(e.currentTarget).attr('data-x'));
			this.drill(`${title} · ${$(e.currentTarget).attr('data-cat')}`, kind, x, this.honours_note(kind));
		});
	}

	// ── SVG charts (no chart library: crisp in both themes, never redraws on resize) ──
	svg_bars(cats, series, rows, opts = {}) {
		if (!cats.length) return `<div class="wbd-empty">${__('No data')}</div>`;
		const fmt = (v) => opts.money ? `₹${this.n(Math.round(v))}` : this.n(v);
		const W = 560, H = opts.compact ? 200 : 230, L = 44, B = 34, T = 18;
		const max = Math.max(1, ...rows.map(r => Math.max(0, ...series.map(s => r[s.key] || 0))));
		const nice = Math.pow(10, Math.floor(Math.log10(max)));
		const top = Math.ceil(max / nice) * nice || 1;
		const step = (W - L - 8) / cats.length;
		const bw = Math.min(46, step * 0.7);
		const y = (v) => T + (H - T - B) * (1 - v / top);
		let g = '';
		[0, 0.5, 1].forEach(f => {
			const v = top * f;
			g += `<line x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="wbd-grid"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" class="wbd-axis">${fmt(v)}</text>`;
		});
		cats.forEach((c, i) => {
			const x0 = L + i * step + (step - bw) / 2;
			const x_attr = opts.click ? `data-x='${this.esc(JSON.stringify(opts.click(i)))}' data-cat="${this.esc(c)}" class="wbd-bar-g is-click"` : 'class="wbd-bar-g"';
			let bars = '';
			const sw = bw / series.length;
			series.forEach((s, j) => {
				const v = rows[i][s.key] || 0;
				bars += `<rect x="${x0 + j * sw}" y="${y(v)}" width="${Math.max(sw - 2, 2)}" height="${Math.max(y(0) - y(v), 0)}" fill="${s.color}" rx="2" data-tip="${this.esc(`${c} · ${s.label}: ${fmt(v)}`)}"/>`;
				if (v && series.length <= 2 && !opts.compact) bars += `<text x="${x0 + j * sw + (sw - 2) / 2}" y="${y(v) - 5}" text-anchor="middle" class="wbd-axis-v">${fmt(v)}</text>`;
			});
			const label = cats.length > 14 && i % Math.ceil(cats.length / 14) ? '' : c;
			g += `<g ${x_attr}><rect x="${L + i * step}" y="${T}" width="${step}" height="${H - T - B}" fill="transparent"/>${bars}
				<text x="${x0 + bw / 2}" y="${H - B + 16}" text-anchor="middle" class="wbd-axis">${this.esc(String(label).slice(0, 16))}</text></g>`;
		});
		return `<svg class="wbd-svg" viewBox="0 0 ${W} ${H}" role="img">${g}</svg>`;
	}

	svg_donut(items, field) {
		const total = items.reduce((a, b) => a + b.value, 0);
		if (!total) return `<div class="wbd-empty">${__('No data')}</div>`;
		const R = 70, r = 44, C = 85;
		let a0 = -Math.PI / 2;
		const arc = (a1) => {
			const p = (rad, a) => `${C + rad * Math.cos(a)} ${C + rad * Math.sin(a)}`;
			const large = a1 - a0 > Math.PI ? 1 : 0;
			const d = `M ${p(R, a0)} A ${R} ${R} 0 ${large} 1 ${p(R, a1)} L ${p(r, a1)} A ${r} ${r} 0 ${large} 0 ${p(r, a0)} Z`;
			a0 = a1;
			return d;
		};
		const slices = items.map(it => {
			const a1 = a0 + (it.value / total) * Math.PI * 2 - (items.length === 1 ? 0.0001 : 0);
			return `<path class="wbd-slice is-click" d="${arc(a1)}" fill="${it.color}" data-field="${field}" data-value="${this.esc(it.key)}"
				data-tip="${this.esc(`${it.label}: ${this.n(it.value)} (${this.pct_txt(it.value, total)})`)}"/>`;
		}).join('');
		const legend = items.slice(0, 8).map(it => `<div class="is-click" data-field="${field}" data-value="${this.esc(it.key)}"><i style="background:${it.color}"></i>
			<span class="lbl">${this.esc(it.label)}</span><b>${this.n(it.value)}</b><span class="wbd-muted">${this.pct_txt(it.value, total)}</span></div>`).join('');
		return `<div class="wbd-donut"><svg class="wbd-donut-svg" viewBox="0 0 170 170">${slices}
			<text x="${C}" y="${C + 7}" text-anchor="middle" class="wbd-donut-total">${this.n(total)}</text></svg>
			<div class="wbd-donut-legend">${legend}</div></div>`;
	}

	bind_tip($scope, $own_tip) {
		const $tip = () => $own_tip || this.$root.find('#wbd-tip');
		$scope.on('mousemove', '[data-tip]', (e) => {
			const t = $(e.currentTarget).attr('data-tip');
			$tip().text(t).css({ left: e.clientX + 14, top: e.clientY + 14 }).addClass('is-on');
		});
		$scope.on('mouseleave', '[data-tip]', () => { $tip().removeClass('is-on'); });
	}

	export_csv(name, columns, rows) {
		const q = (v) => `"${String(v === null || v === undefined ? '' : v).replace(/"/g, '""')}"`;
		const csv = [columns.map(c => q(c.label)).join(',')].concat(rows.map(r => columns.map(c => q(r[c.key])).join(','))).join('\n');
		const a = document.createElement('a');
		a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
		a.download = `${name}-${frappe.datetime.get_today()}.csv`;
		a.click();
		setTimeout(() => { URL.revokeObjectURL(a.href); }, 1000);
	}

	// ── card guide ─────────────────────────────────────────────────────────
	open_guide() {
		const d = new frappe.ui.Dialog({ title: __('Card guide — what each number means'), size: 'extra-large' });
		const row = (c) => `<tr><th>${this.esc(c.label)}</th><td>${this.esc(c.guide || '')}</td></tr>`;
		const note = (kinds) => kinds.map(k => {
			const src = this.meta.sources[k] || {};
			return `${this.esc(src.label || k)}: ${(src.honours || []).length ? this.esc(src.honours.join(', ')) : __('no filters')}`;
		}).join(' · ');
		const sections = [`<div class="wbd-guide-sec">${__('Welfare money flow')}</div>
			<div class="wbd-muted wbd-guide-note">${__('Filters that apply')} — ${note(Array.from(new Set(this.meta.headline.map(c => c.kind))))}</div>
			<table class="wbd-guide">${this.meta.headline.map(row).join('')}</table>`]
			.concat(this.meta.board.map(s => {
				const kinds = Array.from(new Set([].concat(...s.tiles.map(t => t.cards.map(c => c.kind)))));
				return `<div class="wbd-guide-sec">${this.esc(s.title)}</div><div class="wbd-muted wbd-guide-note">${__('Filters that apply')} — ${note(kinds)}</div>
				<table class="wbd-guide">${s.tiles.map(t => t.cards.map(row).join('')).join('')}</table>`;
			}));
		d.$body.html(`<style>${WBD_CSS}</style><div class="wbd-root wbd-in-modal">
			<p class="wbd-muted">${__('Every card counts records that are in that state <b>right now</b>, for the filters you applied. Each area responds to the filters that exist on its records — listed under each section below. Cards marked "any date" ignore the date range. Click any number to open the list behind it; click a worker or aggregator for their timeline.')}</p>
			${sections.join('')}</div>`);
		d.show();
	}
}

const WBD_CSS = `
.wbd-root { --page:#f0f2f5; --bg:#ffffff; --bg-soft:#f8fafc; --border:#e2e8f0; --border-soft:#edf0f4; --text:#1f1a17;
	--text-2:#3b342f; --muted:#57504a; --head:#7a0a1e; --link:#920c24; --hover:#fbf1f3; --grid:#e8e4e0;
	--brand:#920c24; --brand-tint:#fbf1f3; --shadow:0 1px 2px rgba(31,26,23,.05), 0 2px 8px rgba(31,26,23,.04);
	--pipe-open:#920c24; --pipe-ended:#e7b3bd; --font:"Merriweather", Georgia, "Times New Roman", serif;
	color:var(--text); padding:18px 22px 48px; background:var(--page); min-height:100%; transition:opacity .15s; font-family:var(--font); }
:root[data-theme="dark"] .wbd-root { --page:#151312; --bg:#1f1c1a; --bg-soft:#252220; --border:#35302d; --border-soft:#2c2826;
	--text:#f2eeea; --text-2:#d4cdc7; --muted:#a79f98; --head:#4d232b; --link:#f07a8e; --hover:#2a2220; --grid:#35302d;
	--brand:#f07a8e; --brand-tint:#3a1c22; --shadow:none; --pipe-open:#f07a8e; --pipe-ended:#5a2a33; }
.wbd-root button, .wbd-root input, .wbd-root select, .wbd-root table { font-family:var(--font); }
.modal-dialog.wbd-modal .modal-title, .modal-dialog.wbd-modal-tl .modal-title { font-family:"Merriweather", Georgia, serif; }
.wbd-root.wbd-in-modal { padding:0; background:transparent; min-height:0; }
.wbd-root.wbd-loading { opacity:.6; }
.wbd-muted { color:var(--muted); font-size:12px; }
.wbd-tabs { display:flex; gap:2px; margin-bottom:12px; border-bottom:1px solid var(--border); }
.wbd-tab { background:none; border:0; border-bottom:2px solid transparent; margin-bottom:-1px; padding:7px 16px; font-size:13px; font-weight:600; color:var(--muted); cursor:pointer; }
.wbd-tab:hover { color:var(--text); }
.wbd-tab.is-on { color:var(--brand); border-bottom-color:var(--brand); }
.wbd-pane[hidden] { display:none !important; }
.wbd-filters { background:var(--bg); border:1px solid var(--border); border-radius:10px; padding:12px 16px 14px; margin-bottom:16px; box-shadow:var(--shadow); }
.wbd-topbar { display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap; }
.wbd-topbar-right { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.wbd-topbar-right b { color:var(--text); }
.wbd-presets { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px; }
.wbd-preset { border:1px solid var(--border); background:var(--bg-soft); color:var(--text-2); border-radius:20px; padding:3px 12px; font-size:12px; font-weight:600; cursor:pointer; }
.wbd-preset:hover { border-color:var(--brand); color:var(--brand); }
.wbd-preset.is-on { background:var(--brand); border-color:var(--brand); color:#fff; }
:root[data-theme="dark"] .wbd-preset.is-on, :root[data-theme="dark"] #wbd-apply { color:#1f1a17; }
.wbd-filter-row { display:flex; flex-wrap:wrap; gap:10px; align-items:flex-end; }
.wbd-f { display:flex; flex-direction:column; gap:3px; }
.wbd-f label { font-size:10.5px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; margin:0; }
.wbd-f input[type=date] { height:32px; border:1px solid var(--border); border-radius:8px; padding:0 8px; font-size:12.5px; background:var(--bg); color:var(--text); }
.wbd-f-btns { flex-direction:row; gap:6px; margin-left:auto; align-self:flex-end; }
#wbd-apply { background:var(--brand); border-color:var(--brand); color:#fff; }
.wbd-ms { position:relative; }
/* Wide screens: one row, the multi-selects share the free width. Narrower: wrap. */
@media (min-width:1251px) { .wbd-filter-row { flex-wrap:nowrap; } .wbd-f:has(.wbd-ms) { flex:1 1 0; min-width:0; } }
@media (max-width:1250px) { .wbd-ms { width:160px; } }
@media (max-width:700px) { .wbd-f:has(.wbd-ms), .wbd-f:has(input[type=date]) { flex:1 1 calc(50% - 10px); min-width:0; } .wbd-ms, .wbd-f input[type=date] { width:100%; }
	.wbd-jump { position:static; } }
.wbd-ms-box { display:flex; flex-wrap:wrap; align-items:center; overflow:hidden; gap:4px; padding:3px 8px; border:1px solid var(--border); border-radius:8px; background:var(--bg); cursor:pointer; min-height:32px; }
.wbd-ms.open .wbd-ms-box { border-color:var(--brand); box-shadow:0 0 0 3px color-mix(in srgb, var(--brand) 18%, transparent); }
.wbd-ms-ph { font-size:12.5px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }
.wbd-ms-chip { display:inline-flex; align-items:center; gap:4px; background:color-mix(in srgb, var(--brand) 12%, transparent); color:var(--text-2); border-radius:6px; padding:1px 5px 1px 7px; font-size:11px; font-weight:600; max-width:120px; }
.wbd-ms-chip .txt { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.wbd-ms-chip .x { cursor:pointer; opacity:.7; }
.wbd-ms-more { font-size:11px; color:var(--muted); font-weight:600; }
.wbd-ms-panel { display:none; position:absolute; top:calc(100% + 4px); left:0; z-index:60; background:var(--bg); border:1px solid var(--border); border-radius:10px;
	box-shadow:0 10px 24px -8px rgba(16,24,40,.25); width:max(100%,270px); max-width:min(360px,90vw); max-height:300px; overflow-y:auto; }
.wbd-ms.open .wbd-ms-panel { display:block; }
.wbd-ms-search { position:sticky; top:0; background:var(--bg); padding:6px; border-bottom:1px solid var(--border-soft); }
.wbd-ms-search input { width:100%; padding:5px 8px; border:1px solid var(--border); border-radius:6px; font-size:12px; background:var(--bg); color:var(--text); }
.wbd-ms-actions { display:flex; justify-content:space-between; padding:5px 8px; border-bottom:1px solid var(--border-soft); font-size:11px; }
.wbd-ms-actions a { color:var(--link); cursor:pointer; font-weight:600; }
.wbd-ms-opt { display:flex; gap:8px; padding:6px 10px; font-size:12px; cursor:pointer; margin:0; font-weight:400; color:var(--text); }
.wbd-ms-opt:hover { background:var(--hover); }
.wbd-ms-empty, .wbd-empty { padding:14px; font-size:12px; color:var(--muted); text-align:center; }
/* cards */
.wbd-cards { margin-bottom:18px; }
.wbd-headline { display:grid; grid-template-columns:repeat(6, minmax(0,1fr)); gap:12px; }
.wbd-headline.is-funnel { column-gap:18px; }
.wbd-headline.is-funnel .wbd-kpi:not(:last-child)::after { content:'›'; position:absolute; right:-14px; top:30px; width:10px; text-align:center; font-size:20px; line-height:1; color:var(--muted); pointer-events:none; }
.wbd-headline.is-funnel .wbd-kpi:has(+ .is-aside)::after { display:none; }
.wbd-kpi, .wbd-tile { position:relative; background:var(--bg); border:1px solid var(--border); border-radius:8px; box-shadow:var(--shadow); min-width:0; }
.wbd-kpi { padding:14px 16px 12px; display:flex; flex-direction:column; gap:6px; }
.wbd-kpi.is-click, .wbd-half.is-click, .wbd-tile-1.is-click { cursor:pointer; }
.wbd-kpi.is-click:hover, .wbd-tile-1.is-click:hover { border-color:color-mix(in srgb, var(--brand) 45%, var(--border)); }
.wbd-kpi:focus-visible, .wbd-half:focus-visible, .wbd-tile-1:focus-visible { outline:none; box-shadow:0 0 0 2px var(--brand); }
.wbd-kpi-top, .wbd-tile-head { display:flex; align-items:center; justify-content:space-between; gap:8px; min-width:0; }
.wbd-kpi-label, .wbd-tile-title { font-size:13.5px; font-weight:650; color:var(--text); display:flex; align-items:center; min-width:0; line-height:1.3; }
.wbd-kpi-value { font-size:28px; font-weight:700; letter-spacing:-.02em; line-height:1.15; color:var(--text); font-variant-numeric:tabular-nums; display:flex; align-items:center; }
.wbd-share { font-size:11.5px; font-weight:600; color:var(--text-2); background:var(--bg-soft); border:1px solid var(--border); border-radius:20px; padding:1px 8px; margin-left:10px; letter-spacing:0; }
.wbd-kpi-sub { font-size:12px; color:var(--muted); }
.wbd-dot { display:inline-block; flex:none; width:8px; height:8px; border-radius:50%; background:var(--c); margin-right:7px; }
.wbd-info { flex:none; display:inline-grid; place-items:center; width:16px; height:16px; border-radius:50%; border:1px solid var(--border); color:var(--muted); font-size:10px; font-style:italic; font-family:Georgia, serif; cursor:help; }
.wbd-section { margin-top:22px; }
.wbd-section-title { display:flex; align-items:center; gap:10px; font-size:11px; font-weight:700; color:var(--text-2); text-transform:uppercase; letter-spacing:.06em; margin:0 2px 10px; }
.wbd-section-title::after { content:''; flex:1; border-top:1px solid var(--border); }
.wbd-section-note { text-transform:none; letter-spacing:0; font-weight:500; color:var(--muted); order:2; }
.wbd-tiles { display:grid; grid-template-columns:repeat(6, minmax(0,1fr)); gap:12px; }
.wbd-tile { padding:14px 16px 12px; display:flex; flex-direction:column; gap:6px; }
.wbd-tile-2 { grid-column:span 2; }
.wbd-halves { display:grid; grid-template-columns:1fr 1fr; gap:0; }
.wbd-half { padding:2px 10px 2px 0; border-radius:6px; display:flex; flex-direction:column; gap:4px; min-width:0; }
.wbd-half + .wbd-half { border-left:1px solid var(--border-soft); padding-left:18px; }
.wbd-half.is-click:hover .wbd-kpi-value { color:var(--link) !important; }
/* Block (not flex) so a long label wraps as text and keeps its dot on the first line. */
.wbd-half-label { font-size:12.5px; font-weight:600; color:var(--text); display:block; line-height:1.35; }
.wbd-half-label .wbd-dot { vertical-align:1px; }
.wbd-half-label .wbd-flag { display:inline-block; vertical-align:1px; }
.wbd-flag { margin-left:6px; font-size:9.5px; font-weight:700; color:#B7651B; border:1px solid #B7651B; border-radius:3px; padding:0 4px; text-transform:uppercase; letter-spacing:.04em; }
@media (max-width:1250px) { .wbd-headline, .wbd-tiles { grid-template-columns:repeat(3, minmax(0,1fr)); } .wbd-headline.is-funnel .wbd-kpi::after { display:none; } }
@media (max-width:700px) { .wbd-headline, .wbd-tiles { grid-template-columns:repeat(2, minmax(0,1fr)); } .wbd-tile-2 { grid-column:span 2; } .wbd-root { padding:12px 16px 40px; } }
/* panels & tables */
.wbd-panel { background:var(--bg); border:1px solid var(--border); border-radius:10px; box-shadow:var(--shadow); margin-bottom:16px; min-width:0; }
.wbd-panel-head { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap; padding:12px 14px; border-bottom:1px solid var(--border-soft); }
.wbd-panel-title { font-size:14px; font-weight:700; color:var(--text); }
.wbd-panel-sub { font-size:11.5px; color:var(--muted); margin-top:2px; }
.wbd-panel-body { padding:14px; transition:opacity .15s; }
.wbd-panel-tools { display:flex; gap:6px; flex-wrap:wrap; }
.wbd-st-loading { opacity:.55; }
.wbd-grid-2 { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:12px; }
.wbd-grid-2 > .wbd-panel { margin-bottom:16px; }
@media (max-width:900px) { .wbd-grid-2 { grid-template-columns:minmax(0,1fr); } }
.wbd-table-scroll { overflow-x:auto; position:relative; }
.wbd-table { width:100%; border-collapse:collapse; font-size:12.5px; }
.wbd-table th { background:var(--head); color:#fff; font-weight:600; text-align:left; padding:8px 10px; white-space:nowrap; position:sticky; top:0; }
.wbd-table th.is-sort { cursor:pointer; }
.wbd-arrow { opacity:.7; font-size:10px; }
.wbd-table td { padding:8px 10px; border-bottom:1px solid var(--border-soft); color:var(--text); vertical-align:middle; white-space:nowrap; }
.wbd-table tbody tr:hover td { background:var(--hover); }
.wbd-trunc { display:inline-block; max-width:240px; overflow:hidden; text-overflow:ellipsis; vertical-align:bottom; }
.wbd-idlink, .wbd-cand, .wbd-num { color:var(--link); font-weight:600; cursor:pointer; text-decoration:underline; text-decoration-color:color-mix(in srgb, var(--link) 35%, transparent); text-underline-offset:3px; }
.wbd-pill { display:inline-block; font-size:11px; font-weight:600; color:color-mix(in srgb, var(--c) 80%, #000); background:color-mix(in srgb, var(--c) 12%, transparent);
	border:1px solid color-mix(in srgb, var(--c) 35%, transparent); border-radius:20px; padding:1px 8px; white-space:nowrap; }
:root[data-theme="dark"] .wbd-pill { color:color-mix(in srgb, var(--c) 60%, #fff); }
.wbd-days { font-weight:600; font-variant-numeric:tabular-nums; }
.wbd-days.is-long { color:#B7651B; }
.wbd-tt-tools { display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:10px 14px; }
.wbd-search { flex:0 1 380px; }
.wbd-search input { width:100%; height:34px; border:1px solid var(--border); border-radius:8px; padding:0 10px; font-size:12.5px; background:var(--bg); color:var(--text); }
.wbd-tt-export { margin-left:auto; }
.wbd-tt-pager { display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; padding:10px 14px; }
.wbd-tt-pager select { margin-left:6px; height:28px; border:1px solid var(--border); border-radius:6px; background:var(--bg); color:var(--text); }
.wbd-pages { display:flex; align-items:center; gap:4px; }
.wbd-pg { border:1px solid var(--border); background:var(--bg); color:var(--text); border-radius:6px; min-width:28px; height:28px; cursor:pointer; }
.wbd-pg:disabled { opacity:.4; cursor:default; }
/* funnel */
.wbd-fun { display:flex; flex-direction:column; gap:2px; }
.wbd-fun-row { display:grid; grid-template-columns:170px minmax(0,1fr) 80px 120px 90px 150px; align-items:center; gap:12px; padding:6px; border-radius:6px; font-size:12.5px; }
.wbd-fun-row.is-click { cursor:pointer; }
.wbd-fun-row.is-click:hover { background:var(--hover); }
.wbd-fun-label { font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.wbd-fun-track, .wbd-bar-track { height:18px; background:var(--border-soft); border-radius:0 4px 4px 0; overflow:hidden; display:block; }
.wbd-fun-bar, .wbd-bar-fill { display:block; height:100%; background:var(--brand); border-radius:0 4px 4px 0; }
.wbd-fun-val { text-align:right; font-variant-numeric:tabular-nums; }
.wbd-fun-pct, .wbd-fun-lost { white-space:nowrap; font-variant-numeric:tabular-nums; }
.wbd-fun-lost { font-size:11.5px; color:var(--muted); }
@media (max-width:900px) { .wbd-fun-row { grid-template-columns:110px minmax(0,1fr) 64px; } .wbd-fun-pct, .wbd-fun-lost { grid-column:2 / -1; } }
.wbd-fun-table td { white-space:nowrap; }
.wbd-bars { display:flex; flex-direction:column; gap:4px; }
.wbd-bar-row { display:grid; grid-template-columns:150px minmax(0,1fr) 170px; align-items:center; gap:10px; padding:5px 6px; border-radius:6px; font-size:12.5px; }
.wbd-bar-row.is-click { cursor:pointer; }
.wbd-bar-row.is-click:hover { background:var(--hover); }
.wbd-bar-label { display:flex; align-items:center; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.wbd-bar-val { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
@media (max-width:600px) { .wbd-bar-row { grid-template-columns:100px minmax(0,1fr); } .wbd-bar-val { grid-column:1 / -1; text-align:left; } }
.wbd-tl-kpis { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:12px; margin-bottom:12px; }
.wbd-tl-kpi { border:1px solid var(--border); border-top:3px solid var(--c); border-radius:8px; padding:10px 12px; background:var(--bg); display:flex; flex-direction:column; gap:2px; min-width:0; }
.wbd-tl-kpi.is-click { cursor:pointer; }
.wbd-tl-kpi.is-click:hover { background:var(--hover); }
.wbd-tl-kpi-top span { font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); }
.wbd-tl-kpi b { font-size:22px; color:var(--text); font-variant-numeric:tabular-nums; }
.wbd-tl-kpi small { font-size:11.5px; color:var(--muted); }
@media (max-width:900px) { .wbd-tl-kpis { grid-template-columns:repeat(2, minmax(0,1fr)); } }
.wbd-tl-chart { border:1px solid var(--border); border-radius:8px; padding:12px 14px; background:var(--bg); min-width:0; }
.wbd-tl-chart-head { display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap; margin-bottom:8px; }
.wbd-tl-chart-title { font-size:13.5px; font-weight:700; color:var(--text); margin-bottom:6px; }
.wbd-offers-head { margin:16px 2px 10px; }
.wbd-legend { display:flex; gap:12px; flex-wrap:wrap; font-size:11.5px; color:var(--text-2); }
.wbd-legend span { display:inline-flex; align-items:center; gap:5px; white-space:nowrap; }
.wbd-legend i { display:inline-block; width:10px; height:10px; border-radius:2px; }
.wbd-svg { display:block; width:100%; height:auto; }
.wbd-svg .wbd-grid { stroke:var(--grid); }
.wbd-svg .wbd-axis { fill:var(--muted); font-size:11px; }
.wbd-svg .wbd-axis-v { fill:var(--text-2); font-size:11px; font-weight:600; }
.wbd-svg .is-click { cursor:pointer; }
.wbd-svg .is-click:hover > rect:first-child { fill:var(--hover); }
.wbd-donut { display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
.wbd-donut-svg { width:170px; height:170px; flex:none; }
.wbd-slice { cursor:pointer; }
.wbd-slice:hover { opacity:.85; }
.wbd-donut-total { font-size:20px; font-weight:700; fill:var(--text); }
.wbd-donut-legend { flex:1; min-width:150px; display:flex; flex-direction:column; gap:6px; font-size:12px; color:var(--text-2); }
.wbd-donut-legend > div { display:grid; grid-template-columns:10px minmax(0,1fr) auto 42px; align-items:center; gap:8px; cursor:pointer; border-radius:4px; }
.wbd-donut-legend > div:hover { background:var(--hover); }
.wbd-donut-legend i { width:10px; height:10px; border-radius:2px; }
.wbd-donut-legend .lbl { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.wbd-donut-legend b { color:var(--text); font-variant-numeric:tabular-nums; }
.wbd-donut-legend .wbd-muted { text-align:right; }
.wbd-tip { position:fixed; z-index:1100; pointer-events:none; background:#1A2B3C; color:#fff; font-size:12px; padding:5px 9px; border-radius:6px; opacity:0; transition:opacity .1s; max-width:320px; white-space:pre-line; }
.wbd-tip.is-on { opacity:1; }
/* drilldown & timeline popups */
.modal-dialog.wbd-modal, .modal-dialog.wbd-modal-tl { max-width:min(1240px, 94vw); width:94vw; }
.wbd-dd-note { margin-bottom:10px; }
.wbd-dd-units { display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:8px; margin-bottom:12px; }
.wbd-dd-units:empty { display:none; }
.wbd-dd-unit { display:flex; flex-direction:column; align-items:flex-start; gap:2px; text-align:left; cursor:pointer; border:1px solid var(--border); border-radius:8px; background:var(--bg); padding:8px 12px; color:var(--text); }
.wbd-dd-unit:hover { border-color:var(--brand); }
.wbd-dd-unit.is-on { border-color:var(--brand); box-shadow:inset 0 0 0 1px var(--brand); background:color-mix(in srgb, var(--brand) 7%, var(--bg)); }
.wbd-dd-unit-name { font-size:12px; font-weight:600; color:var(--text-2); }
.wbd-dd-unit-v { display:flex; align-items:baseline; gap:6px; }
.wbd-dd-unit-v b { font-size:18px; font-variant-numeric:tabular-nums; }
.wbd-dd-unit-v small { font-size:11.5px; color:var(--muted); }
.wbd-in-modal .wbd-tt { border:1px solid var(--border); border-radius:10px; }
.wbd-tl-tools { display:flex; align-items:flex-end; gap:10px; flex-wrap:wrap; padding:10px 14px; border-bottom:1px solid var(--border-soft); background:var(--bg-soft); }
.wbd-tl-tool { display:flex; flex-direction:column; gap:3px; margin:0; }
.wbd-tl-tool span { font-size:10.5px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; }
.wbd-tl-tool select { height:32px; min-width:170px; max-width:260px; border:1px solid var(--border); border-radius:8px; padding:0 8px; font-size:12.5px; background:var(--bg); color:var(--text); }
.wbd-tl-tool-wide select { min-width:240px; }
@media (max-width:600px) { .wbd-tl-tool, .wbd-tl-tool select { width:100%; max-width:none; } }
.wbd-tlp-head { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:14px; }
.wbd-tlp-who { display:flex; align-items:center; gap:12px; min-width:0; }
.wbd-tlp-avatar { flex:none; width:42px; height:42px; border-radius:50%; display:grid; place-items:center; font-size:17px; font-weight:700;
	color:color-mix(in srgb, var(--c) 85%, #000); background:color-mix(in srgb, var(--c) 14%, var(--bg)); border:1px solid color-mix(in srgb, var(--c) 35%, transparent); }
.wbd-tlp-name { font-size:16px; font-weight:700; color:var(--text); display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; }
.wbd-tlp-name .wbd-idlink { font-size:12.5px; }
.wbd-tlp-pills { display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-top:4px; }
.wbd-tlp-stats { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:10px; }
.wbd-tlp-stats > div { border:1px solid var(--border); border-top:3px solid var(--c); border-radius:8px; padding:9px 12px; background:color-mix(in srgb, var(--c) 4%, var(--bg)); display:flex; flex-direction:column; gap:2px; }
.wbd-tlp-stats span { font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); }
.wbd-tlp-stats b { font-size:15px; color:var(--text); }
.wbd-journey { display:flex; gap:0; margin:16px 0 6px; overflow-x:auto; padding-bottom:4px; }
.wbd-step { flex:1; min-width:78px; display:flex; flex-direction:column; align-items:center; gap:4px; position:relative; font-size:11px; color:var(--muted); text-align:center; }
.wbd-step::before { content:''; position:absolute; top:11px; left:-50%; width:100%; border-top:2px solid var(--border); z-index:0; }
.wbd-step:first-child::before { display:none; }
.wbd-step.is-done::before { border-color:#2F7D4F; }
.wbd-step-dot { position:relative; z-index:1; width:24px; height:24px; border-radius:50%; display:grid; place-items:center; font-size:12px; font-weight:700;
	background:var(--bg); border:2px solid var(--border); color:#fff; }
.wbd-step.is-done .wbd-step-dot { background:#2F7D4F; border-color:#2F7D4F; }
.wbd-step.is-done { color:var(--text); font-weight:600; }
.wbd-step.is-bad .wbd-step-dot { background:#B83232; border-color:#B83232; }
.wbd-step.is-bad { color:#B83232; font-weight:600; }
.wbd-tlp-filter { display:flex; gap:6px; flex-wrap:wrap; padding:10px 0; border-top:1px solid var(--border-soft); margin-top:8px; }
.wbd-tlf { display:inline-flex; align-items:center; border:1px solid var(--border); background:var(--bg); color:var(--text-2); border-radius:20px; padding:3px 11px; font-size:12px; font-weight:600; cursor:pointer; }
.wbd-tlf .wbd-dot { width:7px; height:7px; margin-right:6px; }
.wbd-tlf > span:last-child { margin-left:5px; color:var(--muted); font-weight:500; }
.wbd-tlf.is-on { background:color-mix(in srgb, var(--k, var(--brand)) 12%, var(--bg)); border-color:var(--k, var(--brand)); color:var(--text); }
.wbd-tlp-scroll { max-height:58vh; overflow:auto; overscroll-behavior:contain; border:1px solid var(--border); border-radius:10px; background:var(--bg-soft); padding:16px 18px 6px; }
.wbd-tlg { display:grid; grid-template-columns:86px minmax(0,1fr); gap:14px; }
.wbd-tlg.is-hidden, .wbd-tli.is-hidden { display:none; }
.wbd-tlg-date { text-align:right; padding-top:9px; display:flex; flex-direction:column; line-height:1.25; }
.wbd-tlg-date b { font-size:13.5px; color:var(--text); }
.wbd-tlg-date span { font-size:11px; color:var(--muted); }
.wbd-tlg-items { border-left:2px solid var(--border); padding:0 0 10px 18px; display:flex; flex-direction:column; gap:6px; }
.wbd-tli { position:relative; display:grid; grid-template-columns:40px minmax(0,1fr); gap:8px; align-items:start; }
.wbd-tli::before { content:''; position:absolute; left:-25px; top:10px; width:12px; height:12px; border-radius:50%; background:var(--k); border:2px solid var(--bg-soft); box-shadow:0 0 0 1px var(--k); }
.wbd-tli.is-future::before { background:var(--bg-soft); border:2px dashed var(--k); box-shadow:none; }
.wbd-tli-time { font-size:11.5px; color:var(--muted); padding-top:8px; font-variant-numeric:tabular-nums; }
.wbd-tli-card { background:var(--bg); border:1px solid var(--border-soft); border-left:3px solid var(--k); border-radius:8px; padding:7px 12px; min-width:0; }
.wbd-tli-top { display:flex; align-items:center; gap:4px 8px; flex-wrap:wrap; }
.wbd-tli-kind { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:color-mix(in srgb, var(--k) 85%, #000); background:color-mix(in srgb, var(--k) 11%, transparent); border-radius:4px; padding:1px 6px; }
:root[data-theme="dark"] .wbd-tli-kind { color:color-mix(in srgb, var(--k) 65%, #fff); }
.wbd-tli-title { font-size:13px; font-weight:650; color:var(--text); }
.wbd-tli-doc { margin-left:auto; font-size:11.5px; color:var(--link); white-space:nowrap; }
.wbd-tli-flow { display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-top:5px; }
.wbd-tli-arrow { color:var(--muted); }
.wbd-tli-meta { font-size:12px; color:var(--text-2); margin-top:3px; overflow-wrap:anywhere; }
.wbd-tl-today { position:relative; margin:8px 0 12px; text-align:center; }
.wbd-tl-today::before { content:''; position:absolute; left:0; right:0; top:50%; border-top:1px dashed #A16207; }
.wbd-tl-today span { position:relative; background:var(--bg-soft); padding:0 10px; font-size:11px; font-weight:700; color:#A16207; text-transform:uppercase; letter-spacing:.05em; }
@media (max-width:600px) { .wbd-tlp-stats { grid-template-columns:repeat(2, minmax(0,1fr)); } .wbd-tlg { grid-template-columns:minmax(0,1fr); gap:4px; }
	.wbd-tlg-date { text-align:left; flex-direction:row; gap:6px; padding-top:0; } .wbd-tli { grid-template-columns:minmax(0,1fr); } .wbd-tli-time:empty { display:none; } }
.wbd-headline-title { margin:22px 2px 10px; }
/* module jump bar */
/* Pinned while the board scrolls (the v16 desk scrolls .main-section, which is the sticky container). */
.wbd-jump { display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin:-4px -6px 14px; padding:8px 6px; position:sticky; top:0; z-index:20;
	background:color-mix(in srgb, var(--page) 92%, transparent); backdrop-filter:blur(6px); }
.wbd-jump:empty { display:none; }
.wbd-jump-label { font-size:10.5px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; margin-right:4px; }
.wbd-jump-chip { border:1px solid var(--border); background:var(--bg); color:var(--text-2); border-radius:20px; padding:3px 12px; font-size:12px; font-weight:600; cursor:pointer; }
.wbd-jump-chip:hover { border-color:var(--brand); color:var(--brand); background:var(--brand-tint); }
.wbd-section { scroll-margin-top:56px; }
.wbd-is-denied, .wbd-tile-1.is-denied, .wbd-half.is-denied { opacity:.55; cursor:not-allowed; }
.wbd-num-cell { font-variant-numeric:tabular-nums; }
.wbd-guide-note { margin:-2px 0 6px; }
/* guide */
.wbd-guide-sec { font-size:11px; font-weight:700; color:var(--text-2); text-transform:uppercase; letter-spacing:.06em; margin:18px 0 6px; padding-bottom:6px; border-bottom:1px solid var(--border); }
.wbd-guide { width:100%; border-collapse:collapse; font-size:12.5px; }
.wbd-guide th { width:230px; text-align:left; vertical-align:top; padding:8px 12px 8px 0; color:var(--text); font-weight:650; border-bottom:1px solid var(--border-soft); }
.wbd-guide td { padding:8px 0; color:var(--text-2); border-bottom:1px solid var(--border-soft); }
/* Welfare Board additions */
.wbd-fun-row { grid-template-columns:190px minmax(0,1fr) 120px 120px 150px 170px; }
@media (max-width:900px) { .wbd-fun-row { grid-template-columns:120px minmax(0,1fr) 100px; } }
.wbd-agg-tl { cursor:pointer; }
`;
