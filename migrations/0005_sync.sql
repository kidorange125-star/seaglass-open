-- Two-way sync support for outside agents (MCP): page metadata and a change feed.

-- Small key/value metadata a sync keeps on a page, e.g. {"external_ids":{"notion":"..."}}. Not shown in the editor,
-- not part of page history (undo never reverts it), and setting it doesn't count as an edit.
ALTER TABLE notes ADD COLUMN meta TEXT NOT NULL DEFAULT '{}';

-- Append-only change feed: one row per created / edited / moved / trashed / restored / deleted page, from every
-- source (the app, the assistant, MCP, undo). seq is the cursor. Consecutive edits to the same page within a few minutes
-- replace the previous row (it moves to the end), so typing doesn't flood the feed.
CREATE TABLE IF NOT EXISTS changes (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id     TEXT NOT NULL,
  type        TEXT NOT NULL,                     -- created | edited | moved | trashed | restored | deleted
  source      TEXT NOT NULL,                     -- user | agent | mcp
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS changes_at ON changes(created_at);
CREATE INDEX IF NOT EXISTS changes_note ON changes(note_id, seq DESC);

-- Seed the feed from existing history so it starts with what already happened.
INSERT INTO changes (note_id, type, source, created_at)
SELECT note_id,
  CASE
    WHEN before_json IS NULL THEN 'created'
    WHEN after_json IS NULL THEN 'deleted'
    WHEN json_extract(before_json, '$.deleted_at') IS NULL AND json_extract(after_json, '$.deleted_at') IS NOT NULL THEN 'trashed'
    WHEN json_extract(before_json, '$.deleted_at') IS NOT NULL AND json_extract(after_json, '$.deleted_at') IS NULL THEN 'restored'
    WHEN json_extract(before_json, '$.parent_id') IS NOT json_extract(after_json, '$.parent_id') THEN 'moved'
    ELSE 'edited'
  END,
  source, created_at
FROM actions ORDER BY created_at, id;
