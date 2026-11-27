-- What the assistant wrote for the Study games (Quiz, Fill in the blanks, Match), saved so playing again costs nothing.
-- One row per game and set of pages; `data` is sealed and also holds a hash of the notes it was written from, so
-- editing the notes makes a new set next time. Not note content, so outside notes.ts and history.
CREATE TABLE IF NOT EXISTS study_sets (
  id TEXT PRIMARY KEY,          -- sha-256 of "mode|sorted page ids"
  mode TEXT NOT NULL,           -- quiz | blanks | match
  data TEXT NOT NULL,           -- sealed JSON: { source, items }
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_study_sets_created ON study_sets(created_at);
