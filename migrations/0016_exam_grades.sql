-- The real grade on a test, once its date has passed (worker study.ts logGrade): sealed JSON with the score, what it was out
-- of, the percent, what practice predicted at the time, and the Grades row and run it added (so Undo can take it back).
-- Or {"skipped":true} when the user chose not to say.
ALTER TABLE study_exams ADD COLUMN grade TEXT;
