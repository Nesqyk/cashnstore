# CashNStore

Point of sale, inventory, GCash cash in/out and store analytics for a small tindahan.
Plain HTML/JS front end (no build step), Node + Express back end, PostgreSQL database.

Demo data is **Aling Maria's Tindahan & E-Services** (Ibabao, Perrelos, Carcar City, Cebu): 49 products, 9 accounts, and 30 days of sales and GCash history.

## What is in it

| Area | What it does |
| --- | --- |
| Sign in | Username + password, server-side session cookie, forgot/reset password with a 6-digit code, forced password change after a temporary password |
| Dashboard | Owner: sales, orders, drawer cash, GCash float, low stock, plus an Analytics section (trend vs previous period, category change, top sellers, busy-hours heat map, payment mix, GCash activity). Cashier: own shift, daily goal, hourly sales vs yesterday, payment mix |
| Point of sale | Product grid with search/barcode, senior/PWD discount, review, cash / GCash / utang payment, change, receipt (80 mm, 58 mm, A4) and print |
| Products | List with filters, add/edit, archive, stock adjust, restock with supplier and invoice |
| Inventory | Low and out-of-stock alerts with days left, suggested order size, restock-order CSV, stock-out trend |
| Sales | History, filters, sale details, refund (permission + owner PIN, stock is returned), CSV export, today's analytics |
| GCash | Cash in and cash out with fee quote, float and drawer effect, transaction history and details, fee analytics |
| Staff | Add/edit, "can log in" switch, reset code, temporary password, shift coverage, sales by cashier |
| Reports | Overview plus sales, inventory and GCash reports with period filters and CSV downloads |
| Settings | Store info, receipt message, discount and GCash fee rules, account and avatar, password, owner PIN, signed-in devices |

## Quick start (local PostgreSQL + pgAdmin)

You need Node 18+ and PostgreSQL 13+.

1. **Create the database in pgAdmin.** Right-click *Databases > Create > Database*, name it `cashnstore`, leave the encoding as `UTF8`.
2. **Create the tables and demo data.** Either:
   - *In pgAdmin:* open the Query Tool on `cashnstore`, then open and run these files **in order**: `db/01_schema.sql`, `db/02_rbac.sql`, `db/03_functions.sql`, `db/04_demo_seed.sql` (skip the seed file if you want an empty store). `db/00_reset.sql` wipes everything and is only for starting over.
   - *Or from the terminal* (after step 3): `npm run db:fresh`.
3. **Configure the app.**
   ```bash
   cp .env.example .env      # then edit DATABASE_URL and SESSION_SECRET
   npm install
   npm start                 # http://localhost:3000
   ```
   `DATABASE_URL` looks like `postgres://postgres:YOURPASSWORD@localhost:5432/cashnstore`.

### Demo logins

Password for every account: `Tindahan#123`

| Username | Role |
| --- | --- |
| `mariasantos` | Owner (owner PIN is `1234`) |
| `juandelacruz`, `anareyes`, `markv`, `elenab`, `jaysond`, `cristines`, `ramoncruz` | Cashier |
| `lizam` | Cashier, switched off ("cannot log in") |

Change these before using the app for real. For a real store, run only the first three SQL files, then create your owner account:

```sql
INSERT INTO users (username, full_name, email, password_hash, role_id)
VALUES ('yourname', 'Your Name', 'you@example.com',
        crypt('A-strong-Passw0rd!', gen_salt('bf', 10)),
        (SELECT id FROM roles WHERE code = 'owner'));
```

## Roles and permissions

Access is checked on the server for every request from the `roles`, `permissions` and `role_permissions` tables (`db/02_rbac.sql`); hiding a button in the browser is only cosmetic. To change what a role can do, edit those rows. No code change is needed.

| Permission | Owner | Cashier |
| --- | :-: | :-: |
| `pos.sell` | ✔ | ✔ |
| `products.view` | ✔ | ✔ |
| `products.manage` | ✔ | |
| `inventory.view`, `inventory.restock` | ✔ | ✔ |
| `sales.view_own` | ✔ | ✔ |
| `sales.view_all`, `sales.refund` | ✔ | |
| `gcash.view`, `gcash.transact` | ✔ | ✔ |
| `analytics.store` (store-wide analytics) | ✔ | |
| `reports.view`, `staff.manage`, `settings.manage` | ✔ | |

Cashiers see only their own sales. Store-wide analytics strips on Products, Inventory and Staff need `analytics.store`; the GCash strip needs `gcash.view`.

## How the numbers work

- **Prices are never trusted from the browser.** Checkout sends product ids and quantities; the server reads prices, applies the discount, checks stock under a row lock and writes the sale, items and stock movements in one transaction.
- **GCash fee** = the fee percent of the amount rounded to whole pesos, never below the minimum fee (defaults 1% and ₱10, editable in Settings).
  - *Cash in:* the customer hands over amount + fee; drawer goes up by that, the GCash float goes down by the amount.
  - *Cash out:* the float goes up by the amount; the drawer goes down by amount − fee (the fee is either deducted from the cash handed over, or collected separately).
- **Float** = opening float + cash-outs − cash-ins + GCash QR sales. **Drawer** = opening cash + cash sales + GCash cash flow − restock payments.
- **Analytics are SQL functions** in `db/03_functions.sql` (`dashboard_owner()`, `analytics_overview(days)`, `report_sales(period)` and so on). They return JSON, so you can run `SELECT analytics_overview(7);` in pgAdmin to see exactly what the screens receive.

## Useful commands

| Command | What it does |
| --- | --- |
| `npm start` | Run the server |
| `npm run dev` | Run with auto-restart on changes |
| `npm run db:fresh` | Drop everything, rebuild the schema and load the demo data |
| `npm run db:setup` / `db:seed` / `db:reset` | Schema only / demo data only / wipe |
| `npm run check` | Confirm the database objects and every analytics function work |
| `npm run smoke` | Run ~115 API checks (roles, checkout maths, refunds, GCash, staff). Writes test data, so use a throwaway database |

## Project layout

```
db/           SQL: schema, roles/permissions, analytics functions, demo seed
server/       Express app: routes/, middleware/ (auth, CSRF guard, rate limit), lib/
public/       Front end: index.html, css/app.css, js/ (router, api, charts, views/)
scripts/      db.js (runs the SQL files), check.js, smoke.js
```

## Security notes

- Passwords are hashed with bcrypt. Sessions live in Postgres (`session` table) behind an HttpOnly, SameSite=Lax cookie; changing a password or switching an account off signs that person out everywhere.
- State-changing requests must carry an `X-Requested-With` header and a same-origin `Origin`, on top of SameSite.
- Sign-in is throttled (5 wrong tries per username and IP, then a 5 minute wait); the reset endpoints are rate limited.
- Set a long random `SESSION_SECRET` and `NODE_ENV=production` (behind HTTPS) when deploying.

## Known limitations

- **Receipts by SMS or email and two-step login are not wired up.** The buttons and settings exist, but no SMS or email provider is connected. The *Send* button says so, and the two-step switch is stored only.
- **Reset codes are printed in the server console** instead of being emailed. Replace `deliverResetCode` in `server/lib/mailer.js` with your provider.
- **Product photos and the store logo are links**, not uploads, and the Figma photos were not carried over (products show an icon, the sign-in screen uses a drawn storefront, the logo is a simple SVG).
- Utang balances grow with credit sales but there is no screen yet to record a customer paying them back.
- Refunds are whole-sale only.
