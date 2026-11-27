-- Which agent made each change: a short label such as "the assistant (Sonnet 5.5)", "Waffle (Haiku 5.5, live voice)" or
-- "Claude (MCP)" (src/worker/identity.ts). NULL for the user's own edits and for changes made before this column existed.
ALTER TABLE actions ADD COLUMN agent TEXT;
ALTER TABLE changes ADD COLUMN agent TEXT;
