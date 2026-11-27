const express = require('express');
const { query } = require('../db');
const { wrap, toCsv } = require('../lib/http');
const { can } = require('../middleware/auth');

const router = express.Router();

// Items at or below their reorder level, with how fast they sell and a suggested order size.
const ALERTS_SQL = `
  WITH sold AS (
    SELECT si.product_id, sum(si.qty)::numeric / 14 AS per_day
    FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE s.status = 'completed' AND s.created_at >= now() - interval '14 days'
    GROUP BY si.product_id
  ), last_restock AS (
    SELECT DISTINCT ON (product_id) product_id, received_on, quantity, unit_cost
    FROM restocks ORDER BY product_id, received_on DESC, id DESC
  )
  SELECT p.id, p.name, p.description, p.stock_qty, p.reorder_level, p.unit, p.cost, p.price,
         c.name AS category, s.id AS supplier_id, s.name AS supplier,
         CASE WHEN p.stock_qty = 0 THEN 'out' ELSE 'low' END AS stock_status,
         round(COALESCE(sold.per_day, 0), 1) AS per_day,
         CASE WHEN COALESCE(sold.per_day, 0) > 0 THEN floor(p.stock_qty / sold.per_day)::int END AS days_left,
         -- order enough for about a week of selling, and never less than twice the reorder level
         GREATEST(ceil(COALESCE(sold.per_day, 0) * 7)::int - p.stock_qty, p.reorder_level * 2 - p.stock_qty, 1) AS suggested_qty,
         lr.received_on AS last_restocked, lr.unit_cost AS last_unit_cost
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN suppliers s ON s.id = p.supplier_id
  LEFT JOIN sold ON sold.product_id = p.id
  LEFT JOIN last_restock lr ON lr.product_id = p.id
  WHERE p.is_active AND p.stock_qty <= p.reorder_level`;

router.get('/alerts', can('inventory.view'), wrap(async (req, res) => {
  const status = req.query.status;
  const filter = status === 'out' ? `AND p.stock_qty = 0` : status === 'low' ? `AND p.stock_qty > 0` : '';
  const { rows } = await query(`${ALERTS_SQL} ${filter} ORDER BY (p.stock_qty = 0) DESC, days_left NULLS LAST, lower(p.name)`);
  const sum = await query(
    `SELECT count(*) FILTER (WHERE stock_qty = 0)::int AS out,
            count(*) FILTER (WHERE stock_qty > 0 AND stock_qty <= reorder_level)::int AS low,
            count(*)::int AS total,
            COALESCE(sum(stock_qty * cost), 0) AS stock_value
     FROM products WHERE is_active`);
  res.json({ items: rows, summary: sum.rows[0] });
}));

router.get('/analytics', can('analytics.store'), wrap(async (req, res) => {
  const { rows } = await query('SELECT analytics_inventory() AS data');
  res.json(rows[0].data);
}));

// Restock order grouped by supplier, as CSV the owner can send or print.
router.get('/restock-order.csv', can('inventory.restock'), wrap(async (req, res) => {
  const { rows } = await query(`${ALERTS_SQL} ORDER BY s.name NULLS LAST, lower(p.name)`);
  const csv = toCsv(
    ['Supplier', 'Product', 'Description', 'In stock', 'Reorder level', 'Suggested qty', 'Last unit cost'],
    rows.map((r) => [r.supplier || 'No supplier', r.name, r.description, r.stock_qty, r.reorder_level, r.suggested_qty, r.last_unit_cost ?? r.cost])
  );
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="restock-order.csv"' });
  res.send(csv);
}));

router.get('/restocks', can('inventory.view'), wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT r.id, r.quantity, r.unit_cost, r.quantity * r.unit_cost AS total_cost, r.invoice_no, r.received_on,
            p.id AS product_id, p.name AS product, s.name AS supplier, u.full_name AS by
     FROM restocks r JOIN products p ON p.id = r.product_id
     LEFT JOIN suppliers s ON s.id = r.supplier_id LEFT JOIN users u ON u.id = r.user_id
     ORDER BY r.received_on DESC, r.id DESC LIMIT 20`);
  res.json({ restocks: rows });
}));

module.exports = router;
