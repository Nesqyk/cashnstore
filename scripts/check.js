// Quick health check of the database: tables, roles, and every analytics function.
//   npm run check
const { Client } = require('pg');
const config = require('../server/config');

const FUNCS = [
  'dashboard_owner()', 'analytics_overview(7)', 'analytics_sales_today(NULL)', 'dashboard_cashier((SELECT id FROM users WHERE username = \'juandelacruz\'))',
  'analytics_products()', 'analytics_inventory()', 'analytics_gcash()', 'analytics_staff()',
  'report_overview()', "report_sales('30d')", 'report_inventory()', "report_gcash('30d')",
];

(async () => {
  const c = new Client({ connectionString: config.databaseUrl });
  await c.connect();
  let bad = 0;
  const one = async (label, sql) => {
    try { const r = await c.query(sql); console.log(`ok   ${label}: ${JSON.stringify(r.rows[0]).slice(0, 90)}`); }
    catch (e) { bad += 1; console.log(`FAIL ${label}: ${e.message}`); }
  };
  await one('roles', 'SELECT count(*)::int AS roles FROM roles');
  await one('permissions', 'SELECT count(*)::int AS permissions, (SELECT count(*)::int FROM role_permissions) AS grants FROM permissions');
  await one('users', 'SELECT count(*)::int AS users FROM users');
  await one('products', 'SELECT count(*)::int AS products FROM products');
  await one('balances', 'SELECT drawer_cash() AS drawer, gcash_float() AS gcash_float');
  for (const f of FUNCS) await one(f.split('(')[0], `SELECT jsonb_typeof(${f}) AS type`);
  await c.end();
  console.log(bad ? `\n${bad} problem(s) found.` : '\nEverything looks good.');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('Could not check the database:', e.message); process.exit(1); });
