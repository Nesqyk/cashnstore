// Small helpers used by every screen. No framework: screens build DOM with h().

// h('div', { class: 'card', onclick: fn }, 'text', childNode, [more, children])
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;          // only ever used with our own generated SVG
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}
export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export function fromHtml(svg) { const t = document.createElement('template'); t.innerHTML = svg.trim(); return t.content.firstElementChild; }
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- numbers and dates ---------------------------------------------------------------------------
export const peso = (n, dp) => {
  const v = Number(n || 0);
  const digits = dp ?? (Number.isInteger(v) ? 0 : 2);
  return `${v < 0 ? '-' : ''}₱${Math.abs(v).toLocaleString('en-PH', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
};
export const pesoShort = (n) => {
  const v = Math.abs(Number(n || 0));
  if (v >= 1e6) return `₱${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e4) return `₱${Math.round(v / 1000)}k`;
  if (v >= 1e3) return `₱${(v / 1000).toFixed(1)}k`;
  return `₱${Math.round(v)}`;
};
export const num = (n) => Number(n || 0).toLocaleString('en-PH');
const TZ = 'Asia/Manila';
export const fmtTime = (d) => new Date(d).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
export const fmtDate = (d) => new Date(d.length === 10 ? `${d}T00:00:00+08:00` : d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: TZ });
export const fmtDay = (d) => new Date(d.length === 10 ? `${d}T00:00:00+08:00` : d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: TZ });
export const fmtWeekday = (d) => new Date(`${d}T00:00:00+08:00`).toLocaleDateString('en-PH', { weekday: 'short', timeZone: TZ });
export const fmtDateTime = (d) => `${fmtDate(d)}, ${fmtTime(d)}`;
export function ago(d) {
  const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  if (s < 172800) return 'Yesterday';
  return fmtDay(d);
}
export const hourLabel = (h24) => `${((h24 + 11) % 12) + 1}${h24 < 12 ? 'am' : 'pm'}`;
export const greeting = () => { const h24 = Number(new Date().toLocaleString('en-GB', { hour: 'numeric', hour12: false, timeZone: TZ })); return h24 < 12 ? 'Good morning' : h24 < 18 ? 'Good afternoon' : 'Good evening'; };
export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

export function delta(pct, { suffix = '' } = {}) {
  if (pct === null || pct === undefined) return null;
  const up = pct > 0.05; const down = pct < -0.05;
  return h('span', { class: `delta ${up ? 'up' : down ? 'down' : 'flat'}` }, up ? '▲' : down ? '▼' : '•', ` ${Math.abs(pct).toFixed(1)}%${suffix}`);
}

// ---- toast + modal -------------------------------------------------------------------------------
export function toast(message, kind = '') {
  const t = h('div', { class: `toast ${kind}`, role: 'status' }, message);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), kind === 'err' ? 5000 : 3000);
}

// ---- layers: dialogs and the side panel ----------------------------------------------------------
// Everything that covers the page registers here, bottom first. Only the top layer reacts to Esc and
// to the keyboard; whatever is underneath is made inert. (Each layer's backdrop takes its own outside clicks.)
const layers = [];
const syncLayers = () => {
  layers.forEach((l, i) => { l.el.inert = i < layers.length - 1; });
  const app = document.getElementById('app');
  if (app) app.inert = layers.some((l) => l.coversApp);
  document.dispatchEvent(new Event('cns:layers'));        // chart tooltips close when something covers them
};
export function pushLayer(layer) {                  // { el, dismiss, close?, coversApp? } -> remove()
  layers.push(layer); syncLayers();
  return () => { const i = layers.indexOf(layer); if (i >= 0) layers.splice(i, 1); syncLayers(); };
}
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing || !layers.length) return;
  e.preventDefault();
  layers[layers.length - 1].dismiss();
});
// Closes every dialog, top first. The side panel has no `close` here: the router decides when it goes.
export function closeAllModals() { [...layers].reverse().forEach((l) => { if (l.close) l.close(); }); }

