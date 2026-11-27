-- Accounts (Seaglass Open). Usernames and passwords instead of one shared access token. Passwords are kept only as salted
-- PBKDF2-SHA256 hashes; sessions only as the SHA-256 of their token. The household (individual or household, its name) is
-- in prefs under "household". Every account belongs to that one household; members beyond the owner arrive later.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  pass_salt TEXT NOT NULL,
  pass_iter INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',          -- owner | adult | kid
  created_at INTEGER NOT NULL,
  password_changed_at INTEGER NOT NULL
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                         -- SHA-256 of the cookie's token, never the token itself
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
-- Failed sign-ins by username, to slow down guessing.
CREATE TABLE login_attempts (
  key TEXT PRIMARY KEY,
  fails INTEGER NOT NULL,
  locked_until INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
