-- Paper Lock cards, version 2: the card is found by its edges and straightened, and its drawing compared finely
-- (client/paper/scan.ts, match.ts). template holds the three setup scans (sealed JSON). Version 1 cards (one
-- 40 x 24 map, compared loosely) still open their pages, at a stricter threshold, and after the next good scan the
-- phone is asked for three fresh scans (refresh_until: until when that is allowed).
ALTER TABLE paper_cards ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE paper_cards ADD COLUMN refresh_until INTEGER NOT NULL DEFAULT 0;
