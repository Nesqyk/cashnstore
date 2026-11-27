// Small SVG chart helpers. All text that came from the database is escaped.
import { h, esc, fromHtml, pesoShort, peso } from './util.js';

export const COLORS = { teal: '#006768', teal2: '#4f9d9a', teal3: '#bcdad7', org: '#d9692a', line: '#e2e8e6', muted: '#5a6967', track: '#e6edeb' };
export const MIX_COLORS = { cash: COLORS.teal, gcash: COLORS.org, utang: COLORS.teal3 };
export const METHOD_LABEL = { cash: 'Cash', gcash: 'GCash', utang: 'Utang' };

const W = 640;
const niceMax = (v) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
};
const svg = (w, hgt, inner, cls = 'chart') => fromHtml(`<svg class="${cls}" viewBox="0 0 ${w} ${hgt}" xmlns="http://www.w3.org/2000/svg" role="img">${inner}</svg>`);

function grid(plotL, plotR, top, bottom, max, fmt, ticks = 4) {
  let s = '';
  for (let i = 0; i <= ticks; i += 1) {
    const y = bottom - ((bottom - top) * i) / ticks;
    s += `<line x1="${plotL}" x2="${plotR}" y1="${y}" y2="${y}" stroke="${COLORS.line}" ${i === 0 ? '' : 'stroke-dasharray="3 4"'}/>`;
    s += `<text x="${plotL - 8}" y="${y + 4}" text-anchor="end">${esc(fmt((max * i) / ticks))}</text>`;
  }
  return s;
}

// series: [{ values:[], color, dashed, area }], labels: x labels
export function lineChart({ labels, series, height = 230, fmt = pesoShort, title = '' }) {
  const L = 52; const R = W - 12; const T = 12; const B = height - 28;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values.map((v) => v || 0))));
  const n = labels.length;
  const x = (i) => (n === 1 ? (L + R) / 2 : L + ((R - L) * i) / (n - 1));
  const y = (v) => B - ((B - T) * (v || 0)) / max;
  let body = grid(L, R, T, B, max, fmt);
  const every = Math.ceil(n / 8);
  labels.forEach((lb, i) => { if (i % every === 0 || i === n - 1) body += `<text x="${x(i)}" y="${height - 8}" text-anchor="middle">${esc(lb)}</text>`; });
  for (const s of series) {
    const pts = s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    if (s.area) body += `<path d="M${x(0)},${B} L${pts.join(' L')} L${x(n - 1)},${B} Z" fill="${s.color}" opacity=".10"/>`;
    body += `<polyline points="${pts.join(' ')}" fill="none" stroke="${s.color}" stroke-width="${s.dashed ? 2 : 2.8}" stroke-linecap="round" stroke-linejoin="round" ${s.dashed ? 'stroke-dasharray="6 5"' : ''}/>`;
    if (!s.dashed && n <= 14) s.values.forEach((v, i) => { body += `<circle cx="${x(i)}" cy="${y(v)}" r="3.5" fill="#fff" stroke="${s.color}" stroke-width="2"/>`; });
  }
  const el = svg(W, height, `<title>${esc(title)}</title>${body}`);
  return el;
}

// Vertical bars. bars: [{ label, value, color? }]
export function barChart({ bars, height = 210, fmt = pesoShort, color = COLORS.teal, title = '', highlightLast = false }) {
  const L = 52; const R = W - 8; const T = 12; const B = height - 28;
  const max = niceMax(Math.max(1, ...bars.map((b) => b.value || 0)));
  const slot = (R - L) / bars.length; const bw = Math.min(46, slot * 0.6);
  let body = grid(L, R, T, B, max, fmt);
  bars.forEach((b, i) => {
    const bh = ((B - T) * (b.value || 0)) / max; const cx = L + slot * i + slot / 2;
    const fill = b.color || (highlightLast && i === bars.length - 1 ? color : highlightLast ? COLORS.teal3 : color);
    body += `<rect x="${cx - bw / 2}" y="${B - bh}" width="${bw}" height="${Math.max(bh, 0)}" rx="5" fill="${fill}"><title>${esc(b.label)}: ${esc(fmt(b.value))}</title></rect>`;
    body += `<text x="${cx}" y="${height - 8}" text-anchor="middle">${esc(b.label)}</text>`;
  });
  return svg(W, height, `<title>${esc(title)}</title>${body}`);
}

