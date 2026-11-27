-- Helper and analytics functions. Safe to re-run (CREATE OR REPLACE).
-- The Node API calls these with e.g.  SELECT analytics_overview(7) AS data;
-- Every analytics function returns one jsonb document, so you can also try them
-- by hand in pgAdmin's Query Tool.

-- ---------------------------------------------------------------------------
-- Small helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION store_tz() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT timezone FROM store_settings WHERE id = 1 $$;

CREATE OR REPLACE FUNCTION store_today() RETURNS date LANGUAGE sql STABLE AS
$$ SELECT (now() AT TIME ZONE store_tz())::date $$;

CREATE OR REPLACE FUNCTION pct_change(cur numeric, prev numeric) RETURNS numeric LANGUAGE sql IMMUTABLE AS
$$ SELECT CASE WHEN prev IS NULL OR prev = 0 THEN NULL ELSE round((cur - prev) / prev * 100, 1) END $$;

-- Start and end (local dates, inclusive) for a period code used by the reports.
--   today | week (last 7 days) | month (this calendar month) | 30d (last 30 days)
CREATE OR REPLACE FUNCTION period_range(p text, OUT d_from date, OUT d_to date) LANGUAGE plpgsql STABLE AS $$
BEGIN
  d_to := store_today();
  IF p = 'today' THEN d_from := d_to;
  ELSIF p = 'month' THEN d_from := date_trunc('month', d_to)::date;
  ELSIF p = '30d' THEN d_from := d_to - 29;
  ELSE d_from := d_to - 6;   -- 'week'
  END IF;
END $$;

-- Completed sales between two local dates (inclusive), with the local timestamp.
CREATE OR REPLACE FUNCTION sales_in(d_from date, d_to date)
RETURNS TABLE (id bigint, lts timestamp, total numeric, payment_method text, user_id integer)
LANGUAGE sql STABLE AS $$
  SELECT s.id, (s.created_at AT TIME ZONE store_tz()), s.total, s.payment_method, s.user_id
  FROM sales s
  WHERE s.status = 'completed'
    AND s.created_at >= (d_from::timestamp AT TIME ZONE store_tz())
    AND s.created_at <  ((d_to + 1)::timestamp AT TIME ZONE store_tz())
$$;

-- Money in the GCash wallet: opening + cash outs received - cash ins sent + GCash QR sales
CREATE OR REPLACE FUNCTION gcash_float() RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT st.gcash_opening_float
       + COALESCE((SELECT sum(CASE WHEN type = 'cash_out' THEN amount ELSE -amount END)
                   FROM gcash_transactions WHERE status = 'completed'), 0)
       + COALESCE((SELECT sum(total) FROM sales WHERE status = 'completed' AND payment_method = 'gcash'), 0)
  FROM store_settings st WHERE st.id = 1
$$;

-- Cash in the drawer: opening + cash sales + GCash cash-in collected - GCash cash-out paid
-- - cash paid to suppliers for restocks
CREATE OR REPLACE FUNCTION drawer_cash() RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT st.drawer_opening_cash
       + COALESCE((SELECT sum(total) FROM sales WHERE status = 'completed' AND payment_method = 'cash'), 0)
       + COALESCE((SELECT sum(CASE WHEN type = 'cash_in' THEN amount + fee ELSE -(amount - fee) END)
                   FROM gcash_transactions WHERE status = 'completed'), 0)
       - COALESCE((SELECT sum(quantity * unit_cost) FROM restocks), 0)
  FROM store_settings st WHERE st.id = 1
$$;

-- ---------------------------------------------------------------------------
-- Owner dashboard: today at a glance, week chart, running low, recent sales
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION dashboard_owner() RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  tz text := store_tz();
  today date := store_today();
  now_local timestamp := now() AT TIME ZONE store_tz();
  res jsonb;
BEGIN
  SELECT jsonb_build_object(
    'today', jsonb_build_object(
      'sales',   COALESCE((SELECT sum(total) FROM sales_in(today, today)), 0),
      'orders',  (SELECT count(*) FROM sales_in(today, today)),
      'cash_orders',  (SELECT count(*) FROM sales_in(today, today) WHERE payment_method = 'cash'),
      'gcash_orders', (SELECT count(*) FROM sales_in(today, today) WHERE payment_method = 'gcash'),
      'utang_orders', (SELECT count(*) FROM sales_in(today, today) WHERE payment_method = 'utang'),
      'yesterday_same_time', COALESCE((SELECT sum(total) FROM sales_in(today - 1, today - 1)
                                       WHERE lts::time <= now_local::time), 0)
    ),
    'drawer_cash', drawer_cash(),
    'gcash_float', gcash_float(),
    'week', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('date', d::date, 'total',
               COALESCE((SELECT sum(total) FROM sales_in(d::date, d::date)), 0)) ORDER BY d)
      FROM generate_series(today - 6, today, interval '1 day') d), '[]'::jsonb),
    'low_items', COALESCE((
      SELECT jsonb_agg(x) FROM (
        SELECT jsonb_build_object('id', p.id, 'name', p.name, 'stock_qty', p.stock_qty,
                                  'reorder_level', p.reorder_level, 'unit', p.unit) AS x
        FROM products p WHERE p.is_active AND p.stock_qty <= p.reorder_level
        ORDER BY p.stock_qty, p.name LIMIT 4) q), '[]'::jsonb),
    'low_count', (SELECT count(*) FROM products WHERE is_active AND stock_qty > 0 AND stock_qty <= reorder_level),
    'out_count', (SELECT count(*) FROM products WHERE is_active AND stock_qty = 0),
    'recent_sales', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'created_at') DESC) FROM (
        SELECT jsonb_build_object('id', s.id, 'sale_no', s.sale_no, 'created_at', s.created_at,
                 'cashier', u.full_name, 'payment_method', s.payment_method, 'total', s.total,
                 'items', (SELECT string_agg(si.product_name, ', ' ORDER BY si.id) FROM sale_items si WHERE si.sale_id = s.id)) AS x
        FROM sales s JOIN users u ON u.id = s.user_id
        WHERE s.status = 'completed' ORDER BY s.created_at DESC LIMIT 5) q), '[]'::jsonb)
  ) INTO res;
  RETURN res;
