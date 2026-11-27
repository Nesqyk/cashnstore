import { api } from '../api.js';
import { h, peso, pesoShort, num, fmtDay, fmtDate, fmtWeekday, fmtTime, delta } from '../util.js';
import { icon } from '../icons.js';
import { pageHead, card, kpi, chips, emptyState, csvLink, methodBadge } from '../components.js';
import { lineChart, barChart, groupedBars, donut, hbars, legend, COLORS, MIX_COLORS, METHOD_LABEL } from '../charts.js';
import { href, go } from '../router.js';

const PERIODS = [{ value: 'today', label: 'Today' }, { value: 'week', label: 'This week' }, { value: 'month', label: 'This month' }, { value: '30d', label: 'Last 30 days' }];

export async function overview() {
  const r = await api.get('/api/reports/overview');
  const link = (to, ic, title, text) => h('a', { class: 'card', href: href(to), style: { textDecoration: 'none', color: 'inherit', display: 'flex', gap: '14px', alignItems: 'center' } },
    h('span', { class: 'avatar', style: { borderRadius: '12px' } }, icon(ic, 22)), h('div', { class: 'grow' }, h('b', null, title), h('div', { class: 'small muted' }, text)), icon('chevronRight', 18));
  return h('div', { class: 'stack s24' }, pageHead({ title: 'Reports', subtitle: 'A quick read on sales, stock and GCash.' }),
    h('div', { class: 'grid g4' }, kpi('Sales, last 7 days', peso(r.week_sales), { pct: r.week_pct, sub: 'vs the 7 days before' }), kpi('Orders today', num(r.orders_today), { sub: `${r.cash_orders} cash · ${r.gcash_orders} GCash` }),
      kpi('Needs restocking', num(r.needs_restock), { sub: `${r.out_count} out of stock` }), kpi('GCash fees this month', peso(r.gcash_fees_month), { sub: `${num(r.gcash_txn_month)} transactions` })),
    h('div', { class: 'grid g-23' }, card(lineChart({ labels: r.series.map((s) => fmtDay(s.date)), series: [{ values: r.series.map((s) => s.total), color: COLORS.teal, area: true }], title: 'Daily sales' }), { title: 'Daily sales', subtitle: 'Last 7 days' }),
      card(r.top_today.length ? hbars(r.top_today.map((p) => ({ label: p.description ? `${p.name} (${p.description})` : p.name, value: p.sold, text: `${p.sold} sold` })), { fmt: String }) : emptyState({ art: 'chart', title: 'No sales today', text: 'Best sellers show here once you sell.' }), { title: 'Best sellers today' })),
    h('div', { class: 'grid g3' }, link('/reports/sales', 'receipt', 'Sales report', 'Totals, best days and best sellers'), link('/reports/inventory', 'clipboard', 'Inventory report', 'Stock value and what to reorder'), link('/reports/gcash', 'wallet', 'GCash report', 'Cash in, cash out and fees')));
}

export async function detail({ params, query }) {
  const kind = params.kind;
  if (!['sales', 'inventory', 'gcash'].includes(kind)) return emptyState({ art: 'search', title: 'Report not found', action: h('a', { class: 'btn primary', href: href('/reports') }, 'All reports') });
  const state = { period: query.period && PERIODS.some((p) => p.value === query.period) ? query.period : '30d' };
  const body = h('div', { class: 'stack s24' });
  const titles = { sales: ['Sales report', 'Where the money came from.'], inventory: ['Inventory report', 'What is on the shelf and what to buy.'], gcash: ['GCash report', 'Cash in, cash out and the fees you earned.'] };
  const head = h('div');
  async function load() {
    body.replaceChildren(h('div', { class: 'card skeleton', style: { height: '300px' } }));
    try { body.replaceChildren(...BUILD[kind](await api.get(`/api/reports/${kind}`, { period: state.period }))); } catch (ex) { body.replaceChildren(h('div', { class: 'alert err' }, ex.message)); }
  }
  const controls = h('div', { class: 'row wrap between' }, kind === 'inventory' ? h('span') : chips(PERIODS, state.period, (v) => { state.period = v; load(); }), csvLink(`/api/reports/${kind}.csv?period=${state.period}`));
  // keep the CSV link in step with the period chips
  controls.addEventListener('click', () => setTimeout(() => { const a = controls.querySelector('a'); if (a) a.href = `/api/reports/${kind}.csv?period=${state.period}`; }, 0));
  await load();
  return h('div', { class: 'stack s24' }, pageHead({ crumb: { to: '/reports', label: 'Reports' }, title: titles[kind][0], subtitle: titles[kind][1] }), controls, body);
}

