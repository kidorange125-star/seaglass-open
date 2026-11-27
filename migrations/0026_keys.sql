-- Keys entered in the app instead of with `wrangler secret put` (src/worker/keys.ts): the Claude API key, voice keys,
-- and the notification signing key Seaglass makes for itself. Each value is sealed with DATA_KEY (vault.ts, "secrets")
-- and never sent back to the app; only its last four characters are shown. A Worker secret of the same name wins.
CREATE TABLE household_keys (
  name       TEXT PRIMARY KEY,   -- ANTHROPIC_API_KEY, ELEVENLABS_API_KEY, OPENROUTER_API_KEY, VAPID_PRIVATE_KEY
  value      TEXT NOT NULL,      -- sealed
  hint       TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL DEFAULT ''
);
