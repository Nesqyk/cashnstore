import { api } from '../api.js';
import { h, peso, num, fmtTime, fmtDate, fmtDateTime, toast, openModal, field, input, withIcon, busy, showFieldErrors, setFieldError, debounce, hourLabel, delta } from '../util.js';
import { icon } from '../icons.js';
import { can, session } from '../state.js';
import { pageHead, card, kpi, chips, emptyState, pager, methodBadge, statusBadge, csvLink, segmented } from '../components.js';
import { avatarFor } from '../avatars.js';
import { lineChart, donut, hbars, legend, COLORS, MIX_COLORS, METHOD_LABEL } from '../charts.js';
import { receiptNode, printReceipt } from '../receipt.js';
import { href, go } from '../router.js';

const PERIODS = [{ value: 'today', label: 'Today' }, { value: 'week', label: 'This week' }, { value: 'month', label: 'This month' }, { value: '30d', label: 'Last 30 days' }, { value: 'all', label: 'All time' }];

export async function list() {
  const all = can('sales.view_all');
  const state = { page: 1, period: 'week', method: '', status: '', q: '' };
  const page = h('div', { class: 'stack s24' });
  page.append(pageHead({ title: all ? 'Sales' : 'My sales', subtitle: all ? 'Every sale rung up at your registers.' : 'The sales you rang up.', actions: all ? csvLink(`/api/sales/export.csv?period=${state.period}`, 'Export CSV') : null }));

  const analytics = h('div');
  page.append(analytics);
  api.get('/api/sales/analytics').then((a) => {
    const k = a.kpis;
    if (!k.orders) { analytics.replaceChildren(card(emptyState({ art: 'chart', title: 'No sales yet today', text: 'Today’s numbers appear here as soon as the first sale is rung up.' }), { title: 'Today at a glance' })); return; }
    const mix = a.payment_mix.map((m) => ({ label: METHOD_LABEL[m.method], value: m.total, color: MIX_COLORS[m.method] }));
    analytics.replaceChildren(h('div', { class: 'stack' },
      h('div', { class: 'grid g4' }, kpi(a.scope === 'own' ? 'Your sales today' : 'Sales today', peso(k.sales), { pct: k.vs_yesterday_pct, sub: 'vs same time yesterday' }),
        kpi('Orders', num(k.orders), { sub: `${k.cash_orders} cash · ${k.gcash_orders} GCash${k.utang_orders ? ` · ${k.utang_orders} utang` : ''}` }), kpi('Average sale', peso(k.avg_sale, 2)), kpi('Items per order', String(k.items_per_order))),
      h('div', { class: 'grid g-23' },
        card(h('div', null, lineChart({ labels: a.hourly.map((r) => hourLabel(r.hour)), title: 'Sales by the hour', series: [{ name: 'Yesterday', values: a.hourly.map((r) => r.yesterday), color: COLORS.teal3, dashed: true }, { name: 'Today', values: a.hourly.map((r) => r.today), color: COLORS.teal, area: true }], height: 200 }),
          h('div', { style: { marginTop: '8px' } }, legend([{ label: 'Today', color: COLORS.teal }, { label: 'Yesterday', color: COLORS.teal3 }]))), { title: 'Today by the hour' }),
        card(h('div', { class: 'stack' },
          h('div', { class: 'row wrap', style: { gap: '18px', justifyContent: 'center' } }, donut({ parts: mix, size: 110, centerTop: String(k.orders), centerBottom: 'orders', title: 'Sales by payment method', inline: true }), h('div', { class: 'stack s8', style: { flex: '1 1 150px' } }, a.payment_mix.map((m) => h('div', { class: 'row between small' }, h('span', null, METHOD_LABEL[m.method]), h('b', null, peso(m.total)))))),
          h('hr', { class: 'divider' }), h('div', { class: 'small muted' }, 'Basket size'), hbars(a.order_size.map((o) => ({ label: o.label, value: o.orders, text: String(o.orders) })), { fmt: String, title: 'Orders by basket size' })), { title: 'Payments and baskets' })),
      h('div', { class: 'grid g2' },
        card(a.top_items.length ? hbars(a.top_items.map((i) => ({ label: i.description ? `${i.name} (${i.description})` : i.name, value: i.sold, text: `${i.sold} sold` })), { fmt: String, title: 'Top items today' }) : h('p', { class: 'muted' }, 'Nothing sold yet.'), { title: 'Top items today' }),
        all ? card(h('div', null, a.by_cashier.map((c) => h('div', { class: 'row', style: { padding: '8px 0' } }, avatarFor(c.name, c.avatar_key, 'sm'), h('div', { class: 'grow' }, h('div', { class: 'bold' }, c.name), h('div', { class: 'tiny muted' }, `${c.orders} orders`)), h('b', { class: 'num' }, peso(c.total))))), { title: 'By cashier today' }) : null)));
  }).catch(() => {});

  const tableBox = h('div');
  page.append(tableBox);
  async function load() {
    tableBox.replaceChildren(h('div', { class: 'card skeleton', style: { height: '300px' } }));
    let r;
    try { r = await api.get('/api/sales', { page: state.page, size: 10, period: state.period, method: state.method, status: state.status, q: state.q }); }
    catch (ex) { tableBox.replaceChildren(h('div', { class: 'alert err' }, ex.message)); return; }
    const sel = (opts, val, key, label) => { const s = h('select', { class: 'input', style: 'width:auto', 'aria-label': label, onchange: (e) => { state[key] = e.target.value; state.page = 1; load(); } }, opts.map(([v, l]) => h('option', { value: v }, l))); s.value = val; return s; };
    const search = input({ type: 'search', placeholder: 'Search sale number, item or customer', value: state.q, 'aria-label': 'Search sales' });
    search.addEventListener('input', debounce(() => { state.q = search.value; state.page = 1; load().then(() => { const i = tableBox.querySelector('input[type=search]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }); }, 300));
    const head = h('div', { class: 'stack s12' },
      chips(PERIODS, state.period, (v) => { state.period = v; state.page = 1; load(); }),
      h('div', { class: 'toolbar', style: { marginBottom: 0 } }, h('div', { class: 'search' }, withIcon(icon('search', 18), search)),
        sel([['', 'All payments'], ['cash', 'Cash'], ['gcash', 'GCash'], ['utang', 'Utang']], state.method, 'method', 'Payment method'),
        sel([['', 'Any status'], ['completed', 'Completed'], ['refunded', 'Refunded']], state.status, 'status', 'Status')),
      h('div', { class: 'small muted' }, `${num(r.total)} sales · ${peso(r.sum_total)} total${r.refunded ? ` · ${r.refunded} refunded` : ''}`));
    const table = !r.sales.length
      ? emptyState({ art: state.q || state.method || state.status ? 'search' : 'sales', title: 'No sales found', text: 'Try another period or clear the filters.' })
      : h('div', null, h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, ['Sale', 'When', all ? 'Cashier' : null, 'Items', 'Payment', 'Total', 'Status'].filter(Boolean).map((t, i) => h('th', { class: t === 'Total' ? 'right' : '' }, t)))),
        h('tbody', null, r.sales.map((s) => h('tr', { class: 'click', onclick: () => go(`/sales/${s.id}`) },
          h('td', { class: 'bold' }, s.sale_no), h('td', { class: 'muted' }, `${fmtDate(s.created_at)}, ${fmtTime(s.created_at)}`),
          all ? h('td', null, h('div', { class: 'row s8' }, avatarFor(s.cashier, s.cashier_avatar, 'sm'), s.cashier)) : null,
          h('td', { style: { maxWidth: '260px' } }, h('div', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, s.preview), s.item_count > 2 ? h('div', { class: 'tiny muted' }, `+${s.item_count - 2} more`) : null),
          h('td', null, methodBadge(s.payment_method), s.customer ? h('div', { class: 'tiny muted' }, s.customer) : null), h('td', { class: 'right num bold' }, peso(s.total, 2)), h('td', null, statusBadge(s.status))))))),
      pager({ page: r.page, size: r.size, total: r.total, noun: 'sales', onPage: (n) => { state.page = n; load(); } }));
    tableBox.replaceChildren(h('div', { class: 'stack s12' }, head, h('div', { class: 'card flush' }, table)));
  }
  await load();
  return page;
}

export async function detail({ params }) {
  const data = await api.get(`/api/sales/${params.id}`);
  const { sale, items, store } = data;
  let size = '80';
  const holder = h('div', { style: { overflow: 'auto', padding: '4px' } });
  const paint = () => holder.replaceChildren(receiptNode(data, size));
  paint();

  const actions = [h('button', { class: 'btn', onclick: () => printReceipt(holder.firstChild) }, icon('print', 16), 'Print receipt')];
  if (data.can_refund) actions.push(h('button', { class: 'btn danger', onclick: () => refundModal(sale) }, icon('undo', 16), 'Issue refund'));

  return h('div', { class: 'stack' },
    pageHead({ crumb: { to: '/sales', label: 'Sales' }, title: sale.sale_no, subtitle: fmtDateTime(sale.created_at), actions }),
    sale.status === 'refunded' ? h('div', { class: 'alert err' }, icon('undo', 18), h('div', null, h('b', null, 'Refunded'), ` on ${fmtDateTime(sale.refunded_at)}${sale.refunded_by ? ` by ${sale.refunded_by}` : ''}. Reason: ${sale.refund_reason || 'none given'}. Stock was returned to the shelf.`)) : null,
    h('div', { class: 'grid g-main' },
      h('div', { class: 'stack' },
        card(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
          h('thead', null, h('tr', null, ['Item', 'Qty', 'Price', 'Total'].map((t, i) => h('th', { class: i ? 'right' : '' }, t)))),
          h('tbody', null, items.map((i) => h('tr', null, h('td', null, h('div', { class: 'bold' }, i.name), h('div', { class: 'small muted' }, i.description)), h('td', { class: 'right num' }, i.qty), h('td', { class: 'right num' }, peso(i.unit_price, 2)), h('td', { class: 'right num bold' }, peso(i.line_total, 2))))))),
          { title: 'Items' }),
        card(h('dl', { class: 'kv' },
          h('dt', null, 'Status'), h('dd', null, statusBadge(sale.status)), h('dt', null, 'Cashier'), h('dd', null, h('span', { class: 'row s8' }, avatarFor(sale.cashier, sale.cashier_avatar, 'sm'), sale.cashier)),
          h('dt', null, 'Register'), h('dd', null, sale.station), h('dt', null, 'Payment'), h('dd', null, methodBadge(sale.payment_method)),
          sale.customer ? [h('dt', null, 'Customer'), h('dd', null, `${sale.customer} (owes ${peso(sale.customer_balance, 2)})`)] : null,
          h('dt', null, 'Subtotal'), h('dd', { class: 'num' }, peso(sale.subtotal, 2)),
          sale.discount > 0 ? [h('dt', null, sale.discount_type === 'pwd' ? 'PWD discount' : 'Senior discount'), h('dd', { class: 'num' }, `-${peso(sale.discount, 2)}`)] : null,
          h('dt', null, 'Total'), h('dd', { class: 'num bold', style: { fontSize: '20px' } }, peso(sale.total, 2)),
          sale.cash_received != null ? [h('dt', null, 'Cash received'), h('dd', { class: 'num' }, peso(sale.cash_received, 2)), h('dt', null, 'Change'), h('dd', { class: 'num' }, peso(sale.change_given, 2))] : null), { title: 'Sale details' })),
      card(h('div', { class: 'stack s12' }, segmented([{ value: '80', label: '80 mm' }, { value: '58', label: '58 mm' }, { value: 'a4', label: 'A4' }], size, (v) => { size = v; paint(); }), holder), { title: 'Receipt' })));
}