END $$;

-- ---------------------------------------------------------------------------
-- Owner dashboard "Analytics" section (7 days / 30 days / today)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION analytics_overview(p_days integer DEFAULT 7) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  d_end   date := store_today();
  d_start date := store_today() - (GREATEST(p_days, 1) - 1);
  n       integer := GREATEST(p_days, 1);
  p_start date := store_today() - (GREATEST(p_days, 1) - 1) - GREATEST(p_days, 1);
  p_end   date := store_today() - (GREATEST(p_days, 1) - 1) - 1;
  res jsonb;
BEGIN
  SELECT jsonb_build_object(
    'days', n,
    'kpis', (
      WITH cur AS (SELECT * FROM sales_in(d_start, d_end)), prv AS (SELECT * FROM sales_in(p_start, p_end)),
      pc AS (SELECT COALESCE(sum(si.line_total - si.qty * si.unit_cost), 0) AS profit
             FROM sale_items si WHERE si.sale_id IN (SELECT id FROM cur)),
      pp AS (SELECT COALESCE(sum(si.line_total - si.qty * si.unit_cost), 0) AS profit
             FROM sale_items si WHERE si.sale_id IN (SELECT id FROM prv))
      SELECT jsonb_build_object(
        'gross', COALESCE((SELECT sum(total) FROM cur), 0), 'prev_gross', COALESCE((SELECT sum(total) FROM prv), 0),
        'gross_pct', pct_change((SELECT sum(total) FROM cur), (SELECT sum(total) FROM prv)),
        'orders', (SELECT count(*) FROM cur), 'prev_orders', (SELECT count(*) FROM prv),
        'orders_pct', pct_change((SELECT count(*) FROM cur), (SELECT count(*) FROM prv)),
        'avg_sale', COALESCE(round((SELECT avg(total) FROM cur), 2), 0),
        'avg_pct', pct_change((SELECT avg(total) FROM cur), (SELECT avg(total) FROM prv)),
        'profit', (SELECT profit FROM pc), 'profit_pct', pct_change((SELECT profit FROM pc), (SELECT profit FROM pp)))
    ),
    'series', (
      SELECT jsonb_agg(jsonb_build_object(
               'date', d::date,
               'total', COALESCE((SELECT sum(total) FROM sales_in(d::date, d::date)), 0),
               'prev_total', COALESCE((SELECT sum(total) FROM sales_in((d::date - n), (d::date - n))), 0)) ORDER BY d)
      FROM generate_series(d_start, d_end, interval '1 day') d),
    'hourly_today', (
      SELECT jsonb_agg(jsonb_build_object('hour', h,
               'total', COALESCE((SELECT sum(total) FROM sales_in(d_end, d_end) WHERE extract(hour FROM lts) = h), 0),
               'prev_total', COALESCE((SELECT sum(total) FROM sales_in(d_end - 1, d_end - 1) WHERE extract(hour FROM lts) = h), 0)) ORDER BY h)
      FROM generate_series(8, 19) h),
    'payment_mix', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('method', payment_method, 'total', t, 'orders', c) ORDER BY t DESC)
      FROM (SELECT payment_method, sum(total) AS t, count(*) AS c FROM sales_in(d_start, d_end) GROUP BY 1) q), '[]'::jsonb),
    'heatmap', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('dow', dow, 'hour', hr, 'total', t))
      FROM (SELECT (extract(isodow FROM lts)::int - 1) AS dow, extract(hour FROM lts)::int AS hr, sum(total) AS t
            FROM sales_in(d_start, d_end) GROUP BY 1, 2) q), '[]'::jsonb),
    'top_sellers', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'revenue')::numeric DESC) FROM (
        SELECT jsonb_build_object('product_id', p.id, 'name', p.name, 'description', p.description, 'sold', sum(si.qty), 'revenue', sum(si.line_total),
                 'stock_qty', p.stock_qty, 'reorder_level', p.reorder_level, 'unit', p.unit) AS x
        FROM sale_items si JOIN sales_in(d_start, d_end) s ON s.id = si.sale_id
        JOIN products p ON p.id = si.product_id
        GROUP BY p.id ORDER BY sum(si.line_total) DESC LIMIT 5) q), '[]'::jsonb),
    'categories', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'revenue')::numeric DESC) FROM (
        SELECT jsonb_build_object('category', COALESCE(c.name, 'Others'), 'revenue', cur.rev, 'prev_revenue', COALESCE(prv.rev, 0),
                 'change_pct', pct_change(cur.rev, prv.rev)) AS x
        FROM (SELECT p.category_id, sum(si.line_total) AS rev
              FROM sale_items si JOIN sales_in(d_start, d_end) s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
              GROUP BY p.category_id) cur
        LEFT JOIN (SELECT p.category_id, sum(si.line_total) AS rev
              FROM sale_items si JOIN sales_in(p_start, p_end) s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
              GROUP BY p.category_id) prv ON prv.category_id IS NOT DISTINCT FROM cur.category_id
        LEFT JOIN categories c ON c.id = cur.category_id) q), '[]'::jsonb),
    'gcash', (
      SELECT jsonb_build_object(
        'cash_in',  COALESCE(sum(amount) FILTER (WHERE type = 'cash_in'), 0),
        'cash_out', COALESCE(sum(amount) FILTER (WHERE type = 'cash_out'), 0),
        'fees',     COALESCE(sum(fee), 0),
        'prev_fees', COALESCE((SELECT sum(fee) FROM gcash_transactions g2 WHERE g2.status = 'completed'
                       AND (g2.created_at AT TIME ZONE store_tz())::date BETWEEN p_start AND p_end), 0),
        'daily', COALESCE((SELECT jsonb_agg(jsonb_build_object('date', d::date,
                   'cash_in',  COALESCE((SELECT sum(amount) FROM gcash_transactions g3 WHERE g3.status = 'completed' AND g3.type = 'cash_in'
                                 AND (g3.created_at AT TIME ZONE store_tz())::date = d::date), 0),
                   'cash_out', COALESCE((SELECT sum(amount) FROM gcash_transactions g4 WHERE g4.status = 'completed' AND g4.type = 'cash_out'
                                 AND (g4.created_at AT TIME ZONE store_tz())::date = d::date), 0)) ORDER BY d)
                 FROM generate_series(d_start, d_end, interval '1 day') d), '[]'::jsonb),
        'float', gcash_float(), 'min_float', (SELECT gcash_min_float FROM store_settings WHERE id = 1))
      FROM gcash_transactions g
      WHERE g.status = 'completed' AND (g.created_at AT TIME ZONE store_tz())::date BETWEEN d_start AND d_end)
  ) INTO res;
  RETURN res;
