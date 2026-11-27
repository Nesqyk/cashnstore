// End-to-end check of the API against a running server and the demo data.
//   1) npm run db:fresh   2) npm start   3) npm run smoke       (BASE_URL=http://localhost:3000 by default)
// It signs in as the demo owner and a demo cashier, exercises every area, and checks the money maths.
// It changes data (adds a product, makes a sale and refunds it), so run it on a throwaway database.
const BASE = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const PASSWORD = 'Tindahan#123';

let passed = 0; const failures = [];
function ok(cond, label, extra) { if (cond) passed += 1; else { failures.push(label); console.log(`  FAIL ${label}${extra ? ` -> ${extra}` : ''}`); } }

class Client {
  constructor() { this.cookie = ''; }
  async req(method, url, body, headers = {}) {
    const res = await fetch(BASE + url, { method, redirect: 'manual', headers: { 'X-Requested-With': 'cashnstore', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie'); if (set) this.cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data };
  }
  get(u) { return this.req('GET', u); } post(u, b = {}) { return this.req('POST', u, b); } put(u, b = {}) { return this.req('PUT', u, b); } del(u) { return this.req('DELETE', u); }
}
const near = (a, b) => Math.abs(a - b) < 0.005;
const section = (t) => console.log(`\n${t}`);

(async () => {
  const owner = new Client(); const cashier = new Client(); const anon = new Client();

  section('Sign in and guards');
  let r = await anon.post('/api/auth/login', { username: 'mariasantos', password: 'wrong' }); ok(r.status === 401, 'wrong password is rejected', r.status);
  r = await anon.req('POST', '/api/auth/login', { username: 'mariasantos', password: PASSWORD }, { 'X-Requested-With': '' }); ok(r.status === 403, 'missing CSRF header is rejected', r.status);
  r = await anon.get('/api/products'); ok(r.status === 401, 'products need sign-in', r.status);
  r = await owner.post('/api/auth/login', { username: 'mariasantos', password: PASSWORD }); ok(r.status === 200 && r.data.user.role === 'owner', 'owner signs in', r.status);
  ok(r.data.user.permissions.length === 14 && !('password_hash' in r.data.user), 'owner has all 14 permissions and no hash leaks');
  r = await cashier.post('/api/auth/login', { username: 'juandelacruz', password: PASSWORD }); ok(r.status === 200 && r.data.user.role === 'cashier', 'cashier signs in', r.status);
  r = await anon.post('/api/auth/login', { username: 'lizam', password: PASSWORD }); ok(r.status === 401, 'inactive account cannot sign in', r.status);
  r = await owner.get('/api/auth/me'); ok(r.data.user && r.data.user.username === 'mariasantos', '/me returns the user');

  section('Role-based access');
  for (const url of ['/api/staff', '/api/reports/overview', '/api/products/analytics', '/api/inventory/analytics', '/api/dashboard/analytics', '/api/staff/analytics']) {
    r = await cashier.get(url); ok(r.status === 403, `cashier blocked from ${url}`, r.status);
  }
  r = await cashier.put('/api/settings/store', {}); ok(r.status === 403, 'cashier cannot change store settings', r.status);
  r = await cashier.post('/api/products', { name: 'x', price: 1 }); ok(r.status === 403, 'cashier cannot add products', r.status);
  r = await cashier.get('/api/products'); ok(r.status === 200 && r.data.products.length > 0, 'cashier can view products', r.status);
  r = await cashier.get('/api/gcash/analytics'); ok(r.status === 200, 'cashier can see GCash analytics (gcash.view)', r.status);
  r = await cashier.get('/api/sales/analytics'); ok(r.status === 200 && r.data.scope === 'own', 'cashier sales analytics are own-only', r.status);

  section('Dashboards and analytics');
  r = await owner.get('/api/dashboard'); ok(r.data.kind === 'owner' && r.data.data.drawer_cash === 8450 && r.data.data.gcash_float === 14820, 'owner dashboard shows drawer 8,450 and float 14,820', JSON.stringify([r.data.data && r.data.data.drawer_cash, r.data.data && r.data.data.gcash_float]));
  r = await cashier.get('/api/dashboard'); ok(r.data.kind === 'cashier' && r.data.data.goal === 7000, 'cashier dashboard has the 7,000 goal');
  for (const d of [7, 14, 30]) { r = await owner.get(`/api/dashboard/analytics?days=${d}`); ok(r.status === 200 && r.data.kpis && r.data.series.length > 0, `analytics overview ${d} days`, r.status); }
  r = await owner.get('/api/dashboard/analytics?days=99'); ok(r.status === 400, 'bad days value is rejected');
  for (const u of ['/api/products/analytics', '/api/inventory/analytics', '/api/gcash/analytics', '/api/staff/analytics', '/api/sales/analytics']) { r = await owner.get(u); ok(r.status === 200, `owner ${u}`, r.status); }

  section('Products and inventory');
  r = await owner.get('/api/products?size=5'); ok(r.data.total === 49 && r.data.products.length === 5, '49 demo products, page size 5', r.data.total);
  r = await owner.get('/api/products?status=out'); ok(r.data.products.every((p) => p.stock_qty === 0), 'out-of-stock filter');
  r = await owner.get('/api/products?q=lucky'); ok(r.data.products.length > 0 && r.data.products.every((p) => /lucky/i.test(p.name + p.description)), 'search finds Lucky Me');
  r = await owner.post('/api/products', { name: 'Smoke Test Biscuit', description: '10 pack', price: 'abc' }); ok(r.status === 400 && r.data.fields && r.data.fields.price, 'bad price gives a field error', r.status);
  r = await owner.post('/api/products', { name: 'Smoke Test Biscuit', description: '10 pack', price: 12, cost: 9, stock_qty: 20, reorder_level: 5, barcode: 'SMOKE-001', unit: 'pcs' });
  ok(r.status === 201, 'create product', r.status); const pid = r.data.id;
  r = await owner.post('/api/products', { name: 'Dup', price: 1, barcode: 'SMOKE-001' }); ok(r.status === 400 && r.data.fields && r.data.fields.barcode, 'duplicate barcode is rejected', r.status);
  r = await owner.get(`/api/products/barcode/SMOKE-001`); ok(r.data.product && r.data.product.id === pid, 'barcode lookup');
  r = await owner.put(`/api/products/${pid}`, { name: 'Smoke Test Biscuit', description: '10 pack', price: 15, cost: 10, reorder_level: 6, unit: 'pcs', barcode: 'SMOKE-001' }); ok(r.status === 200, 'update product', r.status);
  r = await owner.post(`/api/products/${pid}/restock`, { quantity: 30, unit_cost: 11, invoice_no: 'INV-1' }); ok(r.status === 201 && r.data.stock_before === 20 && r.data.stock_after === 50, 'restock adds stock', JSON.stringify(r.data));
  r = await owner.post(`/api/products/${pid}/restock`, { quantity: 0, unit_cost: 11 }); ok(r.status === 400, 'zero restock rejected');
  r = await owner.post(`/api/products/${pid}/adjust`, { stock_qty: 48, note: 'count' }); ok(r.status === 200, 'adjust stock');
  r = await owner.get(`/api/products/${pid}`); ok(r.data.product.stock_qty === 48 && r.data.product.cost === 11 && r.data.movements.length >= 3, 'detail shows new stock, cost and movements', JSON.stringify(r.data.product));
  r = await owner.get('/api/inventory/alerts'); ok(r.data.items.length === r.data.summary.out + r.data.summary.low && r.data.items.every((i) => i.suggested_qty > 0), 'inventory alerts add up');
  r = await owner.get('/api/inventory/restock-order.csv'); ok(r.status === 200 && /^Supplier,Product/.test(r.data), 'restock order CSV');
  r = await owner.get('/api/inventory/restocks'); ok(r.data.restocks.length > 0, 'recent restocks');
  r = await owner.get('/api/categories'); ok(r.data.categories.length === 8, '8 categories');
  r = await owner.get('/api/suppliers'); ok(r.data.suppliers.length === 4, '4 suppliers');

  section('Point of sale');
  const pos = (await cashier.get('/api/products/pos')).data;
  ok(pos.products.length > 0 && pos.discount_percent === 20, 'POS catalogue and 20% discount');
  const rice = pos.products.find((p) => /Sinandomeng/.test(p.name)); const noodles = pos.products.find((p) => /Pancit Canton/.test(p.name) && p.stock_qty > 3);
  r = await cashier.post('/api/pos/checkout', { items: [], payment_method: 'cash' }); ok(r.status === 400, 'empty order rejected');
  r = await cashier.post('/api/pos/checkout', { items: [{ product_id: pid, qty: 2 }], payment_method: 'cash', cash_received: 10 }); ok(r.status === 400, 'not enough cash rejected', r.status);
  r = await cashier.post('/api/pos/checkout', { items: [{ product_id: pid, qty: 999 }], payment_method: 'gcash' }); ok(r.status === 400, 'cannot sell more than in stock', r.status);
  const before = (await owner.get(`/api/products/${pid}`)).data.product.stock_qty;
  r = await cashier.post('/api/pos/checkout', { items: [{ product_id: pid, qty: 3, price: 1 }], payment_method: 'cash', cash_received: 100, discount_type: 'senior' });
  ok(r.status === 201, 'cash sale with senior discount', r.status);
  const s1 = r.data.sale;
  ok(s1 && near(s1.subtotal, 45) && near(s1.discount, 9) && near(s1.total, 36) && near(s1.change_given, 64), 'server prices it itself: 3 x 15 = 45, 20% off = 36, change 64 (client price ignored)', JSON.stringify(s1));
  ok((await owner.get(`/api/products/${pid}`)).data.product.stock_qty === before - 3, 'stock went down by 3');
  r = await cashier.post('/api/pos/checkout', { items: [{ product_id: pid, qty: 1 }], payment_method: 'utang', customer_name: 'Smoke Customer' }); ok(r.status === 201, 'utang sale for a new customer', r.status);
  const s2 = r.data.sale;
  r = await cashier.get('/api/pos/customers?q=smoke'); ok(r.data.customers.length === 1 && near(r.data.customers[0].balance, 15), 'customer owes 15', JSON.stringify(r.data.customers));
  r = await cashier.post('/api/pos/checkout', { items: [{ product_id: pid, qty: 1 }], payment_method: 'gcash' }); ok(r.status === 201 && r.data.sale.payment_method === 'gcash', 'GCash sale');
  const s3 = r.data.sale;

  section('Sales');
  r = await cashier.get('/api/sales?period=today'); ok(r.status === 200 && r.data.sales.every((s) => s.cashier_id === 2), 'cashier only sees own sales', r.status);
  r = await owner.get('/api/sales?period=today&size=100'); ok(r.data.total > r.data.sales.length * 0 && r.data.sales.some((s) => s.id === s1.id), 'owner sees all sales including the new one');
  r = await owner.get(`/api/sales/${s1.id}`); ok(r.data.items.length === 1 && r.data.can_refund === true, 'sale detail with refund allowed');
  r = await cashier.get(`/api/sales/${(await owner.get('/api/sales?user=3&size=1&period=all')).data.sales[0].id}`); ok(r.status === 404, "cashier cannot open another cashier's sale", r.status);
  r = await cashier.post(`/api/sales/${s1.id}/refund`, { reason: 'x', pin: '1234' }); ok(r.status === 403, 'cashier cannot refund', r.status);
  r = await owner.post(`/api/sales/${s1.id}/refund`, { reason: 'Wrong item', pin: '0000' }); ok(r.status === 400 && r.data.fields && r.data.fields.pin, 'wrong PIN stops the refund', r.status);
  r = await owner.post(`/api/sales/${s1.id}/refund`, { reason: '', pin: '1234' }); ok(r.status === 400, 'refund needs a reason');
  r = await owner.post(`/api/sales/${s1.id}/refund`, { reason: 'Wrong item', pin: '1234' }); ok(r.status === 200, 'refund with the PIN', r.status);
  ok((await owner.get(`/api/products/${pid}`)).data.product.stock_qty === before - 3 + 3 - 1 - 1, 'refund put the 3 back (net: 2 sold since)');
  r = await owner.post(`/api/sales/${s1.id}/refund`, { reason: 'again', pin: '1234' }); ok(r.status === 400, 'cannot refund twice');
  r = await owner.post(`/api/sales/${s2.id}/refund`, { reason: 'Cancelled utang', pin: '1234' }); ok(r.status === 200, 'refund utang sale');
  r = await cashier.get('/api/pos/customers?q=smoke'); ok(near(r.data.customers[0].balance, 0), 'customer balance back to 0 after refund', JSON.stringify(r.data.customers));
  r = await owner.get('/api/sales/export.csv?period=today'); ok(r.status === 200 && /^Sale,Date/.test(r.data), 'sales CSV');

  section('GCash');
  const sum0 = (await owner.get('/api/gcash/summary')).data;
  r = await cashier.get('/api/gcash/quote?type=cash_in&amount=2000'); ok(near(r.data.fee, 20) && near(r.data.cash_from_customer, 2020) && r.data.float_change === -2000, 'cash in 2,000: fee 20, collect 2,020', JSON.stringify(r.data));
  r = await cashier.get('/api/gcash/quote?type=cash_in&amount=300'); ok(near(r.data.fee, 10), 'minimum fee of 10 applies');
  r = await cashier.post('/api/gcash', { type: 'cash_in', customer_name: 'Smoke Gcash', gcash_number: '09171234567', amount: 2000 }); ok(r.status === 201 && near(r.data.fee, 20), 'record cash in', r.status);
  const g1 = r.data.id;
  r = await cashier.post('/api/gcash', { type: 'cash_out', customer_name: 'Smoke Gcash', amount: 1000, fee_mode: 'deduct', reference: 'REF1' }); ok(r.status === 201 && near(r.data.effects.cash_to_customer, 990), 'cash out 1,000 deducting a 10 fee hands over 990', JSON.stringify(r.data));
  r = await cashier.post('/api/gcash', { type: 'cash_out', customer_name: 'Smoke Two', amount: 1000, fee_mode: 'separate' }); ok(r.status === 201 && near(r.data.effects.cash_to_customer, 1000) && near(r.data.effects.cash_from_customer, 10), 'cash out with the fee paid separately');
  const sum1 = (await owner.get('/api/gcash/summary')).data;
  // float: -2000 (cash in) +1000 +1000 (cash outs). The QR sale was already counted in sum0.
  ok(near(sum1.gcash_float - sum0.gcash_float, -2000 + 1000 + 1000), 'float moved by -2000 +1000 +1000', sum1.gcash_float - sum0.gcash_float);
  // drawer: cash sale 36 refunded (-36) => net 0 for it; +2020 -990 -(1000-10)
  ok(near(sum1.drawer_cash - sum0.drawer_cash, 2020 - 990 - 990), 'drawer moved by +2020 -990 -990', sum1.drawer_cash - sum0.drawer_cash);
  r = await cashier.post('/api/gcash', { type: 'cash_in', customer_name: 'Too Big', amount: 50000 }); ok(r.status === 400, 'cash in larger than the float is rejected', r.status);
  r = await cashier.post('/api/gcash', { type: 'cash_in', customer_name: 'Bad', amount: 100, gcash_number: '123' }); ok(r.status === 400 && r.data.fields.gcash_number, 'bad mobile number');
  r = await owner.get(`/api/gcash/${g1}`); ok(r.data.transaction.gc_no && r.data.effects.drawer_change === 2020, 'transaction detail');
  r = await owner.get('/api/gcash?period=today'); ok(r.data.total >= 3, 'GCash list');

  section('Shifts');
  r = await cashier.get('/api/shifts/current'); ok(r.status === 200 && r.data.shift, 'cashier has a shift running (demo data)');
  r = await cashier.post('/api/shifts/start', { opening_cash: 100 }); ok(r.status === 400, 'cannot start a second shift');

  section('Staff');
  r = await owner.get('/api/staff'); ok(r.data.staff.length === 8 && !r.data.staff.some((s) => s.username === 'mariasantos'), '8 staff, owner not listed');
  r = await owner.post('/api/staff', { username: 'smokecash', full_name: 'Smoke Cashier', email: 'smoke@example.com', password: 'weak' }); ok(r.status === 400 && r.data.fields.password, 'weak password rejected');
  r = await owner.post('/api/staff', { username: 'smokecash', full_name: 'Smoke Cashier', email: 'smoke@example.com', password: 'Smoke#Pass1', confirm: 'Smoke#Pass1' }); ok(r.status === 201, 'create staff', r.status); const sid = r.data.id;
  r = await owner.post('/api/staff', { username: 'SMOKECASH', full_name: 'Again', password: 'Smoke#Pass1' }); ok(r.status === 400 && r.data.fields.username, 'duplicate username (any case) rejected', r.status);
  const fresh = new Client(); r = await fresh.post('/api/auth/login', { username: 'smokecash', password: 'Smoke#Pass1' }); ok(r.status === 200 && r.data.user.must_change_password === true, 'new staff must change password');
  r = await fresh.post('/api/auth/change-password', { current: 'Smoke#Pass1', next: 'Newer#Pass2', confirm: 'Newer#Pass2' }); ok(r.status === 200, 'staff changes own password', r.status);
  r = await fresh.post('/api/auth/change-password', { current: 'Newer#Pass2', next: 'NoSymbol22' }); ok(r.status === 400, 'change needs a symbol');
  r = await owner.put(`/api/staff/${sid}`, { full_name: 'Smoke Cashier', email: 'smoke@example.com', job_title: 'Cashier', station: 'Register 2', daily_goal: 5000, is_active: false }); ok(r.status === 200, 'deactivate staff');
  r = await fresh.get('/api/auth/me'); ok(r.data.user === null, 'deactivating signs them out straight away');
  r = await anon.post('/api/auth/login', { username: 'smokecash', password: 'Newer#Pass2' }); ok(r.status === 401, 'deactivated staff cannot sign in');
  r = await owner.post(`/api/staff/${sid}/temp-password`); ok(r.status === 200 && /^A7/.test(r.data.temporary_password), 'temporary password');
  r = await owner.post(`/api/staff/${sid}/send-reset`); ok(r.status === 200, 'send reset');
  r = await owner.post('/api/staff/1/temp-password'); ok(r.status === 404, 'cannot touch the owner account through the staff routes', r.status);

  section('Reports and settings');
  for (const u of ['/api/reports/overview', '/api/reports/sales?period=week', '/api/reports/inventory', '/api/reports/gcash?period=30d']) { r = await owner.get(u); ok(r.status === 200, u, r.status); }
  for (const u of ['/api/reports/sales.csv', '/api/reports/inventory.csv', '/api/reports/gcash.csv']) { r = await owner.get(u); ok(r.status === 200 && typeof r.data === 'string' && r.data.includes(','), u, r.status); }
  r = await owner.get('/api/reports/sales?period=bogus'); ok(r.status === 400, 'bad period rejected');
  r = await owner.get('/api/settings/store'); ok(r.data.store.store_name && r.data.store.has_owner_pin === true, 'owner reads store settings');
  r = await cashier.get('/api/settings/store'); ok(r.data.store.store_name && !('gcash_min_float' in r.data.store), 'cashier sees only receipt details');
  const st = (await owner.get('/api/settings/store')).data.store;
  r = await owner.put('/api/settings/store', { ...st, receipt_message: 'Salamat po! (smoke)' }); ok(r.status === 200, 'save store settings', r.status);
  r = await owner.put('/api/settings/store', { ...st, gcash_target_float: 1, gcash_min_float: 5000 }); ok(r.status === 400, 'target below minimum rejected');
  r = await owner.put('/api/settings/store', { ...st, receipt_message: st.receipt_message }); ok(r.status === 200, 'restore receipt message');
  r = await owner.get('/api/settings/account'); ok(r.data.account.username === 'mariasantos', 'account');
  r = await owner.post('/api/settings/owner-pin', { pin: '12', password: PASSWORD }); ok(r.status === 400, 'PIN must be 4 digits');
  r = await owner.post('/api/settings/owner-pin', { pin: '1234', password: 'nope' }); ok(r.status === 400, 'PIN change needs the password');
  r = await owner.get('/api/settings/sessions'); ok(r.data.sessions.length >= 1 && r.data.sessions.some((s) => s.current), 'signed-in devices');
  r = await owner.post('/api/auth/logout'); ok(r.status === 200, 'sign out'); r = await owner.get('/api/auth/me'); ok(r.data.user === null, 'signed out');

  // tidy up what this script made
  console.log(`\n${passed} checks passed, ${failures.length} failed.`);
  if (failures.length) { console.log(failures.map((f) => ` - ${f}`).join('\n')); process.exit(1); }
})().catch((e) => { console.error('Smoke test crashed:', e); process.exit(1); });
