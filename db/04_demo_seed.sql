-- Demo data so every screen has something to show. OPTIONAL: skip this file for a real store.
-- Run after 01, 02 and 03. It simulates about 30 days of sales, GCash transactions and restocks.
--
-- Demo logins (all use the same password):   Tindahan#123
--   mariasantos   owner
--   juandelacruz  cashier (day shift)       anareyes   cashier (evening shift)
--   markv, elenab, jaysond, cristines, ramoncruz   cashiers      lizam   cashier (inactive)
--
-- "Today" only has sales for hours that have already passed, so run this during the day
-- (or after 9 AM) if you want the dashboard to look busy. Re-run 00 -> 04 any time to reset.

-- ---------------------------------------------------------------------------
-- Store, categories, suppliers
-- ---------------------------------------------------------------------------
UPDATE store_settings SET
  store_name      = 'Aling Maria''s Tindahan & E-Services',
  address         = 'Ibabao, Perrelos, Carcar City, Cebu',
  phone           = '0917 555 0192',
  email           = 'alingmaria.store@gmail.com',
  tin             = '402-991-881-000',
  receipt_message = 'Salamat po! Balik po kayo muli.',
  owner_pin_hash  = crypt('1234', gen_salt('bf', 10)),
  owner_pin_changed_at = now() - interval '3 days',
  updated_at      = now()
WHERE id = 1;

INSERT INTO categories (name, sort_order) VALUES
  ('Instant noodles', 1), ('Canned goods', 2), ('Beverages', 3), ('Rice and staples', 4),
  ('Condiments', 5), ('Snacks', 6), ('Toiletries', 7), ('Dairy and eggs', 8);

INSERT INTO suppliers (name, mobile) VALUES
  ('Gaisano GrandMall', '0917 600 1001'), ('Carcar Public Market', '0918 600 1002'),
  ('Puregold Wholesale', '0919 600 1003'), ('Metro Retail Wholesale', '0920 600 1004');

-- ---------------------------------------------------------------------------
-- Users (passwords are hashed with bcrypt by pgcrypto; the Node app verifies them with bcryptjs)
-- ---------------------------------------------------------------------------
INSERT INTO users (username, full_name, email, mobile, password_hash, role_id, is_active, avatar_key, job_title, station, daily_goal, created_at)
SELECT v.username, v.full_name, v.email, v.mobile, crypt('Tindahan#123', gen_salt('bf', 10)),
       (SELECT id FROM roles WHERE code = v.role), v.active, v.avatar, v.title, 'Register 1', 7000, v.created::timestamptz
FROM (VALUES
  ('mariasantos',  'Maria Santos',     'maria.santos@tindahan.ph', '0917 123 4567', 'owner',   true,  'maria', 'Store owner',            '2026-10-01 08:00+08'),
  ('juandelacruz', 'Juan Dela Cruz',   'juan@example.com',         '0917 123 4567', 'cashier', true,  'juan',  'Cashier, day shift',     '2026-10-12 08:00+08'),
  ('anareyes',     'Ana Reyes',        'ana@example.com',          '0918 234 5678', 'cashier', true,  'ana',   'Cashier, evening shift', '2026-10-14 08:00+08'),
  ('markv',        'Mark Villanueva',  NULL,                       '0922 345 6789', 'cashier', true,  NULL,    'Weekend staff',          '2026-10-15 08:00+08'),
  ('elenab',       'Elena Bautista',   'elena@tindahan.ph',        '0920 456 7890', 'cashier', true,  NULL,    'Cashier, morning shift', '2026-10-19 08:00+08'),
  ('jaysond',      'Jayson Dizon',     NULL,                       '0927 567 8901', 'cashier', true,  NULL,    'Inventory clerk',        '2026-10-22 08:00+08'),
  ('cristines',    'Cristine Santos',  NULL,                       '0915 678 9012', 'cashier', true,  NULL,    'Part-time cashier',      '2026-10-25 08:00+08'),
  ('ramoncruz',    'Ramon Cruz',       NULL,                       '0908 789 0123', 'cashier', true,  NULL,    'Senior cashier',         '2026-10-27 08:00+08'),
  ('lizam',        'Liza Magbanua',    NULL,                       '0939 890 1234', 'cashier', false, NULL,    'Cashier, on leave',      '2026-11-01 08:00+08')
) AS v(username, full_name, email, mobile, role, active, avatar, title, created);
UPDATE users SET created_by = (SELECT id FROM users WHERE username = 'mariasantos') WHERE username <> 'mariasantos';