END $$;

-- ---------------------------------------------------------------------------
-- Sales route: today so far versus yesterday at the same hour.
-- p_user NULL = whole store; a user id = only that person's sales.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION analytics_sales_today(p_user integer DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  today date := store_today();
  now_local timestamp := now() AT TIME ZONE store_tz();
  last_hour integer := GREATEST(extract(hour FROM now() AT TIME ZONE store_tz())::int, 11);
  res jsonb;
BEGIN
  SELECT jsonb_build_object(
    'kpis', (
      WITH t AS (SELECT * FROM sales_in(today, today) WHERE p_user IS NULL OR user_id = p_user),
           y AS (SELECT * FROM sales_in(today - 1, today - 1) WHERE (p_user IS NULL OR user_id = p_user) AND lts::time <= now_local::time),
           u AS (SELECT COALESCE(sum(si.qty), 0) AS units FROM sale_items si WHERE si.sale_id IN (SELECT id FROM t))
      SELECT jsonb_build_object(
        'sales', COALESCE((SELECT sum(total) FROM t), 0), 'orders', (SELECT count(*) FROM t),
        'cash_orders', (SELECT count(*) FROM t WHERE payment_method = 'cash'),
        'gcash_orders', (SELECT count(*) FROM t WHERE payment_method = 'gcash'),
        'utang_orders', (SELECT count(*) FROM t WHERE payment_method = 'utang'),
        'avg_sale', COALESCE(round((SELECT avg(total) FROM t), 2), 0),
        'items_per_order', CASE WHEN (SELECT count(*) FROM t) = 0 THEN 0 ELSE round((SELECT units FROM u)::numeric / (SELECT count(*) FROM t), 1) END,
        'yesterday_same_time', COALESCE((SELECT sum(total) FROM y), 0),
        'vs_yesterday_pct', pct_change((SELECT sum(total) FROM t), (SELECT sum(total) FROM y)))
    ),
    'hourly', (
      SELECT jsonb_agg(jsonb_build_object('hour', h,
          'today', COALESCE((SELECT sum(total) FROM sales_in(today, today) WHERE (p_user IS NULL OR user_id = p_user) AND extract(hour FROM lts) = h), 0),
          'yesterday', COALESCE((SELECT sum(total) FROM sales_in(today - 1, today - 1) WHERE (p_user IS NULL OR user_id = p_user) AND extract(hour FROM lts) = h), 0)) ORDER BY h)
      FROM generate_series(8, last_hour) h),
    'payment_mix', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('method', payment_method, 'total', t, 'orders', c) ORDER BY t DESC)
      FROM (SELECT payment_method, sum(total) AS t, count(*) AS c FROM sales_in(today, today)
            WHERE p_user IS NULL OR user_id = p_user GROUP BY 1) q), '[]'::jsonb),
    'by_cashier', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('user_id', u.id, 'name', u.full_name, 'role', r.name, 'avatar_key', u.avatar_key, 'total', q.t, 'orders', q.c) ORDER BY q.t DESC)
      FROM (SELECT user_id, sum(total) AS t, count(*) AS c FROM sales_in(today, today)
            WHERE p_user IS NULL OR user_id = p_user GROUP BY 1) q
      JOIN users u ON u.id = q.user_id JOIN roles r ON r.id = u.role_id), '[]'::jsonb),
    'top_items', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'revenue')::numeric DESC) FROM (
        SELECT jsonb_build_object('name', p.name, 'description', p.description, 'sold', sum(si.qty), 'revenue', sum(si.line_total)) AS x
        FROM sale_items si JOIN sales_in(today, today) s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
        WHERE p_user IS NULL OR s.user_id = p_user
        GROUP BY p.id ORDER BY sum(si.line_total) DESC LIMIT 5) q), '[]'::jsonb),
    'order_size', (
      WITH o AS (SELECT s.id, sum(si.qty) AS units FROM sales_in(today, today) s JOIN sale_items si ON si.sale_id = s.id
                 WHERE p_user IS NULL OR s.user_id = p_user GROUP BY s.id)
      SELECT jsonb_build_array(
        jsonb_build_object('label', '1 item',     'orders', (SELECT count(*) FROM o WHERE units = 1)),
        jsonb_build_object('label', '2–3 items',  'orders', (SELECT count(*) FROM o WHERE units BETWEEN 2 AND 3)),
        jsonb_build_object('label', '4–5 items',  'orders', (SELECT count(*) FROM o WHERE units BETWEEN 4 AND 5)),
        jsonb_build_object('label', '6+ items',   'orders', (SELECT count(*) FROM o WHERE units >= 6)))
    )
  ) INTO res;
  RETURN res;
