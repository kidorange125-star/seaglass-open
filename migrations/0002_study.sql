-- Study mode: spaced-repetition progress for flashcards. Cards themselves live in page content (toggles and
-- "term :: definition" lines); this table only remembers how well you know each one. It isn't note content,
-- so it doesn't go through notes.ts or the history log (reviewing shouldn't fill your undo history).
CREATE TABLE IF NOT EXISTS study (
  note_id     TEXT NOT NULL,                     -- the page the card is on
  card_id     TEXT NOT NULL,                     -- hash of the card's question
  ease        REAL NOT NULL DEFAULT 2.5,
  interval    INTEGER NOT NULL DEFAULT 0,        -- days
  reps        INTEGER NOT NULL DEFAULT 0,
  lapses      INTEGER NOT NULL DEFAULT 0,
  due         TEXT NOT NULL,                     -- YYYY-MM-DD, the user's local date
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (note_id, card_id)
);
CREATE INDEX IF NOT EXISTS study_due ON study(due);
