// Talks to the server. Every request carries the header the server uses as a CSRF guard.
export class ApiError extends Error {
  constructor(status, message, fields) { super(message); this.status = status; this.fields = fields || {}; }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

async function request(method, url, body) {
  const opts = { method, headers: { 'X-Requested-With': 'cashnstore' }, credentials: 'same-origin' };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(url, opts); } catch (_) { throw new ApiError(0, 'Cannot reach the server. Check your connection.'); }
  let data = null;
  const type = res.headers.get('content-type') || '';
  if (type.includes('application/json')) data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new ApiError(res.status, (data && data.error) || `Request failed (${res.status})`, data && data.fields);
    if (res.status === 401 && !url.startsWith('/api/auth/')) onUnauthorized();
    throw err;
  }
  return data;
}

const qs = (params) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString(); return s ? `?${s}` : '';
};

export const api = {
  get: (url, params) => request('GET', url + qs(params)),
  post: (url, body = {}) => request('POST', url, body),
  put: (url, body = {}) => request('PUT', url, body),
  del: (url) => request('DELETE', url),
  qs,
};
