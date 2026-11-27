-- Seaglass Open 0.2.x: what the AI costs, per person (src/worker/usage.ts). One row per person, day (their own time
-- zone), feature and model, added to after every call. Personal: each person sees their own; the owner sees totals only.
CREATE TABLE ai_usage (
  owner_id    TEXT NOT NULL,
  day         TEXT NOT NULL,          -- YYYY-MM-DD in the person's time zone
  feature     TEXT NOT NULL,          -- "assistant", "quiz", "voice to text"…
  model       TEXT NOT NULL,
  calls       INTEGER NOT NULL DEFAULT 0,
  input       INTEGER NOT NULL DEFAULT 0,
  output      INTEGER NOT NULL DEFAULT 0,
  cache_read  INTEGER NOT NULL DEFAULT 0,
  cache_write INTEGER NOT NULL DEFAULT 0,
  cost_usd    REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id, day, feature, model)
);
CREATE INDEX ai_usage_day ON ai_usage (day);

-- What each person may do, set by the household's owners and never by the person themselves (a system table: no
-- person's own routes write it). person_id '' is the whole household. Kid accounts (role 'kid') get teach mode, no web
-- and a small daily allowance unless an owner changes them.
CREATE TABLE person_rules (
  person_id   TEXT PRIMARY KEY,
  daily_usd   REAL,                   -- NULL: no daily limit
  monthly_usd REAL,                   -- NULL: no monthly limit
  web         INTEGER NOT NULL DEFAULT 1,
  teach       INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL
);
