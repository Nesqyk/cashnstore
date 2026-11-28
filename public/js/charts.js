// Charts, drawn with Apache ECharts (SVG renderer). Each helper returns a node straight away, already
// at its final size. The library is fetched the first time a chart appears on the page.
// All text that came from the database reaches the page as text nodes, never as HTML.
import { h, pesoShort, peso } from './util.js';

export const COLORS = { teal: '#006768', teal2: '#4f9d9a', teal3: '#bcdad7', org: '#d9692a', line: '#e2e8e6', muted: '#5a6967', track: '#e6edeb' };
export const MIX_COLORS = { cash: COLORS.teal, gcash: COLORS.org, utang: COLORS.teal3 };
export const METHOD_LABEL = { cash: 'Cash', gcash: 'GCash', utang: 'Utang' };
const INK = '#14201f';
const FONT = "'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif";

// ---- the library ---------------------------------------------------------------------------------
let library = null;
let failures = 0;
function loadLibrary() {
  if (!library) {
    // a browser may remember a failed import, so a retry asks under a new address
    library = import(`/vendor/echarts.js${failures ? `?retry=${failures}` : ''}`)
      .catch((err) => { library = null; failures += 1; throw err; });
  }
  return library;
}

// Tooltips go in a window-sized layer that clips. ECharts first puts a new tooltip wherever it likes,
// and on the page itself that can flash a scrollbar and move the chart from under the finger.
let layer = null;
const tipLayer = () => {
  if (!layer) { layer = h('div', { id: 'chart-tips' }); document.body.append(layer); }
  return layer;
};

// ---- the chart element -----------------------------------------------------------------------------
// A <cns-chart> draws itself once it is on the page and has a size, and releases everything when it
// is removed. Its `spec` says what to draw:
//   option(width, height)  the ECharts option
//   count                  how many data points the keyboard can visit (0 = nothing to read)
//   tip(i)                 { title, rows: [{ name?, value, color? }] }
//   target(i)              which series and data index show point i
//   axis                   true when the tooltip follows a whole column; otherwise a single item
//   step(i, key)           optional: where an arrow key goes
//   spot(i, width)         optional: [x, width] of point i, to scroll it into view
const live = new Set();

class ChartElement extends HTMLElement {
  connectedCallback() {
    if (this.observer) return;                            // only moved
    live.add(this);
    this.observer = new ResizeObserver(() => this.fit());
    this.observer.observe(this);
  }

  disconnectedCallback() { queueMicrotask(() => { if (!this.isConnected) this.release(); }); }

  release() {
    if (this.observer) { this.observer.disconnect(); this.observer = null; }
    if (this.chart) { this.chart.dispose(); this.chart = null; }     // takes the tooltip with it
    this.tipBox = null; this.marked = null;
    live.delete(this);
  }

  async fit() {
    const width = this.clientWidth; const height = this.clientHeight;
    if (!width || !height || this.failed) return;
    if (this.chart) {
      if (width === this.drawnWidth && height === this.drawnHeight) return;
      this.hideTip();
      this.drawnWidth = width; this.drawnHeight = height;
      this.chart.resize();
      this.chart.setOption(this.option(width, height), { notMerge: true });
      this.stamp();
      return;
    }
    if (this.starting) return;
    this.starting = true;
    let echarts = null;
    try { echarts = await loadLibrary(); } catch (err) { console.warn('Charts could not be loaded:', err.message); }
    this.starting = false;
    if (!this.isConnected || !this.observer || this.chart || this.failed) return;
    if (!echarts) { this.fail(); return; }
    try {
      this.drawnWidth = this.clientWidth; this.drawnHeight = this.clientHeight;
      this.chart = echarts.init(this.plot, null, { renderer: 'svg' });
      this.chart.setOption(this.option(this.drawnWidth, this.drawnHeight));
      this.stamp();
      this.chart.on('click', (p) => { this.tapped = { seriesIndex: p.seriesIndex, dataIndex: p.dataIndex }; });
      if (this.matches(':focus-visible')) this.show(this.index ?? 0);
    } catch (err) {
      console.error(err);
      if (this.chart) { this.chart.dispose(); this.chart = null; }
      this.fail();
    }
  }

