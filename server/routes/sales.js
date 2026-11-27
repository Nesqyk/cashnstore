const express = require('express');
const bcrypt = require('bcryptjs');
const { query, tx } = require('../db');
const { wrap, bad, notFound, text, paging, oneOf, toCsv } = require('../lib/http');
const { can, hasPerm } = require('../middleware/auth');
const { audit } = require('../lib/audit');
const { loadReceipt } = require('../lib/receipt');

const router = express.Router();

// Build the WHERE clause for the sales list. Cashiers only ever see their own sales.
function salesFilter(req) {
  const where = []; const params = [];
  const add = (v) => { params.push(v); return `$${params.length}`; };
  if (!hasPerm(req, 'sales.view_all')) where.push(`s.user_id = ${add(req.user.id)}`);
  else if (req.query.user) where.push(`s.user_id = ${add(parseInt(req.query.user, 10) || 0)}`);

  const period = req.query.period || 'week';
  if (period !== 'all') {
    oneOf(period, ['today', 'week', 'month', '30d'], { field: 'period' });
    const n = add(period);
    where.push(`(s.created_at AT TIME ZONE store_tz())::date BETWEEN (SELECT d_from FROM period_range(${n})) AND (SELECT d_to FROM period_range(${n}))`);
  }
  if (req.query.method) where.push(`s.payment_method = ${add(oneOf(req.query.method, ['cash', 'gcash', 'utang'], { field: 'method' }))}`);
  if (req.query.status) where.push(`s.status = ${add(oneOf(req.query.status, ['completed', 'refunded'], { field: 'status' }))}`);
  if (req.query.q) {
    const like = `%${String(req.query.q).trim().toLowerCase().replace(/[%_]/g, '')}%`;
    const n = add(like);
    where.push(`(lower(s.sale_no) LIKE ${n} OR lower(COALESCE(cu.name, '')) LIKE ${n}
                 OR EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND lower(si.product_name) LIKE ${n}))`);
  }
  return { w: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

const FROM = `FROM sales s JOIN users u ON u.id = s.user_id LEFT JOIN customers cu ON cu.id = s.customer_id`;

router.get('/', can('sales.view_own', 'sales.view_all'), wrap(async (req, res) => {
  const { size, page, offset } = paging(req.query, 10);
  const { w, params } = salesFilter(req);
  const [rows, sum] = await Promise.all([
    query(
      `SELECT s.id, s.sale_no, s.payment_method, s.total, s.discount, s.status, s.created_at,
              u.id AS cashier_id, u.full_name AS cashier, u.avatar_key AS cashier_avatar, cu.name AS customer,
              (SELECT count(*)::int FROM sale_items si WHERE si.sale_id = s.id) AS item_count,
              (SELECT string_agg(si.product_name, ', ' ORDER BY si.id) FROM (SELECT * FROM sale_items WHERE sale_id = s.id ORDER BY id LIMIT 2) si) AS preview
       ${FROM} ${w} ORDER BY s.created_at DESC, s.id DESC LIMIT ${size} OFFSET ${offset}`, params),
    query(
      `SELECT count(*)::int AS n,
              COALESCE(sum(s.total) FILTER (WHERE s.status = 'completed'), 0) AS total,
              count(*) FILTER (WHERE s.status = 'refunded')::int AS refunded
       ${FROM} ${w}`, params),
  ]);
  res.json({ sales: rows.rows, total: sum.rows[0].n, sum_total: sum.rows[0].total, refunded: sum.rows[0].refunded, page, size });
}));

router.get('/analytics', can('sales.view_own', 'sales.view_all'), wrap(async (req, res) => {
  const forUser = hasPerm(req, 'sales.view_all') ? null : req.user.id;
  const { rows } = await query('SELECT analytics_sales_today($1) AS data', [forUser]);
  res.json({ ...rows[0].data, scope: forUser ? 'own' : 'store' });
}));

router.get('/export.csv', can('sales.view_all'), wrap(async (req, res) => {
  const { w, params } = salesFilter(req);
  const { rows } = await query(
    `SELECT s.sale_no, s.created_at, u.full_name AS cashier, s.payment_method, cu.name AS customer, s.subtotal, s.discount, s.total, s.status
     ${FROM} ${w} ORDER BY s.created_at DESC LIMIT 5000`, params);
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="sales.csv"' });
  res.send(toCsv(['Sale', 'Date', 'Cashier', 'Payment', 'Customer', 'Subtotal', 'Discount', 'Total', 'Status'],
    rows.map((r) => [r.sale_no, r.created_at, r.cashier, r.payment_method, r.customer, r.subtotal, r.discount, r.total, r.status])));
}));

router.get('/:id(\\d+)', can('sales.view_own', 'sales.view_all'), wrap(async (req, res) => {
  const data = await loadReceipt(parseInt(req.params.id, 10));
  // A cashier asking for someone else's sale gets the same "not found" as a missing one.
  if (!data || (!hasPerm(req, 'sales.view_all') && data.sale.cashier_id !== req.user.id)) throw notFound('Sale not found');
  data.can_refund = hasPerm(req, 'sales.refund') && data.sale.status === 'completed';
  res.json(data);
}));

// Refund a whole sale: needs the permission, and the owner PIN when one is set.
router.post('/:id(\\d+)/refund', can('sales.refund'), wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const reason = text(req.body.reason, { max: 200, required: true, field: 'reason' });
  const pin = typeof req.body.pin === 'string' ? req.body.pin : '';

  const st = (await query('SELECT owner_pin_hash FROM store_settings WHERE id = 1')).rows[0];
  if (st.owner_pin_hash) {
    if (!/^\d{4}$/.test(pin) || !(await bcrypt.compare(pin, st.owner_pin_hash))) {
      throw bad('Wrong owner PIN', { pin: 'Wrong PIN' });
    }
  }

  await tx(async (c) => {
    const s = (await c.query('SELECT id, sale_no, status, payment_method, total, customer_id FROM sales WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!s) throw notFound('Sale not found');
    if (s.status === 'refunded') throw bad('This sale was already refunded');

    await c.query(
      `UPDATE sales SET status = 'refunded', refunded_by = $1, refunded_at = now(), refund_reason = $2 WHERE id = $3`,
      [req.user.id, reason, id]);

    const items = (await c.query('SELECT product_id, qty FROM sale_items WHERE sale_id = $1 AND product_id IS NOT NULL ORDER BY product_id', [id])).rows;
    for (const it of items) {
      await c.query('UPDATE products SET stock_qty = stock_qty + $1, updated_at = now() WHERE id = $2', [it.qty, it.product_id]);
      await c.query(
        `INSERT INTO stock_movements (product_id, user_id, kind, qty_change, ref_type, ref_id, note) VALUES ($1,$2,'refund',$3,'sale',$4,$5)`,
        [it.product_id, req.user.id, it.qty, id, `Refund of ${s.sale_no}`]);
    }
    // A refunded utang sale no longer counts as money the customer owes.
    if (s.payment_method === 'utang' && s.customer_id) {
      await c.query('UPDATE customers SET balance = GREATEST(balance - $1, 0) WHERE id = $2', [s.total, s.customer_id]);
    }
    await audit(c, req.user.id, 'sale.refund', 'sale', id, { sale_no: s.sale_no, total: s.total, reason });
  });
  res.json({ ok: true });
}));

module.exports = router;