END $$;

-- ---------------------------------------------------------------------------
-- Cashier dashboard: "my shift" numbers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION dashboard_cashier(p_user integer) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  today date := store_today();
  now_local timestamp := now() AT TIME ZONE store_tz();
  last_hour integer := GREATEST(extract(hour FROM now() AT TIME ZONE store_tz())::int, 11);
  goal numeric;
  shift_row record;
  res jsonb;
BEGIN
  SELECT daily_goal INTO goal FROM users WHERE id = p_user;
  SELECT * INTO shift_row FROM shifts WHERE user_id = p_user AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1;
  SELECT jsonb_build_object(
    'goal', goal,
    'shift', CASE WHEN shift_row.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', shift_row.id, 'started_at', shift_row.started_at, 'opening_cash', shift_row.opening_cash, 'station', shift_row.station) END,
    'sales_today', COALESCE((SELECT sum(total) FROM sales_in(today, today) WHERE user_id = p_user), 0),
    'orders_today', (SELECT count(*) FROM sales_in(today, today) WHERE user_id = p_user),
    'yesterday_same_time', COALESCE((SELECT sum(total) FROM sales_in(today - 1, today - 1) WHERE user_id = p_user AND lts::time <= now_local::time), 0),
    'cash_in_drawer', COALESCE(shift_row.opening_cash, 0)
        + COALESCE((SELECT sum(total) FROM sales s WHERE s.user_id = p_user AND s.status = 'completed' AND s.payment_method = 'cash'
                    AND s.created_at >= shift_row.started_at), 0)
        + COALESCE((SELECT sum(CASE WHEN type = 'cash_in' THEN amount + fee ELSE -(amount - fee) END) FROM gcash_transactions g
                    WHERE g.user_id = p_user AND g.status = 'completed' AND g.created_at >= shift_row.started_at), 0),
    'hourly', (
      SELECT jsonb_agg(jsonb_build_object('hour', h,
          'today', COALESCE((SELECT sum(total) FROM sales_in(today, today) WHERE user_id = p_user AND extract(hour FROM lts) = h), 0),
          'yesterday', COALESCE((SELECT sum(total) FROM sales_in(today - 1, today - 1) WHERE user_id = p_user AND extract(hour FROM lts) = h), 0)) ORDER BY h)
      FROM generate_series(8, last_hour) h),
    'payment_mix', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('method', payment_method, 'total', t, 'orders', c) ORDER BY t DESC)
      FROM (SELECT payment_method, sum(total) AS t, count(*) AS c FROM sales_in(today, today) WHERE user_id = p_user GROUP BY 1) q), '[]'::jsonb),
    'gcash', (
      SELECT jsonb_build_object(
        'cash_in',  COALESCE(sum(amount) FILTER (WHERE type = 'cash_in'), 0), 'cash_in_count',  count(*) FILTER (WHERE type = 'cash_in'),
        'cash_out', COALESCE(sum(amount) FILTER (WHERE type = 'cash_out'), 0), 'cash_out_count', count(*) FILTER (WHERE type = 'cash_out'),
        'fees', COALESCE(sum(fee), 0), 'count', count(*))
      FROM gcash_transactions g WHERE g.user_id = p_user AND g.status = 'completed'
        AND (g.created_at AT TIME ZONE store_tz())::date = today),
    'recent_sales', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'created_at') DESC) FROM (
        SELECT jsonb_build_object('id', s.id, 'sale_no', s.sale_no, 'created_at', s.created_at, 'payment_method', s.payment_method, 'total', s.total,
                 'items', (SELECT string_agg(si.product_name, ', ' ORDER BY si.id) FROM sale_items si WHERE si.sale_id = s.id)) AS x
        FROM sales s WHERE s.user_id = p_user AND s.status = 'completed' ORDER BY s.created_at DESC LIMIT 5) q), '[]'::jsonb)
  ) INTO res;
  RETURN res;