// Two bars per slot. groups: [{ label, a, b }]
export function groupedBars({ groups, height = 210, colors = [COLORS.teal, COLORS.org], fmt = pesoShort, title = '' }) {
  const L = 52; const R = W - 8; const T = 12; const B = height - 28;
  const max = niceMax(Math.max(1, ...groups.flatMap((g) => [g.a, g.b])));
  const slot = (R - L) / groups.length; const bw = Math.min(22, slot * 0.32);
  let body = grid(L, R, T, B, max, fmt);
  groups.forEach((g, i) => {
    const cx = L + slot * i + slot / 2;
    [[g.a, -bw - 1, colors[0]], [g.b, 1, colors[1]]].forEach(([v, dx, c]) => {
      const bh = ((B - T) * v) / max;
      body += `<rect x="${cx + dx}" y="${B - bh}" width="${bw}" height="${bh}" rx="4" fill="${c}"><title>${esc(fmt(v))}</title></rect>`;
    });
    body += `<text x="${cx}" y="${height - 8}" text-anchor="middle">${esc(g.label)}</text>`;
  });
  return svg(W, height, `<title>${esc(title)}</title>${body}`);
}

// Donut with total in the middle. parts: [{ label, value, color }]
export function donut({ parts, size = 170, centerTop = '', centerBottom = '' }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  const r = 62; const c = 2 * Math.PI * r; let off = 0; let arcs = '';
  for (const p of parts) {
    const len = (p.value / total) * c;
    arcs += `<circle cx="80" cy="80" r="${r}" fill="none" stroke="${p.color}" stroke-width="22" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-off}" transform="rotate(-90 80 80)"><title>${esc(p.label)}</title></circle>`;
    off += len;
  }
  const mid = `<text x="80" y="${centerBottom ? 78 : 86}" text-anchor="middle" style="font-size:20px;font-weight:700;fill:#14201f">${esc(centerTop)}</text>` +
    (centerBottom ? `<text x="80" y="96" text-anchor="middle" style="font-size:11px">${esc(centerBottom)}</text>` : '');
  const el = fromHtml(`<svg viewBox="0 0 160 160" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" role="img"><circle cx="80" cy="80" r="${r}" fill="none" stroke="${COLORS.track}" stroke-width="22"/>${arcs}${mid}</svg>`);
  el.classList.add('chart');
  return el;
}

export function sparkline(values, { color = COLORS.teal, width = 120, height = 34 } = {}) {
  if (!values.length) return h('span');
  const max = Math.max(...values, 1); const min = Math.min(...values, 0);
  const x = (i) => (values.length === 1 ? width / 2 : (width * i) / (values.length - 1));
  const y = (v) => height - 4 - ((height - 8) * (v - min)) / (max - min || 1);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return fromHtml(`<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.200" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${x(values.length - 1)}" cy="${y(values[values.length - 1])}" r="3" fill="${color}"/></svg>`);
}

export function legend(items) {
  return h('div', { class: 'legend' }, items.map((i) => h('span', null, h('i', { style: { background: i.color } }), i.label)));
}

// Horizontal bars as plain HTML (keeps long names readable). items: [{ label, value, sub? }]
export function hbars(items, { fmt = peso, color = COLORS.teal, max } = {}) {
  const top = max || Math.max(1, ...items.map((i) => i.value));
  return h('div', null, items.map((i) => h('div', { class: 'bar-row' },
    h('span', { title: i.label, style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, i.label),
    h('div', { class: 'track' }, h('div', { class: 'fill', style: { width: `${Math.max(2, (i.value / top) * 100)}%`, background: i.color || color } })),
    h('span', { class: 'num bold' }, i.text ?? fmt(i.value)))));
}

// Busy-hours grid. cells: [{ dow (0=Mon .. 6=Sun, as the database sends it), hour, total }]
export function heatmap(cells, { hours = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] } = {}) {
  const map = new Map(cells.map((c) => [`${c.dow}-${c.hour}`, c.total]));
  const max = Math.max(1, ...cells.map((c) => c.total));
  const wrap = h('div', { class: 'heat', style: { gridTemplateColumns: `44px repeat(${hours.length}, 1fr)` } });
  wrap.append(h('span'));
  hours.forEach((hr) => wrap.append(h('span', { class: 'tiny muted center' }, `${((hr + 11) % 12) + 1}${hr < 12 ? 'a' : 'p'}`)));
  days.forEach((d, dow) => {
    wrap.append(h('span', { class: 'tiny muted', style: { alignSelf: 'center' } }, d));
    hours.forEach((hr) => {
      const v = map.get(`${dow}-${hr}`) || 0; const a = v / max;
      wrap.append(h('div', { class: 'cell', title: `${d} ${hr}:00 · ${peso(v)}`, style: { background: v ? `rgba(0,103,104,${0.12 + a * 0.88})` : '' } }));
    });
  });
  return wrap;
}
