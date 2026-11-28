import { api } from '../api.js';
import { h, peso, pesoShort, num, fmtTime, fmtDay, fmtWeekday, hourLabel, greeting, delta, toast, openModal, field, peso$, busy, setFieldError, ago } from '../util.js';
import { icon } from '../icons.js';
import { session } from '../state.js';
import { pageHead, card, kpi, emptyState, segmented, methodBadge, stockBadge } from '../components.js';
import { lineChart, barChart, groupedBars, donut, legend, hbars, heatmap, COLORS, MIX_COLORS, METHOD_LABEL } from '../charts.js';
import { avatarFor } from '../avatars.js';
import { href, go } from '../router.js';

export default async function dashboard({ user }) {
  const { kind, data } = await api.get('/api/dashboard');
  return kind === 'owner' ? ownerView(user, data) : cashierView(user, data);
}

const firstName = (u) => u.full_name.split(' ')[0];

// ---------------------------------------------------------------------------------------------------
function recentList(rows, { showCashier = false } = {}) {
  if (!rows.length) return emptyState({ art: 'sales', title: 'No sales yet today', text: 'Your first sale will show up here.', action: h('a', { class: 'btn primary', href: href('/pos') }, 'Open the register') });
  return h('div', null, rows.map((r) => h('a', { href: href(`/sales/${r.id}`), class: 'row', style: { padding: '12px 0', borderBottom: '1px solid var(--line)', textDecoration: 'none', color: 'inherit' } },
    h('div', { class: 'grow' }, h('div', { class: 'bold', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.items || r.sale_no),
      h('div', { class: 'small muted' }, `${r.sale_no} · ${fmtTime(r.created_at)}${showCashier && r.cashier ? ` · ${r.cashier}` : ''}`)),
    h('div', { class: 'right' }, h('div', { class: 'bold num' }, peso(r.total)), methodBadge(r.payment_method)))));
}

function mixCard(mix, title = 'How customers paid') {
  const parts = mix.map((m) => ({ label: METHOD_LABEL[m.method], value: m.total, color: MIX_COLORS[m.method] }));
  const total = mix.reduce((a, m) => a + m.total, 0);
  if (!total) return card(h('p', { class: 'muted' }, 'No payments yet.'), { title });
  return card(h('div', { class: 'row', style: { gap: '24px', flexWrap: 'wrap' } }, donut({ parts, centerTop: pesoShort(total), centerBottom: 'total', size: 150, title }),
    h('div', { class: 'stack s8 grow' }, mix.map((m) => h('div', { class: 'row between' },
      h('span', null, h('i', { style: { display: 'inline-block', width: '10px', height: '10px', borderRadius: '3px', background: MIX_COLORS[m.method], marginRight: '8px' } }), METHOD_LABEL[m.method]),
      h('span', { class: 'num' }, `${peso(m.total)} · ${m.orders}`))))), { title });
}

function hourlyChart(rows, { prevKey = 'yesterday', curKey = 'today', title }) {
  const hrs = rows.filter((r) => r[curKey] !== undefined);
  if (!hrs.length || hrs.every((r) => !r[curKey] && !r[prevKey])) return h('p', { class: 'muted' }, 'Sales by the hour will appear once you start selling.');
  return h('div', null, lineChart({ labels: hrs.map((r) => hourLabel(r.hour)), title,
    series: [{ name: 'Yesterday', values: hrs.map((r) => r[prevKey]), color: COLORS.teal3, dashed: true }, { name: 'Today', values: hrs.map((r) => r[curKey]), color: COLORS.teal, area: true }] }),
  h('div', { style: { marginTop: '10px' } }, legend([{ label: 'Today', color: COLORS.teal }, { label: 'Yesterday', color: COLORS.teal3 }])));
}

// ---- owner --------------------------------------------------------------------------------------------
async function ownerView(user, d) {
  const t = d.today;
  const vsYesterday = d.today.yesterday_same_time > 0 ? ((t.sales - t.yesterday_same_time) / t.yesterday_same_time) * 100 : null;
  const week = d.week.map((w) => ({ label: fmtWeekday(w.date), tip: `${fmtWeekday(w.date)}, ${fmtDay(w.date)}`, value: w.total }));
  const page = h('div', { class: 'stack s24' });
  page.append(pageHead({ title: `${greeting()}, ${firstName(user)}`, subtitle: `${session.store?.store_name || ''} · here is how the store is doing today.`,
    actions: [h('a', { class: 'btn', href: href('/gcash/cash-in') }, icon('wallet', 16), 'GCash'), h('a', { class: 'btn primary', href: href('/pos') }, icon('cart', 16), 'Open register')] }));

  page.append(h('div', { class: 'grid g4' },
    kpi("Today's sales", peso(t.sales), { pct: vsYesterday, sub: 'vs same time yesterday' }),
    kpi('Orders today', num(t.orders), { sub: `${t.cash_orders} cash · ${t.gcash_orders} GCash${t.utang_orders ? ` · ${t.utang_orders} utang` : ''}` }),
    kpi('Cash in drawer', peso(d.drawer_cash), { sub: 'counted from sales and GCash' }),
    kpi('GCash float', peso(d.gcash_float), { sub: d.gcash_float < 10000 ? 'Below your minimum. Top up soon.' : 'Wallet balance on hand' })));

  page.append(h('div', { class: 'grid g-23' },
    card(week.every((w) => !w.value) ? emptyState({ art: 'chart', title: 'No sales this week yet', text: 'Your 7-day chart fills in as you sell.' }) : barChart({ bars: week, highlightLast: true, title: 'Sales, last 7 days', name: 'Sales' }),
      { title: 'Sales this week', subtitle: 'The last 7 days, today in dark teal' }),
    card(d.low_count + d.out_count === 0
      ? emptyState({ art: 'stock', title: 'All stocked up', text: 'Nothing is running low right now.' })
      : h('div', null, d.low_items.map((i) => h('div', { class: 'row between', style: { padding: '10px 0', borderBottom: '1px solid var(--line)' } },
        h('div', null, h('div', { class: 'bold' }, i.name), h('div', { class: 'small muted' }, `${i.stock_qty} ${i.unit} left · reorder at ${i.reorder_level}`)),
        stockBadge(i.stock_qty === 0 ? 'out' : 'low'))),
      h('a', { class: 'btn block', style: { marginTop: '14px' }, href: href('/inventory') }, `See all ${d.low_count + d.out_count} items`)),
    { title: 'Needs restocking', subtitle: `${d.out_count} out of stock · ${d.low_count} running low` })));

  page.append(card(recentList(d.recent_sales, { showCashier: true }), { title: 'Recent sales', action: h('a', { class: 'btn sm', href: href('/sales') }, 'View all') }));

  // ---- analytics section -------------------------------------------------------------------------------
  const analytics = h('div', { class: 'stack s24' });
  let days = 7;
  async function loadAnalytics() {
    analytics.replaceChildren(h('div', { class: 'card skeleton', style: { height: '280px' } }));
    try { analytics.replaceChildren(...analyticsBlocks(await api.get('/api/dashboard/analytics', { days }))); }
    catch (ex) { analytics.replaceChildren(h('div', { class: 'alert err' }, ex.message)); }
  }
  page.append(h('div', { class: 'row between wrap' }, h('div', null, h('h2', null, 'Analytics'), h('p', { class: 'muted small' }, 'Trends compared with the period just before it.')),
    segmented([{ value: 7, label: '7 days' }, { value: 14, label: '14 days' }, { value: 30, label: '30 days' }], days, (v) => { days = v; loadAnalytics(); })));
  page.append(analytics);
  loadAnalytics();
  return page;
}

function analyticsBlocks(a) {
  const k = a.kpis; const out = [];
  const label = `vs previous ${a.days} days`;
  out.push(h('div', { class: 'grid g4' },
    kpi('Gross sales', peso(k.gross), { pct: k.gross_pct, sub: label }), kpi('Orders', num(k.orders), { pct: k.orders_pct, sub: label }),
    kpi('Average sale', peso(k.avg_sale, 2), { pct: k.avg_pct, sub: label }), kpi('Estimated profit', peso(k.profit), { pct: k.profit_pct, sub: 'sales minus product cost' })));

  out.push(h('div', { class: 'grid g-23' },
    card(h('div', null, lineChart({ labels: a.series.map((s) => fmtDay(s.date)), title: 'Sales trend', series: [{ name: 'Previous period', values: a.series.map((s) => s.prev_total), color: COLORS.teal3, dashed: true }, { name: 'This period', values: a.series.map((s) => s.total), color: COLORS.teal, area: true }] }),
      h('div', { style: { marginTop: '10px' } }, legend([{ label: 'This period', color: COLORS.teal }, { label: 'Previous period', color: COLORS.teal3 }]))), { title: 'Sales trend' }),
    mixCard(a.payment_mix, 'Payment mix')));

  out.push(h('div', { class: 'grid g2' },
    card(a.categories.length ? h('div', null, a.categories.map((c) => h('div', { class: 'row between', style: { padding: '8px 0' } },
      h('span', { class: 'grow' }, c.category), h('span', { class: 'num bold' }, peso(c.revenue)), delta(c.change_pct) || h('span', { class: 'tiny muted' }, 'new')))) : h('p', { class: 'muted' }, 'No sales by category yet.'),
    { title: 'Sales by category', subtitle: 'Change versus the previous period' }),
    card(a.top_sellers.length ? h('div', null, a.top_sellers.map((p, i) => h('div', { class: 'row', style: { padding: '9px 0', borderBottom: '1px solid var(--line)' } },
      h('span', { class: 'badge teal' }, i + 1), h('div', { class: 'grow' }, h('div', { class: 'bold' }, p.name, p.description ? h('span', { class: 'muted', style: { fontWeight: 400 } }, ` · ${p.description}`) : null), h('div', { class: 'small muted' }, `${p.sold} ${p.unit} sold · ${p.stock_qty} left`)),
      h('span', { class: 'num bold' }, peso(p.revenue)), p.stock_qty <= p.reorder_level ? stockBadge(p.stock_qty === 0 ? 'out' : 'low') : null))) : h('p', { class: 'muted' }, 'Nothing sold yet.'),
    { title: 'Top sellers', subtitle: 'Best sellers that are also running low are flagged' })));

  out.push(h('div', { class: 'grid g2' },
    card(hourlyChart(a.hourly_today.map((r) => ({ hour: r.hour, today: r.total, yesterday: r.prev_total })), { title: 'Today by the hour' }), { title: 'Today by the hour', subtitle: 'Compared with the same hours yesterday' }),
    card(h('div', { class: 'tbl-wrap' }, heatmap(a.heatmap)), { title: 'Busiest hours', subtitle: 'Darker means more sales. Use it to plan who works when.' })));

  out.push(card(h('div', { class: 'grid g-23' },
    h('div', null, groupedBars({ groups: a.gcash.daily.map((g) => ({ label: fmtWeekday(g.date), tip: `${fmtWeekday(g.date)}, ${fmtDay(g.date)}`, a: g.cash_in, b: g.cash_out })), title: 'GCash cash in and out' }),
      h('div', { style: { marginTop: '10px' } }, legend([{ label: 'Cash in', color: COLORS.teal }, { label: 'Cash out', color: COLORS.org }]))),
    h('div', { class: 'stack' },
      h('div', { class: 'soft-box' }, h('div', { class: 'small muted' }, 'Fees earned'), h('div', { class: 'k-value', style: { fontSize: '24px', fontWeight: 700 } }, peso(a.gcash.fees)),
        delta(a.gcash.prev_fees ? ((a.gcash.fees - a.gcash.prev_fees) / a.gcash.prev_fees) * 100 : null)),
      h('div', { class: 'soft-box' }, h('div', { class: 'small muted' }, 'Float now'), h('div', { style: { fontSize: '24px', fontWeight: 700 } }, peso(a.gcash.float)),
        h('div', { class: 'small muted' }, `Minimum ${peso(a.gcash.min_float)}`)))), { title: 'GCash activity', subtitle: `Cash in and out each day for ${a.days} days` }));
  return out;
}

// ---- cashier --------------------------------------------------------------------------------------------
function startShiftModal(onDone) {
  const amt = peso$({ placeholder: '0', value: '1500' });
  const box = field('Cash in the drawer to start', amt, { hint: 'Count the bills and coins in the drawer before you begin.' });
  const btn = h('button', { class: 'btn primary' }, 'Start shift');
  const m = openModal(h('div', null, h('h2', null, 'Start your shift'), h('p', { class: 'muted' }, 'This helps match the drawer at the end of the day.'), h('div', { style: { marginTop: '16px' } }, box),
    h('div', { class: 'modal-actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Not now'), btn)));
  btn.addEventListener('click', () => busy(btn, async () => {
    try { await api.post('/api/shifts/start', { opening_cash: amt.querySelector('input').value }); m.close(); toast('Shift started', 'ok'); onDone(); }
    catch (ex) { setFieldError(box, ex.fields?.opening_cash || ex.message); }
  }));
}
function endShiftModal(shift, onDone) {
  const amt = peso$({ placeholder: '0' });
  const box = field('Cash counted in the drawer', amt);
  const btn = h('button', { class: 'btn primary' }, 'End shift');
  const m = openModal(h('div', null, h('h2', null, 'End your shift'), h('p', { class: 'muted' }, `Started with ${peso(shift.opening_cash)} at ${fmtTime(shift.started_at)}.`), h('div', { style: { marginTop: '16px' } }, box),
    h('div', { class: 'modal-actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'), btn)));
  btn.addEventListener('click', () => busy(btn, async () => {
    try { await api.post('/api/shifts/end', { closing_cash: amt.querySelector('input').value }); m.close(); toast('Shift ended. Salamat!', 'ok'); onDone(); }
    catch (ex) { setFieldError(box, ex.fields?.closing_cash || ex.message); }
  }));
}

async function cashierView(user, d) {
  const page = h('div', { class: 'stack s24' });
  const reload = async () => { const { data } = await api.get('/api/dashboard'); const fresh = await cashierView(user, data); page.replaceWith(fresh); };
  const pctGoal = d.goal ? Math.min(100, (d.sales_today / d.goal) * 100) : 0;
  const vs = d.yesterday_same_time > 0 ? ((d.sales_today - d.yesterday_same_time) / d.yesterday_same_time) * 100 : null;

  page.append(pageHead({ title: `${greeting()}, ${firstName(user)}`, subtitle: d.shift ? `${d.shift.station} · on shift since ${fmtTime(d.shift.started_at)}` : 'You have not started a shift yet.',
    actions: [d.shift ? h('button', { class: 'btn', onclick: () => endShiftModal(d.shift, reload) }, icon('clock', 16), 'End shift') : h('button', { class: 'btn accent', onclick: () => startShiftModal(reload) }, icon('clock', 16), 'Start shift'),
      h('a', { class: 'btn primary', href: href('/pos') }, icon('cart', 16), 'New sale')] }));

  page.append(h('div', { class: 'grid g-main' },
    card(h('div', { class: 'stack' },
      h('div', { class: 'row between wrap' }, h('div', null, h('div', { class: 'k-label muted' }, 'Your sales today'), h('div', { class: 'k-value', style: { fontSize: '36px', fontWeight: 700 } }, peso(d.sales_today))), vs !== null ? delta(vs, { suffix: ' vs yesterday' }) : null),
      h('div', null, h('div', { class: 'row between small' }, h('span', { class: 'muted' }, 'Daily goal'), h('b', null, `${peso(d.sales_today)} of ${peso(d.goal)}`)), h('div', { class: 'progress', style: { marginTop: '8px' } }, h('i', { style: { width: `${pctGoal}%` } })),
        h('div', { class: 'small muted', style: { marginTop: '6px' } }, pctGoal >= 100 ? 'You hit your goal. Magaling!' : `${peso(Math.max(0, d.goal - d.sales_today))} to go`))), { title: 'Your day so far' }),
    h('div', { class: 'stack' }, kpi('Orders', num(d.orders_today), { sub: d.orders_today ? `${peso(d.sales_today / d.orders_today, 0)} average` : 'None yet' }),
      kpi('Cash in drawer', peso(d.cash_in_drawer), { sub: d.shift ? `Started with ${peso(d.shift.opening_cash)}` : 'Start a shift to track this' }))));

  page.append(h('div', { class: 'grid g2' },
    card(hourlyChart(d.hourly, { title: 'Your sales by the hour' }), { title: 'Shift insights', subtitle: 'Your sales by the hour, today and yesterday' }),
    mixCard(d.payment_mix, 'How your customers paid')));

  page.append(h('div', { class: 'grid g2' },
    card(recentList(d.recent_sales), { title: 'Your recent sales', action: h('a', { class: 'btn sm', href: href('/sales') }, 'View all') }),
    card(h('div', { class: 'stack' },
      h('div', { class: 'grid g2' },
        h('div', { class: 'soft-box' }, h('div', { class: 'small muted' }, 'Cash in'), h('b', { style: { fontSize: '20px' } }, peso(d.gcash.cash_in)), h('div', { class: 'tiny muted' }, `${d.gcash.cash_in_count} transactions`)),
        h('div', { class: 'soft-box' }, h('div', { class: 'small muted' }, 'Cash out'), h('b', { style: { fontSize: '20px' } }, peso(d.gcash.cash_out)), h('div', { class: 'tiny muted' }, `${d.gcash.cash_out_count} transactions`))),
      h('div', { class: 'row between' }, h('span', { class: 'muted' }, 'GCash fees earned today'), h('b', null, peso(d.gcash.fees))),
      h('div', { class: 'row' }, h('a', { class: 'btn grow', href: href('/gcash/cash-in') }, 'Cash in'), h('a', { class: 'btn grow', href: href('/gcash/cash-out') }, 'Cash out'))),
    { title: 'GCash today', subtitle: 'All counters, whoever served' })));
  return page;
}
