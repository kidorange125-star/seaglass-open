-- "Hide from AI": a page with ai_hidden = 1 (and everything under it) is invisible to the assistant, MCP and every AI feature.
-- Only the user can change it, from the app. Not encrypted: it's a flag, like locked.
ALTER TABLE notes ADD COLUMN ai_hidden INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_notes_ai_hidden ON notes(ai_hidden) WHERE ai_hidden = 1;
