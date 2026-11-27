const express = require('express');
const { query, tx } = require('../db');
const { wrap, bad, text, int, money, oneOf } = require('../lib/http');
const { can } = require('../middleware/auth');
const { audit } = require('../lib/audit');
const { loadReceipt } = require('../lib/receipt');

const router = express.Router();
const round2 = (n) => Math.round(n * 100) / 100;

// Customers with utang (credit). Used by the "Utang" payment option.
router.get('/customers', can('pos.sell'), wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase().replace(/[%_]/g, '');
  const { rows } = await query(
    `SELECT id, name, mobile, balance FROM customers
     WHERE ($1 = '' OR lower(name) LIKE '%' || $1 || '%') ORDER BY balance DESC, lower(name) LIMIT 20`, [q]);
  res.json({ customers: rows });
}));

// Checkout. Prices, discount and totals are always worked out here from the database;
// the browser only says WHICH products and HOW MANY.
router.post('/checkout', can('pos.sell'), wrap(async (req, res) => {
  const rawItems = Array.isArray(req.body.items) ? req.body.items : [];
  if (!rawItems.length) throw bad('The order is empty');
  if (rawItems.length > 100) throw bad('Too many different items in one order');

  // merge duplicate lines
  const wanted = new Map();
  for (const it of rawItems) {
    const pid = int(it.product_id, { min: 1, field: 'product_id' });
    const qty = int(it.qty, { min: 1, max: 1000, field: 'qty' });
    wanted.set(pid, (wanted.get(pid) || 0) + qty);
  }
  const method = oneOf(req.body.payment_method, ['cash', 'gcash', 'utang'], { field: 'payment_method' });
  const discountType = req.body.discount_type ? oneOf(req.body.discount_type, ['senior', 'pwd'], { field: 'discount_type' }) : null;

  const sale = await tx(async (c) => {
    const ids = [...wanted.keys()].sort((a, b) => a - b);          // lock in a fixed order: no deadlocks
    const prods = (await c.query(
      `SELECT id, name, description, price, cost, stock_qty, is_active FROM products WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE`, [ids])).rows;
    if (prods.length !== ids.length) throw bad('One of the products no longer exists');

    let subtotal = 0;
    const lines = [];
    for (const p of prods) {
      const qty = wanted.get(p.id);
      if (!p.is_active) throw bad(`${p.name} is not available`);
      if (p.stock_qty < qty) {
        throw bad(p.stock_qty === 0 ? `${p.name} is out of stock` : `Only ${p.stock_qty} of ${p.name} left in stock`);
      }
      subtotal += qty * Number(p.price);
      lines.push({ p, qty });
    }
    subtotal = round2(subtotal);

    const st = (await c.query('SELECT discount_percent FROM store_settings WHERE id = 1')).rows[0];
    const discount = discountType ? round2(subtotal * Number(st.discount_percent) / 100) : 0;
    const total = round2(subtotal - discount);

    let cashReceived = null; let change = null; let customerId = null;
    if (method === 'cash') {
      cashReceived = money(req.body.cash_received, { field: 'cash_received', min: 0 });
      if (cashReceived < total) throw bad('Cash received is less than the total', { cash_received: 'Not enough' });
      change = round2(cashReceived - total);
    } else if (method === 'utang') {
      if (req.body.customer_id) {
        customerId = int(req.body.customer_id, { min: 1, field: 'customer_id' });
        const cu = (await c.query('SELECT id FROM customers WHERE id = $1 FOR UPDATE', [customerId])).rows[0];
        if (!cu) throw bad('Customer not found');
      } else {
        const name = text(req.body.customer_name, { max: 80, required: true, field: 'customer_name' });
        const found = (await c.query('SELECT id FROM customers WHERE lower(name) = lower($1) FOR UPDATE', [name])).rows[0];
        customerId = found
          ? found.id
          : (await c.query('INSERT INTO customers (name, mobile) VALUES ($1, $2) RETURNING id', [name, text(req.body.customer_mobile, { max: 30 }) || null])).rows[0].id;
      }
      await c.query('UPDATE customers SET balance = balance + $1 WHERE id = $2', [total, customerId]);
    }

    const station = req.user.station || 'Register 1';
    const s = (await c.query(
      `INSERT INTO sales (user_id, customer_id, station, payment_method, subtotal, discount, discount_type, total, cash_received, change_given)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, sale_no`,
      [req.user.id, customerId, station, method, subtotal, discount, discountType, total, cashReceived, change])).rows[0];

    for (const { p, qty } of lines) {
      await c.query(
        `INSERT INTO sale_items (sale_id, product_id, product_name, description, qty, unit_price, unit_cost) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [s.id, p.id, p.name, p.description, qty, p.price, p.cost]);
      await c.query('UPDATE products SET stock_qty = stock_qty - $1, updated_at = now() WHERE id = $2', [qty, p.id]);
      await c.query(
        `INSERT INTO stock_movements (product_id, user_id, kind, qty_change, ref_type, ref_id, note) VALUES ($1,$2,'sale',$3,'sale',$4,$5)`,
        [p.id, req.user.id, -qty, s.id, s.sale_no]);
    }
    await audit(c, req.user.id, 'sale.create', 'sale', s.id, { sale_no: s.sale_no, total, method });
    return s;
  });

  res.status(201).json(await loadReceipt(sale.id));
}));

module.exports = router;