END $$;

-- ---------------------------------------------------------------------------
-- Products route strip
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION analytics_products() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'total',   (SELECT count(*) FROM products WHERE is_active),
    'healthy', (SELECT count(*) FROM products WHERE is_active AND stock_qty > reorder_level),
    'low',     (SELECT count(*) FROM products WHERE is_active AND stock_qty > 0 AND stock_qty <= reorder_level),
    'out',     (SELECT count(*) FROM products WHERE is_active AND stock_qty = 0),
    'value_cost',   COALESCE((SELECT sum(stock_qty * cost) FROM products WHERE is_active), 0),
    'value_retail', COALESCE((SELECT sum(stock_qty * price) FROM products WHERE is_active), 0),
    -- last 12 daily points: today's value, minus the stock that arrived since, plus what was sold since
    'value_trend', (
      SELECT jsonb_agg(jsonb_build_object('date', d::date, 'value', v) ORDER BY d)
      FROM (SELECT d, COALESCE((
              SELECT sum((p.stock_qty - COALESCE((SELECT sum(m.qty_change) FROM stock_movements m
                         WHERE m.product_id = p.id AND (m.created_at AT TIME ZONE store_tz())::date > d::date), 0)) * p.cost)
              FROM products p WHERE p.is_active), 0) AS v
            FROM generate_series(store_today() - 11, store_today(), interval '1 day') d) q),
    'slow_count', (SELECT count(*) FROM (
        SELECT p.id FROM products p WHERE p.is_active AND p.stock_qty > 0
        AND NOT EXISTS (SELECT 1 FROM sale_items si JOIN sales s ON s.id = si.sale_id
                        WHERE si.product_id = p.id AND s.status = 'completed' AND s.created_at > now() - interval '14 days')) q),
    'slow_movers', COALESCE((
      SELECT jsonb_agg(x) FROM (
        SELECT jsonb_build_object('name', p.name, 'description', p.description,
                 'days', COALESCE(extract(day FROM now() - (SELECT max(s.created_at) FROM sale_items si JOIN sales s ON s.id = si.sale_id
                                   WHERE si.product_id = p.id AND s.status = 'completed'))::int, 99)) AS x
        FROM products p WHERE p.is_active AND p.stock_qty > 0
          AND NOT EXISTS (SELECT 1 FROM sale_items si JOIN sales s ON s.id = si.sale_id
                          WHERE si.product_id = p.id AND s.status = 'completed' AND s.created_at > now() - interval '14 days')
        ORDER BY (SELECT max(s.created_at) FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE si.product_id = p.id AND s.status = 'completed') NULLS FIRST
        LIMIT 3) q), '[]'::jsonb)
  )
$$;

-- ---------------------------------------------------------------------------
-- Inventory route strip: days of stock left and stock-outs per week
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION analytics_inventory() RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH rate AS (
    SELECT si.product_id, sum(si.qty)::numeric / 14 AS per_day
    FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE s.status = 'completed' AND s.created_at > now() - interval '14 days' GROUP BY 1
  ), left_days AS (
    SELECT p.id, p.name, p.stock_qty, p.reorder_level, p.unit, r.per_day,
           CASE WHEN p.stock_qty = 0 THEN 0 ELSE ceil(p.stock_qty / r.per_day)::int END AS days_left
    FROM products p JOIN rate r ON r.product_id = p.id
    WHERE p.is_active AND p.stock_qty <= p.reorder_level * 3
  ), running AS (
    -- stock level right after each movement, rebuilt from today's stock
    SELECT m.product_id, m.created_at,
           p.stock_qty - COALESCE(sum(m.qty_change) OVER (PARTITION BY m.product_id ORDER BY m.created_at, m.id
                              ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING), 0) AS level_after
    FROM stock_movements m JOIN products p ON p.id = m.product_id
  ), weeks AS (
    SELECT w, (store_today() - (7 * w + 6)) AS w_from, (store_today() - 7 * w) AS w_to
    FROM generate_series(0, 7) w
  )
  SELECT jsonb_build_object(
    'days_left', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT jsonb_build_object('name', name, 'days', days_left, 'stock_qty', stock_qty, 'unit', unit) AS x
        FROM left_days ORDER BY days_left, name LIMIT 4) q), '[]'::jsonb),
    'stockouts_per_week', (
      SELECT jsonb_agg(jsonb_build_object('week_end', w_to, 'count',
          (SELECT count(DISTINCT r.product_id) FROM running r
           WHERE r.level_after <= 0 AND (r.created_at AT TIME ZONE store_tz())::date BETWEEN w_from AND w_to)) ORDER BY w DESC)
      FROM weeks)
  )
$$;

-- ---------------------------------------------------------------------------
-- GCash route strip
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION analytics_gcash() RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  today date := store_today();
  last_hour integer := GREATEST(extract(hour FROM now() AT TIME ZONE store_tz())::int, 11);
  res jsonb;
