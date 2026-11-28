import { api } from '../api.js';
import { h, peso, num, fmtDay } from '../util.js';
import { icon } from '../icons.js';
import { can } from '../state.js';
import { pageHead, card, kpi, chips, emptyState, redraw, stockBadge, csvLink } from '../components.js';
import { barChart, hbars, COLORS } from '../charts.js';
import { href } from '../router.js';

export default async function inventory() {
  const state = { status: '' };
  let [first, restocks] = await Promise.all([api.get('/api/inventory/alerts'), api.get('/api/inventory/restocks')]);
  const page = h('div', { class: 'stack s24' });
  page.append(pageHead({ title: 'Inventory', subtitle: 'What to reorder, and how fast it is selling.',
    actions: can('inventory.restock') ? csvLink('/api/inventory/restock-order.csv', 'Restock order (CSV)') : null }));
  const kpis = h('div', { class: 'grid g4' });
  const paintKpis = ({ summary: s }) => kpis.replaceChildren(
    kpi('Out of stock', num(s.out), { sub: s.out ? 'Customers cannot buy these' : 'Nothing missing' }),
    kpi('Running low', num(s.low), { sub: 'At or below reorder level' }),
    kpi('Products tracked', num(s.total)),
    kpi('Stock value', peso(s.stock_value), { sub: 'at your cost price' }));
  paintKpis(first);
  page.append(kpis);

  const listBox = h('div');
  const alerts = () => (state.status === '' ? first : api.get('/api/inventory/alerts', { status: state.status }));
  async function paint() { paintList(await alerts()); }
  function paintList({ items }) {
    redraw(listBox, !items.length
      ? emptyState({ art: 'stock', title: state.status ? 'Nothing here' : 'Everything is stocked', text: 'No products are at or below their reorder level.' })
      : h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, ['Product', 'Supplier', 'In stock', 'Selling', 'Lasts about', 'Suggested order', ''].map((t) => h('th', null, t)))),
        h('tbody', null, items.map((i) => h('tr', null,
          h('td', null, h('div', { class: 'bold' }, i.name), h('div', { class: 'small muted' }, i.description)),
          h('td', null, i.supplier || h('span', { class: 'muted' }, 'None set')),
          h('td', null, stockBadge(i.stock_status), h('div', { class: 'small num', style: { marginTop: '4px' } }, `${i.stock_qty} ${i.unit}`)),
          h('td', { class: 'num' }, i.per_day > 0 ? `${i.per_day} a day` : h('span', { class: 'muted' }, 'No recent sales')),
          h('td', { class: 'num' }, i.days_left === null || i.days_left === undefined ? '—' : i.days_left === 0 ? h('b', { style: { color: 'var(--bad)' } }, 'Out now') : `${i.days_left} day${i.days_left === 1 ? '' : 's'}`),
          h('td', { class: 'num bold' }, `${num(i.suggested_qty)} ${i.unit}`),
          h('td', { class: 'right' }, can('inventory.restock') ? h('a', { class: 'btn sm primary', href: href(`/products/${i.id}/restock`) }, 'Restock') : null)))))));
  }
  page.append(card(h('div', { class: 'stack s12' }, chips([{ value: '', label: 'All alerts' }, { value: 'out', label: 'Out of stock' }, { value: 'low', label: 'Low stock' }], state.status, (v) => { state.status = v; paint(); }), h('div', { class: 'card flush', style: { border: 0 } }, listBox)),
    { title: 'Needs attention', subtitle: 'Suggested order covers about a week of selling.' }));
  await paint();

  const lower = h('div', { class: 'grid g2' });
  const restockCard = () => card(restocks.restocks.length ? h('div', null, restocks.restocks.slice(0, 8).map((r) => h('div', { class: 'row between', style: { padding: '10px 0', borderBottom: '1px solid var(--line)' } },
    h('div', null, h('div', { class: 'bold' }, r.product), h('div', { class: 'small muted' }, `${fmtDay(r.received_on)} · ${r.supplier || 'No supplier'}${r.by ? ` · ${r.by}` : ''}`)),
    h('div', { class: 'right' }, h('div', { class: 'bold num' }, `+${num(r.quantity)}`), h('div', { class: 'small muted' }, peso(r.total_cost, 2)))))) : emptyState({ art: 'products', title: 'No restocks yet', text: 'Deliveries you record will be listed here.' }), { title: 'Recent restocks' });
  let recent = restockCard();
  lower.append(recent);
  page.append(lower);

  let lasting = null;
  function loadAnalytics() {
    if (!can('analytics.store')) return;
    api.get('/api/inventory/analytics').then((a) => {
      const next = card(h('div', { class: 'stack' },
        a.days_left.length ? hbars(a.days_left.map((d) => ({ label: d.name, value: d.days, text: d.days === 0 ? 'Out' : `${d.days} d`, color: d.days <= 1 ? 'var(--bad)' : d.days <= 3 ? 'var(--org)' : COLORS.teal })), { fmt: (v) => `${v} d`, max: Math.max(7, ...a.days_left.map((d) => d.days)), title: 'Days of stock left' }) : h('p', { class: 'muted' }, 'No items are close to running out.'),
        h('hr', { class: 'divider' }),
        h('div', { class: 'small muted' }, 'Stock-outs per week (last 8 weeks)'),
        barChart({ bars: a.stockouts_per_week.map((w) => ({ label: fmtDay(w.week_end), tip: `Week ending ${fmtDay(w.week_end)}`, value: w.count })), fmt: (v) => String(Math.round(v)), height: 170, color: COLORS.org, title: 'Stock-outs per week', name: 'Stock-outs' })),
      { title: 'How long stock will last', subtitle: 'At the current selling speed' });
      if (lasting) lasting.replaceWith(next); else lower.prepend(next);
      lasting = next;
    }).catch(() => {});
  }
  loadAnalytics();

  // new figures, same filter; everything is fetched before anything is redrawn so the page does not move
  page.refresh = async () => {
    const [all, latest] = await Promise.all([api.get('/api/inventory/alerts'), api.get('/api/inventory/restocks')]);
    first = all; restocks = latest;
    const shown = await alerts();
    paintKpis(first); paintList(shown);
    const next = restockCard(); recent.replaceWith(next); recent = next;
    loadAnalytics();
  };
  return page;
}
