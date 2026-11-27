const express = require('express');
const { query, tx } = require('../db');
const { wrap, bad, notFound, text, money, int, paging } = require('../lib/http');
const { can } = require('../middleware/auth');
const { audit } = require('../lib/audit');

const router = express.Router();

const STATUS_SQL = `CASE WHEN p.stock_qty = 0 THEN 'out' WHEN p.stock_qty <= p.reorder_level THEN 'low' ELSE 'ok' END`;

const LIST_COLS = `p.id, p.name, p.description, p.barcode, p.price, p.cost, p.stock_qty, p.reorder_level, p.unit,
  p.image_url, p.is_active, p.category_id, c.name AS category, p.supplier_id, s.name AS supplier, ${STATUS_SQL} AS stock_status`;

function readBody(body, { partial = false } = {}) {
  const out = {};
  out.name = text(body.name, { max: 120, required: true, field: 'name' });
  out.description = text(body.description, { max: 160 });
  out.barcode = text(body.barcode, { max: 60 }) || null;
  out.category_id = body.category_id ? int(body.category_id, { min: 1, field: 'category_id' }) : null;
  out.supplier_id = body.supplier_id ? int(body.supplier_id, { min: 1, field: 'supplier_id' }) : null;
  out.price = money(body.price, { field: 'price', max: 1000000 });
  out.cost = money(body.cost, { field: 'cost', required: false, max: 1000000 }) ?? 0;
  out.reorder_level = int(body.reorder_level, { min: 0, max: 100000, field: 'reorder_level', required: false }) ?? 5;
  out.unit = text(body.unit, { max: 20 }) || 'pcs';
  out.image_url = text(body.image_url, { max: 500 }) || null;
  if (out.image_url && !/^(https?:\/\/|\/)/i.test(out.image_url)) {
    throw bad('Photo link must start with http or /', { image_url: 'Use a web link' });
  }
  if (!partial) out.stock_qty = int(body.stock_qty, { min: 0, max: 1000000, field: 'stock_qty', required: false }) ?? 0;
  return out;
}