BEGIN
  SELECT jsonb_build_object(
    'float', gcash_float(),
    'min_float', (SELECT gcash_min_float FROM store_settings WHERE id = 1),
    'target_float', (SELECT gcash_target_float FROM store_settings WHERE id = 1),
    'hourly', (
      SELECT jsonb_agg(jsonb_build_object('hour', h,
        'cash_in',  COALESCE((SELECT sum(amount) FROM gcash_transactions g WHERE g.status = 'completed' AND g.type = 'cash_in'
                     AND (g.created_at AT TIME ZONE store_tz())::date = today AND extract(hour FROM g.created_at AT TIME ZONE store_tz()) = h), 0),
        'cash_out', COALESCE((SELECT sum(amount) FROM gcash_transactions g WHERE g.status = 'completed' AND g.type = 'cash_out'
                     AND (g.created_at AT TIME ZONE store_tz())::date = today AND extract(hour FROM g.created_at AT TIME ZONE store_tz()) = h), 0)) ORDER BY h)
      FROM generate_series(8, last_hour) h),
    'fees_week', (
      SELECT jsonb_agg(jsonb_build_object('date', d::date,
        'fees', COALESCE((SELECT sum(fee) FROM gcash_transactions g WHERE g.status = 'completed'
                 AND (g.created_at AT TIME ZONE store_tz())::date = d::date), 0)) ORDER BY d)
      FROM generate_series(today - 6, today, interval '1 day') d),
    'fees_week_total', COALESCE((SELECT sum(fee) FROM gcash_transactions g WHERE g.status = 'completed'
                 AND (g.created_at AT TIME ZONE store_tz())::date BETWEEN today - 6 AND today), 0),
    'fees_prev_week_total', COALESCE((SELECT sum(fee) FROM gcash_transactions g WHERE g.status = 'completed'
                 AND (g.created_at AT TIME ZONE store_tz())::date BETWEEN today - 13 AND today - 7), 0),
    'today', (
      SELECT jsonb_build_object('cash_in', COALESCE(sum(amount) FILTER (WHERE type = 'cash_in'), 0),
               'cash_in_count', count(*) FILTER (WHERE type = 'cash_in'),
               'cash_out', COALESCE(sum(amount) FILTER (WHERE type = 'cash_out'), 0),
               'cash_out_count', count(*) FILTER (WHERE type = 'cash_out'),
               'fees', COALESCE(sum(fee), 0), 'count', count(*))
      FROM gcash_transactions g WHERE g.status = 'completed' AND (g.created_at AT TIME ZONE store_tz())::date = today)
  ) INTO res;
  RETURN res;
END $$;

-- ---------------------------------------------------------------------------
-- Staff route strip
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION analytics_staff() RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  today date := store_today();
  res jsonb;
BEGIN
  SELECT jsonb_build_object(
    'week_total', COALESCE((SELECT sum(total) FROM sales_in(today - 6, today)), 0),
    'by_cashier', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('user_id', u.id, 'name', u.full_name, 'avatar_key', u.avatar_key, 'total', q.t) ORDER BY q.t DESC)
      FROM (SELECT user_id, sum(total) AS t FROM sales_in(today - 6, today) GROUP BY 1) q JOIN users u ON u.id = q.user_id), '[]'::jsonb),
    'coverage', (
      SELECT jsonb_build_object(
        'morning', (SELECT jsonb_agg(c ORDER BY wd) FROM (SELECT wd, (SELECT count(*) FROM staff_schedule s JOIN users u ON u.id = s.user_id
                      WHERE u.is_active AND s.weekday = wd AND s.shift = 'morning') AS c FROM generate_series(0, 6) wd) q),
        'evening', (SELECT jsonb_agg(c ORDER BY wd) FROM (SELECT wd, (SELECT count(*) FROM staff_schedule s JOIN users u ON u.id = s.user_id
                      WHERE u.is_active AND s.weekday = wd AND s.shift = 'evening') AS c FROM generate_series(0, 6) wd) q))),
    'clocked_in', (SELECT count(DISTINCT sh.user_id) FROM shifts sh JOIN users u ON u.id = sh.user_id JOIN roles r ON r.id = u.role_id
                   WHERE r.code = 'cashier' AND sh.ended_at IS NULL AND (sh.started_at AT TIME ZONE store_tz())::date = today),
    'can_log_in', (SELECT count(*) FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code = 'cashier' AND u.is_active),
    'avg_sale', COALESCE(round((SELECT avg(total) FROM sales_in(today - 6, today)), 2), 0),
    'top_seller', (SELECT u.full_name FROM sales_in(today - 6, today) s JOIN users u ON u.id = s.user_id
                   GROUP BY u.id ORDER BY sum(s.total) DESC LIMIT 1)
  ) INTO res;
  RETURN res;
END $$;

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION report_overview() RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  today date := store_today();
  res jsonb;
