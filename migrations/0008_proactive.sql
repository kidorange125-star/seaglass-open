-- Proactive assistant (src/worker/proactive.ts). Text columns marked (sealed) are encrypted by vault.ts.

-- What the assistant brings to the user on its own: notes from the hourly check-in, results of routines, and proposals
-- that wait for Accept or Dismiss. Nothing in a proposal changes their notes until the user accepts it.
CREATE TABLE IF NOT EXISTS inbox (
  id          TEXT PRIMARY KEY,
  source      TEXT NOT NULL,                     -- 'checkin' | 'routine'
  kind        TEXT NOT NULL,                     -- 'note' | 'proposal'
  title       TEXT NOT NULL DEFAULT '',          -- (sealed)
  body        TEXT NOT NULL DEFAULT '',          -- (sealed)
  action      TEXT,                              -- (sealed) JSON: {prompt} or {proposal:{type,...}} or {run_id}
  status      TEXT NOT NULL DEFAULT 'new',       -- new | accepted | dismissed | done
  urgent      INTEGER NOT NULL DEFAULT 0,
  feedback    INTEGER NOT NULL DEFAULT 0,        -- 1 helpful, -1 not helpful
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS inbox_status ON inbox(status, created_at DESC);
CREATE INDEX IF NOT EXISTS inbox_created ON inbox(created_at DESC);

-- Saved prompts: The user's own one-tap requests, run as /name in the chat or from a page's / menu.
CREATE TABLE IF NOT EXISTS prompts (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,                     -- the command word, e.g. "cram" (plain: it is matched as you type)
  text        TEXT NOT NULL,                     -- (sealed) what the assistant is asked
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS prompts_name ON prompts(name);

-- Routines: a prompt the assistant runs by itself at set times (The user's time zone), result to the inbox.
CREATE TABLE IF NOT EXISTS routines (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,                     -- (sealed)
  prompt      TEXT NOT NULL,                     -- (sealed)
  days        INTEGER NOT NULL DEFAULT 127,      -- bit 0 = Sunday ... bit 6 = Saturday
  time        TEXT NOT NULL,                     -- "HH:MM", local
  notify      INTEGER NOT NULL DEFAULT 1,        -- also send a notification when it finishes
  enabled     INTEGER NOT NULL DEFAULT 1,
  last_run    TEXT,                              -- "YYYY-MM-DD HH:MM" local, so a minute never runs twice
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
