-- Paper Lock: a page locked with a hand-drawn paper card. The page's real title, icon and words live in paper_pages
-- (sealed); the row in notes becomes an empty placeholder that is hidden from AI, so search, history, export, sharing,
-- the assistant and MCP never meet the content. Only a scan of the card opens it (worker/paper.ts).
ALTER TABLE notes ADD COLUMN paper_lock TEXT;            -- id of the card guarding this page; NULL = not paper-locked
CREATE INDEX idx_notes_paper_lock ON notes(paper_lock) WHERE paper_lock IS NOT NULL;

-- A card: its name and the ink-map template of the drawing (both sealed). fails counts wrong scans in a row.
CREATE TABLE paper_cards (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  template     TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  fails        INTEGER NOT NULL DEFAULT 0,
  blocked_until INTEGER NOT NULL DEFAULT 0
);

-- The locked page's content (title, icon, html sealed).
CREATE TABLE paper_pages (
  note_id      TEXT PRIMARY KEY,
  card_id      TEXT NOT NULL,
  title        TEXT NOT NULL,
  icon         TEXT,
  html         TEXT NOT NULL,
  revision     INTEGER NOT NULL DEFAULT 1,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX idx_paper_pages_card ON paper_pages(card_id);

-- A device asking to open a locked page; the phone with the card answers it.
CREATE TABLE paper_requests (
  id           TEXT PRIMARY KEY,
  note_id      TEXT NOT NULL,
  secret_hash  TEXT NOT NULL,                  -- of the secret only the asking device holds
  device       TEXT NOT NULL,                  -- "Windows · Chrome"
  status       TEXT NOT NULL DEFAULT 'pending',-- pending | approved | denied | expired
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);

-- An open lock: whoever holds the secret may read and save the page until it runs out (it slides while in use).
CREATE TABLE paper_grants (
  id           TEXT PRIMARY KEY,
  secret_hash  TEXT NOT NULL UNIQUE,
  note_id      TEXT NOT NULL,
  device       TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
CREATE INDEX idx_paper_grants_note ON paper_grants(note_id);
