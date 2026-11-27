# Security: what is encrypted, and what isn't

Seaglass keeps one household's notes, so the design goal is simple: **if someone gets a copy of the stored data, they get
nothing readable.** Everything private is encrypted before it is written to the database (D1) or file storage (R2).

## What is encrypted at rest

AES-256-GCM, one fresh random nonce per value, in `src/worker/vault.ts`.

| Data | Where | Notes |
|---|---|---|
| Page titles, content, plain-text copy, properties, database schemas, icons, covers, page metadata | `notes` | |
| Version history and undo snapshots | `actions` | the biggest copy of your text; sealed with its own key |
| Comments | `comments` | |
| Waffle's memories | `memories` | |
| Chats with Waffle (titles, messages, search text) | `chats` | |
| Search-by-meaning vectors | `embeddings` | vectors can be turned back into rough meaning, so they are sealed too |
| Notification device keys and names, snoozed reminder text | `push_subs`, `push_snooze` | |
| Study subject names | `study_subjects` | sealed with the notes key; colours, test dates and page/subject links are plain |
| What the user studied and missed (each session's pages, score, missed questions, and every question the user answered) | `study_sessions` (`data`, `played`) | sealed with the notes key; only the time is in the clear |
| Subject emoji and test names | `study_subjects.icon`, `study_exams.name` | sealed with the notes key |
| The grade the user got on a test, and what practice predicted | `study_exams.grade` | sealed with the notes key |
| Questions the user missed, kept to come back | `study_misses` (`data`) | sealed with the notes key; only the due date and counts are in the clear |
| Live voice | not stored as audio | speech is recognized on the device where the browser can (the screen says which); on iPhones the recording so far goes to Workers AI about once a second to be transcribed and is not kept; if a voice key is set, reply text goes to ElevenLabs or OpenRouter to be spoken; the words are saved in the sealed thread |
| What the assistant wrote for the Study games | `study_sets` | sealed with the notes key (including the hash of the notes it came from); the row id is a hash of the game and page ids |
| Uploaded images, PDFs, voice notes | R2 | sealed before upload, opened when served |

How it is built:
- One 256-bit master key (`DATA_KEY`, a Worker secret) goes through HKDF-SHA-256 to make a separate AES key for each
  kind of data (notes, history, chats, memory, push, search index, files).
- Each value is **bound to its own address** (table, row id, column) as authenticated data. A sealed value copied
  into another row or column fails to open, and any change to the ciphertext is detected.
- Each value records the id of the key that sealed it, so keys can be rotated (below).
- The Worker refuses to serve (HTTP 503) without a valid key, so nothing is ever written as plaintext by accident.
- In **strict mode** (the Worker secret `VAULT_STRICT=1`, on in production since 2026-11-07) plaintext in the database is
  refused outright, so a tampered row can't slip an unencrypted value in. It is a secret rather than a `wrangler.jsonc` var
  so local development and the test suites (which deliberately store old plaintext rows) are unaffected.

## What is NOT encrypted

- **Structure:** page ids, which page is inside which, page type (page or database), order, timestamps, revision
  numbers, favourite / lock / template flags, share links, link relationships between pages, the change feed (ids and
  times only), flashcard review schedules, and two derived flags (`system`: which built-in list; `dated`: has a date).
  Someone with a copy of the database can see *how many* pages you have and when they changed, but not what is in them.
- **File names** in R2 keys, file types, and sizes.
- Notification endpoint URLs (they are the row's key).
- Passwords are never stored: only a salted PBKDF2-SHA256 hash (100,000 rounds, the most Cloudflare Workers allow). Sign-in
  cookies hold a random token and the database keeps only its SHA-256. `SETUP_CODE`, `DATA_KEY` and the other Worker secrets are
  stored by Cloudflare as secrets, not in D1.

## Limits you should know about

Encryption at rest protects the stored copy. The server still has to read your notes to search them, sync them and
talk to Waffle, so:
- Anyone who can **deploy code to your Worker or read its secrets** (your Cloudflare account, your `wrangler` login,
  your GitHub if it deploys) can read everything. Turn on two-factor sign-in for Cloudflare and GitHub.
- Anyone with your **username and password** can use the app as you. Five wrong passwords in a row lock the username for a
  while (longer each time); use a long, unique password.
- **Waffle** sends the pages the user reads, and your chat, to Anthropic. Web search goes through Anthropic too.
  **Search by meaning** sends page text to Cloudflare Workers AI to turn it into vectors, and **voice notes** go there
  to be transcribed.
- Files are served from public capability URLs (a long random id in the address) so images and shared pages work.
  Anyone who has the exact URL can open that file.
- **Shared pages** (the Share button) are decrypted on purpose for whoever has the link.
- On your own devices, the offline copy (the browser's cache, the saved offline edits, and quizzes and tests closed
  halfway with your answers so far, `sg.study.unfinished`, and the quiz questions and practice tests kept for offline with any sessions waiting to sync, `sg.study.sets`/`tests`/`outbox`) is **plaintext** on that
  device, protected only by the device's own lock and disk encryption. Logging out clears it.
- Cloudflare's own disk encryption also applies underneath, but its keys are Cloudflare's. `DATA_KEY` is yours.

## The key: do not lose it

**If `DATA_KEY` is lost, every note is unrecoverable.** There is no back door.
- Make one: `npm run data:keygen -- --out <file> --put` (writes the key to a file, never prints it, and stores it as the
  Worker secret). Copy the file's content into your password manager, then delete the file.
- Local development: `npm run data:keygen -- --dev` adds a separate key to `.dev.vars`.
- A plaintext copy of your notes is always available while signed in: `/api/export`.
- Text read out of a PDF for the assistant (`read_file`) is cached sealed in R2 under `filetext/`, like the file itself.
- Nightly backups (Settings > Backups, `worker/backup.ts`) are sealed with a key derived from `DATA_KEY`, and the pages inside
  stay sealed even in a downloaded copy, so **no backup restores without `DATA_KEY`** (or `DATA_KEY_PREVIOUS` after a rotation;
  the rotation cron re-seals stored backups). The last 14 are kept in R2 under `backups/`. Restore: `npm run backup:restore -- <file>`
  (add `--remote --yes` for production). Uploaded files are not in them. D1 Time Travel (30 days) is a second way back.

## Rotating the key

1. Make a new key (`npm run data:keygen -- --out <file>`), and keep the old one.
2. Store the old key as `DATA_KEY_PREVIOUS`: `npx wrangler secret put DATA_KEY_PREVIOUS`
   (several old keys can be separated with commas).
3. Store the new key as `DATA_KEY`: `npx wrangler secret put DATA_KEY`.
4. Within a few minutes the every-minute job re-encrypts everything under the new key. Check Setup & status:
   "Encryption at rest" turns green when it is done (or `GET /api/security/status`).
5. Then delete the old one: `npx wrangler secret delete DATA_KEY_PREVIOUS`.

## Checking it yourself

This should show text starting with `~sg1~`, not your titles:

    npx wrangler d1 execute seaglass --remote --command "SELECT substr(title,1,24), substr(html,1,24) FROM notes LIMIT 3"

This should print 0:

    npx wrangler d1 execute seaglass --remote --command "SELECT COUNT(*) FROM notes WHERE title != '' AND title NOT LIKE '~sg1~%'"

Tests: `tests/unit/vault.test.mts` (the scheme itself), `tests/api/vault.test.py` (what is really stored, moving old
data onto the key, files) and `tests/api/rotation.test.py` (key rotation).
