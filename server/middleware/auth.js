const { query } = require('../db');
const { HttpError, wrap } = require('../lib/http');

// Load the signed-in user (with role and permission codes) from the session.
// Runs on every /api request; req.user stays undefined for guests.
const loadUser = wrap(async (req, res, next) => {
  const id = req.session && req.session.userId;
  if (!id) return next();

  const { rows } = await query(
    `SELECT u.id, u.username, u.full_name, u.email, u.mobile, u.avatar_key, u.job_title, u.station,
            u.daily_goal, u.must_change_password, u.is_active, u.notify_daily_summary, u.ask_pin_when_short,
            r.code AS role, r.name AS role_name,
            COALESCE(array_agg(p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions
     FROM users u
     JOIN roles r ON r.id = u.role_id
     LEFT JOIN role_permissions rp ON rp.role_id = r.id
     LEFT JOIN permissions p ON p.id = rp.permission_id
     WHERE u.id = $1
     GROUP BY u.id, r.code, r.name`,
    [id]
  );
  const user = rows[0];
  if (!user || !user.is_active) {
    // Account was removed or switched off: end the session.
    return req.session.destroy(() => next());
  }
  req.user = user;
  next();
});

function requireAuth(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Please sign in'));
  next();
}

// Allow the request if the user has ANY of the listed permissions.
const can = (...codes) => (req, res, next) => {
  if (!req.user) return next(new HttpError(401, 'Please sign in'));
  if (!codes.some((c) => req.user.permissions.includes(c))) {
    return next(new HttpError(403, 'You do not have access to this'));
  }
  next();
};

const hasPerm = (req, code) => !!req.user && req.user.permissions.includes(code);

// Block state-changing requests that did not come from our own pages.
// The session cookie is SameSite=Lax; this is a second layer.
function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'cashnstore') return next(new HttpError(403, 'Bad request'));
  const origin = req.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== req.get('host')) return next(new HttpError(403, 'Bad request origin'));
    } catch (_) {
      return next(new HttpError(403, 'Bad request origin'));
    }
  }
  next();
}

module.exports = { loadUser, requireAuth, can, hasPerm, csrfGuard };
