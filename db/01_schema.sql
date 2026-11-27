-- CashNStore database schema (PostgreSQL 13+).
-- Run order: 00_reset (optional) -> 01_schema -> 02_rbac -> 03_functions -> 04_demo_seed (optional)

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- used to hash the demo passwords inside SQL

-- ---------------------------------------------------------------------------
-- Roles and permissions (role-based access control)
-- ---------------------------------------------------------------------------
CREATE TABLE roles (
  id          smallserial PRIMARY KEY,
  code        text NOT NULL UNIQUE,          -- 'owner', 'cashier'
  name        text NOT NULL,
  description text
);

CREATE TABLE permissions (
  id          smallserial PRIMARY KEY,
  code        text NOT NULL UNIQUE,          -- e.g. 'products.manage'
  description text NOT NULL
);

CREATE TABLE role_permissions (
  role_id       smallint NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id smallint NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id                    serial PRIMARY KEY,
  username              text NOT NULL,
  full_name             text NOT NULL,
  email                 text,
  mobile                text,
  password_hash         text NOT NULL,
  role_id               smallint NOT NULL REFERENCES roles(id),
  is_active             boolean NOT NULL DEFAULT true,   -- "Can log in" switch; history is kept
  avatar_key            text,                            -- illustrated avatar key, NULL = initials
  job_title             text,                            -- e.g. 'Cashier, day shift'
  station               text NOT NULL DEFAULT 'Register 1',
  daily_goal            numeric(12,2) NOT NULL DEFAULT 7000,
  must_change_password  boolean NOT NULL DEFAULT false,
  notify_daily_summary  boolean NOT NULL DEFAULT true,
  ask_pin_when_short    boolean NOT NULL DEFAULT true,
  created_by            integer REFERENCES users(id) ON DELETE SET NULL,
  last_login_at         timestamptz,
  password_changed_at   timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_username_key ON users (lower(username));
CREATE UNIQUE INDEX users_email_key ON users (lower(email)) WHERE email IS NOT NULL AND email <> '';

-- Password reset codes ("we will send you a 6-digit code")
CREATE TABLE password_resets (
  id          bigserial PRIMARY KEY,
  user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash   text NOT NULL,
  attempts    smallint NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_resets_user_idx ON password_resets (user_id, created_at DESC);

-- Login sessions (table layout required by connect-pg-simple)
CREATE TABLE session (
  sid    varchar NOT NULL COLLATE "default" PRIMARY KEY,
  sess   json NOT NULL,
  expire timestamp(6) NOT NULL
);
CREATE INDEX session_expire_idx ON session (expire);

-- ---------------------------------------------------------------------------
-- Store settings (single row)
-- ---------------------------------------------------------------------------
CREATE TABLE store_settings (
  id                     smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  store_name             text NOT NULL DEFAULT 'My Tindahan',
  address                text NOT NULL DEFAULT '',
  phone                  text NOT NULL DEFAULT '',
  email                  text NOT NULL DEFAULT '',
  tin                    text NOT NULL DEFAULT '',
  receipt_message        text NOT NULL DEFAULT 'Salamat po! Balik po kayo muli.',
  logo_url               text,
  timezone               text NOT NULL DEFAULT 'Asia/Manila',
  owner_pin_hash         text,                          -- 4-digit PIN for refunds
  owner_pin_changed_at   timestamptz,
  two_step_enabled       boolean NOT NULL DEFAULT false, -- stored only; no SMS provider is wired up
  discount_percent       numeric(5,2) NOT NULL DEFAULT 20, -- senior / PWD discount
  gcash_fee_percent      numeric(5,2) NOT NULL DEFAULT 1,
  gcash_min_fee          numeric(8,2) NOT NULL DEFAULT 10,
  gcash_min_float        numeric(12,2) NOT NULL DEFAULT 10000,
  gcash_target_float     numeric(12,2) NOT NULL DEFAULT 20000,
  gcash_opening_float    numeric(12,2) NOT NULL DEFAULT 0,  -- float before the first recorded transaction
  drawer_opening_cash    numeric(12,2) NOT NULL DEFAULT 0,  -- drawer cash before the first recorded sale
  updated_at             timestamptz NOT NULL DEFAULT now()
);
INSERT INTO store_settings (id) VALUES (1);

-- ---------------------------------------------------------------------------
-- Catalogue and stock
-- ---------------------------------------------------------------------------
CREATE TABLE categories (
  id         serial PRIMARY KEY,
  name       text NOT NULL UNIQUE,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE suppliers (
  id     serial PRIMARY KEY,
  name   text NOT NULL UNIQUE,
  mobile text
);

CREATE TABLE products (
  id            serial PRIMARY KEY,
  name          text NOT NULL,
  description   text NOT NULL DEFAULT '',          -- e.g. 'Kalamansi 80g'
  barcode       text UNIQUE,
  category_id   integer REFERENCES categories(id) ON DELETE SET NULL,
  supplier_id   integer REFERENCES suppliers(id) ON DELETE SET NULL,
  price         numeric(12,2) NOT NULL CHECK (price >= 0),
  cost          numeric(12,2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  stock_qty     integer NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  reorder_level integer NOT NULL DEFAULT 5 CHECK (reorder_level >= 0),
  unit          text NOT NULL DEFAULT 'pcs',
  image_url     text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_category_idx ON products (category_id);
CREATE INDEX products_name_idx ON products (lower(name));

CREATE TABLE restocks (
  id           bigserial PRIMARY KEY,
  product_id   integer NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  supplier_id  integer REFERENCES suppliers(id) ON DELETE SET NULL,
  user_id      integer REFERENCES users(id) ON DELETE SET NULL,
  quantity     integer NOT NULL CHECK (quantity > 0),
  unit_cost    numeric(12,2) NOT NULL CHECK (unit_cost >= 0),
  invoice_no   text,
  received_on  date NOT NULL DEFAULT current_date,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX restocks_product_idx ON restocks (product_id, created_at DESC);

-- Every change to stock is recorded here (sales, restocks, refunds, manual fixes).
CREATE TABLE stock_movements (
  id          bigserial PRIMARY KEY,
  product_id  integer NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id     integer REFERENCES users(id) ON DELETE SET NULL,
  kind        text NOT NULL CHECK (kind IN ('sale','restock','refund','adjustment')),
  qty_change  integer NOT NULL,
  ref_type    text,
  ref_id      bigint,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_movements_product_idx ON stock_movements (product_id, created_at, id);

-- ---------------------------------------------------------------------------
-- Customers (for "utang" / credit sales)
-- ---------------------------------------------------------------------------
CREATE TABLE customers (
  id         serial PRIMARY KEY,
  name       text NOT NULL,
  mobile     text,
  balance    numeric(12,2) NOT NULL DEFAULT 0,   -- unpaid utang
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX customers_name_key ON customers (lower(name));

-- ---------------------------------------------------------------------------
-- Shifts (clock-in and drawer opening cash)
-- ---------------------------------------------------------------------------
CREATE TABLE shifts (
  id           bigserial PRIMARY KEY,
  user_id      integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  station      text NOT NULL DEFAULT 'Register 1',
  opening_cash numeric(12,2) NOT NULL DEFAULT 0,
  closing_cash numeric(12,2),
  started_at   timestamptz NOT NULL DEFAULT now(),
  ended_at     timestamptz
);
CREATE INDEX shifts_user_idx ON shifts (user_id, started_at DESC);

-- Weekly schedule used for the "Shift coverage" card. weekday: 0 = Monday ... 6 = Sunday
CREATE TABLE staff_schedule (
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  shift   text NOT NULL CHECK (shift IN ('morning','evening')),
  PRIMARY KEY (user_id, weekday, shift)
);

-- ---------------------------------------------------------------------------
-- Sales
-- ---------------------------------------------------------------------------
CREATE SEQUENCE sale_no_seq;

CREATE TABLE sales (
  id             bigserial PRIMARY KEY,
  sale_no        text NOT NULL UNIQUE DEFAULT ('SALE-' || lpad(nextval('sale_no_seq')::text, 4, '0')),
  user_id        integer NOT NULL REFERENCES users(id),
  customer_id    integer REFERENCES customers(id) ON DELETE SET NULL,
  station        text NOT NULL DEFAULT 'Register 1',
  payment_method text NOT NULL CHECK (payment_method IN ('cash','gcash','utang')),
  subtotal       numeric(12,2) NOT NULL,
  discount       numeric(12,2) NOT NULL DEFAULT 0,
  discount_type  text CHECK (discount_type IN ('senior','pwd')),
  total          numeric(12,2) NOT NULL,
  cash_received  numeric(12,2),
  change_given   numeric(12,2),
  status         text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','refunded')),
  refunded_by    integer REFERENCES users(id) ON DELETE SET NULL,
  refunded_at    timestamptz,
  refund_reason  text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sales_created_idx ON sales (created_at DESC);
CREATE INDEX sales_user_created_idx ON sales (user_id, created_at DESC);

CREATE TABLE sale_items (
  id           bigserial PRIMARY KEY,
  sale_id      bigint NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id   integer REFERENCES products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  description  text NOT NULL DEFAULT '',
  qty          integer NOT NULL CHECK (qty > 0),
  unit_price   numeric(12,2) NOT NULL,
  unit_cost    numeric(12,2) NOT NULL DEFAULT 0,
  line_total   numeric(12,2) GENERATED ALWAYS AS (qty * unit_price) STORED
);
CREATE INDEX sale_items_sale_idx ON sale_items (sale_id);
CREATE INDEX sale_items_product_idx ON sale_items (product_id);

-- ---------------------------------------------------------------------------
-- GCash cash in / cash out
-- ---------------------------------------------------------------------------
CREATE SEQUENCE gc_no_seq;

CREATE TABLE gcash_transactions (
  id            bigserial PRIMARY KEY,
  gc_no         text NOT NULL UNIQUE DEFAULT ('GC-' || lpad(nextval('gc_no_seq')::text, 4, '0')),
  type          text NOT NULL CHECK (type IN ('cash_in','cash_out')),
  customer_name text NOT NULL,
  gcash_number  text,
  amount        numeric(12,2) NOT NULL CHECK (amount > 0),
  fee           numeric(12,2) NOT NULL DEFAULT 0,
  fee_mode      text CHECK (fee_mode IN ('deduct','separate')),  -- cash out only
  reference     text,
  status        text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','voided')),
  user_id       integer NOT NULL REFERENCES users(id),
  station       text NOT NULL DEFAULT 'Register 1',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gcash_created_idx ON gcash_transactions (created_at DESC);

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  user_id    integer REFERENCES users(id) ON DELETE SET NULL,
  action     text NOT NULL,           -- e.g. 'staff.create', 'sale.refund'
  entity     text,
  entity_id  text,
  meta       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);
