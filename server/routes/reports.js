const express = require('express');
const { query } = require('../db');
const { wrap, oneOf, toCsv } = require('../lib/http');
const { can } = require('../middleware/auth');

const router = express.Router();
router.use(can('reports.view'));

const period = (req) => oneOf(req.query.period || '30d', ['today', 'week', 'month', '30d'], { field: 'period' });
const PERIOD_W = (col) => `(${col} AT TIME ZONE store_tz())::date BETWEEN (SELECT d_from FROM period_range($1)) AND (SELECT d_to FROM period_range($1))`;
const csv = (res, name, headers, rows) => {
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.csv"` });
  res.send(toCsv(headers, rows));
};

router.get('/overview', wrap(async (req, res) => res.json((await query('SELECT report_overview() AS d')).rows[0].d)));
router.get('/sales', wrap(async (req, res) => res.json((await query('SELECT report_sales($1) AS d', [period(req)])).rows[0].d)));
router.get('/inventory', wrap(async (req, res) => res.json((await query('SELECT report_inventory() AS d')).rows[0].d)));
router.get('/gcash', wrap(async (req, res) => res.json((await query('SELECT report_gcash($1) AS d', [period(req)])).rows[0].d)));

router.get('/sales.csv', wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT s.sale_no, s.created_at, u.full_name, s.payment_method, s.subtotal, s.discount, s.total, s.status
     FROM sales s JOIN users u ON u.id = s.user_id WHERE ${PERIOD_W('s.created_at')} ORDER BY s.created_at`, [period(req)]);
  csv(res, 'sales-report', ['Sale', 'Date', 'Cashier', 'Payment', 'Subtotal', 'Discount', 'Total', 'Status'],
    rows.map((r) => [r.sale_no, r.created_at, r.full_name, r.payment_method, r.subtotal, r.discount, r.total, r.status]));
}));

router.get('/inventory.csv', wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT p.name, p.description, c.name AS category, p.stock_qty, p.reorder_level, p.cost, p.price, p.stock_qty * p.cost AS value
     FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.is_active ORDER BY lower(p.name)`);
  csv(res, 'inventory-report', ['Product', 'Description', 'Category', 'In stock', 'Reorder level', 'Cost', 'Price', 'Stock value'],
    rows.map((r) => [r.name, r.description, r.category, r.stock_qty, r.reorder_level, r.cost, r.price, r.value]));
}));

router.get('/gcash.csv', wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT g.gc_no, g.created_at, g.type, g.customer_name, g.gcash_number, g.amount, g.fee, g.reference, u.full_name
     FROM gcash_transactions g JOIN users u ON u.id = g.user_id WHERE ${PERIOD_W('g.created_at')} ORDER BY g.created_at`, [period(req)]);
  csv(res, 'gcash-report', ['Transaction', 'Date', 'Type', 'Customer', 'GCash number', 'Amount', 'Fee', 'Reference', 'Cashier'],
    rows.map((r) => [r.gc_no, r.created_at, r.type, r.customer_name, r.gcash_number, r.amount, r.fee, r.reference, r.full_name]));
}));

module.exports = router;
