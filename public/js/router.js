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
