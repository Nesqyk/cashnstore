// Pieces that several screens share.
import { h, clear, delta, peso, fromHtml } from './util.js';
import { icon } from './icons.js';
import { illustration } from './illustrations.js';
import { href } from './router.js';

export function pageHead({ title, subtitle, crumb, actions }) {
  return h('div', { class: 'page-head' },
    h('div', null,
      crumb ? h('a', { class: 'crumb', href: href(crumb.to) }, icon('arrowLeft', 14), crumb.label) : null,
      h('h1', null, title), subtitle ? h('p', null, subtitle) : null),
    actions ? h('div', { class: 'actions' }, actions) : null);
}

export function card(children, { cls = '', title, subtitle, action } = {}) {
  return h('section', { class: `card ${cls}` },
    title ? h('div', { class: 'card-head' }, h('div', null, h('h2', null, title), subtitle ? h('p', null, subtitle) : null), action || null) : null,
    children);
}

export function kpi(label, value, { sub, pct, pctSuffix } = {}) {
  return h('div', { class: 'card kpi' },
    h('span', { class: 'k-label' }, label), h('span', { class: 'k-value' }, value),
    h('div', { class: 'row s8' }, pct !== undefined && pct !== null ? delta(pct, { suffix: pctSuffix }) : null, sub ? h('span', { class: 'k-sub' }, sub) : null));
}

export function emptyState({ art = 'search', title, text, action }) {
  return h('div', { class: 'empty' }, illustration(art), h('h3', null, title), text ? h('p', null, text) : null, action || null);
}

export function chips(options, value, onPick) {
  const wrap = h('div', { class: 'chips', role: 'group' });
  const paint = (v) => options.forEach((o, i) => wrap.children[i].classList.toggle('active', o.value === v));
  options.forEach((o) => wrap.append(h('button', { type: 'button', class: 'chip', onclick: () => { paint(o.value); onPick(o.value); } }, o.label)));
  paint(value);
  return wrap;
}

export function segmented(options, value, onPick) {
  const wrap = h('div', { class: 'seg', role: 'group' });
  const paint = (v) => options.forEach((o, i) => wrap.children[i].classList.toggle('active', o.value === v));
  options.forEach((o) => wrap.append(h('button', { type: 'button', onclick: () => { paint(o.value); onPick(o.value); } }, o.label)));
  paint(value);
  return wrap;
}

export function tabs(items, active, onPick) {
  const wrap = h('div', { class: 'tabs', role: 'tablist' });
  items.forEach((t) => wrap.append(h('button', { class: `tab${t.value === active ? ' active' : ''}`, role: 'tab', onclick: () => onPick(t.value) }, t.label)));
  return wrap;
}

export function pager({ page, size, total, onPage, noun = 'results' }) {
  const pages = Math.max(1, Math.ceil(total / size));
  const from = total ? (page - 1) * size + 1 : 0; const to = Math.min(total, page * size);
  return h('div', { class: 'pager' },
    h('span', null, `Showing ${from}–${to} of ${total} ${noun}`),
    h('div', { class: 'pg' },
      h('button', { class: 'btn sm', disabled: page <= 1 ? true : null, onclick: () => onPage(page - 1) }, icon('chevronLeft', 14), 'Previous'),
      h('button', { class: 'btn sm', disabled: page >= pages ? true : null, onclick: () => onPage(page + 1) }, 'Next', icon('chevronRight', 14))));
}

export const STOCK_BADGE = {
  ok: () => h('span', { class: 'badge ok' }, h('i', { class: 'dot' }), 'In stock'),
  low: () => h('span', { class: 'badge warn' }, h('i', { class: 'dot' }), 'Low stock'),
  out: () => h('span', { class: 'badge bad' }, h('i', { class: 'dot' }), 'Out of stock'),
};
export const stockBadge = (s) => (STOCK_BADGE[s] || STOCK_BADGE.ok)();
export const methodBadge = (m) => h('span', { class: `badge ${m === 'cash' ? 'teal' : m === 'gcash' ? 'org' : ''}` }, { cash: 'Cash', gcash: 'GCash', utang: 'Utang' }[m] || m);
export const statusBadge = (s) => h('span', { class: `badge ${s === 'refunded' || s === 'voided' ? 'bad' : 'ok'}` }, s === 'refunded' ? 'Refunded' : s === 'voided' ? 'Voided' : 'Completed');

// Strip of small "insight" numbers shown above a list (Products, Inventory, GCash, Staff...).
export function insightStrip(items) {
  return h('div', { class: 'insight' }, items.map((i) => (i instanceof Node ? i : h('div', { class: 'ins' }, h('b', { style: i.color ? { color: i.color } : null }, i.value), h('span', null, i.label)))));
}

// Live password rules checklist. Returns { node, ok() }.
export function passwordRules(inputEl, { symbol = false } = {}) {
  const rules = [
    ['At least 8 characters', (v) => v.length >= 8],
    ['1 capital letter', (v) => /[A-Z]/.test(v)],
    ['1 number', (v) => /[0-9]/.test(v)],
    ...(symbol ? [['1 symbol (like ! or #)', (v) => /[^A-Za-z0-9]/.test(v)]] : []),
  ];
  const rows = rules.map(([label]) => h('div', null, icon('check', 14), label));
  const node = h('div', { class: 'pw-rules' }, rows);
  const update = () => rules.forEach(([, test], i) => rows[i].classList.toggle('met', test(inputEl.value)));
  inputEl.addEventListener('input', update); update();
  return { node, ok: () => rules.every(([, t]) => t(inputEl.value)) };
}

// Password input with a show/hide eye
export function passwordInput(props = {}) {
  const inp = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', ...props });
  const eye = h('button', { type: 'button', class: 'icon-btn', style: { border: 0, background: 'none', width: '32px', height: '32px' }, 'aria-label': 'Show password', title: 'Show or hide password' }, icon('eye', 18));
  eye.addEventListener('click', () => {
    const show = inp.type === 'password'; inp.type = show ? 'text' : 'password';
    eye.replaceChildren(icon(show ? 'eyeOff' : 'eye', 18));
  });
  const wrap = h('div', { class: 'input-wrap' }, h('span', { class: 'ico' }, icon('lock', 18)), inp, h('span', { class: 'trail' }, eye));
  wrap.input = inp;
  return wrap;
}

export function loadingCards(n = 4) {
  return h('div', { class: 'grid g4' }, Array.from({ length: n }, () => h('div', { class: 'card skeleton', style: { height: '110px' } })));
}

export const csvLink = (url, label = 'Download CSV') => h('a', { class: 'btn', href: url, download: '' }, icon('download', 16), label);

export const peso2 = (n) => peso(n, 2);
export const clearNode = clear;
export const html = fromHtml;
