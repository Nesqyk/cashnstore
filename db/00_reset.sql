-- CashNStore: DROP EVERYTHING (development only).
-- Run this in pgAdmin's Query Tool when you want a clean slate, then run 01..04 again.
-- WARNING: this deletes all CashNStore data in the current database.

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO CURRENT_USER;
GRANT ALL ON SCHEMA public TO PUBLIC;
