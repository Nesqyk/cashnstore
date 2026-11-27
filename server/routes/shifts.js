const express = require('express');
const { query, tx } = require('../db');
const { wrap, bad, money } = require('../lib/http');
const { can } = require('../middleware/auth');
const { audit } = require('../lib/audit');

const router = express.Router();
router.use(can('pos.sell'));

router.get('/current', wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT id, station, opening_cash, started_at FROM shifts WHERE user_id = $1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`, [req.user.id]);
  res.json({ shift: rows[0] || null });
}));

router.post('/start', wrap(async (req, res) => {
  const opening = money(req.body.opening_cash, { field: 'opening_cash', max: 1000000 });
  const shift = await tx(async (c) => {
    const open = (await c.query('SELECT id FROM shifts WHERE user_id = $1 AND ended_at IS NULL FOR UPDATE', [req.user.id])).rows[0];
    if (open) throw bad('You already have a shift running');
    const r = (await c.query(
      'INSERT INTO shifts (user_id, station, opening_cash) VALUES ($1,$2,$3) RETURNING id, station, opening_cash, started_at',
      [req.user.id, req.user.station || 'Register 1', opening])).rows[0];
    await audit(c, req.user.id, 'shift.start', 'shift', r.id, { opening });
    return r;
  });
  res.status(201).json({ shift });
}));

router.post('/end', wrap(async (req, res) => {
  const closing = money(req.body.closing_cash, { field: 'closing_cash', max: 1000000 });
  const r = await query(
    `UPDATE shifts SET ended_at = now(), closing_cash = $2 WHERE user_id = $1 AND ended_at IS NULL RETURNING id, opening_cash, closing_cash, started_at, ended_at`,
    [req.user.id, closing]);
  if (!r.rows[0]) throw bad('There is no shift to end');
  await audit(null, req.user.id, 'shift.end', 'shift', r.rows[0].id, { closing });
  res.json({ shift: r.rows[0] });
}));

module.exports = router;
