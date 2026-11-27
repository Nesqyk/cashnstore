const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { query, tx } = require('../db');
const { wrap, HttpError, bad, text, email, checkPassword } = require('../lib/http');
const { requireAuth } = require('../middleware/auth');
const { publicUser, revokeSessions } = require('../lib/users');
const { deliverResetCode } = require('../lib/mailer');
const { audit } = require('../lib/audit');

const router = express.Router();

// A real bcrypt hash of a random string, used so a wrong username takes as long as a wrong password.
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(8).toString('hex'), 10);

// --- very small login throttle: 5 wrong tries per username+IP, then a 5 minute wait -----------
const attempts = new Map();
const MAX_TRIES = 5;
const LOCK_MS = 5 * 60 * 1000;
function throttleKey(req, name) { return `${req.ip}|${String(name).toLowerCase()}`; }
function checkThrottle(key) {
  const a = attempts.get(key);
  if (a && a.count >= MAX_TRIES && Date.now() - a.last < LOCK_MS) {
    const mins = Math.ceil((LOCK_MS - (Date.now() - a.last)) / 60000);
    throw new HttpError(429, `Too many tries. Please wait ${mins} minute${mins === 1 ? '' : 's'} and try again.`);
  }
  if (a && Date.now() - a.last >= LOCK_MS) attempts.delete(key);
}
function recordFailure(key) {
  const a = attempts.get(key) || { count: 0, last: 0 };
  a.count += 1; a.last = Date.now();
  attempts.set(key, a);
}

function describeDevice(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'unknown device';
  return `${browser} on ${os}`;
}

router.post('/login', wrap(async (req, res) => {
  const name = text(req.body.username, { max: 60, required: true, field: 'username' });
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!password) throw bad('Enter your password', { password: 'Required' });

  const key = throttleKey(req, name);
  checkThrottle(key);

  const { rows } = await query(
    `SELECT u.id, u.password_hash, u.is_active FROM users u WHERE lower(u.username) = lower($1)`,
    [name]
  );
  const row = rows[0];
  const ok = await bcrypt.compare(password, row ? row.password_hash : DUMMY_HASH);
  if (!row || !ok || !row.is_active) {
    recordFailure(key);
    throw new HttpError(401, 'Wrong username or password');
  }
  attempts.delete(key);

  // New session id after login (prevents session fixation)
  await new Promise((resolve, reject) => req.session.regenerate((e) => (e ? reject(e) : resolve())));
  req.session.userId = row.id;
  req.session.device = describeDevice(req.get('user-agent'));
  req.session.ip = req.ip;
  req.session.lastSeen = Date.now();
  await new Promise((resolve, reject) => req.session.save((e) => (e ? reject(e) : resolve())));
  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [row.id]);

  const me = await query(
    `SELECT u.id, u.username, u.full_name, u.email, u.mobile, u.avatar_key, u.job_title, u.station, u.must_change_password,
            r.code AS role, r.name AS role_name,
            COALESCE(array_agg(p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions
     FROM users u JOIN roles r ON r.id = u.role_id
     LEFT JOIN role_permissions rp ON rp.role_id = r.id LEFT JOIN permissions p ON p.id = rp.permission_id
     WHERE u.id = $1 GROUP BY u.id, r.code, r.name`,
    [row.id]
  );
  res.json({ user: publicUser(me.rows[0]) });
}));

router.post('/logout', wrap(async (req, res) => {
  await new Promise((resolve) => req.session.destroy(() => resolve()));
  res.clearCookie('cns.sid');
  res.json({ ok: true });
}));

router.get('/me', wrap(async (req, res) => {
  if (!req.user) return res.json({ user: null });
  // Track "last active" for the signed-in devices list, at most every 5 minutes.
  if (!req.session.lastSeen || Date.now() - req.session.lastSeen > 5 * 60 * 1000) req.session.lastSeen = Date.now();
  res.json({ user: publicUser(req.user) });
}));

// ---- forgot / reset password (6-digit code) ----------------------------------------------------
router.post('/forgot', wrap(async (req, res) => {
  const addr = email(req.body.email, { required: true });
  const { rows } = await query(
    'SELECT id, full_name, email, username FROM users WHERE lower(email) = lower($1) AND is_active', [addr]
  );
  const user = rows[0];
  if (user) {
    const code = String(crypto.randomInt(100000, 1000000));
    const hash = await bcrypt.hash(code, 10);
    await tx(async (c) => {
      await c.query('UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [user.id]);
      await c.query(
        `INSERT INTO password_resets (user_id, code_hash, expires_at) VALUES ($1, $2, now() + interval '15 minutes')`,
        [user.id, hash]
      );
    });
    await deliverResetCode(user, code);
  }
  // Same answer whether or not the email exists, so nobody can probe for accounts.
  res.json({ ok: true });
}));

router.post('/reset', wrap(async (req, res) => {
  const addr = email(req.body.email, { required: true });
  const code = text(req.body.code, { max: 10, required: true, field: 'code' });
  const password = checkPassword(req.body.password, { symbol: false, field: 'password' });
  const generic = new HttpError(400, 'That code is not valid or has expired', { code: 'Not valid or expired' });

  const found = await query(
    `SELECT pr.id, pr.user_id, pr.code_hash, pr.attempts
     FROM password_resets pr JOIN users u ON u.id = pr.user_id
     WHERE lower(u.email) = lower($1) AND pr.used_at IS NULL AND pr.expires_at > now()
     ORDER BY pr.created_at DESC LIMIT 1`,
    [addr]
  );
  const pr = found.rows[0];
  if (!pr || pr.attempts >= 5) throw generic;

  const ok = await bcrypt.compare(code, pr.code_hash);
  if (!ok) {
    await query('UPDATE password_resets SET attempts = attempts + 1 WHERE id = $1', [pr.id]);
    throw generic;
  }
  const hash = await bcrypt.hash(password, 10);
  await tx(async (c) => {
    await c.query(
      'UPDATE users SET password_hash = $1, must_change_password = false, password_changed_at = now(), updated_at = now() WHERE id = $2',
      [hash, pr.user_id]
    );
    await c.query('UPDATE password_resets SET used_at = now() WHERE id = $1', [pr.id]);
    await revokeSessions(c, pr.user_id);
    await audit(c, pr.user_id, 'auth.password_reset', 'user', pr.user_id);
  });
  res.json({ ok: true });
}));

// ---- change my own password -------------------------------------------------------------------
router.post('/change-password', requireAuth, wrap(async (req, res) => {
  const current = typeof req.body.current === 'string' ? req.body.current : '';
  const next = checkPassword(req.body.next, { symbol: true, field: 'next' });
  if (req.body.confirm !== undefined && req.body.confirm !== req.body.next) {
    throw bad('Passwords do not match', { confirm: 'Does not match' });
  }
  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  const ok = await bcrypt.compare(current, rows[0].password_hash);
  if (!ok) throw bad('Current password is wrong', { current: 'Wrong password' });
  if (current === next) throw bad('Choose a new password', { next: 'Must be different' });

  const hash = await bcrypt.hash(next, 10);
  await tx(async (c) => {
    await c.query(
      'UPDATE users SET password_hash = $1, must_change_password = false, password_changed_at = now(), updated_at = now() WHERE id = $2',
      [hash, req.user.id]
    );
    await revokeSessions(c, req.user.id, req.sessionID);
    await audit(c, req.user.id, 'auth.password_change', 'user', req.user.id);
  });
  res.json({ ok: true });
}));

module.exports = router;
