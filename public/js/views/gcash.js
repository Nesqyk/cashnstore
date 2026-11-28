import { api } from '../api.js';
import { h, peso, num, fmtTime, fmtDate, fmtDateTime, fmtDay, fmtWeekday, toast, field, input, withIcon, peso$, busy, showFieldErrors, debounce, hourLabel, delta } from '../util.js';
import { icon } from '../icons.js';
import { can } from '../state.js';
import { pageHead, card, kpi, chips, emptyState, pager, statusBadge, insightStrip, csvLink } from '../components.js';
import { groupedBars, barChart, legend, COLORS } from '../charts.js';
import { avatarFor } from '../avatars.js';
import { href, go } from '../router.js';

const PERIODS = [{ value: 'today', label: 'Today' }, { value: 'week', label: 'This week' }, { value: 'month', label: 'This month' }, { value: '30d', label: 'Last 30 days' }, { value: 'all', label: 'All time' }];
const typeBadge = (t) => h('span', { class: `badge ${t === 'cash_in' ? 'teal' : 'org'}` }, t === 'cash_in' ? 'Cash in' : 'Cash out');

// ---- list --------------------------------------------------------------------------------------------------
export async function list() {
  const state = { page: 1, period: 'week', type: '', q: '' };
  const sum = await api.get('/api/gcash/summary');
  const page = h('div', { class: 'stack s24' });
  page.append(pageHead({ title: 'GCash cash in / out', subtitle: 'Track every transaction, your wallet float and the cash in the drawer.',
    actions: can('gcash.transact') ? [h('a', { class: 'btn', href: href('/gcash/cash-out') }, icon('arrowDown', 16), 'Cash out'), h('a', { class: 'btn primary', href: href('/gcash/cash-in') }, icon('arrowUp', 16), 'Cash in')] : null }));
  if (sum.float_status === 'low') page.append(h('div', { class: 'alert warn' }, icon('alert', 18), h('div', null, h('b', null, 'GCash float is low. '), `You have ${peso(sum.gcash_float)}; the minimum is ${peso(sum.min_float)}. Top up your wallet to keep serving cash-ins.`)));
  page.append(h('div', { class: 'grid g4' },
    kpi('GCash float', peso(sum.gcash_float), { sub: `Target ${peso(sum.target_float)}` }), kpi('Cash in drawer', peso(sum.drawer_cash)),
    kpi('Cash in today', peso(sum.today.cash_in), { sub: `${sum.today.cash_in_count} transactions` }), kpi('Cash out today', peso(sum.today.cash_out), { sub: `${sum.today.cash_out_count} transactions · ${peso(sum.today.fees)} fees` })));

  const strip = h('div'); page.append(strip);
  api.get('/api/gcash/analytics').then((a) => {
    strip.replaceChildren(h('div', { class: 'grid g-23' },
      card(h('div', null, groupedBars({ groups: a.hourly.map((r) => ({ label: hourLabel(r.hour), a: r.cash_in, b: r.cash_out })), height: 190, title: 'GCash today by the hour' }), h('div', { style: { marginTop: '8px' } }, legend([{ label: 'Cash in', color: COLORS.teal }, { label: 'Cash out', color: COLORS.org }]))), { title: 'Today by the hour' }),
      card(h('div', { class: 'stack' }, h('div', null, h('div', { class: 'small muted' }, 'Fees this week'), h('div', { style: { fontSize: '26px', fontWeight: 700 } }, peso(a.fees_week_total)),
        delta(a.fees_prev_week_total ? ((a.fees_week_total - a.fees_prev_week_total) / a.fees_prev_week_total) * 100 : null)),
      barChart({ bars: a.fees_week.map((f) => ({ label: fmtWeekday(f.date), tip: `${fmtWeekday(f.date)}, ${fmtDay(f.date)}`, value: f.fees })), height: 150, highlightLast: true, title: 'Fees earned per day', name: 'Fees' })), { title: 'Fees earned' })));
  }).catch(() => {});

  const box = h('div'); page.append(box);
  async function load() {
    box.replaceChildren(h('div', { class: 'card skeleton', style: { height: '280px' } }));
    let r;
    try { r = await api.get('/api/gcash', { page: state.page, size: 10, period: state.period, type: state.type, q: state.q }); } catch (ex) { box.replaceChildren(h('div', { class: 'alert err' }, ex.message)); return; }
    const search = input({ type: 'search', placeholder: 'Search name, number or reference', value: state.q, 'aria-label': 'Search transactions' });
    search.addEventListener('input', debounce(() => { state.q = search.value; state.page = 1; load().then(() => { const i = box.querySelector('input[type=search]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }); }, 300));
    const typeSel = h('select', { class: 'input', style: 'width:auto', 'aria-label': 'Type', onchange: (e) => { state.type = e.target.value; state.page = 1; load(); } }, [['', 'Cash in and out'], ['cash_in', 'Cash in'], ['cash_out', 'Cash out']].map(([v, l]) => h('option', { value: v }, l)));
    typeSel.value = state.type;
    const table = !r.transactions.length
      ? emptyState({ art: 'gcash', title: 'No transactions found', text: state.q || state.type ? 'Try another search or period.' : 'GCash cash ins and outs will be listed here.', action: can('gcash.transact') ? h('a', { class: 'btn primary', href: href('/gcash/cash-in') }, 'Record a cash in') : null })
      : h('div', null, h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, ['Transaction', 'When', 'Customer', 'Type', 'Amount', 'Fee', 'Cashier'].map((t, i) => h('th', { class: i === 4 || i === 5 ? 'right' : '' }, t)))),
        h('tbody', null, r.transactions.map((t) => h('tr', { class: 'click', onclick: () => go(`/gcash/${t.id}`) },
          h('td', { class: 'bold' }, t.gc_no), h('td', { class: 'muted' }, `${fmtDay(t.created_at)}, ${fmtTime(t.created_at)}`),
          h('td', null, t.customer_name, t.gcash_number ? h('div', { class: 'tiny muted' }, t.gcash_number) : null), h('td', null, typeBadge(t.type)),
          h('td', { class: 'right num bold' }, peso(t.amount)), h('td', { class: 'right num muted' }, peso(t.fee)), h('td', null, h('div', { class: 'row s8' }, avatarFor(t.cashier, t.cashier_avatar, 'sm'), t.cashier))))))),
      pager({ page: r.page, size: r.size, total: r.total, noun: 'transactions', onPage: (n) => { state.page = n; load(); } }));
    box.replaceChildren(h('div', { class: 'stack s12' }, chips(PERIODS, state.period, (v) => { state.period = v; state.page = 1; load(); }),
      h('div', { class: 'toolbar', style: { marginBottom: 0 } }, h('div', { class: 'search' }, withIcon(icon('search', 18), search)), typeSel),
      h('div', { class: 'small muted' }, `${num(r.total)} transactions · ${peso(r.sum_amount)} moved · ${peso(r.sum_fees)} in fees`), h('div', { class: 'card flush' }, table)));
  }
  await load();
  return page;
}

// ---- cash in / cash out form ----------------------------------------------------------------------------------
function txForm(type) {
  return async function render(_context, panel) {
    const sum = await api.get('/api/gcash/summary');
    const isIn = type === 'cash_in';
    let feeMode = 'deduct';
    const name = input({ placeholder: 'Customer name', autocomplete: 'off' });
    const number = input({ placeholder: '09XX XXX XXXX', inputmode: 'tel', autocomplete: 'off' });
    const amount = peso$({ placeholder: '0' }); const amountIn = amount.querySelector('input');
    const ref = input({ placeholder: 'GCash reference no. (optional)' });
    const boxes = { customer_name: field('Customer name', withIcon(icon('user', 18), name)), gcash_number: field('GCash number', withIcon(icon('phone', 18), number)), amount: field('Amount', amount), reference: field('Reference number', ref) };
    const quick = h('div', { class: 'chips' }, [100, 200, 500, 1000, 2000, 5000].map((v) => h('button', { type: 'button', class: 'chip', onclick: () => { amountIn.value = v; quote(); } }, peso(v))));
    const summary = h('div', { class: 'sp-summary', 'aria-live': 'polite' });
    const prompt = () => h('p', { class: 'muted' }, 'Enter an amount to see the fee and what to hand over.');
    summary.append(prompt());
    const err = h('div', { class: 'alert err hidden', role: 'alert' });
    const save = h('button', { class: 'btn primary', type: 'submit' }, isIn ? 'Record cash in' : 'Record cash out');
    let seq = 0;
    const feeSeg = h('div', { class: 'seg' }, [['deduct', 'Deduct from amount'], ['separate', 'Customer pays separately']].map(([v, l]) => h('button', { type: 'button', class: v === feeMode ? 'active' : '', onclick: (e) => { feeMode = v; [...feeSeg.children].forEach((b) => b.classList.remove('active')); e.currentTarget.classList.add('active'); quote(); } }, l)));

    const quote = debounce(async () => {
      const amt = Number(amountIn.value); const mine = ++seq;
      if (!amt || amt < 1) { summary.replaceChildren(prompt()); return; }
      try {
        const q = await api.get('/api/gcash/quote', { type, amount: amt, fee_mode: feeMode });
        if (mine !== seq) return;
        const big = (label, value) => h('div', { class: 'row between' }, h('span', { class: 'bold' }, label), h('b', { class: 'sp-big' }, peso(value, 2)));
        summary.replaceChildren(...[
          isIn ? big('Collect from customer', q.cash_from_customer) : big('Hand over to customer', q.cash_to_customer),
          !isIn && q.cash_from_customer ? h('div', { class: 'row between' }, h('span', { class: 'bold' }, 'Collect fee from customer'), h('b', null, peso(q.cash_from_customer, 2))) : null,
          h('div', { class: 'sp-facts' }, h('span', null, 'Amount ', h('b', null, peso(amt, 2))), h('span', null, 'Service fee ', h('b', null, peso(q.fee, 2)))),
          h('div', { class: 'sp-facts' }, h('span', null, 'GCash float after ', h('b', { style: q.float_low_after ? { color: 'var(--warn)' } : null }, peso(q.float_after))),
            h('span', null, 'Drawer cash after ', h('b', null, peso(q.drawer_after)))),
          q.float_low_after ? h('div', { class: 'alert warn' }, icon('alert', 16), 'This will leave your float below the minimum.') : null,
          (isIn && q.float_after < 0) || (!isIn && q.drawer_after < 0) ? h('div', { class: 'alert err' }, icon('alert', 16), isIn ? 'Not enough GCash float for this amount.' : 'Not enough cash in the drawer.') : null,
        ].filter(Boolean));
      } catch (ex) { if (mine === seq) summary.replaceChildren(h('div', { class: 'alert err' }, ex.message)); }
    }, 200);
    amountIn.addEventListener('input', quote); quote();

    const values = () => ({ type, customer_name: name.value, gcash_number: number.value, amount: amountIn.value, reference: ref.value, fee_mode: isIn ? undefined : feeMode });
    let saving = false;
    async function submit() {
      if (saving) return;
      saving = true; err.classList.add('hidden'); showFieldErrors(boxes);
      const r = await busy(save, async () => {
        try { return await api.post('/api/gcash', values()); }
        catch (ex) { if (ex.fields && Object.keys(ex.fields).length) showFieldErrors(boxes, ex.fields); err.textContent = ex.message; err.classList.remove('hidden'); return null; }
      });
      saving = false;
      if (!r) return panel.revealError();
      toast(`${r.gc_no} recorded`, 'ok');
      panel.leaveTo(`/gcash/${r.id}`);
    }

    return {
      title: isIn ? 'GCash cash in' : 'GCash cash out',
      subtitle: isIn ? 'The customer hands you cash; you send the amount to their GCash.' : 'The customer sends GCash to your wallet; you hand them cash.',
      body: [
        card(h('div', { class: 'form-grid' }, boxes.customer_name, boxes.gcash_number, h('div', { class: 'full' }, boxes.amount, h('div', { style: { marginTop: '8px' } }, quick)),
          isIn ? null : h('div', { class: 'full field' }, h('label', null, 'How is the fee taken?'), feeSeg), h('div', { class: 'full' }, boxes.reference)), { title: isIn ? 'Customer sends cash, you send GCash' : 'Customer sends GCash, you give cash' }),
        card(h('div', { class: 'stack s8' }, h('div', { class: 'row between small' }, h('span', { class: 'muted' }, 'GCash float now'), h('b', null, peso(sum.gcash_float))), h('div', { class: 'row between small' }, h('span', { class: 'muted' }, 'Cash in drawer now'), h('b', null, peso(sum.drawer_cash))), h('div', { class: 'row between small' }, h('span', { class: 'muted' }, 'Fee rate'), h('b', null, `${sum.fee_percent}% (min ${peso(sum.min_fee)})`))), { title: 'Right now' }),
      ],
      summary,
      error: err,
      actions: save,
      onSubmit: submit,
      snapshot: values,
    };
  };
}
export const cashIn = txForm('cash_in');
export const cashOut = txForm('cash_out');

// ---- detail -------------------------------------------------------------------------------------------------------
export async function detail({ params }) {
  const { transaction: t, effects: e } = await api.get(`/api/gcash/${params.id}`);
  const isIn = t.type === 'cash_in';
  const steps = isIn
    ? [['Customer paid cash', `${peso(e.cash_from_customer, 2)} (amount ${peso(t.amount)} + fee ${peso(t.fee)})`], ['GCash sent', `${peso(t.amount)} to ${t.gcash_number || t.customer_name}`]]
    : [['Customer sent GCash', `${peso(t.amount)} to the store wallet${t.reference ? `, ref ${t.reference}` : ''}`], ['Cash handed over', `${peso(e.cash_to_customer, 2)}${t.fee_mode === 'deduct' ? ` (fee ${peso(t.fee)} deducted)` : ''}`], e.cash_from_customer ? ['Fee collected', peso(e.cash_from_customer, 2)] : null].filter(Boolean);
  return h('div', { class: 'stack' }, pageHead({ crumb: { to: '/gcash', label: 'GCash' }, title: t.gc_no, subtitle: fmtDateTime(t.created_at), actions: [typeBadge(t.type), statusBadge(t.status)] }),
    h('div', { class: 'grid g-main' },
      card(h('dl', { class: 'kv' }, h('dt', null, 'Customer'), h('dd', null, t.customer_name), h('dt', null, 'GCash number'), h('dd', null, t.gcash_number || '—'), h('dt', null, 'Amount'), h('dd', { class: 'num bold' }, peso(t.amount, 2)),
        h('dt', null, 'Service fee'), h('dd', { class: 'num' }, peso(t.fee, 2)), isIn ? null : [h('dt', null, 'Fee taken'), h('dd', null, t.fee_mode === 'separate' ? 'Paid separately by customer' : 'Deducted from amount')],
        h('dt', null, 'Reference'), h('dd', null, t.reference || '—'), h('dt', null, 'Cashier'), h('dd', null, h('span', { class: 'row s8' }, avatarFor(t.cashier, t.cashier_avatar, 'sm'), t.cashier)), h('dt', null, 'Register'), h('dd', null, t.station)), { title: 'Details' }),
      h('div', { class: 'stack' },
        card(h('ul', { class: 'timeline' }, steps.map(([a, b]) => h('li', null, h('span', { class: 'pt' }), h('div', null, h('div', { class: 'bold' }, a), h('div', { class: 'small muted' }, b)))), h('li', null, h('span', { class: 'pt' }), h('div', null, h('div', { class: 'bold' }, 'Recorded'), h('div', { class: 'small muted' }, `${fmtDateTime(t.created_at)} by ${t.cashier}`)))), { title: 'What happened' }),
        card(h('div', { class: 'stack s8' }, h('div', { class: 'row between' }, h('span', { class: 'muted' }, 'GCash float'), h('b', { class: 'num' }, `${e.float_change >= 0 ? '+' : '-'}${peso(Math.abs(e.float_change))}`)), h('div', { class: 'row between' }, h('span', { class: 'muted' }, 'Drawer cash'), h('b', { class: 'num' }, `${e.drawer_change >= 0 ? '+' : '-'}${peso(Math.abs(e.drawer_change))}`))), { title: 'Effect on your balances' }))));
}
