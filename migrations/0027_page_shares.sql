-- Seaglass Open 0.2.3: sharing a page (and everything under it) with one person in the household (src/worker/sharing.ts).
-- A system table: it links two people, so it belongs to neither one's own data. The page itself stays in its owner's
-- things; the person reaches it only through /api/s/share/<id>/..., which checks this row on every request.
CREATE TABLE page_shares (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL,          -- whose page it is
  note_id    TEXT NOT NULL,          -- the page shared (its sub-pages come with it)
  person_id  TEXT NOT NULL,          -- who it's shared with
  level      TEXT NOT NULL,          -- view | edit
  created_at INTEGER NOT NULL,
  UNIQUE (note_id, person_id)
);
CREATE INDEX page_shares_person ON page_shares (person_id);
CREATE INDEX page_shares_owner ON page_shares (owner_id);
