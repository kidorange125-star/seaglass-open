-- Study tab organisation: subjects (Biology, Civics…) with an optional test date, and per page which subject it's in,
-- whether it's done (finished studying it, e.g. the test is over) or excluded (has "::" lines but isn't study material),
-- and pinned (listed even without flashcards, e.g. for fill in the blanks from bold words). Not note content, so not
-- through notes.ts or history. study_subjects.name is sealed (vault.ts, key "notes").
CREATE TABLE IF NOT EXISTS study_subjects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT 'blue',
  exam_date   TEXT,                              -- YYYY-MM-DD, the user's local date
  position    REAL NOT NULL DEFAULT 0,
  done_at     INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS study_pages (
  note_id     TEXT PRIMARY KEY,
  subject_id  TEXT,
  excluded    INTEGER NOT NULL DEFAULT 0,
  pinned      INTEGER NOT NULL DEFAULT 0,
  done_at     INTEGER,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS study_pages_subject ON study_pages(subject_id);