-- Weekly schedule (weekday 0 = Monday)
INSERT INTO staff_schedule (user_id, weekday, shift)
SELECT u.id, wd, s.shift FROM (VALUES
  ('juandelacruz', ARRAY[0,1,2,3,4,5],   'morning'),
  ('elenab',       ARRAY[0,1,2,3,4,5,6], 'morning'),
  ('ramoncruz',    ARRAY[0,1,2,3,4,6],   'morning'),
  ('markv',        ARRAY[5,6],           'morning'),
  ('jaysond',      ARRAY[5],             'morning'),
  ('anareyes',     ARRAY[0,1,2,3,4,5,6], 'evening'),
  ('cristines',    ARRAY[3,4,5,6],       'evening'),
  ('markv',        ARRAY[0,1,4],         'evening')
) AS s(username, days, shift)
JOIN users u ON u.username = s.username
CROSS JOIN LATERAL unnest(s.days) AS wd
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Products. weight = how often it sells, no_restock = left to run low, final_stock = demo state to end on
-- ---------------------------------------------------------------------------
CREATE TABLE _seed_products (
  name text, descr text, category text, supplier text, price numeric, cost numeric, reorder int, unit text,
  weight numeric, no_restock boolean, final_stock int, barcode text
);
INSERT INTO _seed_products VALUES
 ('Lucky Me! Pancit Canton','Kalamansi 80g','Instant noodles','Puregold Wholesale',15,12,12,'pcs',11,true,3,'4800016644158'),
 ('Lucky Me! Pancit Canton','Chilimansi 80g','Instant noodles','Puregold Wholesale',15,12,12,'pcs',7,false,NULL,NULL),
 ('Lucky Me! Beef Na Beef','Mami beef 55g','Instant noodles','Puregold Wholesale',12,9,12,'pcs',5,false,NULL,NULL),
 ('Payless Xtra Big','Chicken noodles 90g','Instant noodles','Puregold Wholesale',11,8.5,10,'pcs',4,false,NULL,NULL),
 ('Nissin Cup Noodles','Seafood 40g','Instant noodles','Metro Retail Wholesale',25,20,8,'cups',3,false,NULL,NULL),
 ('Lucky Me! Instant Mami','Chicken 55g','Instant noodles','Puregold Wholesale',12,9,12,'pcs',4,false,NULL,NULL),
 ('Mega Sardines','Tomato sauce 155g','Canned goods','Gaisano GrandMall',24,19,18,'cans',7,true,5,NULL),
 ('Ligo Sardines','Tomato sauce 155g','Canned goods','Gaisano GrandMall',25,20,15,'cans',5,false,NULL,NULL),
 ('Argentina Corned Beef','Regular 150g','Canned goods','Gaisano GrandMall',57,47,10,'cans',4,false,NULL,NULL),
 ('Century Tuna','Flakes in oil 155g','Canned goods','Metro Retail Wholesale',38,31,10,'cans',4,false,NULL,NULL),
 ('Purefoods Corned Beef','Regular 150g','Canned goods','Metro Retail Wholesale',62,52,8,'cans',0.04,false,NULL,NULL),
 ('555 Tuna Afritada','155g','Canned goods','Gaisano GrandMall',28,23,10,'cans',3,false,NULL,NULL),
 ('Hunt''s Pork & Beans','230g','Canned goods','Metro Retail Wholesale',36,30,8,'cans',0.04,false,NULL,NULL),
 ('Kopiko Blanca','3-in-1 sachet 30g','Beverages','Puregold Wholesale',5,3.5,20,'sachets',12,true,4,NULL),
 ('Great Taste White','3-in-1 coffee 28g','Beverages','Puregold Wholesale',6,4.5,20,'sachets',7,false,NULL,NULL),
 ('Nescafé Original','3-in-1 stick 20g','Beverages','Puregold Wholesale',7,5.5,20,'sachets',5,false,NULL,NULL),
 ('Coca-Cola','250ml bottle','Beverages','Carcar Public Market',20,15,12,'bottles',9,false,NULL,NULL),
 ('Coca-Cola','1.5L bottle','Beverages','Carcar Public Market',75,62,6,'bottles',3,false,NULL,NULL),
 ('Sprite','250ml bottle','Beverages','Carcar Public Market',20,15,12,'bottles',5,false,NULL,NULL),
 ('San Miguel Pale Pilsen','330ml bottle','Beverages','Carcar Public Market',55,44,12,'bottles',4,true,0,NULL),
 ('Red Horse Beer','500ml bottle','Beverages','Carcar Public Market',70,58,8,'bottles',3,false,NULL,NULL),
 ('C2 Green Tea','Apple 230ml','Beverages','Metro Retail Wholesale',22,17,12,'bottles',6,false,NULL,NULL),
 ('Wilkins Pure','Drinking water 500ml','Beverages','Carcar Public Market',15,10,15,'bottles',7,false,NULL,NULL),
 ('Sinandomeng Rice','Premium, per kilo','Rice and staples','Carcar Public Market',54,46,30,'kg',8,false,NULL,NULL),
 ('Sinandomeng Rice','Premium, 5 kg','Rice and staples','Carcar Public Market',270,230,8,'sacks',5,true,6,NULL),
 ('Brown Rice','Per kilo','Rice and staples','Carcar Public Market',62,52,10,'kg',0.04,false,NULL,NULL),
 ('White Sugar','Per kilo','Rice and staples','Carcar Public Market',85,74,10,'kg',3,false,NULL,NULL),
 ('Iodized Salt','Fine 500g','Rice and staples','Carcar Public Market',18,13,10,'packs',2,false,NULL,NULL),
 ('Datu Puti Suka','Cane vinegar 385ml','Condiments','Gaisano GrandMall',22,17,12,'bottles',4,true,3,NULL),
 ('Silver Swan Soy Sauce','Kasalo bottle 385ml','Condiments','Gaisano GrandMall',20,15,12,'bottles',5,false,NULL,NULL),
 ('UFC Banana Ketchup','Regular 320g','Condiments','Metro Retail Wholesale',28,22,8,'bottles',3,false,NULL,NULL),
 ('Knorr Liquid Seasoning','130ml','Condiments','Metro Retail Wholesale',25,20,8,'bottles',2,false,NULL,NULL),
 ('Magic Sarap','Seasoning 8g','Condiments','Puregold Wholesale',5,3.5,25,'sachets',5,false,NULL,NULL),
 ('Baguio Cooking Oil','Coconut oil 1L','Condiments','Gaisano GrandMall',98,84,6,'bottles',2,false,NULL,NULL),
 ('Piattos','Cheese 40g','Snacks','Puregold Wholesale',18,14,10,'bags',8,true,0,NULL),
 ('Nova','Country cheddar 40g','Snacks','Puregold Wholesale',18,14,10,'bags',4,false,NULL,NULL),
 ('Chippy','BBQ 27g','Snacks','Puregold Wholesale',8,6,20,'bags',6,false,NULL,NULL),
 ('Oishi Prawn Crackers','Spicy 24g','Snacks','Puregold Wholesale',8,6,20,'bags',4,false,NULL,NULL),
 ('Fudgee Barr','Chocolate 42g','Snacks','Puregold Wholesale',10,7.5,15,'pcs',4,false,NULL,NULL),
 ('Cloud 9','Classic chocolate bar','Snacks','Puregold Wholesale',13,10,15,'pcs',3,false,NULL,NULL),
 ('Safeguard','Pure white soap 60g','Toiletries','Metro Retail Wholesale',28,22,10,'bars',3,false,NULL,NULL),
 ('Surf','Powder blossom fresh 1kg','Toiletries','Metro Retail Wholesale',115,96,6,'packs',2,false,NULL,NULL),
 ('Palmolive Shampoo','Naturals sachet 12ml','Toiletries','Metro Retail Wholesale',7,5,30,'sachets',4,false,NULL,NULL),
 ('Colgate','Great regular flavor 25g','Toiletries','Metro Retail Wholesale',28,22,8,'tubes',2,false,NULL,NULL),
 ('Joy Dishwashing Liquid','Lemon 250ml','Toiletries','Metro Retail Wholesale',48,39,6,'bottles',2,false,NULL,NULL),
 ('Bear Brand','Adult plus milk 300g','Dairy and eggs','Metro Retail Wholesale',145,120,6,'packs',2,false,NULL,NULL),
 ('Eggs','Medium, per piece','Dairy and eggs','Carcar Public Market',9,7,30,'pcs',6,false,NULL,NULL),
 ('Alaska Evaporada','Evaporated milk 140ml','Dairy and eggs','Metro Retail Wholesale',27,22,8,'cans',2,false,NULL,NULL),
 ('Selecta Cornetto','Vanilla cone','Dairy and eggs','Metro Retail Wholesale',30,24,8,'pcs',0.03,false,NULL,NULL);