  // With a viewBox the drawing can scale to the paper when the page is printed.
  stamp() {
    const drawing = this.plot.querySelector('svg');
    if (drawing) drawing.setAttribute('viewBox', `0 0 ${this.drawnWidth} ${this.drawnHeight}`);
  }

  option(width, height) {
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const { tooltip, ...rest } = this.spec.option(width, height);
    return {
      animation: false,                                    // highlights fade with CSS; nothing animates on load
      textStyle: { fontFamily: FONT },
      ...rest,
      tooltip: this.spec.count ? {
        trigger: this.spec.axis ? 'axis' : 'item', appendTo: tipLayer, className: 'cns-tip', hideDelay: 80,
        transitionDuration: still ? 0 : 0.12,
        backgroundColor: '#fff', borderColor: COLORS.line, borderWidth: 1, padding: [8, 12],
        textStyle: { color: INK, fontFamily: FONT, fontSize: 13 },
        extraCssText: 'z-index:30;border-radius:10px;box-shadow:0 6px 20px rgba(20,32,31,.16);white-space:normal;max-width:min(280px,calc(100vw - 16px));pointer-events:none;',
        formatter: (p) => tipNode(this.spec.tip((Array.isArray(p) ? p[0] : p).dataIndex)),
        position: (point, params, box, rect, size) => { this.tipBox = box; return this.place(this.fingerAt || point, size.contentSize); },
        ...tooltip,
      } : { show: false },
    };
  }

  // Beside the pointer, flipped or nudged so it always stays inside the window.
  place([px, py], [w, hgt]) {
    const at = this.getBoundingClientRect();
    const right = document.documentElement.clientWidth - 8; const bottom = document.documentElement.clientHeight - 8;
    let x = at.left + px + 14;
    if (x + w > right) x = at.left + px - 14 - w;
    let y = at.top + py - hgt - 12;
    if (y < 8) y = at.top + py + 18;
    x = Math.max(8, Math.min(x, right - w));
    y = Math.max(8, Math.min(y, bottom - hgt));
    return [x - at.left, y - at.top];
  }

  fail() {
    this.failed = true;
    this.classList.add('failed');
    const retry = h('button', { type: 'button', class: 'btn sm', onclick: () => {
      this.failed = false; this.classList.remove('failed'); note.remove(); this.setAccess(); this.fit();
    } }, 'Try again');
    const note = h('div', { class: 'cns-fail' }, h('span', null, 'Chart could not load.'), this.compact ? null : retry);
    // the keyboard has nothing to read here, but the button must be reachable
    this.removeAttribute('tabindex'); this.setAttribute('role', 'group');
    this.setAttribute('aria-label', this.spec.label);
    this.append(note);
  }

  setAccess() {
    const { count, label } = this.spec;
    this.setAttribute('role', count ? 'application' : 'img');
    if (count) { this.setAttribute('tabindex', '0'); this.setAttribute('aria-roledescription', 'chart'); }
    this.setAttribute('aria-label', count ? `${label} Use the arrow keys to read each value, Escape to close it.` : label);
  }

  // ---- tooltip by keyboard
  show(i) {
    if (!this.chart || !this.spec.count) return;
    this.index = Math.max(0, Math.min(this.spec.count - 1, i));
    this.keyed = true;
    this.fingerAt = null;
    this.reveal();
    const at = this.spec.target(this.index);
    if (!this.spec.axis) this.mark(at);
    this.chart.dispatchAction({ type: 'showTip', ...at });
    const t = this.spec.tip(this.index);
    this.live.textContent = `${t.title}. ${t.rows.map((r) => `${r.name ? `${r.name}: ` : ''}${r.value}`).join(', ')}`;
  }

