// Database helper: runs the SQL files in db/ against DATABASE_URL.
//
//   npm run db:setup   schema + roles/permissions + functions         (keeps existing data out: fails if tables exist)
//   npm run db:seed    demo data (Aling Maria's Tindahan, 30 days of sales)
//   npm run db:reset   DROPS everything in the public schema
//   npm run db:fresh   reset + setup + seed  (wipes the existing database)
//   npm run db:init    ONE STEP: creates the database itself (and .env if missing), then loads schema + demo data
//                      npm run db:init -- --no-seed   empty store, no demo data
//                      npm run db:init -- --force     wipe and reload if the database already has CashNStore tables
//
// You can also run the same files by hand in pgAdmin's Query Tool, in this order:
//   db/00_reset.sql (optional), db/01_schema.sql, db/02_rbac.sql, db/03_functions.sql, db/04_demo_seed.sql
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const ENV_FILE = path.join(ROOT, '.env');

const FILES = {
  reset: ['00_reset.sql'],
  setup: ['01_schema.sql', '02_rbac.sql', '03_functions.sql'],
  seed: ['04_demo_seed.sql'],
};
FILES.fresh = [...FILES.reset, ...FILES.setup, ...FILES.seed];

const maskUrl = (u) => u.replace(/:[^:@/]*@/, ':****@');

async function runFiles(client, names) {
  for (const f of names) {
    const sql = fs.readFileSync(path.join(ROOT, 'db', f), 'utf8');
    process.stdout.write(`running db/${f} ... `);
    await client.query(sql);
    console.log('done');
  }
}

function printLogins() {
  console.log('\nDemo logins (password for all: Tindahan#123)');
  console.log('  owner    mariasantos   (owner PIN 1234)');
  console.log('  cashier  juandelacruz  (also anareyes, markv, elenab, jaysond, cristines, ramoncruz)');
}

// ---------- db:init ----------

function ask(rl, question, fallback) {
  return new Promise((resolve) => {
    rl.question(`${question}${fallback ? ` [${fallback}]` : ''}: `, (a) => resolve(a.trim() || fallback || ''));
  });
}

// Creates .env the first time, so a fresh clone only needs `npm install` and `npm run db:init`.
async function ensureEnv() {
  if (fs.existsSync(ENV_FILE) || process.env.DATABASE_URL) return;
  let host = 'localhost', port = '5432', user = 'postgres', password = 'postgres', dbname = 'cashnstore';
  if (process.stdin.isTTY) {
    console.log('No .env file yet. Enter the details of your local PostgreSQL (the ones pgAdmin uses). Press Enter for the default.\n');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    host = await ask(rl, 'Host', host);
    port = await ask(rl, 'Port', port);
    user = await ask(rl, 'User', user);
    password = await ask(rl, `Password for ${user}`, '');
    dbname = await ask(rl, 'Database name to create', dbname);
    rl.close();
    console.log('');
  } else {
    console.log('No .env file and not an interactive terminal: using postgres://postgres:postgres@localhost:5432/cashnstore');
  }
  const url = `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${dbname}`;
  const secret = crypto.randomBytes(32).toString('hex');
  const body = [
    '# Created by `npm run db:init`. Edit freely.',
    `PORT=3000`,
    `DATABASE_URL=${url}`,
    `SESSION_SECRET=${secret}`,
    `NODE_ENV=development`,
    '',
  ].join('\n');
  fs.writeFileSync(ENV_FILE, body, { mode: 0o600 });
  process.env.DATABASE_URL = url;
  console.log('Wrote .env (not committed to git).');
}

async function connectOrExplain(url, what) {
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    return client;
  } catch (err) {
    console.error(`Could not connect to ${what} (${maskUrl(url)}).`);
    console.error(`  ${err.message}`);
    if (err.code === '28P01' || /password/i.test(err.message)) {
      console.error('  The password looks wrong. Use the password you set for this user when installing PostgreSQL (the one pgAdmin asks for), then fix DATABASE_URL in .env.');
    } else if (err.code === 'ECONNREFUSED' || /ECONNREFUSED/.test(err.message)) {
      console.error('  PostgreSQL is not accepting connections. Start the PostgreSQL service and check the port (pgAdmin > Server > Properties > Connection).');
    }
    process.exit(1);
  }
}

