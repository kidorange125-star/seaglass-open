-- the assistant's memory and chat history. Neither is note content, so they don't go through notes.ts or the
-- undo log. Memories are short facts the assistant (or the user, in Settings) saves; the assistant sees them in every chat.
CREATE TABLE IF NOT EXISTS memories (
  id          TEXT PRIMARY KEY,
  text        TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'agent',     -- 'agent' (the assistant), 'mcp' (Claude) or 'user'
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- Chats with the assistant, synced so they follow the user between devices. messages is the panel's JSON; text is a
-- plain copy of what was said, for search_past_chats.
CREATE TABLE IF NOT EXISTS chats (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL DEFAULT '',
  messages    TEXT NOT NULL DEFAULT '[]',
  text        TEXT NOT NULL DEFAULT '',
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS chats_updated ON chats(updated_at DESC);
