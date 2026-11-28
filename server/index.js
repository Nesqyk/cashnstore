const fs = require('fs');
const path = require('path');
const util = require('util');
const zlib = require('zlib');
const express = require('express');
const session = require('express-session');
const PgStore = require('connect-pg-simple')(session);
const config = require('./config');
const { pool } = require('./db');
const { HttpError } = require('./lib/http');
const { loadUser, requireAuth, csrfGuard } = require('./middleware/auth');
const { rateLimit } = require('./middleware/rateLimit');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.isProd ? 1 : false);

// ---- security headers -----------------------------------------------------------------------------
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
  });
  next();
});

app.use(express.json({ limit: '100kb' }));

app.use(session({
  name: 'cns.sid',
  store: new PgStore({ pool, tableName: 'session', createTableIfMissing: false }),
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,                                   // activity keeps you signed in; idle sessions end
  cookie: { httpOnly: true, sameSite: 'lax', secure: config.isProd ? 'auto' : false, maxAge: config.sessionHours * 3600 * 1000 },
}));

// ---- API ----------------------------------------------------------------------------------------------
const api = express.Router();
api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
api.use(csrfGuard);
api.use(loadUser);

const sensitive = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: 'Too many attempts. Please wait a few minutes.' });
api.use('/auth/forgot', sensitive);
api.use('/auth/reset', sensitive);

api.use('/auth', require('./routes/auth'));
api.use('/settings', require('./routes/settings'));          // requires sign-in inside
api.use('/dashboard', require('./routes/dashboard'));

// Everything below needs a signed-in user; each route then checks its own permission.
api.use(requireAuth);
api.use('/', require('./routes/catalog'));                    // /categories, /suppliers
api.use('/products', require('./routes/products'));
api.use('/inventory', require('./routes/inventory'));
api.use('/pos', require('./routes/pos'));
api.use('/sales', require('./routes/sales'));
api.use('/gcash', require('./routes/gcash'));
api.use('/staff', require('./routes/staff'));
api.use('/reports', require('./routes/reports'));
api.use('/shifts', require('./routes/shifts'));

api.use((req, res, next) => next(new HttpError(404, 'Not found')));
app.use('/api', api);

// ---- front end ----------------------------------------------------------------------------------------
// The charting library: this one prebuilt file out of node_modules, compressed once and kept in memory.
let echartsBundle = null;
const readEcharts = async () => {
  const raw = await fs.promises.readFile(require.resolve('echarts/dist/echarts.esm.min'));
  return { raw, gzip: await util.promisify(zlib.gzip)(raw, { level: 9 }) };
};
app.get('/vendor/echarts.js', async (req, res, next) => {
  try {
    echartsBundle = echartsBundle || readEcharts().catch((err) => { echartsBundle = null; throw err; });
    const file = await echartsBundle;
    const gzip = req.acceptsEncodings('gzip', 'identity') === 'gzip';
    res.type('js').set({ 'Cache-Control': `public, max-age=${config.isProd ? 3600 : 0}`, Vary: 'Accept-Encoding' });
    if (gzip) res.set('Content-Encoding', 'gzip');
    res.send(gzip ? file.gzip : file.raw);
  } catch (err) { next(err); }
});

const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir, { index: false, maxAge: config.isProd ? '1h' : 0 }));
app.get('*', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

// ---- errors ----------------------------------------------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, fields: err.fields || undefined });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Bad request' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`CashNStore running at http://localhost:${config.port}`);
  });
}

module.exports = app;