// ---- list for the Products screen ---------------------------------------------------------
router.get('/', can('products.view'), wrap(async (req, res) => {
  const { size, page, offset } = paging(req.query, 12);
  const where = []; const params = [];
  const add = (v) => { params.push(v); return `$${params.length}`; };

  const status = req.query.status || 'active';
  if (status === 'active') where.push('p.is_active');
  else if (status === 'archived') where.push('NOT p.is_active');
  else if (status === 'low') where.push(`p.is_active AND p.stock_qty > 0 AND p.stock_qty <= p.reorder_level`);
  else if (status === 'out') where.push(`p.is_active AND p.stock_qty = 0`);
  if (req.query.category) where.push(`p.category_id = ${add(parseInt(req.query.category, 10) || 0)}`);
  if (req.query.q) {
    const like = `%${String(req.query.q).trim().toLowerCase().replace(/[%_]/g, '')}%`;
    const n = add(like);
    where.push(`(lower(p.name) LIKE ${n} OR lower(p.description) LIKE ${n} OR p.barcode LIKE ${n})`);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sorts = {
    name: 'lower(p.name)', price: 'p.price DESC', stock: 'p.stock_qty ASC, lower(p.name)', newest: 'p.id DESC',
  };
  const order = sorts[req.query.sort] || sorts.name;

  const [rows, count, counts] = await Promise.all([
    query(
      `SELECT ${LIST_COLS} FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN suppliers s ON s.id = p.supplier_id
       ${w} ORDER BY ${order} LIMIT ${size} OFFSET ${offset}`, params),
    query(`SELECT count(*)::int AS n FROM products p ${w}`, params),
    query(`SELECT count(*) FILTER (WHERE is_active)::int AS active,
                  count(*) FILTER (WHERE is_active AND stock_qty > 0 AND stock_qty <= reorder_level)::int AS low,
                  count(*) FILTER (WHERE is_active AND stock_qty = 0)::int AS out,
                  count(*) FILTER (WHERE NOT is_active)::int AS archived FROM products`),
  ]);
  res.json({ products: rows.rows, total: count.rows[0].n, page, size, counts: counts.rows[0] });
}));

// Everything the register needs in one call (active products only).
router.get('/pos', can('pos.sell'), wrap(async (req, res) => {
  const [products, categories, st] = await Promise.all([
    query(`SELECT p.id, p.name, p.description, p.price, p.stock_qty, p.reorder_level, p.unit, p.image_url, p.barcode,
                  p.category_id, c.name AS category, ${STATUS_SQL} AS stock_status
           FROM products p LEFT JOIN categories c ON c.id = p.category_id
           WHERE p.is_active ORDER BY lower(p.name)`),
    query('SELECT id, name FROM categories ORDER BY sort_order, name'),
    query('SELECT discount_percent FROM store_settings WHERE id = 1'),
  ]);
  res.json({ products: products.rows, categories: categories.rows, discount_percent: st.rows[0].discount_percent });
}));

router.get('/analytics', can('analytics.store'), wrap(async (req, res) => {
  const { rows } = await query('SELECT analytics_products() AS data');
  res.json(rows[0].data);
}));

router.get('/barcode/:code', can('products.view', 'pos.sell'), wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT ${LIST_COLS} FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN suppliers s ON s.id = p.supplier_id
     WHERE p.barcode = $1 AND p.is_active`, [String(req.params.code)]);
  if (!rows[0]) throw notFound('No product has that barcode');
  res.json({ product: rows[0] });
}));

router.get('/:id(\\d+)', can('products.view'), wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { rows } = await query(
    `SELECT ${LIST_COLS}, p.created_at, p.updated_at FROM products p LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.id = $1`, [id]);
  if (!rows[0]) throw notFound('Product not found');
  const [moves, sold] = await Promise.all([
    query(
      `SELECT m.id, m.kind, m.qty_change, m.note, m.created_at, u.full_name AS by
       FROM stock_movements m LEFT JOIN users u ON u.id = m.user_id
       WHERE m.product_id = $1 ORDER BY m.created_at DESC, m.id DESC LIMIT 10`, [id]),
    query(
      `SELECT COALESCE(sum(si.qty), 0)::int AS qty_30d, COALESCE(sum(si.line_total), 0) AS revenue_30d
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE si.product_id = $1 AND s.status = 'completed' AND s.created_at >= now() - interval '30 days'`, [id]),
  ]);
  res.json({ product: rows[0], movements: moves.rows, sold_30d: sold.rows[0] });
}));

// ---- create / edit / archive ---------------------------------------------------------------
router.post('/', can('products.manage'), wrap(async (req, res) => {
  const d = readBody(req.body);
  const product = await tx(async (c) => {
    let row;
    try {
      row = (await c.query(
        `INSERT INTO products (name, description, barcode, category_id, supplier_id, price, cost, stock_qty, reorder_level, unit, image_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [d.name, d.description, d.barcode, d.category_id, d.supplier_id, d.price, d.cost, d.stock_qty, d.reorder_level, d.unit, d.image_url]
      )).rows[0];
    } catch (err) {
      if (err.code === '23505') throw bad('That barcode is already used by another product', { barcode: 'Already used' });
      if (err.code === '23503') throw bad('Pick a valid category or supplier');
      throw err;
    }
    if (d.stock_qty > 0) {
      await c.query(
        `INSERT INTO stock_movements (product_id, user_id, kind, qty_change, ref_type, note) VALUES ($1,$2,'adjustment',$3,'product','Starting stock')`,
        [row.id, req.user.id, d.stock_qty]);
    }
    await audit(c, req.user.id, 'product.create', 'product', row.id, { name: d.name });
    return row;
  });
  res.status(201).json({ id: product.id });
}));

router.put('/:id(\\d+)', can('products.manage'), wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const d = readBody(req.body, { partial: true });
  try {
    const { rowCount } = await query(
      `UPDATE products SET name=$1, description=$2, barcode=$3, category_id=$4, supplier_id=$5, price=$6, cost=$7,
              reorder_level=$8, unit=$9, image_url=$10, updated_at=now() WHERE id=$11`,
      [d.name, d.description, d.barcode, d.category_id, d.supplier_id, d.price, d.cost, d.reorder_level, d.unit, d.image_url, id]);
    if (!rowCount) throw notFound('Product not found');
  } catch (err) {
    if (err.code === '23505') throw bad('That barcode is already used by another product', { barcode: 'Already used' });
    if (err.code === '23503') throw bad('Pick a valid category or supplier');
    throw err;
  }
  await audit(null, req.user.id, 'product.update', 'product', id, { name: d.name });
  res.json({ ok: true });
}));