BEGIN
  SELECT jsonb_build_object(
    'week_sales', COALESCE((SELECT sum(total) FROM sales_in(today - 6, today)), 0),
    'week_pct', pct_change((SELECT sum(total) FROM sales_in(today - 6, today)), (SELECT sum(total) FROM sales_in(today - 13, today - 7))),
    'orders_today', (SELECT count(*) FROM sales_in(today, today)),
    'cash_orders', (SELECT count(*) FROM sales_in(today, today) WHERE payment_method = 'cash'),
    'gcash_orders', (SELECT count(*) FROM sales_in(today, today) WHERE payment_method = 'gcash'),
    'needs_restock', (SELECT count(*) FROM products WHERE is_active AND stock_qty <= reorder_level),
    'out_count', (SELECT count(*) FROM products WHERE is_active AND stock_qty = 0),
    'gcash_fees_month', COALESCE((SELECT sum(fee) FROM gcash_transactions WHERE status = 'completed'
        AND (created_at AT TIME ZONE store_tz())::date >= date_trunc('month', today)::date), 0),
    'gcash_txn_month', (SELECT count(*) FROM gcash_transactions WHERE status = 'completed'
        AND (created_at AT TIME ZONE store_tz())::date >= date_trunc('month', today)::date),
    'series', (SELECT jsonb_agg(jsonb_build_object('date', d::date, 'total',
                 COALESCE((SELECT sum(total) FROM sales_in(d::date, d::date)), 0)) ORDER BY d)
               FROM generate_series(today - 6, today, interval '1 day') d),
    'top_today', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'revenue')::numeric DESC) FROM (
        SELECT jsonb_build_object('name', p.name, 'description', p.description, 'sold', sum(si.qty), 'revenue', sum(si.line_total)) AS x
        FROM sale_items si JOIN sales_in(today, today) s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
        GROUP BY p.id ORDER BY sum(si.line_total) DESC LIMIT 4) q), '[]'::jsonb)
  ) INTO res;
  RETURN res;
END $$;

CREATE OR REPLACE FUNCTION report_sales(p_period text DEFAULT '30d') RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  r record;
  n integer;
  p_from date;
  p_to date;
  res jsonb;
BEGIN
  SELECT * INTO r FROM period_range(p_period);
  n := (r.d_to - r.d_from) + 1;
  p_to := r.d_from - 1;
  p_from := p_to - (n - 1);
  SELECT jsonb_build_object(
    'from', r.d_from, 'to', r.d_to, 'days', n,
    'total', COALESCE((SELECT sum(total) FROM sales_in(r.d_from, r.d_to)), 0),
    -- compare with the previous period only when that period has sales on most of its days
    'total_pct', CASE WHEN (SELECT count(DISTINCT lts::date) FROM sales_in(p_from, p_to)) >= n * 0.8
                      THEN pct_change((SELECT sum(total) FROM sales_in(r.d_from, r.d_to)), (SELECT sum(total) FROM sales_in(p_from, p_to))) END,
    'orders', (SELECT count(*) FROM sales_in(r.d_from, r.d_to)),
    'orders_per_day', round((SELECT count(*) FROM sales_in(r.d_from, r.d_to))::numeric / n, 1),
    'avg_sale', COALESCE(round((SELECT avg(total) FROM sales_in(r.d_from, r.d_to)), 2), 0),
    'items_per_order', COALESCE((SELECT round(sum(si.qty)::numeric / NULLIF(count(DISTINCT s.id), 0), 1)
                         FROM sales_in(r.d_from, r.d_to) s JOIN sale_items si ON si.sale_id = s.id), 0),
    'best_day', (SELECT jsonb_build_object('date', d, 'total', t) FROM (
                   SELECT lts::date AS d, sum(total) AS t FROM sales_in(r.d_from, r.d_to) GROUP BY 1 ORDER BY 2 DESC LIMIT 1) q),
    'daily', (SELECT jsonb_agg(jsonb_build_object('date', d::date, 'total',
                COALESCE((SELECT sum(total) FROM sales_in(d::date, d::date)), 0)) ORDER BY d)
              FROM generate_series(r.d_from, r.d_to, interval '1 day') d),
    'payment_mix', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('method', payment_method, 'total', t, 'orders', c) ORDER BY t DESC)
      FROM (SELECT payment_method, sum(total) AS t, count(*) AS c FROM sales_in(r.d_from, r.d_to) GROUP BY 1) q), '[]'::jsonb),
    'best_sellers', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'sold')::int DESC) FROM (
        SELECT jsonb_build_object('name', p.name, 'description', p.description, 'category', COALESCE(c.name, 'Others'),
                 'sold', sum(si.qty), 'sales', sum(si.line_total)) AS x
        FROM sale_items si JOIN sales_in(r.d_from, r.d_to) s ON s.id = si.sale_id
        JOIN products p ON p.id = si.product_id LEFT JOIN categories c ON c.id = p.category_id
        GROUP BY p.id, c.name ORDER BY sum(si.qty) DESC LIMIT 5) q), '[]'::jsonb),
    'product_count', (SELECT count(*) FROM products WHERE is_active)
  ) INTO res;
  RETURN res;
END $$;

