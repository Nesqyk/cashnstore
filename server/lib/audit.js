const db = require('../db');

// Write a line to audit_log. Pass a transaction client to include it in that transaction,
// or null to write on its own. Never throws: an audit failure must not break the action.
async function audit(client, userId, action, entity, entityId, meta = {}) {
  const runner = client && typeof client.query === 'function' ? client : db;
  try {
    await runner.query(
      'INSERT INTO audit_log (user_id, action, entity, entity_id, meta) VALUES ($1, $2, $3, $4, $5)',
      [userId || null, action, entity || null, entityId === undefined || entityId === null ? null : String(entityId), JSON.stringify(meta)]
    );
  } catch (err) {
    console.error('audit failed', err.message);
  }
}

module.exports = { audit };