// Opens a modal with `content` (a node). Returns { close, el }.
export function openModal(content, { wide = false, onClose } = {}) {
  const root = document.getElementById('modal-root');
  const box = h('div', { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true' }, content);
  const back = h('div', { class: 'modal-back' }, box);
  const prevFocus = document.activeElement;
  let closed = false; let removeLayer = () => {};
  const close = () => {
    if (closed) return;
    closed = true; back.remove(); removeLayer();
    if (prevFocus && prevFocus.focus) prevFocus.focus();
    if (onClose) onClose();
  };
  // preventDefault: the mouse press must not move focus after close() has put it back
  back.addEventListener('mousedown', (e) => { if (e.target === back) { e.preventDefault(); close(); } });
  root.append(back);
  removeLayer = pushLayer({ el: back, dismiss: close, close });
  const first = box.querySelector('input, select, textarea, button.primary')
    || (document.getElementById('app').inert ? box.querySelector('button') : null);   // over the side panel, focus must not be left behind
  if (first) first.focus();
  return { close, el: box };
}

export function confirmModal({ title, message, confirmText = 'Confirm', cancelText = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const m = openModal(h('div', null,
      h('h2', null, title), h('p', { class: 'muted', style: { marginTop: '6px' } }, message),
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn', onclick: () => { finish(false); m.close(); } }, cancelText),
        h('button', { class: `btn ${danger ? 'danger solid' : 'primary'}`, onclick: () => { finish(true); m.close(); } }, confirmText))),
    { onClose: () => finish(false) });
  });
}

// ---- form helpers -------------------------------------------------------------------------------
// field('Label', inputNode, { hint, error }) -> labelled block
export function field(label, input, { hint, error, id } = {}) {
  const fid = id || `f${Math.random().toString(36).slice(2, 8)}`;
  if (input.setAttribute && !input.id) input.id = fid;
  const box = h('div', { class: 'field' }, label ? h('label', { for: input.id }, label) : null, input,
    hint ? h('div', { class: 'hint' }, hint) : null, h('div', { class: 'err hidden' }));
  if (error) setFieldError(box, error);
  return box;
}
export function setFieldError(box, msg) {
  const e = box.querySelector('.err'); const inp = box.querySelector('.input');
  if (!e) return;
  e.textContent = msg || ''; e.classList.toggle('hidden', !msg);
  if (inp) inp.classList.toggle('invalid', !!msg);
}
// Show server-side `fields` errors on a form. `boxes` maps field name -> field() element.
export function showFieldErrors(boxes, fields = {}) {
  for (const [name, box] of Object.entries(boxes)) setFieldError(box, fields[name] || '');
}
export const input = (props = {}) => h('input', { class: 'input', ...props });
export function withIcon(iconNode, inputNode, trailing) {
  return h('div', { class: 'input-wrap' }, h('span', { class: 'ico' }, iconNode), inputNode, trailing ? h('span', { class: 'trail' }, trailing) : null);
}
export function peso$(props = {}) { return h('div', { class: 'prefix-wrap' }, h('span', null, '₱'), h('input', { class: 'input', inputmode: 'decimal', ...props })); }
export function switchEl(checked, onchange) {
  const i = h('input', { type: 'checkbox', role: 'switch', checked: checked ? true : null });
  i.checked = !!checked;
  if (onchange) i.addEventListener('change', () => onchange(i.checked));
  return h('label', { class: 'switch' }, i, h('i'));
}
export function spinnerBlock() { return h('div', { class: 'center-screen' }, h('span', { class: 'spinner' })); }

// Disable a button while an async action runs.
export async function busy(btn, fn) {
  const label = btn.textContent; btn.disabled = true; btn.classList.add('disabled');
  try { return await fn(); } finally { btn.disabled = false; btn.classList.remove('disabled'); btn.textContent = label; }
}

// The element itself, or if a refresh redrew it: the link that replaced it, otherwise the main area.
export function stillThere(el) {
  if (el.isConnected) return el;
  const to = el.getAttribute('href');
  return (to && document.querySelector(`#app a[href="${CSS.escape(to)}"]`)) || document.getElementById('main');
}

export function download(url) { const a = document.createElement('a'); a.href = url; a.download = ''; document.body.append(a); a.click(); a.remove(); }
