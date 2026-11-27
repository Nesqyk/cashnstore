const { query } = require('../db');

// Everything needed to show a sale on the receipt / sale-details screens.
async function loadReceipt(saleId) {
  const [sale, items, store] = await Promise.all([
    query(
      `SELECT s.id, s.sale_no, s.payment_method, s.subtotal, s.discount, s.discount_type, s.total, s.cash_received, s.change_given,
              s.status, s.station, s.created_at, s.refunded_at, s.refund_reason,
              u.id AS cashier_id, u.full_name AS cashier, u.avatar_key AS cashier_avatar,
              cu.id AS customer_id, cu.name AS customer, cu.balance AS customer_balance,
              rb.full_name AS refunded_by
       FROM sales s JOIN users u ON u.id = s.user_id
       LEFT JOIN customers cu ON cu.id = s.customer_id
       LEFT JOIN users rb ON rb.id = s.refunded_by
       WHERE s.id = $1`, [saleId]),
    query(
      `SELECT id, product_id, product_name AS name, description, qty, unit_price, line_total
       FROM sale_items WHERE sale_id = $1 ORDER BY id`, [saleId]),
    query('SELECT store_name, address, phone, email, tin, receipt_message, logo_url, discount_percent FROM store_settings WHERE id = 1'),
  ]);
  if (!sale.rows[0]) return null;
  return { sale: sale.rows[0], items: items.rows, store: store.rows[0] };
}

module.exports = { loadReceipt };
