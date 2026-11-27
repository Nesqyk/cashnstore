require('dotenv').config();

const env = process.env;
const isProd = env.NODE_ENV === 'production';

if (isProd && (!env.SESSION_SECRET || env.SESSION_SECRET.startsWith('change-me'))) {
  throw new Error('Set a real SESSION_SECRET in .env before running in production.');
}

module.exports = {
  isProd,
  port: Number(env.PORT) || 3000,
  databaseUrl: env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/cashnstore',
  sessionSecret: env.SESSION_SECRET || 'dev-only-secret-do-not-use-in-production',
  sessionHours: 12,
};
