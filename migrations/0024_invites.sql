-- Seaglass Open 0.2: inviting family members (src/worker/household.ts). An invite is a one-time code (shown once, as a
-- code and a link) that makes one account with the given role. Only its SHA-256 is stored. Not personal data: it
-- belongs to the household, and only the owner can see or cancel invites.
CREATE TABLE invites (
  id TEXT PRIMARY KEY,                 -- SHA-256 of the code
  role TEXT NOT NULL DEFAULT 'adult',  -- owner | adult
  label TEXT NOT NULL DEFAULT '',      -- who it's for ("Sam"), so the owner can tell invites apart
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_by TEXT,
  used_at INTEGER
);
CREATE INDEX invites_open ON invites (used_at, expires_at);
