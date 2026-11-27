const { query } = require('../db');

// The user object the browser is allowed to see.
function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    full_name: u.full_name,
    email: u.email,
    mobile: u.mobile,
    role: u.role,
    role_name: u.role_name,
    permissions: u.permissions,
    avatar_key: u.avatar_key,
    job_title: u.job_title,
    station: u.station,
    must_change_password: u.must_change_password,
  };
}

// Sign out every session of a user (used after a password change or deactivation).
// keepSid: leave this one session alone.
async function revokeSessions(client, userId, keepSid) {
  const runner = client || { query };
  await runner.query(
    `DELETE FROM session WHERE (sess->>'userId')::int = $1 AND ($2::text IS NULL OR sid <> $2)`,
    [userId, keepSid || null]
  );
}

module.exports = { publicUser, revokeSessions };
