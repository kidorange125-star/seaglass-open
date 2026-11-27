-- Questions the user missed in quizzes and tests, brought back reworded a few days later until the user gets them right twice
-- (src/worker/misses.ts). data is sealed (vault.ts): the question, its answer and the pages it came from.
CREATE TABLE study_misses (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  rights INTEGER NOT NULL DEFAULT 0,
  misses INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_study_misses_due ON study_misses(due_at);
