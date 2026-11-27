-- A subject's class in the Grades database (#9, worker hub.ts): the class option's id, chosen in the subject editor. Empty
-- means "the class with the same name". Not sealed: an option id says nothing on its own.
ALTER TABLE study_subjects ADD COLUMN grade_class TEXT;
