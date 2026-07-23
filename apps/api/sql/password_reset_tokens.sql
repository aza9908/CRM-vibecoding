-- ===========================================================================
-- Password recovery — password_reset_tokens
-- ===========================================================================
--
-- TWO WAYS TO APPLY THIS. Pick one.
--
--   1. Preferred — let drizzle-kit generate it from the schema:
--        pnpm db:generate     # reads the updated src/db/schema.ts
--        pnpm db:migrate
--      This keeps drizzle's journal and snapshots consistent for future
--      migrations, which hand-written files in drizzle/ would desync.
--
--   2. Direct — if you just want the table in place right now:
--        psql "$DATABASE_URL" -f apps/api/sql/password_reset_tokens.sql
--
-- The script is idempotent, so running it twice is harmless, and it is safe to
-- run before option 1 (drizzle will see the table already exists).
-- ===========================================================================

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash    text NOT NULL,
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz,
  requested_ip  text,
  created_at    timestamptz DEFAULT now()
);

-- Only the SHA-256 hash is stored, never the raw token. The unique index also
-- makes the lookup on the reset path an index scan rather than a table scan.
CREATE UNIQUE INDEX IF NOT EXISTS password_reset_token_hash_idx
  ON password_reset_tokens (token_hash);

CREATE INDEX IF NOT EXISTS password_reset_user_idx
  ON password_reset_tokens (user_id);

-- Supports both the throttle window query and the cleanup sweep.
CREATE INDEX IF NOT EXISTS password_reset_expires_idx
  ON password_reset_tokens (expires_at);
