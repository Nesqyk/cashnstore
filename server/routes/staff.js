const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { query, tx } = require('../db');
const { wrap, bad, notFound, text, email, int, money, checkPassword, username } = require('../lib/http');
const { can } = require('../middleware/auth');
const { audit } = require('../lib/audit');
const { revokeSessions } = require('../lib/users');
const { deliverResetCode } = require('../lib/mailer');

const router = express.Router();
router.use(can('staff.manage'));

const AVATAR_RE = /^[a-z0-9_-]{1,30}$/;
const avatar = (v) => {
  const s = text(v, { max: 30 });
  if (s && !AVATAR_RE.test(s)) throw bad('Pick an avatar from the list');
  return s || null;
};

// Staff = everyone who is not the owner.
const LIST_SQL = `
  SELECT u.id, u.username, u.full_name, u.email, u.mobile, u.avatar_key, u.job_title, u.station, u.daily_goal,
         u.is_active, u.last_login_at, u.created_at,
         COALESCE(t.total, 0) AS sales_today, COALESCE(t.n, 0)::int AS sales_count_today,
         EXISTS (SELECT 1 FROM shifts sh WHERE sh.user_id = u.id AND sh.ended_at IS NULL) AS on_shift,
         COALESCE((SELECT json_agg(json_build_object('weekday', ss.weekday, 'shift', ss.shift) ORDER BY ss.weekday, ss.shift)
                   FROM staff_schedule ss WHERE ss.user_id = u.id), '[]'::json) AS schedule
  FROM users u JOIN roles r ON r.id = u.role_id
  LEFT JOIN LATERAL (
    SELECT sum(s.total) AS total, count(*) AS n FROM sales s
    WHERE s.user_id = u.id AND s.status = 'completed' AND (s.created_at AT TIME ZONE store_tz())::date = store_today()
  ) t ON true
  WHERE r.code <> 'owner'`;

router.get('/', wrap(async (req, res) => {
  const params = []; let extra = '';
  if (req.query.q) {
    params.push(`%${String(req.query.q).trim().toLowerCase().replace(/[%_]/g, '')}%`);
    extra = ` AND (lower(u.full_name) LIKE $1 OR lower(u.username) LIKE $1)`;
  }
  const { rows } = await query(`${LIST_SQL}${extra} ORDER BY u.is_active DESC, lower(u.full_name)`, params);
  res.json({ staff: rows, counts: { total: rows.length, active: rows.filter((r) => r.is_active).length } });
}));

router.get('/analytics', wrap(async (req, res) => {
  const { rows } = await query('SELECT analytics_staff() AS data');
  res.json(rows[0].data);
}));

router.get('/:id(\\d+)', wrap(async (req, res) => {
  const { rows } = await query(`${LIST_SQL} AND u.id = $1`, [parseInt(req.params.id, 10)]);
  if (!rows[0]) throw notFound('Staff member not found');
  res.json({ staff: rows[0] });
}));

