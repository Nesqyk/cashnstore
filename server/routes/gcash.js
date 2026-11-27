const express = require('express');
const { query, tx } = require('../db');
const { wrap, bad, notFound, text, money, oneOf, paging } = require('../lib/http');
const { can } = require('../middleware/auth');
const { audit } = require('../lib/audit');
const { calcFee, effects } = require('../lib/gcash');

const router = express.Router();

async function settings(runner = { query }) {
  return (await runner.query('SELECT gcash_fee_percent, gcash_min_fee, gcash_min_float, gcash_target_float FROM store_settings WHERE id = 1')).rows[0];
}

router.get('/summary', can('gcash.view'), wrap(async (req, res) => {
  const [st, bal, today] = await Promise.all([
    settings(),
    query('SELECT gcash_float() AS gcash_float, drawer_cash() AS drawer_cash'),
    query(
      `SELECT COALESCE(sum(amount) FILTER (WHERE type = 'cash_in'), 0) AS cash_in,
              COALESCE(sum(amount) FILTER (WHERE type = 'cash_out'), 0) AS cash_out,
              count(*) FILTER (WHERE type = 'cash_in')::int AS cash_in_count,
              count(*) FILTER (WHERE type = 'cash_out')::int AS cash_out_count,
              COALESCE(sum(fee), 0) AS fees
       FROM gcash_transactions
       WHERE status = 'completed' AND (created_at AT TIME ZONE store_tz())::date = store_today()`),
  ]);
  const f = Number(bal.rows[0].gcash_float);
  res.json({
    gcash_float: f, drawer_cash: Number(bal.rows[0].drawer_cash),
    min_float: Number(st.gcash_min_float), target_float: Number(st.gcash_target_float),
    float_status: f < Number(st.gcash_min_float) ? 'low' : 'ok',
    fee_percent: Number(st.gcash_fee_percent), min_fee: Number(st.gcash_min_fee),
    today: today.rows[0],
  });
}));

router.get('/analytics', can('gcash.view'), wrap(async (req, res) => {
  const { rows } = await query('SELECT analytics_gcash() AS data');
  res.json(rows[0].data);
}));

router.get('/', can('gcash.view'), wrap(async (req, res) => {
  const { size, page, offset } = paging(req.query, 10);
  const where = []; const params = [];
  const add = (v) => { params.push(v); return `$${params.length}`; };
  if (req.query.type) where.push(`g.type = ${add(oneOf(req.query.type, ['cash_in', 'cash_out'], { field: 'type' }))}`);
  const period = req.query.period || 'week';
  if (period !== 'all') {
    oneOf(period, ['today', 'week', 'month', '30d'], { field: 'period' });
    const n = add(period);
    where.push(`(g.created_at AT TIME ZONE store_tz())::date BETWEEN (SELECT d_from FROM period_range(${n})) AND (SELECT d_to FROM period_range(${n}))`);
  }
  if (req.query.q) {
    const n = add(`%${String(req.query.q).trim().toLowerCase().replace(/[%_]/g, '')}%`);
    where.push(`(lower(g.gc_no) LIKE ${n} OR lower(g.customer_name) LIKE ${n} OR lower(COALESCE(g.reference, '')) LIKE ${n} OR COALESCE(g.gcash_number, '') LIKE ${n})`);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows, sum] = await Promise.all([
    query(
      `SELECT g.id, g.gc_no, g.type, g.customer_name, g.gcash_number, g.amount, g.fee, g.fee_mode, g.reference, g.status, g.created_at,
              u.full_name AS cashier, u.avatar_key AS cashier_avatar
       FROM gcash_transactions g JOIN users u ON u.id = g.user_id ${w}
       ORDER BY g.created_at DESC, g.id DESC LIMIT ${size} OFFSET ${offset}`, params),
    query(
      `SELECT count(*)::int AS n, COALESCE(sum(amount), 0) AS amount, COALESCE(sum(fee), 0) AS fees
       FROM gcash_transactions g ${w}`, params),
  ]);
  res.json({ transactions: rows.rows, total: sum.rows[0].n, sum_amount: sum.rows[0].amount, sum_fees: sum.rows[0].fees, page, size });
}));

