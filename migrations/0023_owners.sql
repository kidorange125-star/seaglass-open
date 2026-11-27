-- 0.2: everything personal belongs to one person (owner_id = users.id). Existing rows go to the first account.
-- Household-wide settings (the household, backups, encryption upkeep, the change feed's pruning) keep owner_id ''.
-- See docs/HOUSEHOLDS.md and src/worker/scope.ts.
ALTER TABLE notes ADD COLUMN owner_id TEXT NOT NULL DEFAULT '';
UPDATE notes SET owner_id = COALESCE((SELECT id FROM users ORDER BY created_at LIMIT 1), '');
ALTER TABLE actions ADD COLUMN owner_id TEXT NOT NULL DEFAULT '';
UPDATE actions SET owner_id = COALESCE((SELECT id FROM users ORDER BY created_at LIMIT 1), '');
ALTER TABLE links ADD COLUMN owner_id TEXT NOT NULL DEFAULT '';
UPDATE links SET owner_id = COALESCE((SELECT id FROM users ORDER BY created_at LIMIT 1), '');
ALTER TABLE comments ADD COLUMN owner_id TEXT NOT NULL DEFAULT '';
UPDATE comments SET owner_id = COALESCE((SELECT id FROM users ORDER BY created_at LIMIT 1), '');
ALTER TABLE changes ADD COLUMN owner_id TEXT NOT NULL DEFAULT '';
UPDATE changes SET owner_id = COALESCE((SELECT id FROM users ORDER BY created_at LIMIT 1), '');
ALTER TABLE study ADD COLUMN owner_id TEXT NOT NULL DEFAULT '';
UPDATE study SET owner_id = COALESCE((SELECT id FROM users ORDER BY created_at LIMIT 1), '');
ALTER TABLE memories ADD COLUMN owner_id TEXT NOT NULL DEFAULT '';
UPDATE memories SET owner_id = COALESCE((SELECT id FROM users ORDER BY created_at LIMIT 1), '');
ALTER TABLE chats ADD COLUMN owner_id TEXT NOT NULL DEFAULT '';
UPDATE chats SET owner_id = COALESCE((SELECT id FROM users ORDER BY created_at LIMIT 1), '');
ALTER TABLE push_subs ADD COLUMN owner_id TEXT NOT NULL DEFAULT '';
UPDATE push_subs SET owner_id = COALESCE((SELECT id FROM users ORDER BY created_at LIMIT 1), '');
ALTER TABLE push_sent ADD COLUMN owner_id TEXT NOT NULL DEFAULT '';
UPDATE push_sent SET owner_id = COALESCE((SELECT id FROM users ORDER BY created_at LIMIT 1), '');
ALTER TABLE push_snooze ADD COLUMN owner_id TEXT NOT NULL DEFAULT '';
UPDATE push_snooze SET owner_id = COALESCE((SELECT id FROM users ORDER BY created_at LIMIT 1), '');
ALTER TABLE embeddings ADD COLUMN owner_id TEXT NOT NULL DEFAULT '';
UPDATE embeddings SET owner_id = COALESCE((SELECT id FROM users ORDER BY created_at LIMIT 1), '');
ALTER TABLE inbox ADD COLUMN owner_id TEXT NOT NULL DEFAULT '';
UPDATE inbox SET owner_id = COALESCE((SELECT id FROM users ORDER BY created_at LIMIT 1), '');
ALTER TABLE prompts ADD COLUMN owner_id TEXT NOT NULL DEFAULT '';
UPDATE prompts SET owner_id = COALESCE((SELECT id FROM users ORDER BY created_at LIMIT 1), '');
ALTER TABLE routines ADD COLUMN owner_id TEXT NOT NULL DEFAULT '';
UPDATE routines SET owner_id = COALESCE((SELECT id FROM users ORDER BY created_at LIMIT 1), '');
ALTER TABLE thread ADD COLUMN owner_id TEXT NOT NULL DEFAULT '';
UPDATE thread SET owner_id = COALESCE((SELECT id FROM users ORDER BY created_at LIMIT 1), '');
ALTER TABLE study_subjects ADD COLUMN owner_id TEXT NOT NULL DEFAULT '';
UPDATE study_subjects SET owner_id = COALESCE((SELECT id FROM users ORDER BY created_at LIMIT 1), '');
ALTER TABLE study_pages ADD COLUMN owner_id TEXT NOT NULL DEFAULT '';
UPDATE study_pages SET owner_id = COALESCE((SELECT id FROM users ORDER BY created_at LIMIT 1), '');
ALTER TABLE study_sets ADD COLUMN owner_id TEXT NOT NULL DEFAULT '';
UPDATE study_sets SET owner_id = COALESCE((SELECT id FROM users ORDER BY created_at LIMIT 1), '');
ALTER TABLE study_sessions ADD COLUMN owner_id TEXT NOT NULL DEFAULT '';
UPDATE study_sessions SET owner_id = COALESCE((SELECT id FROM users ORDER BY created_at LIMIT 1), '');
ALTER TABLE study_exams ADD COLUMN owner_id TEXT NOT NULL DEFAULT '';
UPDATE study_exams SET owner_id = COALESCE((SELECT id FROM users ORDER BY created_at LIMIT 1), '');
ALTER TABLE study_exam_pages ADD COLUMN owner_id TEXT NOT NULL DEFAULT '';
UPDATE study_exam_pages SET owner_id = COALESCE((SELECT id FROM users ORDER BY created_at LIMIT 1), '');
ALTER TABLE study_misses ADD COLUMN owner_id TEXT NOT NULL DEFAULT '';
UPDATE study_misses SET owner_id = COALESCE((SELECT id FROM users ORDER BY created_at LIMIT 1), '');
ALTER TABLE agent_approvals ADD COLUMN owner_id TEXT NOT NULL DEFAULT '';
UPDATE agent_approvals SET owner_id = COALESCE((SELECT id FROM users ORDER BY created_at LIMIT 1), '');
CREATE INDEX notes_owner ON notes(owner_id);
CREATE INDEX actions_owner ON actions(owner_id);
CREATE INDEX changes_owner ON changes(owner_id);
CREATE INDEX thread_owner ON thread(owner_id);
CREATE INDEX embeddings_owner ON embeddings(owner_id);
CREATE INDEX study_sessions_owner ON study_sessions(owner_id);
CREATE INDEX study_misses_owner ON study_misses(owner_id);
CREATE INDEX memories_owner ON memories(owner_id);
CREATE INDEX inbox_owner ON inbox(owner_id);
-- prefs: one value per person and key.
CREATE TABLE prefs_new (owner_id TEXT NOT NULL DEFAULT '', key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (owner_id, key));
INSERT INTO prefs_new (owner_id, key, value) SELECT CASE WHEN key IN ('household', 'backup_status', 'vault_sealed_kid', 'changes_pruned_through') THEN '' ELSE COALESCE((SELECT id FROM users ORDER BY created_at LIMIT 1), '') END, key, value FROM prefs;
DROP TABLE prefs;
ALTER TABLE prefs_new RENAME TO prefs;

-- Keys that were unique across the whole copy become unique per person: a reminder's sent-marker ("d|<day>|<time zone>"
-- for the daily summary would otherwise let only the first person in a time zone get theirs), and a saved prompt's name.
CREATE TABLE push_sent_new (owner_id TEXT NOT NULL DEFAULT '', key TEXT NOT NULL, sent_at INTEGER NOT NULL, PRIMARY KEY (owner_id, key));
INSERT INTO push_sent_new (owner_id, key, sent_at) SELECT owner_id, key, sent_at FROM push_sent;
DROP TABLE push_sent;
ALTER TABLE push_sent_new RENAME TO push_sent;
DROP INDEX IF EXISTS prompts_name;
CREATE UNIQUE INDEX prompts_owner_name ON prompts (owner_id, name);