const BUILD = {
  sales: (r) => [
    h('div', { class: 'grid g4' }, kpi('Total sales', peso(r.total), { pct: r.total_pct, sub: r.total_pct === null ? `${fmtDate(r.from)} to ${fmtDate(r.to)}` : 'vs the period before' }), kpi('Orders', num(r.orders), { sub: `${r.orders_per_day} a day` }),
      kpi('Average sale', peso(r.avg_sale, 2), { sub: `${r.items_per_order} items per order` }), kpi('Best day', r.best_day ? peso(r.best_day.total) : '—', { sub: r.best_day ? fmtDay(r.best_day.date) : 'No sales in this period' })),
    h('div', { class: 'grid g-23' },
      card(r.daily.length > 14 ? lineChart({ labels: r.daily.map((d) => fmtDay(d.date)), series: [{ values: r.daily.map((d) => d.total), color: COLORS.teal, area: true }], title: 'Daily sales' }) : barChart({ bars: r.daily.map((d) => ({ label: r.daily.length > 8 ? fmtDay(d.date) : fmtWeekday(d.date), value: d.total })), title: 'Daily sales' }), { title: 'Sales per day' }),
      card(r.payment_mix.length ? h('div', { class: 'stack' }, donut({ parts: r.payment_mix.map((m) => ({ label: METHOD_LABEL[m.method], value: m.total, color: MIX_COLORS[m.method] })), centerTop: pesoShort(r.total), centerBottom: 'total', size: 150 }),
        r.payment_mix.map((m) => h('div', { class: 'row between' }, h('span', null, methodBadge(m.method)), h('span', { class: 'num' }, `${peso(m.total)} · ${num(m.orders)}`)))) : h('p', { class: 'muted' }, 'No payments in this period.'), { title: 'Payment methods' })),
    card(r.best_sellers.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['#', 'Product', 'Category', 'Sold', 'Sales'].map((t, i) => h('th', { class: i > 2 ? 'right' : '' }, t)))),
      h('tbody', null, r.best_sellers.map((p, i) => h('tr', null, h('td', null, h('span', { class: 'badge teal' }, i + 1)), h('td', null, h('div', { class: 'bold' }, p.name), h('div', { class: 'small muted' }, p.description)), h('td', null, p.category), h('td', { class: 'right num' }, num(p.sold)), h('td', { class: 'right num bold' }, peso(p.sales))))))) : emptyState({ art: 'chart', title: 'No sales in this period' }), { title: 'Best sellers', subtitle: `${r.product_count} products on sale` }),
  ],
  inventory: (r) => [
    h('div', { class: 'grid g4' }, kpi('Products', num(r.products)), kpi('In stock', num(r.in_stock)), kpi('Running low', num(r.low)), kpi('Out of stock', num(r.out))),
    h('div', { class: 'grid g-23' },
      card(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Category', 'Products', 'Stock value', 'To reorder'].map((t, i) => h('th', { class: i ? 'right' : '' }, t)))),
        h('tbody', null, r.by_category.map((c) => h('tr', null, h('td', { class: 'bold' }, c.category), h('td', { class: 'right num' }, c.products), h('td', { class: 'right num' }, peso(c.stock_value)), h('td', { class: 'right' }, c.needs_restock ? h('span', { class: 'badge warn' }, c.needs_restock) : h('span', { class: 'muted' }, '0'))))))), { title: 'By category', subtitle: `Total stock value ${peso(r.stock_value)}` }),
      card(r.restock_first.length ? h('div', null, r.restock_first.map((p) => h('div', { class: 'row between', style: { padding: '10px 0', borderBottom: '1px solid var(--line)' } }, h('b', null, p.name), h('span', { class: p.stock_qty ? 'badge warn' : 'badge bad' }, p.stock_qty ? `${p.stock_qty} ${p.unit} left` : 'Out'))),
        r.restock_total > r.restock_first.length ? h('div', { class: 'small muted', style: { marginTop: '10px' } }, `and ${r.restock_total - r.restock_first.length} more`) : null, h('a', { class: 'btn block', style: { marginTop: '12px' }, href: href('/inventory') }, 'Open inventory')) : emptyState({ art: 'stock', title: 'All stocked up' }), { title: 'Restock first' })),
  ],
  gcash: (r) => [
    h('div', { class: 'grid g4' }, kpi('Fees earned', peso(r.fees), { sub: `${fmtDate(r.from)} to ${fmtDate(r.to)}` }), kpi('Cash in', peso(r.cash_in), { sub: `${num(r.cash_in_count)} transactions` }), kpi('Cash out', peso(r.cash_out), { sub: `${num(r.cash_out_count)} transactions` }), kpi('GCash float now', peso(r.float))),
    h('div', { class: 'grid g-23' },
      card(r.buckets && r.buckets.length ? h('div', null, groupedBars({ groups: r.buckets.map((b) => ({ label: fmtDay(b.from), a: b.cash_in, b: b.cash_out })), title: 'Cash in and out' }), h('div', { style: { marginTop: '8px' } }, legend([{ label: 'Cash in', color: COLORS.teal }, { label: 'Cash out', color: COLORS.org }]))) : h('p', { class: 'muted' }, 'No transactions in this period.'), { title: 'Cash in and out', subtitle: 'Grouped by period' }),
      card(r.fee_brackets && r.fee_brackets.length ? hbars(r.fee_brackets.map((b) => ({ label: b.label, value: b.fees, text: `${peso(b.fees)} · ${b.count}` }))) : h('p', { class: 'muted' }, 'No fees yet.'), { title: 'Fees by amount size', subtitle: 'Which transaction sizes earn the most' })),
    card(r.recent.length ? h('div', null, r.recent.map((t) => h('a', { href: href(`/gcash/${t.id}`), class: 'row between', style: { padding: '10px 0', borderBottom: '1px solid var(--line)', textDecoration: 'none', color: 'inherit' } },
      h('div', null, h('div', { class: 'bold' }, `${t.gc_no} · ${t.customer_name}`), h('div', { class: 'small muted' }, `${fmtDay(t.created_at)}, ${fmtTime(t.created_at)}`)),
      h('div', { class: 'right' }, h('div', { class: 'num bold' }, peso(t.amount)), h('span', { class: `badge ${t.type === 'cash_in' ? 'teal' : 'org'}` }, t.type === 'cash_in' ? 'Cash in' : 'Cash out'))))) : emptyState({ art: 'gcash', title: 'No GCash activity' }), { title: 'Latest transactions' }),
  ],
};
