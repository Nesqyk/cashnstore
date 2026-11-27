// Database helper: runs the SQL files in db/ against DATABASE_URL.
//
//   npm run db:setup   schema + roles/permissions + functions         (keeps existing data out: fails if tables exist)
//   npm run db:seed    demo data (Aling Maria's Tindahan, 30 days of sales)
//   npm run db:reset   DROPS everything in the public schema
//   npm run db:fresh   reset + setup + seed  (what you want the first time)
//
// You can also run the same files by hand in pgAdmin's Query Tool, in this order:
//   db/00_reset.sql (optional), db/01_schema.sql, db/02_rbac.sql, db/03_functions.sql, db/04_demo_seed.sql
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const config = require('../server/config');

const FILES = {
  reset: ['00_reset.sql'],
  setup: ['01_schema.sql', '02_rbac.sql', '03_functions.sql'],
  seed: ['04_demo_seed.sql'],
};
FILES.fresh = [...FILES.reset, ...FILES.setup, ...FILES.seed];

async function main() {
  const cmd = process.argv[2];
  if (!FILES[cmd]) {
    console.error('Usage: node scripts/db.js <reset|setup|seed|fresh>');
    process.exit(1);
  }
  if (cmd === 'reset' || cmd === 'fresh') {
    if (config.isProd && process.env.CONFIRM_RESET !== 'yes') {
      console.error('Refusing to wipe the database while NODE_ENV=production. Set CONFIRM_RESET=yes if you really mean it.');
      process.exit(1);
    }
  }
  const client = new Client({ connectionString: config.databaseUrl });
  try {
    await client.connect();
  } catch (err) {
    console.error(`Could not connect to Postgres using DATABASE_URL (${config.databaseUrl.replace(/:[^:@/]*@/, ':****@')}).`);
    console.error(err.message);
    console.error('Check that PostgreSQL is running and that the database exists (create an empty "cashnstore" database in pgAdmin first).');
    process.exit(1);
  }
  try {
    for (const f of FILES[cmd]) {
      const sql = fs.readFileSync(path.join(__dirname, '..', 'db', f), 'utf8');
      process.stdout.write(`running db/${f} ... `);
      await client.query(sql);
      console.log('done');
    }
    if (cmd === 'fresh' || cmd === 'seed') {
      console.log('\nDemo logins (password for all: Tindahan#123)');
      console.log('  owner    mariasantos');
      console.log('  cashier  juandelacruz (also anareyes, markv, elenab, jaysond, cristines, ramoncruz)');
    }
  } catch (err) {
    console.error(`\nFailed: ${err.message}`);
    if (err.position) console.error(`(at character ${err.position})`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
