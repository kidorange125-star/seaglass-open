-- Subjects are folders of tests. In the code a test is an "exam" (a Practice test is a way of studying, this is the real
-- thing with a date). A page can be in more than one (a unit test and the midterm). study_exams.name and
-- study_subjects.icon are sealed (vault.ts, key "notes"). Not note content, so not through notes.ts or history.
ALTER TABLE study_subjects ADD COLUMN icon TEXT;
CREATE TABLE study_exams (
  id          TEXT PRIMARY KEY,
  subject_id  TEXT NOT NULL,
  name        TEXT NOT NULL,
  exam_date   TEXT,                              -- YYYY-MM-DD, the user's local date
  position    REAL NOT NULL DEFAULT 0,
  done_at     INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_study_exams_subject ON study_exams(subject_id);
CREATE TABLE study_exam_pages (
  exam_id  TEXT NOT NULL,
  note_id  TEXT NOT NULL,
  PRIMARY KEY (exam_id, note_id)
);
CREATE INDEX idx_study_exam_pages_note ON study_exam_pages(note_id);
