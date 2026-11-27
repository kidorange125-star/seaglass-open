-- The whole of a finished quiz or practice test (questions, options, what the user answered), so it can be reviewed and
-- retaken later. Sealed like `data`. Kept apart from `data` so the assistant's summaries never have to read it.
ALTER TABLE study_sessions ADD COLUMN played TEXT;
