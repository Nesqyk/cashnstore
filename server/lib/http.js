// Small helpers shared by every route.

class HttpError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields; // optional { fieldName: 'message' } for form errors
  }
}

const bad = (message, fields) => new HttpError(400, message, fields);
const notFound = (what = 'Not found') => new HttpError(404, what);

// Wrap an async route so thrown errors reach the error handler.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---- input cleaning -------------------------------------------------------
function text(value, { max = 200, required = false, field = 'value' } = {}) {
  const s = value === undefined || value === null ? '' : String(value).trim();
  if (required && !s) throw bad(`${field} is required`, { [field]: 'Required' });
  if (s.length > max) throw bad(`${field} is too long`, { [field]: `Max ${max} characters` });
  return s;
}

function money(value, { min = 0, max = 10000000, field = 'amount', required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw bad(`${field} is required`, { [field]: 'Required' });
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) throw bad(`${field} must be a number`, { [field]: 'Enter a number' });
  if (n < min) throw bad(`${field} must be at least ${min}`, { [field]: `Must be at least ${min}` });
  if (n > max) throw bad(`${field} is too large`, { [field]: 'Too large' });
  return Math.round(n * 100) / 100;
}

function int(value, { min = 0, max = 1000000, field = 'value', required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw bad(`${field} is required`, { [field]: 'Required' });
    return null;
  }
  const n = Number(value);
  if (!Number.isInteger(n)) throw bad(`${field} must be a whole number`, { [field]: 'Whole numbers only' });
  if (n < min || n > max) throw bad(`${field} must be between ${min} and ${max}`, { [field]: `Between ${min} and ${max}` });
  return n;
}

function oneOf(value, allowed, { field = 'value', fallback } = {}) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    throw bad(`${field} is required`, { [field]: 'Required' });
  }
  if (!allowed.includes(value)) throw bad(`${field} is not valid`, { [field]: 'Not a valid choice' });
  return value;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function email(value, { required = false, field = 'email' } = {}) {
  const s = text(value, { max: 200, required, field });
  if (s && !EMAIL_RE.test(s)) throw bad('Enter a valid email', { [field]: 'Enter a valid email' });
  return s || null;
}

// Password rules from the design: at least 8 characters, 1 capital letter, 1 number.
// Changing your own password also asks for 1 symbol.
function checkPassword(pw, { symbol = false, field = 'password' } = {}) {
  const s = typeof pw === 'string' ? pw : '';
  const problems = [];
  if (s.length < 8) problems.push('at least 8 characters');
  if (!/[A-Z]/.test(s)) problems.push('1 capital letter');
  if (!/[0-9]/.test(s)) problems.push('1 number');
  if (symbol && !/[^A-Za-z0-9]/.test(s)) problems.push('1 symbol');
  if (problems.length) {
    const msg = `Use ${problems.join(', ')}`;
    throw bad(msg, { [field]: msg });
  }
  return s;
}

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,30}$/;
function username(value, field = 'username') {
  const s = text(value, { max: 30, required: true, field });
  if (!USERNAME_RE.test(s)) {
    throw bad('Use 3-30 letters, numbers, dots or dashes', { [field]: 'Use 3-30 letters, numbers, dots or dashes' });
  }
  return s;
}

// Page size / offset from a query string
function paging(q, defaultSize = 10) {
  const size = Math.min(Math.max(parseInt(q.size, 10) || defaultSize, 1), 100);
  const page = Math.max(parseInt(q.page, 10) || 1, 1);
  return { size, page, offset: (page - 1) * size };
}

// Escape a value for CSV output.
function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  // Neutralise spreadsheet formulas
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
function toCsv(headers, rows) {
  return [headers.join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n') + '\n';
}

module.exports = { HttpError, bad, notFound, wrap, text, money, int, oneOf, email, checkPassword, username, paging, toCsv };