function refundModal(sale) {
  const needPin = session.store && session.store.has_owner_pin;
  const reason = input({ placeholder: 'e.g. Wrong item, customer returned' });
  const pin = input({ type: 'password', inputmode: 'numeric', maxlength: 4, placeholder: '4-digit PIN', autocomplete: 'off' });
  const boxes = { reason: field('Reason for the refund', reason), pin: field('Owner PIN', pin) };
  const err = h('div', { class: 'alert err hidden' });
  const btn = h('button', { class: 'btn danger solid' }, `Refund ${peso(sale.total, 2)}`);
  const m = openModal(h('div', null, h('h2', null, 'Issue refund'), h('p', { class: 'muted' }, `${sale.sale_no} will be marked refunded and the items returned to stock.`),
    h('div', { class: 'stack', style: { marginTop: '16px' } }, boxes.reason, needPin ? boxes.pin : null, err),
    h('div', { class: 'modal-actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'), btn)));
  btn.addEventListener('click', () => busy(btn, async () => {
    err.classList.add('hidden'); showFieldErrors(boxes);
    try { await api.post(`/api/sales/${sale.id}/refund`, { reason: reason.value, pin: pin.value }); m.close(); toast('Sale refunded', 'ok'); go(`/sales/${sale.id}`); }
    catch (ex) { if (ex.fields && Object.keys(ex.fields).length) showFieldErrors(boxes, ex.fields); else { err.textContent = ex.message; err.classList.remove('hidden'); } }
  }));
}