INSERT INTO products (name, description, barcode, category_id, supplier_id, price, cost, stock_qty, reorder_level, unit)
SELECT sp.name, sp.descr, sp.barcode, c.id, s.id, sp.price, sp.cost, 0, sp.reorder, sp.unit
FROM _seed_products sp
JOIN categories c ON c.name = sp.category
JOIN suppliers s ON s.name = sp.supplier
ORDER BY sp.category, sp.name, sp.descr;

UPDATE products SET barcode = '48' || lpad(id::text, 11, '0') WHERE barcode IS NULL;

-- Utang customers
INSERT INTO customers (name, mobile) VALUES
  ('Aling Nena', '0917 301 1111'), ('Mang Tonyo', '0918 302 2222'),
  ('Kuya Rey', '0919 303 3333'), ('Ate Lorna', '0920 304 4444');

-- ---------------------------------------------------------------------------
-- Simulate the last 30 days (and today up to the last full hour)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  tz          text := store_tz();
  today       date := store_today();
  now_hour    integer := extract(hour FROM now() AT TIME ZONE store_tz())::int;
  maria       integer := (SELECT id FROM users WHERE username = 'mariasantos');
  w_hours     integer[] := ARRAY[8,9,10,11,12,13,14,15,16,17,18,19];
  w_vals      numeric[] := ARRAY[5,9,13,12,9,6,5,6,8,12,11,6];
  base_by_dow integer[] := ARRAY[100,96,102,110,125,145,128];   -- Monday first
  day_idx     integer;
  d           date;
  dow         integer;
  maxh        integer;
  tot         numeric;
  acc         numeric;
  r           numeric;
  n_sales     integer;
  n_gcash     integer;
  i           integer;
  j           integer;
  h           integer;
  mi          integer;
  ts          timestamptz;
  uid         integer;
  pay         text;
  cust        integer;
  sid         bigint;
  lines       integer;
  qty         integer;
  prod        record;
  sub         numeric;
  disc        numeric;
  dtype       text;
  tot_amt     numeric;
  recv        numeric;
  amt         numeric;
  amounts     numeric[] := ARRAY[100,200,300,500,500,1000,1000,1500,2000,3000,5000];
  names       text[] := ARRAY['Maria Santos','Pedro Reyes','Elena Bautista','Ramon Cruz','Ailyn Mercado','Jayson Dizon','Rosa Villanueva','Tomas Abella','Liza Gomez','Nilo Pacaña','Joy Alcantara','Dante Rivera'];