  mark(at) {
    if (this.marked) this.chart.dispatchAction({ type: 'downplay', ...this.marked });
    this.marked = at;
    if (at) this.chart.dispatchAction({ type: 'highlight', ...at });
  }

  // In a chart wider than its card, scroll so that the point being read is on screen.
  reveal() {
    const scroller = this.parentElement;
    if (!this.spec.spot || !scroller || scroller.scrollWidth <= scroller.clientWidth) return;
    const [x, w] = this.spec.spot(this.index, this.clientWidth);
    if (x < scroller.scrollLeft) scroller.scrollLeft = Math.max(0, x - 44);
    else if (x + w > scroller.scrollLeft + scroller.clientWidth) scroller.scrollLeft = x + w - scroller.clientWidth;
  }

  tipOpen() {
    const box = this.tipBox;
    return !!box && box.isConnected && box.style.display !== 'none' && box.style.visibility !== 'hidden';
  }

  hideTip() {
    this.keyed = false;
    if (!this.chart) return;
    this.mark(null);
    this.chart.dispatchAction({ type: 'hideTip' });
    this.chart.dispatchAction({ type: 'updateAxisPointer', currTrigger: 'leave' });     // the guide line
    if (this.tipBox) { this.tipBox.style.visibility = 'hidden'; this.tipBox.style.opacity = '0'; }
  }

  onKey(e) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== this || !this.chart || !this.spec.count) return;
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', ' '];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    let i = this.index ?? 0;
    // the first press after the tooltip was closed brings back the point we were on
    if (this.keyed && this.tipOpen()) {
      if (this.spec.step) i = this.spec.step(i, e.key);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') i -= 1;
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') i += 1;
      else if (e.key === 'Home') i = 0;
      else if (e.key === 'End') i = this.spec.count - 1;
    } else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = this.spec.count - 1;
    this.show(i);
  }
}
customElements.define('cns-chart', ChartElement);

// ---- page-wide: closing and following tooltips -----------------------------------------------------
const hideAll = () => live.forEach((c) => { if (c.tipOpen() || c.keyed) c.hideTip(); });
// Capture phase, so that Escape closes a tooltip before it closes anything else.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
  const open = [...live].filter((c) => c.tipOpen() && !c.closest('[inert]'));
  if (!open.length) return;
  e.preventDefault();
  open.forEach((c) => c.hideTip());
}, true);
document.addEventListener('pointerdown', (e) => {
  live.forEach((c) => {
    if (c.contains(e.target)) c.keyed = false;
    else if (c.tipOpen() || c.keyed) c.hideTip();
  });
}, true);
document.addEventListener('scroll', () => {
  live.forEach((c) => {
    if (c.keyed && c === document.activeElement) { if (c.tipOpen()) c.chart.dispatchAction({ type: 'showTip', ...c.spec.target(c.index) }); }
    else if (c.tipOpen()) c.hideTip();
  });
}, { capture: true, passive: true });
document.addEventListener('cns:layers', () => hideAll());      // a dialog or the side panel opened or closed
// Paper is a different width, and nothing hovered should be printed. Both must be drawn at once:
// the page is captured before the next frame.
const redrawNow = () => live.forEach((c) => { if (c.chart) { c.fit(); c.chart.getZr().flush(); } });
window.addEventListener('beforeprint', () => { hideAll(); redrawNow(); });
window.matchMedia('print').addEventListener('change', redrawNow);