// Preview a transaction before saving it.
router.get('/quote', can('gcash.transact'), wrap(async (req, res) => {
  const type = oneOf(req.query.type, ['cash_in', 'cash_out'], { field: 'type' });
  const amount = money(req.query.amount, { min: 1, max: 50000, field: 'amount' });
  const feeMode = type === 'cash_out' ? oneOf(req.query.fee_mode, ['deduct', 'separate'], { field: 'fee_mode', fallback: 'deduct' }) : null;
  const st = await settings();
  const fee = calcFee(amount, st);
  const bal = (await query('SELECT gcash_float() AS f, drawer_cash() AS d')).rows[0];
  const e = effects(type, amount, fee, feeMode);
  res.json({
    fee, ...e,
    float_after: Number(bal.f) + e.float_change, drawer_after: Number(bal.d) + e.drawer_change,
    float_before: Number(bal.f), drawer_before: Number(bal.d),
    float_low_after: Number(bal.f) + e.float_change < Number(st.gcash_min_float),
  });
}));

router.get('/:id(\\d+)', can('gcash.view'), wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT g.id, g.gc_no, g.type, g.customer_name, g.gcash_number, g.amount, g.fee, g.fee_mode, g.reference, g.status, g.station, g.created_at,
            u.id AS cashier_id, u.full_name AS cashier, u.avatar_key AS cashier_avatar
     FROM gcash_transactions g JOIN users u ON u.id = g.user_id WHERE g.id = $1`, [parseInt(req.params.id, 10)]);
  const t = rows[0];
  if (!t) throw notFound('Transaction not found');
  res.json({ transaction: t, effects: effects(t.type, Number(t.amount), Number(t.fee), t.fee_mode) });
}));

router.post('/', can('gcash.transact'), wrap(async (req, res) => {
  const type = oneOf(req.body.type, ['cash_in', 'cash_out'], { field: 'type' });
  const amount = money(req.body.amount, { min: 1, max: 50000, field: 'amount' });
  const customer = text(req.body.customer_name, { max: 80, required: true, field: 'customer_name' });
  const number = text(req.body.gcash_number, { max: 20 }).replace(/[\s-]/g, '');
  if (number && !/^(\+?63|0)?9\d{9}$/.test(number)) throw bad('Enter a valid mobile number', { gcash_number: 'Use an 11-digit mobile number' });
  const reference = text(req.body.reference, { max: 40 }) || null;
  const feeMode = type === 'cash_out' ? oneOf(req.body.fee_mode, ['deduct', 'separate'], { field: 'fee_mode', fallback: 'deduct' }) : null;

  const created = await tx(async (c) => {
    // Serialise GCash postings so two cashiers cannot both spend the last of the float.
    await c.query('SELECT pg_advisory_xact_lock(7001)');
    const st = await settings(c);
    const fee = calcFee(amount, st);
    const e = effects(type, amount, fee, feeMode);
    const bal = (await c.query('SELECT gcash_float() AS f, drawer_cash() AS d')).rows[0];

    if (type === 'cash_in' && Number(bal.f) < amount) {
      throw bad(`Not enough GCash float. Only ₱${Number(bal.f).toLocaleString('en-PH')} available.`, { amount: 'More than the GCash float' });
    }
    if (type === 'cash_out' && Number(bal.d) < e.cash_to_customer) {
      throw bad(`Not enough cash in the drawer. Only ₱${Number(bal.d).toLocaleString('en-PH')} available.`, { amount: 'More than the cash in the drawer' });
    }
    const r = (await c.query(
      `INSERT INTO gcash_transactions (type, customer_name, gcash_number, amount, fee, fee_mode, reference, user_id, station)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, gc_no`,
      [type, customer, number || null, amount, fee, feeMode, reference, req.user.id, req.user.station || 'Register 1'])).rows[0];
    await audit(c, req.user.id, 'gcash.' + type, 'gcash', r.id, { gc_no: r.gc_no, amount, fee });
    return { ...r, fee, effects: e };
  });
  res.status(201).json(created);
}));

module.exports = router;