BEGIN
  PERFORM setseed(0.2026);

  CREATE TEMP TABLE sim (
    id integer PRIMARY KEY, name text, descr text, weight numeric, price numeric, cost numeric,
    stock integer, reorder integer, no_restock boolean
  ) ON COMMIT DROP;
  INSERT INTO sim
  SELECT p.id, p.name, p.description, sp.weight, p.price, p.cost,
         CASE WHEN sp.no_restock THEN 55 ELSE p.reorder_level * 8 + 40 END,
         p.reorder_level, sp.no_restock
  FROM products p JOIN _seed_products sp ON sp.name = p.name AND sp.descr = p.description;

  -- Opening stock, dated before the first sale
  INSERT INTO stock_movements (product_id, user_id, kind, qty_change, note, created_at)
  SELECT id, maria, 'adjustment', stock, 'Opening stock', (today - 31)::timestamp AT TIME ZONE tz FROM sim;

  FOR day_idx IN REVERSE 30..0 LOOP
    d := today - day_idx;
    dow := extract(isodow FROM d)::int - 1;
    maxh := CASE WHEN day_idx = 0 THEN LEAST(now_hour - 1, 19) ELSE 19 END;
    CONTINUE WHEN maxh < 8;

    -- how many sales today: a share of the full-day count when the day is not over
    tot := 0; acc := 0;
    FOR j IN 1..12 LOOP tot := tot + w_vals[j]; IF w_hours[j] <= maxh THEN acc := acc + w_vals[j]; END IF; END LOOP;
    n_sales := round((base_by_dow[dow + 1] + (random() * 16 - 8)) * acc / tot);
    n_gcash := round((20 + random() * 10) * acc / tot);

    -- ---- sales ----
    FOR i IN 1..n_sales LOOP
      -- pick an hour, weighted (Saturday 10 AM is the busiest)
      tot := 0;
      FOR j IN 1..12 LOOP IF w_hours[j] <= maxh THEN tot := tot + w_vals[j] * CASE WHEN dow = 5 AND w_hours[j] = 10 THEN 1.7 ELSE 1 END; END IF; END LOOP;
      r := random() * tot; acc := 0; h := 8;
      FOR j IN 1..12 LOOP
        IF w_hours[j] <= maxh THEN
          acc := acc + w_vals[j] * CASE WHEN dow = 5 AND w_hours[j] = 10 THEN 1.7 ELSE 1 END;
          IF r <= acc THEN h := w_hours[j]; EXIT; END IF;
        END IF;
      END LOOP;
      mi := floor(random() * 60)::int;
      ts := (d::timestamp + make_interval(hours => h, mins => mi, secs => floor(random() * 60)::int)) AT TIME ZONE tz;

      -- who rang it up
      r := random();
      IF h < 14 THEN
        SELECT id INTO uid FROM users WHERE username = CASE WHEN r < 0.45 THEN 'juandelacruz' WHEN r < 0.65 THEN 'elenab' WHEN r < 0.80 THEN 'ramoncruz' WHEN r < 0.95 THEN 'mariasantos' ELSE 'markv' END;
      ELSE
        SELECT id INTO uid FROM users WHERE username = CASE WHEN r < 0.40 THEN 'anareyes' WHEN r < 0.65 THEN 'mariasantos' WHEN r < 0.80 THEN 'cristines' WHEN r < 0.90 THEN 'ramoncruz' ELSE 'markv' END;
      END IF;

      r := random();
      pay := CASE WHEN r < 0.67 THEN 'cash' WHEN r < 0.95 THEN 'gcash' ELSE 'utang' END;
      cust := NULL;
      IF pay = 'utang' THEN SELECT id INTO cust FROM customers ORDER BY random() LIMIT 1; END IF;

      INSERT INTO sales (user_id, customer_id, payment_method, subtotal, total, created_at)
      VALUES (uid, cust, pay, 0, 0, ts) RETURNING id INTO sid;

      lines := 1 + floor(power(random(), 1.5) * 4)::int;
      sub := 0;
      FOR prod IN SELECT s.id, s.name, s.descr, s.price, s.cost, s.stock FROM sim s WHERE s.stock > 0
                  ORDER BY -ln(random()) / s.weight LIMIT lines LOOP
        qty := LEAST(prod.stock, 1 + floor(random() * random() * 4)::int);
        INSERT INTO sale_items (sale_id, product_id, product_name, description, qty, unit_price, unit_cost)
        VALUES (sid, prod.id, prod.name, prod.descr, qty, prod.price, prod.cost);
        INSERT INTO stock_movements (product_id, user_id, kind, qty_change, ref_type, ref_id, created_at)
        VALUES (prod.id, uid, 'sale', -qty, 'sale', sid, ts);
        UPDATE sim SET stock = stock - qty WHERE id = prod.id;
        sub := sub + qty * prod.price;
      END LOOP;

      IF sub = 0 THEN DELETE FROM sales WHERE id = sid; CONTINUE; END IF;

      disc := 0; dtype := NULL;
      IF random() < 0.04 THEN dtype := CASE WHEN random() < 0.5 THEN 'senior' ELSE 'pwd' END; disc := round(sub * 0.20, 2); END IF;
      tot_amt := sub - disc;
      recv := NULL;
      IF pay = 'cash' THEN recv := CASE WHEN random() < 0.4 THEN tot_amt ELSE ceil(tot_amt / 50) * 50 END; END IF;
      UPDATE sales SET subtotal = sub, discount = disc, discount_type = dtype, total = tot_amt,
                       cash_received = recv, change_given = CASE WHEN recv IS NULL THEN NULL ELSE recv - tot_amt END
      WHERE id = sid;
      IF pay = 'utang' THEN UPDATE customers SET balance = balance + tot_amt WHERE id = cust; END IF;
    END LOOP;

    -- ---- GCash cash in / cash out ----
    FOR i IN 1..n_gcash LOOP
      h := 8 + floor(random() * (maxh - 8 + 1))::int;
      ts := (d::timestamp + make_interval(hours => h, mins => floor(random() * 60)::int)) AT TIME ZONE tz;
      amt := amounts[1 + floor(random() * array_length(amounts, 1))::int];
      SELECT id INTO uid FROM users WHERE username = CASE WHEN h < 14 THEN 'juandelacruz' ELSE 'anareyes' END;
      IF random() < 0.6 THEN
        INSERT INTO gcash_transactions (type, customer_name, gcash_number, amount, fee, reference, user_id, created_at)
        VALUES ('cash_in', names[1 + floor(random() * 12)::int], '09' || lpad(floor(random() * 1e9)::bigint::text, 9, '0'),
                amt, greatest(10, round(amt * 0.01)), NULL, uid, ts);
      ELSE
        INSERT INTO gcash_transactions (type, customer_name, gcash_number, amount, fee, fee_mode, reference, user_id, created_at)
        VALUES ('cash_out', names[1 + floor(random() * 12)::int], '09' || lpad(floor(random() * 1e9)::bigint::text, 9, '0'),
                amt, greatest(10, round(amt * 0.01)), CASE WHEN random() < 0.7 THEN 'deduct' ELSE 'separate' END,
                lpad(floor(random() * 1e4)::int::text, 4, '0') || ' ' || lpad(floor(random() * 1e4)::int::text, 4, '0') || ' ' || lpad(floor(random() * 1e4)::int::text, 4, '0'),
                uid, ts);
      END IF;
    END LOOP;

    -- ---- evening restock for products running low (some are left low on purpose) ----
    IF day_idx > 0 THEN
      FOR prod IN SELECT s.id, s.cost, s.reorder, s.stock FROM sim s WHERE s.stock <= s.reorder * 3 AND (NOT s.no_restock OR day_idx > 5) AND random() < 0.9 LOOP
        qty := prod.reorder * 8 + 40 - prod.stock;
        INSERT INTO restocks (product_id, supplier_id, user_id, quantity, unit_cost, invoice_no, received_on, created_at)
        VALUES (prod.id, (SELECT supplier_id FROM products WHERE id = prod.id), maria, qty, prod.cost,
                'Inv #SA-' || (80000 + floor(random() * 9999))::int, d, (d::timestamp + interval '21 hours') AT TIME ZONE tz);
        INSERT INTO stock_movements (product_id, user_id, kind, qty_change, ref_type, note, created_at)
        VALUES (prod.id, maria, 'restock', qty, 'restock', 'Delivery', (d::timestamp + interval '21 hours') AT TIME ZONE tz);
        UPDATE sim SET stock = stock + qty WHERE id = prod.id;
      END LOOP;
    END IF;
  END LOOP;

  -- Bring products to the simulated stock, then force the demo states (low / out of stock)
  UPDATE products p SET stock_qty = s.stock FROM sim s WHERE s.id = p.id;
  INSERT INTO stock_movements (product_id, user_id, kind, qty_change, note, created_at)
  SELECT p.id, maria, 'adjustment', sp.final_stock - p.stock_qty, 'Stock count', now() - interval '2 hours'
  FROM products p JOIN _seed_products sp ON sp.name = p.name AND sp.descr = p.description
  WHERE sp.final_stock IS NOT NULL AND sp.final_stock <> p.stock_qty;
  UPDATE products p SET stock_qty = sp.final_stock FROM _seed_products sp
  WHERE sp.name = p.name AND sp.descr = p.description AND sp.final_stock IS NOT NULL;