// `style` sets the size, so the space is held before the library arrives.
function chartNode(spec, { cls = '', style = {}, compact = false } = {}) {
  const el = document.createElement('cns-chart');
  el.className = cls;
  Object.assign(el.style, style);
  el.spec = spec;
  el.compact = compact;
  el.plot = h('div', { class: 'cns-plot', 'aria-hidden': 'true' });
  el.live = h('span', { class: 'sr', 'aria-live': 'polite' });
  el.append(el.plot, el.live);
  el.setAccess();
  el.addEventListener('keydown', (e) => el.onKey(e));
  el.addEventListener('focus', () => { if (el.matches(':focus-visible')) el.show(el.index ?? 0); });
  el.addEventListener('blur', () => { if (el.keyed) el.hideTip(); el.live.textContent = ''; });
  // A tap must leave its tooltip up. With a mouse also attached, the browser can report right after the
  // tap that the idle mouse is outside the chart, which closes it; so show it once more.
  let finger = false;
  el.addEventListener('pointerdown', (e) => { finger = e.pointerType !== 'mouse'; el.tapped = null; el.fingerAt = null; });
  el.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') el.fingerAt = null; });
  el.addEventListener('click', (e) => {
    if (!finger || !el.chart) return;
    const box = el.getBoundingClientRect(); const spot = [e.clientX - box.left, e.clientY - box.top];
    const at = el.spec.axis ? { x: spot[0], y: spot[1] } : el.tapped;
    if (!at) return;
    setTimeout(() => {
      if (!el.chart) return;
      if (!el.spec.axis) el.mark(at);
      el.fingerAt = spot;                                 // ECharts places it a moment later: keep it beside the finger
      el.chart.dispatchAction({ type: 'showTip', ...at });
    }, 30);
  });
  return el;
}

// The tooltip's content. Everything is added as text.
function tipNode({ title, rows }) {
  return h('div', { class: 'cns-tip-body' }, h('div', { class: 'cns-tip-title' }, title),
    rows.map((r) => h('div', { class: 'cns-tip-row' },
      r.color ? h('i', { style: { background: r.color } }) : null,
      r.name ? h('span', null, r.name) : null,
      h('b', null, r.value))));
}

// ---- shared by line and bar charts -----------------------------------------------------------------
const niceMax = (v) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
};
// Four steps. Counts and very small amounts get whole-number steps so no two labels round to the same text.
const axisTop = (values, whole) => {
  const v = Math.max(0, ...values);
  return whole || v <= 4 ? 4 * Math.max(1, Math.ceil(v / 4)) : niceMax(v);
};
// Axis labels are shortened; tooltips show the exact amount.
const exact = (fmt) => (fmt === pesoShort ? peso : fmt);

function frame({ width, labels, max, fmt, gap }) {
  const text = { color: COLORS.muted, fontFamily: FONT, fontSize: width < 360 ? 11 : 11.5 };
  return {
    grid: { left: 52, right: gap ? 8 : 22, top: 12, bottom: 28 },
    xAxis: {
      type: 'category', data: labels, boundaryGap: gap, axisTick: { show: false }, axisLine: { show: true, lineStyle: { color: COLORS.line } },
      axisLabel: { ...text, margin: 10, hideOverlap: true, interval: 'auto' },
    },
    yAxis: {
      type: 'value', min: 0, max, interval: max / 4, axisLabel: { ...text, margin: 8, formatter: (v) => fmt(v) },
      splitLine: { lineStyle: { color: COLORS.line, type: [3, 4] } },           // dashed, over the solid x axis
    },
  };
}

const points = (n) => `${n} point${n === 1 ? '' : 's'}`;
// "Sales highest ₱14,100 on Nov 27." for each series, for screen readers.
const peaks = (series, titles, say) => series.map((s) => {
  const top = Math.max(0, ...s.values);
  if (!top) return `${s.name}: all zero.`;
  return `${s.name} highest ${say(top)} on ${titles[s.values.indexOf(top)]}.`;
}).join(' ');
const describe = (title, kind, labels, series, say) => (labels.length
  ? `${title || 'Chart'}. ${kind} chart, ${points(labels.length)}, ${labels[0]} to ${labels[labels.length - 1]}. ${peaks(series, labels, say)}`
  : `${title || 'Chart'}. No data.`);

function columnSpec({ labels, tipLabels, series, say, title, kind, option }) {
  const titles = tipLabels || labels;
  // the tooltip lists solid series before the dashed comparison
  const listed = [...series].sort((a, b) => !!a.dashed - !!b.dashed);
  return {
    axis: true, count: labels.length, label: describe(title, kind, titles, listed, say), option,
    tip: (i) => ({ title: titles[i], rows: listed.map((s) => ({ name: s.name, color: s.key || s.color, value: say(s.values[i]) })) }),
    target: (i) => ({ seriesIndex: 0, dataIndex: i }),
  };
}

