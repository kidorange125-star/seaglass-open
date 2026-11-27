-- Comments on specific text, and suggested edits (#22). anchor: the words a comment is on and which occurrence, as sealed
-- JSON {quote, nth}; kind: comment or suggestion; author: user, agent or mcp; replace_with: a suggestion's new text (sealed);
-- outcome: accepted or rejected once a suggestion is answered.
ALTER TABLE comments ADD COLUMN kind TEXT NOT NULL DEFAULT 'comment';
ALTER TABLE comments ADD COLUMN author TEXT NOT NULL DEFAULT 'user';
ALTER TABLE comments ADD COLUMN anchor TEXT;
ALTER TABLE comments ADD COLUMN replace_with TEXT;
ALTER TABLE comments ADD COLUMN outcome TEXT;
