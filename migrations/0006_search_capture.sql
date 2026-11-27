-- Search by meaning: one embedding vector per note (Workers AI, 384 floats stored as a BLOB), refreshed in the
-- background when a note changes. Not note content, so it isn't in history or the change feed.
CREATE TABLE IF NOT EXISTS embeddings (
  note_id       TEXT PRIMARY KEY,
  vec           BLOB NOT NULL,
  note_updated  INTEGER NOT NULL,                -- notes.updated_at this vector was made from
  embedded_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS embeddings_updated ON embeddings(note_updated);
