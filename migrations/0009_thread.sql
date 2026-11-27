-- One ongoing conversation with the assistant (src/worker/thread.ts), replacing separate chats. Everything lands here:
-- the user's messages, the assistant's replies, what it says on its own (check-ins) and routine reports. (sealed) = encrypted.
CREATE TABLE IF NOT EXISTS thread (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  id          TEXT NOT NULL UNIQUE,
  role        TEXT NOT NULL,                     -- 'user' | 'assistant' | 'divider'
  kind        TEXT NOT NULL DEFAULT 'chat',      -- 'chat' | 'proactive' | 'routine' | 'divider'
  text        TEXT NOT NULL DEFAULT '',          -- (sealed)
  meta        TEXT,                              -- (sealed) JSON: label, tools, run_id, changes, cost, inbox_id, page_id, error, undone
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS thread_created ON thread(created_at);
