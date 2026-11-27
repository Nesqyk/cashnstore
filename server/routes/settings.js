const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { query, tx } = require('../db');
const { wrap, bad, HttpError, text, email, money } = require('../lib/http');
const { requireAuth, can, hasPerm } = require('../middleware/auth');
const { audit } = require('../lib/audit');

const router = express.Router();
router.use(requireAuth);

const sidHash = (sid) => crypto.createHash('sha256').update(sid).digest('hex').slice(0, 16);

// ---- store (General tab) ------------------------------------------------------------------------
router.get('/store', wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT store_name, address, phone, email, tin, receipt_message, logo_url, timezone, discount_percent,
            gcash_fee_percent, gcash_min_fee, gcash_min_float, gcash_target_float,
            (owner_pin_hash IS NOT NULL) AS has_owner_pin, owner_pin_changed_at, two_step_enabled
     FROM store_settings WHERE id = 1`);
  const s = rows[0];
  if (!hasPerm(req, 'settings.manage')) {
    // Cashiers only need what is printed on the receipt.
    return res.json({ store: { store_name: s.store_name, address: s.address, phone: s.phone, email: s.email, tin: s.tin,
      receipt_message: s.receipt_message, logo_url: s.logo_url, discount_percent: s.discount_percent } });
  }
  res.json({ store: s });
}));

router.put('/store', can('settings.manage'), wrap(async (req, res) => {
  const b = req.body;
  const logo = text(b.logo_url, { max: 500 }) || null;
  if (logo && !/^(https?:\/\/|\/)/i.test(logo)) throw bad('Logo link must start with http or /', { logo_url: 'Use a web link' });
  const minFloat = money(b.gcash_min_float, { field: 'gcash_min_float', max: 1000000 });
  const targetFloat = money(b.gcash_target_float, { field: 'gcash_target_float', max: 1000000 });
  if (targetFloat < minFloat) throw bad('The target float must be at least the minimum float', { gcash_target_float: 'Must be at least the minimum' });
  await query(
    `UPDATE store_settings SET store_name=$1, address=$2, phone=$3, email=$4, tin=$5, receipt_message=$6, logo_url=$7,
            discount_percent=$8, gcash_fee_percent=$9, gcash_min_fee=$10, gcash_min_float=$11, gcash_target_float=$12, updated_at=now() WHERE id=1`,
    [text(b.store_name, { max: 120, required: true, field: 'store_name' }), text(b.address, { max: 200 }), text(b.phone, { max: 40 }),
      email(b.email) || '', text(b.tin, { max: 40 }), text(b.receipt_message, { max: 160 }), logo,
      money(b.discount_percent, { field: 'discount_percent', max: 100 }), money(b.gcash_fee_percent, { field: 'gcash_fee_percent', max: 20 }),
      money(b.gcash_min_fee, { field: 'gcash_min_fee', max: 1000 }), minFloat, targetFloat]);
  await audit(null, req.user.id, 'settings.store', 'store', 1);
  res.json({ ok: true });
}));

// ---- my account (Account tab) ---------------------------------------------------------------------
router.get('/account', wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT id, username, full_name, email, mobile, avatar_key, job_title, notify_daily_summary, ask_pin_when_short, last_login_at, password_changed_at
     FROM users WHERE id = $1`, [req.user.id]);
  res.json({ account: rows[0] });
}));

router.put('/account', wrap(async (req, res) => {
  const b = req.body;
  const key = text(b.avatar_key, { max: 30 });
  if (key && !/^[a-z0-9_-]+$/.test(key)) throw bad('Pick an avatar from the list');
  try {
    await query(
      `UPDATE users SET full_name=$1, email=$2, mobile=$3, avatar_key=$4, notify_daily_summary=$5, ask_pin_when_short=$6, updated_at=now() WHERE id=$7`,
      [text(b.full_name, { max: 100, required: true, field: 'full_name' }), email(b.email), text(b.mobile, { max: 30 }) || null, key || null,
        b.notify_daily_summary !== false, b.ask_pin_when_short !== false, req.user.id]);
  } catch (err) {
    if (err.code === '23505') throw bad('That email is already used', { email: 'Already used' });
    throw err;
  }
  res.json({ ok: true });
}));

// ---- security tab -------------------------------------------------------------------------------------
async function checkMyPassword(req) {
  const pw = typeof req.body.password === 'string' ? req.body.password : '';
  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!pw || !(await bcrypt.compare(pw, rows[0].password_hash))) throw bad('Wrong password', { password: 'Wrong password' });
}

// Set or change the 4-digit owner PIN (asked for on refunds).
router.post('/owner-pin', can('settings.manage'), wrap(async (req, res) => {
  const pin = typeof req.body.pin === 'string' ? req.body.pin : '';
  if (!/^\d{4}$/.test(pin)) throw bad('The PIN is 4 digits', { pin: 'Use exactly 4 digits' });
  await checkMyPassword(req);
  const hash = await bcrypt.hash(pin, 10);
  await query('UPDATE store_settings SET owner_pin_hash=$1, owner_pin_changed_at=now(), updated_at=now() WHERE id=1', [hash]);
  await audit(null, req.user.id, 'settings.owner_pin', 'store', 1);
  res.json({ ok: true });
}));

// Two-step login: only the setting is stored. No SMS or email provider is connected yet,
// so sign-in does not ask for a second code. See README "Limitations".
router.post('/two-step', can('settings.manage'), wrap(async (req, res) => {
  await checkMyPassword(req);
  await query('UPDATE store_settings SET two_step_enabled=$1, updated_at=now() WHERE id=1', [req.body.enabled === true]);
  await audit(null, req.user.id, 'settings.two_step', 'store', 1, { enabled: req.body.enabled === true });
  res.json({ ok: true });
}));

// Signed-in devices for the current user
router.get('/sessions', wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT sid, sess::jsonb AS sess, expire FROM session WHERE (sess::jsonb->>'userId')::int = $1 AND expire > now() ORDER BY expire DESC`, [req.user.id]);
  res.json({
    sessions: rows.map((r) => ({
      id: sidHash(r.sid), current: r.sid === req.sessionID, device: r.sess.device || 'Unknown device', ip: r.sess.ip || null,
      last_seen: r.sess.lastSeen || null,
    })),
  });
}));

router.delete('/sessions/:id', wrap(async (req, res) => {
  const { rows } = await query(`SELECT sid FROM session WHERE (sess::jsonb->>'userId')::int = $1`, [req.user.id]);
  const hit = rows.find((r) => sidHash(r.sid) === req.params.id);
  if (!hit) throw new HttpError(404, 'That device is already signed out');
  if (hit.sid === req.sessionID) throw bad('Use Sign out to leave this device');
  await query('DELETE FROM session WHERE sid = $1', [hit.sid]);
  res.json({ ok: true });
}));

router.post('/sessions/sign-out-others', wrap(async (req, res) => {
  const r = await query(`DELETE FROM session WHERE (sess::jsonb->>'userId')::int = $1 AND sid <> $2`, [req.user.id, req.sessionID]);
  res.json({ ok: true, signed_out: r.rowCount });
}));

module.exports = router;