async function init(flags) {
  await ensureEnv();
  const config = require('../server/config');
  let target;
  try { target = new URL(config.databaseUrl); } catch (e) {
    console.error('DATABASE_URL in .env is not a valid URL, e.g. postgres://postgres:PASSWORD@localhost:5432/cashnstore');
    process.exit(1);
  }
  const dbName = decodeURIComponent(target.pathname.replace(/^\//, ''));
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(dbName)) {
    console.error(`Database name "${dbName}" should only use letters, numbers and underscores.`);
    process.exit(1);
  }
  const admin = new URL(config.databaseUrl);
  admin.pathname = '/postgres';

  // 1. create the database if it is not there yet
  const adminClient = await connectOrExplain(admin.toString(), 'PostgreSQL');
  try {
    const exists = await adminClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (exists.rows.length) {
      console.log(`Database "${dbName}" already exists.`);
    } else {
      process.stdout.write(`creating database "${dbName}" (UTF8) ... `);
      try {
        await adminClient.query(`CREATE DATABASE "${dbName}" ENCODING 'UTF8' TEMPLATE template0`);
      } catch (e) {
        // some Windows locales refuse an explicit encoding; fall back to the server default and check it
        await adminClient.query(`CREATE DATABASE "${dbName}"`);
      }
      console.log('done');
    }
    const enc = await adminClient.query('SELECT pg_encoding_to_char(encoding) AS enc FROM pg_database WHERE datname = $1', [dbName]);
    if (enc.rows[0] && enc.rows[0].enc !== 'UTF8') {
      console.warn(`\nWarning: database encoding is ${enc.rows[0].enc}, not UTF8. The peso sign may not display. Drop it and create it again with encoding UTF8.\n`);
    }
  } catch (err) {
    console.error(`\nCould not create the database: ${err.message}`);
    console.error('The PostgreSQL user needs the CREATEDB right (the default "postgres" user has it).');
    process.exit(1);
  } finally {
    await adminClient.end();
  }

  // 2. load the schema (and demo data) into it
  const client = await connectOrExplain(config.databaseUrl, `database "${dbName}"`);
  try {
    const has = await client.query("SELECT to_regclass('public.users') IS NOT NULL AS yes");
    const installed = has.rows[0] && has.rows[0].yes;
    if (installed && !flags.force) {
      console.log('\nCashNStore tables are already in this database, so nothing was changed.');
      console.log('To wipe it and reload everything, run:  npm run db:init -- --force');
      return;
    }
    if (installed && config.isProd && process.env.CONFIRM_RESET !== 'yes') {
      console.error('Refusing to wipe the database while NODE_ENV=production. Set CONFIRM_RESET=yes if you really mean it.');
      process.exit(1);
    }
    const files = [...(installed ? FILES.reset : []), ...FILES.setup, ...(flags.noSeed ? [] : FILES.seed)];
    await runFiles(client, files);
    console.log(`\nDone. Database "${dbName}" is ready${flags.noSeed ? ' (empty: no demo data).' : ' with demo data.'}`);
    if (flags.noSeed) {
      console.log('Add your owner account with the INSERT shown in README.md ("Change these before using the app for real").');
    } else {
      printLogins();
    }
    console.log('\nNext:  npm start   then open http://localhost:' + config.port);
  } catch (err) {
    console.error(`\nFailed: ${err.message}`);
    if (err.position) console.error(`(at character ${err.position})`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

async function main() {
  const cmd = process.argv[2];
  const args = process.argv.slice(3);
  if (cmd === 'init') {
    await init({ force: args.includes('--force'), noSeed: args.includes('--no-seed') });
    return;
  }
  if (!FILES[cmd]) {
    console.error('Usage: node scripts/db.js <init|reset|setup|seed|fresh>');
    process.exit(1);
  }
  const config = require('../server/config');
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
    console.error(`Could not connect to Postgres using DATABASE_URL (${maskUrl(config.databaseUrl)}).`);
    console.error(err.message);
    console.error('Check that PostgreSQL is running and that the database exists. Or let the script create it for you:  npm run db:init');
    process.exit(1);
  }
  try {
    await runFiles(client, FILES[cmd]);
    if (cmd === 'fresh' || cmd === 'seed') printLogins();
  } catch (err) {
    console.error(`\nFailed: ${err.message}`);
    if (err.position) console.error(`(at character ${err.position})`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
