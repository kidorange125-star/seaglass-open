-- What happened each time the user studied (the games, flashcards, practice tests and Chat), so the assistant can cheer on
-- real progress, aim at what the user keeps missing and plan around it. `data` is sealed JSON: mode, page ids, title, score, missed.
CREATE TABLE study_sessions (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_study_sessions_created ON study_sessions(created_at);
