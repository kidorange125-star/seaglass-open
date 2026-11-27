-- Everything is a "note" row: a page, a database, or a database row (a page whose parent is a database).
-- html is the sanitized source of truth; text is a plain copy for search and AI.
CREATE TABLE notes (
  id          TEXT PRIMARY KEY,
  parent_id   TEXT,                              -- parent page or database
  kind        TEXT NOT NULL DEFAULT 'page',      -- 'page' | 'database'
  title       TEXT NOT NULL DEFAULT '',
  html        TEXT NOT NULL DEFAULT '',
  text        TEXT NOT NULL DEFAULT '',
  icon        TEXT,                              -- emoji
  cover       TEXT,                              -- css gradient / color / image url
  favorite    INTEGER NOT NULL DEFAULT 0,
  position    REAL NOT NULL DEFAULT 0,           -- sibling order
  full_width  INTEGER NOT NULL DEFAULT 0,
  small_text  INTEGER NOT NULL DEFAULT 0,
  font        TEXT NOT NULL DEFAULT 'sans',      -- sans | serif | mono
  locked      INTEGER NOT NULL DEFAULT 0,
  is_template INTEGER NOT NULL DEFAULT 0,
  props       TEXT NOT NULL DEFAULT '{}',        -- JSON: property values when this is a database row
  db_schema   TEXT,                              -- JSON: {properties, views} when kind = 'database'
  share_slug  TEXT,                              -- set = publicly readable at /p/<slug>
  revision    INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);
CREATE INDEX idx_notes_parent ON notes(parent_id);
CREATE INDEX idx_notes_updated ON notes(updated_at DESC);
CREATE UNIQUE INDEX idx_notes_share ON notes(share_slug) WHERE share_slug IS NOT NULL;

-- Page-to-page links, rebuilt from @mentions on every save. Powers backlinks.
CREATE TABLE links (
  from_id TEXT NOT NULL,
  to_id   TEXT NOT NULL,
  PRIMARY KEY (from_id, to_id)
);
CREATE INDEX idx_links_to ON links(to_id);

CREATE TABLE comments (
  id          TEXT PRIMARY KEY,
  note_id     TEXT NOT NULL,
  body        TEXT NOT NULL,
  resolved    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_comments_note ON comments(note_id);

-- Append-only action log. Each row holds a full snapshot of the note before and after,
-- so version history, agent /undo and MCP undo are all "restore this snapshot".
CREATE TABLE actions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      TEXT NOT NULL,                     -- groups every action from one agent prompt
  source      TEXT NOT NULL,                     -- 'user' | 'agent' | 'mcp'
  tool        TEXT NOT NULL,                     -- create | update | delete | restore
  note_id     TEXT NOT NULL,
  before_json TEXT,                              -- null when the note did not exist yet
  after_json  TEXT,
  undone_at   INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_actions_note ON actions(note_id, id DESC);
CREATE INDEX idx_actions_run ON actions(run_id);
