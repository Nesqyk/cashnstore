const express = require('express');
const { query } = require('../db');
const { wrap, oneOf } = require('../lib/http');
const { requireAuth, can, hasPerm } = require('../middleware/auth');

const router = express.Router();

// Owner gets the store-wide dashboard; cashiers get their own shift.
router.get('/', requireAuth, wrap(async (req, res) => {
  if (hasPerm(req, 'analytics.store')) {
    const { rows } = await query('SELECT dashboard_owner() AS data');
    return res.json({ kind: 'owner', data: rows[0].data });
  }
  const { rows } = await query('SELECT dashboard_cashier($1) AS data', [req.user.id]);
  res.json({ kind: 'cashier', data: rows[0].data });
}));

// Analytics section on the owner dashboard (7 or 30 days)
router.get('/analytics', can('analytics.store'), wrap(async (req, res) => {
  const days = Number(oneOf(String(req.query.days || '7'), ['7', '14', '30'], { field: 'days' }));
  const { rows } = await query('SELECT analytics_overview($1) AS data', [days]);
  res.json(rows[0].data);
}));

module.exports = router;