router.post('/', wrap(async (req, res) => {
  const d = {
    username: username(req.body.username),
    full_name: text(req.body.full_name, { max: 100, required: true, field: 'full_name' }),
    email: email(req.body.email),
    mobile: text(req.body.mobile, { max: 30 }) || null,
    job_title: text(req.body.job_title, { max: 60 }) || 'Cashier',
    station: text(req.body.station, { max: 30 }) || 'Register 1',
    avatar_key: avatar(req.body.avatar_key),
    daily_goal: money(req.body.daily_goal, { field: 'daily_goal', required: false, max: 1000000 }) ?? 7000,
  };
  const password = checkPassword(req.body.password, { field: 'password' });
  if (req.body.confirm !== undefined && req.body.confirm !== req.body.password) throw bad('Passwords do not match', { confirm: 'Does not match' });
  const mustChange = req.body.must_change_password !== false;
  const hash = await bcrypt.hash(password, 10);
  try {
    const id = await tx(async (c) => {
      const role = (await c.query(`SELECT id FROM roles WHERE code = 'cashier'`)).rows[0];
      const r = (await c.query(
        `INSERT INTO users (username, full_name, email, mobile, password_hash, role_id, job_title, station, avatar_key, daily_goal, must_change_password, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [d.username, d.full_name, d.email, d.mobile, hash, role.id, d.job_title, d.station, d.avatar_key, d.daily_goal, mustChange, req.user.id])).rows[0];
      await audit(c, req.user.id, 'staff.create', 'user', r.id, { username: d.username });
      return r.id;
    });
    res.status(201).json({ id });
  } catch (err) {
    if (err.code === '23505') {
      const f = /email/.test(err.constraint || '') ? 'email' : 'username';
      throw bad(`That ${f} is already used`, { [f]: 'Already used' });
    }
    throw err;
  }
}));

async function mustBeStaff(client, id) {
  const u = (await client.query(
    `SELECT u.id, u.full_name, u.email, u.username, r.code AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`, [id])).rows[0];
  if (!u || u.role === 'owner') throw notFound('Staff member not found');
  return u;
}

router.put('/:id(\\d+)', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const d = {
    full_name: text(req.body.full_name, { max: 100, required: true, field: 'full_name' }),
    email: email(req.body.email),
    mobile: text(req.body.mobile, { max: 30 }) || null,
    job_title: text(req.body.job_title, { max: 60 }) || 'Cashier',
    station: text(req.body.station, { max: 30 }) || 'Register 1',
    avatar_key: avatar(req.body.avatar_key),
    daily_goal: money(req.body.daily_goal, { field: 'daily_goal', required: false, max: 1000000 }) ?? 7000,
  };
  const active = typeof req.body.is_active === 'boolean' ? req.body.is_active : undefined;
  try {
    await tx(async (c) => {
      await mustBeStaff(c, id);
      await c.query(
        `UPDATE users SET full_name=$1, email=$2, mobile=$3, job_title=$4, station=$5, avatar_key=$6, daily_goal=$7,
                is_active = COALESCE($8, is_active), updated_at = now() WHERE id = $9`,
        [d.full_name, d.email, d.mobile, d.job_title, d.station, d.avatar_key, d.daily_goal, active ?? null, id]);
      if (active === false) await revokeSessions(c, id);       // switching "Can log in" off signs them out now
      await audit(c, req.user.id, active === false ? 'staff.deactivate' : 'staff.update', 'user', id);
    });
  } catch (err) {
    if (err.code === '23505') throw bad('That email is already used', { email: 'Already used' });
    throw err;
  }
  res.json({ ok: true });
}));

// "Send reset link": we email a 6-digit code the person can enter on the Forgot password screen.
router.post('/:id(\\d+)/send-reset', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const u = await mustBeStaff({ query }, id);
  if (!u.email) throw bad('Add an email address for this person first', { email: 'Needed to send a reset' });
  const code = String(crypto.randomInt(100000, 1000000));
  const hash = await bcrypt.hash(code, 10);
  await tx(async (c) => {
    await c.query('UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [id]);
    await c.query(`INSERT INTO password_resets (user_id, code_hash, expires_at) VALUES ($1,$2, now() + interval '15 minutes')`, [id, hash]);
    await audit(c, req.user.id, 'staff.send_reset', 'user', id);
  });
  await deliverResetCode(u, code);
  res.json({ ok: true, sent_to: u.email });
}));

// "Create temporary PIN": a one-time password the owner reads out; they must change it at next sign-in.
router.post('/:id(\\d+)/temp-password', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let temp = 'A' + '7';
  for (let i = 0; i < 6; i += 1) temp += alphabet[crypto.randomInt(alphabet.length)];
  const hash = await bcrypt.hash(temp, 10);
  await tx(async (c) => {
    await mustBeStaff(c, id);
    await c.query('UPDATE users SET password_hash=$1, must_change_password=true, password_changed_at=now(), updated_at=now() WHERE id=$2', [hash, id]);
    await revokeSessions(c, id);
    await audit(c, req.user.id, 'staff.temp_password', 'user', id);
  });
  res.json({ temporary_password: temp });
}));

module.exports = router;
