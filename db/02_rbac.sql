-- Roles and permissions. Safe to re-run (it upserts).
-- The app asks the database "does this user's role have permission X?" on every request,
-- so you can change who can do what here (or in pgAdmin) without touching the code.

INSERT INTO roles (code, name, description) VALUES
  ('owner',   'Owner',   'Store owner. Full access.'),
  ('cashier', 'Cashier', 'Staff who ring up sales, handle GCash and restock.')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description;

INSERT INTO permissions (code, description) VALUES
  ('pos.sell',            'Ring up sales at the register'),
  ('products.view',       'See products and prices'),
  ('products.manage',     'Add, edit and deactivate products'),
  ('inventory.view',      'See inventory alerts'),
  ('inventory.restock',   'Add stock after a delivery'),
  ('sales.view_own',      'See sales rung up by themselves'),
  ('sales.view_all',      'See every sale in the store'),
  ('sales.refund',        'Refund a sale'),
  ('gcash.view',          'See GCash transactions'),
  ('gcash.transact',      'Record GCash cash in and cash out'),
  ('reports.view',        'Open the Reports screens'),
  ('analytics.store',     'See store-wide analytics on the dashboard and routes'),
  ('staff.manage',        'Add, edit and deactivate staff'),
  ('settings.manage',     'Change store settings')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;

-- Owner gets everything.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.code = 'owner'
ON CONFLICT DO NOTHING;

-- Cashier: matches the "What staff can do" card in the design.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'pos.sell','products.view','inventory.view','inventory.restock',
  'sales.view_own','gcash.view','gcash.transact'
) WHERE r.code = 'cashier'
ON CONFLICT DO NOTHING;