CREATE OR REPLACE FUNCTION report_inventory() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'stock_value', COALESCE((SELECT sum(stock_qty * cost) FROM products WHERE is_active), 0),
    'products', (SELECT count(*) FROM products WHERE is_active),
    'in_stock', (SELECT count(*) FROM products WHERE is_active AND stock_qty > reorder_level),
    'low', (SELECT count(*) FROM products WHERE is_active AND stock_qty > 0 AND stock_qty <= reorder_level),
    'out', (SELECT count(*) FROM products WHERE is_active AND stock_qty = 0),
    'by_category', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('category', COALESCE(c.name, 'Others'), 'products', q.n, 'stock_value', q.v, 'needs_restock', q.r)
                       ORDER BY q.v DESC)
      FROM (SELECT category_id, count(*) AS n, sum(stock_qty * cost) AS v, count(*) FILTER (WHERE stock_qty <= reorder_level) AS r
            FROM products WHERE is_active GROUP BY category_id) q LEFT JOIN categories c ON c.id = q.category_id), '[]'::jsonb),
    'restock_first', COALESCE((
      SELECT jsonb_agg(x) FROM (
        SELECT jsonb_build_object('id', id, 'name', name, 'stock_qty', stock_qty, 'unit', unit) AS x
        FROM products WHERE is_active AND stock_qty <= reorder_level ORDER BY stock_qty, name LIMIT 5) q), '[]'::jsonb),
    'restock_total', (SELECT count(*) FROM products WHERE is_active AND stock_qty <= reorder_level)
  )
$$;

CREATE OR REPLACE FUNCTION report_gcash(p_period text DEFAULT '30d') RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  r record;
  res jsonb;
BEGIN
  SELECT * INTO r FROM period_range(p_period);
  SELECT jsonb_build_object(
    'from', r.d_from, 'to', r.d_to,
    'cash_in',  COALESCE((SELECT sum(amount) FROM gcash_transactions g WHERE g.status = 'completed' AND g.type = 'cash_in'
                 AND (g.created_at AT TIME ZONE store_tz())::date BETWEEN r.d_from AND r.d_to), 0),
    'cash_in_count', (SELECT count(*) FROM gcash_transactions g WHERE g.status = 'completed' AND g.type = 'cash_in'
                 AND (g.created_at AT TIME ZONE store_tz())::date BETWEEN r.d_from AND r.d_to),
    'cash_out', COALESCE((SELECT sum(amount) FROM gcash_transactions g WHERE g.status = 'completed' AND g.type = 'cash_out'
                 AND (g.created_at AT TIME ZONE store_tz())::date BETWEEN r.d_from AND r.d_to), 0),
    'cash_out_count', (SELECT count(*) FROM gcash_transactions g WHERE g.status = 'completed' AND g.type = 'cash_out'
                 AND (g.created_at AT TIME ZONE store_tz())::date BETWEEN r.d_from AND r.d_to),
    'fees', COALESCE((SELECT sum(fee) FROM gcash_transactions g WHERE g.status = 'completed'
                 AND (g.created_at AT TIME ZONE store_tz())::date BETWEEN r.d_from AND r.d_to), 0),
    'float', gcash_float(),
    -- four equal buckets across the period, oldest first
    'buckets', (
      SELECT jsonb_agg(jsonb_build_object('from', b_from, 'to', b_to,
        'cash_in',  COALESCE((SELECT sum(amount) FROM gcash_transactions g WHERE g.status = 'completed' AND g.type = 'cash_in'
                      AND (g.created_at AT TIME ZONE store_tz())::date BETWEEN b_from AND b_to), 0),
        'cash_out', COALESCE((SELECT sum(amount) FROM gcash_transactions g WHERE g.status = 'completed' AND g.type = 'cash_out'
                      AND (g.created_at AT TIME ZONE store_tz())::date BETWEEN b_from AND b_to), 0)) ORDER BY i)
      FROM (SELECT i,
                   (r.d_from + floor(i * ((r.d_to - r.d_from + 1)::numeric / 4))::int) AS b_from,
                   (r.d_from + floor((i + 1) * ((r.d_to - r.d_from + 1)::numeric / 4))::int - 1) AS b_to
            FROM generate_series(0, 3) i) bk),
    'fee_brackets', (
      SELECT jsonb_agg(jsonb_build_object('label', label, 'count', c, 'fees', f) ORDER BY ord)
      FROM (SELECT ord, label, count(g.id) AS c, COALESCE(sum(g.fee), 0) AS f
            FROM (VALUES (1, '₱100 to ₱500', 0::numeric, 500::numeric),
                         (2, '₱501 to ₱1,000', 500.01, 1000),
                         (3, '₱1,001 and above', 1000.01, 1e12)) b(ord, label, lo, hi)
            LEFT JOIN gcash_transactions g ON g.status = 'completed' AND g.amount BETWEEN b.lo AND b.hi
                 AND (g.created_at AT TIME ZONE store_tz())::date BETWEEN r.d_from AND r.d_to
            GROUP BY ord, label) q),
    'recent', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'created_at') DESC) FROM (
        SELECT jsonb_build_object('id', g.id, 'gc_no', g.gc_no, 'type', g.type, 'customer_name', g.customer_name,
                 'amount', g.amount, 'fee', g.fee, 'created_at', g.created_at) AS x
        FROM gcash_transactions g WHERE g.status = 'completed' ORDER BY g.created_at DESC LIMIT 4) q), '[]'::jsonb),
    'total_count', (SELECT count(*) FROM gcash_transactions WHERE status = 'completed')
  ) INTO res;
  RETURN res;
END $$;
