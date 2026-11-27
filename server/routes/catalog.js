const express = require('express');
const { query } = require('../db');
const { wrap, text, bad } = require('../lib/http');
const { can } = require('../middleware/auth');

const router = express.Router();

router.get('/categories', can('products.view'), wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT c.id, c.name, count(p.id) FILTER (WHERE p.is_active) AS products
     FROM categories c LEFT JOIN products p ON p.category_id = c.id
     GROUP BY c.id ORDER BY c.sort_order, c.name`
  );
  res.json({ categories: rows });
}));

router.post('/categories', can('products.manage'), wrap(async (req, res) => {
  const name = text(req.body.name, { max: 60, required: true, field: 'name' });
  try {
    const { rows } = await query(
      `INSERT INTO categories (name, sort_order) VALUES ($1, (SELECT COALESCE(max(sort_order), 0) + 1 FROM categories)) RETURNING id, name`,
      [name]
    );
    res.status(201).json({ category: rows[0] });
  } catch (err) {
    if (err.code === '23505') throw bad('That category already exists', { name: 'Already exists' });
    throw err;
  }
}));

router.get('/suppliers', can('products.view', 'inventory.restock'), wrap(async (req, res) => {
  const { rows } = await query('SELECT id, name, mobile FROM suppliers ORDER BY name');
  res.json({ suppliers: rows });
}));

router.post('/suppliers', can('products.manage', 'inventory.restock'), wrap(async (req, res) => {
  const name = text(req.body.name, { max: 80, required: true, field: 'name' });
  const mobile = text(req.body.mobile, { max: 30 });
  try {
    const { rows } = await query('INSERT INTO suppliers (name, mobile) VALUES ($1, $2) RETURNING id, name, mobile', [name, mobile || null]);
    res.status(201).json({ supplier: rows[0] });
  } catch (err) {
    if (err.code === '23505') throw bad('That supplier already exists', { name: 'Already exists' });
    throw err;
  }
}));

module.exports = router;