// Archive / restore. Products with sales history are never deleted, only hidden from the register.
router.post('/:id(\\d+)/archive', can('products.manage'), wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const active = req.body.active === true;
  const { rowCount } = await query('UPDATE products SET is_active = $1, updated_at = now() WHERE id = $2', [active, id]);
  if (!rowCount) throw notFound('Product not found');
  await audit(null, req.user.id, active ? 'product.restore' : 'product.archive', 'product', id);
  res.json({ ok: true });
}));

// Manual stock fix (count was wrong, item broke, etc.)
router.post('/:id(\\d+)/adjust', can('products.manage'), wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const newQty = int(req.body.stock_qty, { min: 0, max: 1000000, field: 'stock_qty' });
  const note = text(req.body.note, { max: 160 }) || 'Stock count';
  await tx(async (c) => {
    const cur = (await c.query('SELECT stock_qty FROM products WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!cur) throw notFound('Product not found');
    const diff = newQty - cur.stock_qty;
    if (diff === 0) return;
    await c.query('UPDATE products SET stock_qty = $1, updated_at = now() WHERE id = $2', [newQty, id]);
    await c.query(
      `INSERT INTO stock_movements (product_id, user_id, kind, qty_change, ref_type, note) VALUES ($1,$2,'adjustment',$3,'product',$4)`,
      [id, req.user.id, diff, note]);
    await audit(c, req.user.id, 'product.adjust', 'product', id, { from: cur.stock_qty, to: newQty, note });
  });
  res.json({ ok: true });
}));

// ---- restock ---------------------------------------------------------------------------------
router.post('/:id(\\d+)/restock', can('inventory.restock'), wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const qty = int(req.body.quantity, { min: 1, max: 100000, field: 'quantity' });
  const unitCost = money(req.body.unit_cost, { field: 'unit_cost', max: 1000000 });
  const supplierId = req.body.supplier_id ? int(req.body.supplier_id, { min: 1, field: 'supplier_id' }) : null;
  const invoice = text(req.body.invoice_no, { max: 60 }) || null;
  const receivedOn = /^\d{4}-\d{2}-\d{2}$/.test(req.body.received_on || '') ? req.body.received_on : null;

  const result = await tx(async (c) => {
    const cur = (await c.query('SELECT stock_qty, name FROM products WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!cur) throw notFound('Product not found');
    const r = (await c.query(
      `INSERT INTO restocks (product_id, supplier_id, user_id, quantity, unit_cost, invoice_no, received_on)
       VALUES ($1,$2,$3,$4,$5,$6, COALESCE($7::date, store_today())) RETURNING id`,
      [id, supplierId, req.user.id, qty, unitCost, invoice, receivedOn])).rows[0];
    // The latest supplier cost becomes the product cost, so margins stay current.
    const upd = (await c.query(
      `UPDATE products SET stock_qty = stock_qty + $1, cost = $2, supplier_id = COALESCE($3, supplier_id), updated_at = now()
       WHERE id = $4 RETURNING stock_qty`, [qty, unitCost, supplierId, id])).rows[0];
    await c.query(
      `INSERT INTO stock_movements (product_id, user_id, kind, qty_change, ref_type, ref_id, note) VALUES ($1,$2,'restock',$3,'restock',$4,$5)`,
      [id, req.user.id, qty, r.id, invoice ? `Invoice ${invoice}` : 'Restock']);
    await audit(c, req.user.id, 'product.restock', 'product', id, { qty, unitCost });
    return { restock_id: r.id, stock_before: cur.stock_qty, stock_after: upd.stock_qty, total_cost: Math.round(qty * unitCost * 100) / 100 };
  });
  res.status(201).json(result);
}));

module.exports = router;
