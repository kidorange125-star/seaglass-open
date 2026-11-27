-- Encryption at rest (src/worker/vault.ts). Private content is now sealed, so SQL can no longer look inside it. Two plain
-- flags carry what the database itself needs to know, and are kept up to date by notes.ts on every write:
--   system: which built-in list a database is ('tasks' or 'grades'), instead of searching its schema text
--   dated:  1 when a row has a date, so reminders and the home screen can find dated rows without reading every row
ALTER TABLE notes ADD COLUMN system TEXT;
ALTER TABLE notes ADD COLUMN dated INTEGER NOT NULL DEFAULT 0;
UPDATE notes SET system = 'tasks'  WHERE kind = 'database' AND db_schema LIKE '%"system":"tasks"%';
UPDATE notes SET system = 'grades' WHERE kind = 'database' AND db_schema LIKE '%"system":"grades"%';
UPDATE notes SET dated = 1 WHERE props LIKE '%"start"%';
CREATE INDEX IF NOT EXISTS idx_notes_system ON notes(system) WHERE system IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notes_dated ON notes(dated) WHERE dated = 1;
