// Hash router. A route is { path: '/products/:id/edit', load: () => import(...), perm: [...], auth: true }.
export function compile(routes) {
  return routes.map((r) => {
    const keys = [];
    const re = new RegExp(`^${r.path.replace(/:([a-z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}/?$`);
    return { ...r, re, keys };
  });
}
export function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, search = ''] = raw.split('?');
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(search)) };
}
export function match(compiled, path) {
  for (const r of compiled) {
    const m = r.re.exec(path);
    if (m) return { route: r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}
export const go = (path) => { if (location.hash === `#${path}`) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = path; };
export const href = (path) => `#${path}`;

// ---- history ---------------------------------------------------------------------------------------
// The side panel needs to know which way a navigation went, so every history entry is numbered.
export const currentPath = () => location.hash.replace(/^#/, '') || '/';        // includes the query string
export const entryState = () => history.state || {};
export const setEntryState = (patch) => history.replaceState({ ...history.state, ...patch }, '');

let entry = 0;            // number of the entry we are on
let shown = '/';          // and its path
let travelled = null;     // resolves a travel() in progress
let replacing = false;

// Calls onMove({ fresh, delta, from }) after each navigation, except the ones made by travel().
export function watchHistory(onMove) {
  history.scrollRestoration = 'manual';                  // a screen kept under the side panel must not jump
  if (entryState().idx === undefined) setEntryState({ idx: 0 });
  entry = entryState().idx; shown = currentPath();
  window.addEventListener('hashchange', () => {
    const fresh = entryState().idx === undefined;        // a new entry, not Back or Forward
    if (fresh) setEntryState({ idx: replacing ? entry : entry + 1 });
    replacing = false;
    const move = { fresh, delta: entryState().idx - entry, from: shown };
    entry = entryState().idx; shown = currentPath();
    if (travelled) { const done = travelled; travelled = null; done(); } else onMove(move);
  });
}
// Moves through history without calling onMove. The two entries must have different hashes.
export const travel = (delta) => new Promise((resolve) => { travelled = resolve; history.go(delta); });
// Changes the address of this entry. No navigation happens.
export const rewrite = (path) => { history.replaceState(history.state, '', href(path)); shown = path; };
// Navigates without leaving the current entry behind.
export const replaceWith = (path) => { replacing = true; location.replace(href(path)); };
// Slips an entry for `under` beneath the current one. No navigation happens.
export function insertUnder(under) {
  const path = currentPath();
  history.replaceState(history.state, '', href(under));
  entry += 1; history.pushState({ idx: entry, under }, '', href(path));
}