// series: [{ values:[], color, dashed, area, name }], labels: x labels, tipLabels: longer ones for the tooltip
export function lineChart({ labels, series, tipLabels, height = 230, fmt = pesoShort, title = '' }) {
  const list = series.map((s) => ({ ...s, name: s.name || title || 'Value', values: labels.map((_, i) => Number(s.values[i]) || 0) }));
  const n = labels.length;
  const option = (width) => ({
    ...frame({ width, labels, max: axisTop(list.flatMap((s) => s.values)), fmt, gap: false }),
    tooltip: { axisPointer: { type: 'line', snap: true, lineStyle: { color: COLORS.muted, width: 1, type: [4, 3] }, z: 1 } },
    series: list.map((s) => ({
      type: 'line', name: s.name, data: s.values, cursor: 'default',
      symbol: s.dashed ? 'circle' : 'emptyCircle', symbolSize: 7, showSymbol: !s.dashed && n <= 14, showAllSymbol: true,
      itemStyle: { color: s.color, borderWidth: 2 },
      lineStyle: { color: s.color, width: s.dashed ? 2 : 2.8, type: s.dashed ? [6, 5] : 'solid', cap: 'round', join: 'round' },
      areaStyle: s.area ? { color: s.color, opacity: 0.1 } : undefined,
      emphasis: { scale: 1.6, lineStyle: { width: s.dashed ? 2 : 2.8 }, areaStyle: { opacity: 0.1 } },
    })),
  });
  return chartNode(columnSpec({ labels, tipLabels, series: list, say: exact(fmt), title, kind: 'Line', option }), { style: ratio(height) });
}

// Keeps the proportions the charts have always had, with a floor so that narrow screens stay readable.
const ratio = (height) => ({ aspectRatio: `640 / ${height}`, minHeight: `${Math.min(height, 170)}px` });