END $$;

DROP TABLE _seed_products;

-- ---------------------------------------------------------------------------
-- Today's shifts (clock-ins), then set the opening balances so the drawer shows
-- ₱8,450.00 and the GCash float ₱14,820.00 right now.
-- ---------------------------------------------------------------------------
INSERT INTO shifts (user_id, station, opening_cash, started_at)
SELECT u.id, 'Register 1', v.cash,
       LEAST(now(), (store_today()::timestamp + interval '8 hours') AT TIME ZONE store_tz())
FROM (VALUES ('juandelacruz', 1500), ('elenab', 1000), ('ramoncruz', 1000), ('markv', 1000), ('cristines', 1000)) AS v(username, cash)
JOIN users u ON u.username = v.username;

UPDATE store_settings SET gcash_opening_float = 0, drawer_opening_cash = 0 WHERE id = 1;
UPDATE store_settings SET
  gcash_opening_float = 14820 - gcash_float(),
  drawer_opening_cash = 8450 - drawer_cash()
WHERE id = 1;

SELECT setval('sale_no_seq', GREATEST((SELECT max(substring(sale_no FROM 6)::int) FROM sales), 1));
SELECT setval('gc_no_seq', GREATEST((SELECT max(substring(gc_no FROM 4)::int) FROM gcash_transactions), 1));