// Vertical bars. bars: [{ label, value, color?, tip? }]
export function barChart({ bars, height = 210, fmt = pesoShort, color = COLORS.teal, title = '', name, highlightLast = false }) {
  const labels = bars.map((b) => b.label);
  const series = [{ name: name || title || 'Value', color, values: bars.map((b) => Number(b.value) || 0) }];
  const option = (width) => ({
    ...frame({ width, labels, max: axisTop(series[0].values, fmt !== pesoShort), fmt, gap: true }),
    tooltip: { axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(0,103,104,.07)' } } },
    series: [{
      type: 'bar', name: series[0].name, barWidth: '60%', barMaxWidth: 46, cursor: 'default',
      data: bars.map((b, i) => ({ value: series[0].values[i], itemStyle: { color: b.color || (highlightLast ? (i === bars.length - 1 ? color : COLORS.teal3) : color) } })),
      itemStyle: { borderRadius: 5 },
      emphasis: { itemStyle: { shadowColor: 'rgba(20,32,31,.25)', shadowBlur: 6 } },
    }],
  });
  return chartNode(columnSpec({ labels, tipLabels: bars.map((b) => b.tip || b.label), series, say: exact(fmt), title, kind: 'Bar', option }), { style: ratio(height) });
}

// Two bars per slot. groups: [{ label, a, b, tip? }], names: what a and b are
export function groupedBars({ groups, height = 210, colors = [COLORS.teal, COLORS.org], names = ['Cash in', 'Cash out'], fmt = pesoShort, title = '' }) {
  const labels = groups.map((g) => g.label);
  const series = ['a', 'b'].map((key, j) => ({ name: names[j], color: colors[j], values: groups.map((g) => Number(g[key]) || 0) }));
  const option = (width) => {
    const bar = Math.max(3, Math.min(22, ((width - 60) / Math.max(1, groups.length)) * 0.32));
    return {
      ...frame({ width, labels, max: axisTop(series.flatMap((s) => s.values), fmt !== pesoShort), fmt, gap: true }),
      tooltip: { axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(0,103,104,.07)' } } },
      series: series.map((s) => ({
        type: 'bar', name: s.name, data: s.values, barWidth: bar, barGap: `${(2 / bar) * 100}%`, cursor: 'default',
        itemStyle: { color: s.color, borderRadius: Math.min(4, bar / 3) },
        emphasis: { itemStyle: { shadowColor: 'rgba(20,32,31,.25)', shadowBlur: 6 } },
      })),
    };
  };
  return chartNode(columnSpec({ labels, tipLabels: groups.map((g) => g.tip || g.label), series, say: exact(fmt), title, kind: 'Grouped bar', option }), { style: ratio(height) });
}

// Donut with total in the middle. parts: [{ label, value, color }]. `inline` makes it only as wide as it is tall.
export function donut({ parts, size = 170, centerTop = '', centerBottom = '', title = 'Share of total', fmt = peso, inline = false }) {
  const slices = parts.filter((p) => Number(p.value) > 0).map((p) => ({ ...p, value: Number(p.value) }));
  const total = slices.reduce((a, p) => a + p.value, 0);
  const share = (v) => { const pct = (v / total) * 100; return pct < 0.1 ? '<0.1%' : `${pct.toFixed(1)}%`; };
  const radius = ['64%', '91%'];
  const scale = size / 160;
  const option = () => ({
    title: {
      text: centerTop, subtext: centerBottom, left: 'center', top: 'center', itemGap: 2, silent: true,
      textStyle: { color: INK, fontFamily: FONT, fontSize: Math.max(15, Math.round(20 * scale)), fontWeight: 700 },
      subtextStyle: { color: COLORS.muted, fontFamily: FONT, fontSize: 11 },
    },
    series: [
      { type: 'pie', data: slices.map((p) => ({ name: p.label, value: p.value, itemStyle: { color: p.color } })), radius, center: ['50%', '50%'], startAngle: 90,
        z: 3, label: { show: false }, labelLine: { show: false }, cursor: 'default', emphasis: { scale: true, scaleSize: Math.max(3, Math.round(5 * scale)) } },
      { type: 'pie', data: [{ value: 1 }], radius, center: ['50%', '50%'], silent: true, z: 1, label: { show: false }, labelLine: { show: false },
        itemStyle: { color: COLORS.track }, tooltip: { show: false }, emphasis: { disabled: true } },
    ],
  });
  const label = total ? `${title}. Donut chart. ${slices.map((p) => `${p.label} ${fmt(p.value)}, ${share(p.value)}`).join('; ')}.` : `${title}. No data.`;
  return chartNode({
    count: slices.length, label, option,
    tip: (i) => ({ title: slices[i].label, rows: [{ color: slices[i].color, value: fmt(slices[i].value) }, { name: 'Share', value: share(slices[i].value) }] }),
    target: (i) => ({ seriesIndex: 0, dataIndex: i }),
  }, { cls: 'donut', style: { height: `${size}px`, width: inline ? `${size}px` : '100%', flex: 'none' } });
}

// A small trend line. `labels` names each value (its date) for the tooltip.
export function sparkline(values, { color = COLORS.teal, width = 120, height = 34, labels = [], fmt = peso, title = 'Trend' } = {}) {
  if (!values.length) return h('span');
  const data = values.map((v) => Number(v) || 0);
  const last = data.length - 1;
  const name = (i) => labels[i] || `Point ${i + 1}`;
  const option = () => ({
    grid: { left: 4, right: 4, top: 4, bottom: 4, outerBoundsMode: 'none' },
    xAxis: { type: 'category', data: data.map((_, i) => name(i)), boundaryGap: data.length === 1, show: false },
    yAxis: { type: 'value', min: Math.min(...data, 0), max: Math.max(...data, 1), show: false },
    tooltip: { axisPointer: { type: 'line', lineStyle: { color: COLORS.muted, width: 1 } } },
    series: [
      { type: 'line', data, symbol: 'circle', symbolSize: 7, showSymbol: false, cursor: 'default', itemStyle: { color },
        lineStyle: { color, width: 2.2, cap: 'round', join: 'round' }, emphasis: { lineStyle: { width: 2.2 } } },
      { type: 'scatter', data: [[last, data[last]]], symbolSize: 6, itemStyle: { color }, silent: true, emphasis: { disabled: true } },
    ],
  });
  return chartNode({
    axis: true, count: data.length, option,
    label: `${title}. ${points(data.length)}, from ${fmt(data[0])} on ${name(0)} to ${fmt(data[last])} on ${name(last)}.`,
    tip: (i) => ({ title: name(i), rows: [{ value: fmt(data[i]) }] }),
    target: (i) => ({ seriesIndex: 0, dataIndex: i }),
  }, { cls: 'spark', style: { width: `${width}px`, height: `${height}px` }, compact: true });
}

export function legend(items) {
  return h('div', { class: 'legend' }, items.map((i) => h('span', null, h('i', { style: { background: i.color } }), i.label)));
}

let ruler = null;
const textWidth = (text, font) => {
  ruler = ruler || document.createElement('canvas').getContext('2d');
  ruler.font = font;
  return ruler.measureText(text).width;
};
// ECharts cannot read CSS variables, so 'var(--bad)' is looked up first.
const cssColor = (c) => {
  const m = /^var\((--[\w-]+)\)$/.exec(c);
  return m ? getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() : c;
};
const rect = (x, y, width, height, fill, r) => ({ type: 'rect', shape: { x, y, width, height, r }, style: { fill }, emphasisDisabled: true });

// Horizontal bars: name, track, value. Long names are cut short here and shown in full in the tooltip.
// items: [{ label, value, text?, color? }]
export function hbars(items, { fmt = peso, color = COLORS.teal, max, title = 'Comparison' } = {}) {
  const ROW = 32;
  const rows = items.map((i) => ({ label: String(i.label ?? ''), value: Number(i.value) || 0, text: String(i.text ?? fmt(i.value)), color: i.color || color }));
  const top = max || Math.max(1, ...rows.map((r) => r.value));
  const option = (width) => {
    const names = Math.round(Math.max(90, Math.min(150, width * 0.42)));
    const values = Math.ceil(Math.max(0, ...rows.map((r) => textWidth(r.text, `600 13.5px ${FONT}`)))) + 2;
    const left = names + 12; const track = Math.max(24, width - left - 12 - values);
    return {
      tooltip: {},
      series: [{
        type: 'custom', coordinateSystem: 'none', cursor: 'default', data: rows.map((r) => r.value),
        renderItem: (params) => {
          const r = rows[params.dataIndex]; const y = params.dataIndex * ROW; const mid = y + ROW / 2;
          const fill = Math.min(1, Math.max(0.02, r.value / top)) * track;             // zero still shows a sliver
          const text = (x, str, style) => ({ type: 'text', style: { text: str, x, y: mid, fill: INK, verticalAlign: 'middle', fontFamily: FONT, fontSize: 13.5, ...style }, emphasisDisabled: true });
          return {
            type: 'group', focus: 'none',
            children: [
              // the whole row answers to the pointer, and lights up
              { type: 'rect', shape: { x: 0, y: y + 1, width, height: ROW - 2, r: 6 }, style: { fill: 'rgba(0,103,104,0)' }, emphasis: { style: { fill: 'rgba(0,103,104,.07)' } } },
              text(0, r.label, { width: names, overflow: 'truncate', ellipsis: '…' }),
              rect(left, mid - 5, track, 10, COLORS.track, 5),
              rect(left, mid - 5, fill, 10, cssColor(r.color), Math.min(5, fill / 2)),
              text(width, r.text, { align: 'right', fontWeight: 600 }),
            ],
          };
        },
      }],
    };
  };
  return chartNode({
    count: rows.length, option,
    label: rows.length ? `${title}. Bar chart. ${rows.map((r) => `${r.label}: ${r.text}`).join('; ')}.` : `${title}. No data.`,
    tip: (i) => ({ title: rows[i].label, rows: [{ color: rows[i].color, value: rows[i].text }] }),
    target: (i) => ({ seriesIndex: 0, dataIndex: i }),
  }, { cls: 'hbars', style: { height: `${rows.length * ROW}px` } });
}

// Busy-hours grid. cells: [{ dow (0=Mon .. 6=Sun, as the database sends it), hour, total }]
export function heatmap(cells, { hours = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], title = 'Busiest hours' } = {}) {
  const LEFT = 47; const HEAD = 20; const ROW = 25; const GAP = 3;
  const map = new Map(cells.map((c) => [`${c.dow}-${c.hour}`, Number(c.total) || 0]));
  const grid = days.flatMap((day, dow) => hours.map((hour, x) => ({ day, dow, hour, x, value: map.get(`${dow}-${hour}`) || 0 })));
  const max = Math.max(1, ...grid.map((c) => c.value));
  const short = (hr) => `${((hr + 11) % 12) + 1}${hr < 12 ? 'a' : 'p'}`;
  const long = (hr) => `${((hr + 11) % 12) + 1}:00 ${hr < 12 ? 'am' : 'pm'}`;
  const across = (width) => (width - LEFT + GAP) / hours.length;
  const cols = hours.length;
  const option = (width) => {
    const col = across(width);
    const text = (x, y, str, align) => ({ type: 'text', silent: true, style: { text: str, x, y, fill: COLORS.muted, align, verticalAlign: 'middle', fontFamily: FONT, fontSize: 12 } });
    return {
      tooltip: {},
      graphic: [
        ...hours.map((hr, i) => text(LEFT + i * col + (col - GAP) / 2, 8, short(hr), 'center')),
        ...days.map((d, i) => text(0, HEAD + i * ROW + 11, d, 'left')),
      ],
      series: [{
        type: 'custom', coordinateSystem: 'none', cursor: 'default', data: grid.map((c) => c.value),
        renderItem: (params) => {
          const c = grid[params.dataIndex];
          return {
            type: 'rect', focus: 'none',
            shape: { x: LEFT + c.x * col, y: HEAD + c.dow * ROW, width: col - GAP, height: ROW - GAP, r: 4 },
            style: { fill: c.value ? `rgba(0,103,104,${0.12 + (c.value / max) * 0.88})` : COLORS.track, stroke: 'rgba(20,32,31,0)', lineWidth: 2 },
            emphasis: { style: { stroke: INK } },
          };
        },
      }],
    };
  };
  const busiest = grid.reduce((a, c) => (c.value > a.value ? c : a), grid[0]);
  return chartNode({
    count: grid.length, option,
    label: `${title}. Heat map of sales by day and hour. ${busiest && busiest.value ? `Busiest: ${busiest.day} ${long(busiest.hour)}, ${peso(busiest.value)}.` : 'No sales.'} Left and right change the hour, up and down the day.`,
    tip: (i) => ({ title: `${grid[i].day}, ${long(grid[i].hour)}`, rows: [{ name: 'Sales', value: peso(grid[i].value) }] }),
    target: (i) => ({ seriesIndex: 0, dataIndex: i }),
    step: (i, key) => {
      const row = Math.floor(i / cols) * cols;
      if (key === 'ArrowLeft') return Math.max(row, i - 1);
      if (key === 'ArrowRight') return Math.min(row + cols - 1, i + 1);
      if (key === 'ArrowUp') return i >= cols ? i - cols : i;
      if (key === 'ArrowDown') return i + cols < grid.length ? i + cols : i;
      if (key === 'Home') return row;
      if (key === 'End') return row + cols - 1;
      return i;
    },
    spot: (i, width) => [LEFT + grid[i].x * across(width), across(width)],
  }, { cls: 'heat', style: { height: `${HEAD + days.length * ROW}px` } });
}
