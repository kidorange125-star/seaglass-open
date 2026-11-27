# Tests

> **Warning:** the API and browser suites expect an empty database and wipe it. Never run them against the dev
> server you use for real notes. Run a second server with its own throwaway data instead:
>
> ```powershell
> $env:SEAGLASS_STATE = "$env:TEMP\seaglass-test"; npx wrangler d1 migrations apply seaglass --local --persist-to $env:SEAGLASS_STATE
> npx vite --port 5174 --strictPort          # test server, separate database
> $env:SEAGLASS_URL = "http://localhost:5174" # every suite reads this (default 5173)
> npx wrangler d1 execute seaglass --local --persist-to $env:SEAGLASS_STATE --command "DELETE FROM notes; DELETE FROM actions; DELETE FROM links; DELETE FROM comments; DELETE FROM changes; DELETE FROM study;"   # wipe between suites
> ```

These are the suites used to build and verify Seaglass. They run against a local dev server, and most
expect an empty local database, so wipe it between suites:

```powershell
npx wrangler d1 execute seaglass --local --command "DELETE FROM notes; DELETE FROM actions; DELETE FROM links; DELETE FROM comments; DELETE FROM changes; DELETE FROM study;"
```

## Unit (no server needed)

```powershell
node tests/unit/logic.test.mjs                                   # formulas, filters, sorts, groups, rollups (50)
node --experimental-strip-types tests/unit/wif.test.mts           # federation identity tokens + JWKS (11)
node tests/unit/time.test.mjs                                    # task time windows: quick-add parsing, labels (17)
node tests/unit/recur.test.mjs                                   # repeating tasks: next dates, quick-add phrases (24)
node --experimental-strip-types tests/unit/grades.test.mjs      # grade averages, letters, and what a test needs to keep or raise one (19)
node tests/unit/study-modes.test.mjs                             # study games: quiz, blanks, match, typed-answer matching, card count, and checks on what the assistant writes (125)
node tests/unit/study.test.mjs                                   # flashcard scheduling (SM-2) and card ids (17)
node --experimental-strip-types tests/unit/webpush.test.mts       # push encryption vs RFC 8291's test vector, VAPID (20)
node --experimental-strip-types tests/unit/links.test.mts         # which link addresses are allowed and completed, how they're shown, what a click does (25)
node --experimental-strip-types tests/unit/reminders.test.mts     # when task reminders fire: time zones, DST, summary (39)
node --experimental-strip-types tests/unit/resume.test.mts        # unfinished quizzes kept on the device: keys, limit, age (20)
node --experimental-strip-types tests/unit/dbtools.test.mts       # database charts (series, averages, percents) and CSV (parse, round trip, types, import plan) (27)
node --experimental-strip-types tests/unit/comments.test.mts      # comments on words: anchors, found again after edits, panel order (15)
node tests/unit/backup.test.mjs                                    # restoring a backup: values, batches, refuses non-backups and unsafe names (9)
node --experimental-strip-types tests/unit/weak.test.mts          # weak spots: which block holds an answer the user keeps missing (9)
node --experimental-strip-types tests/unit/tidy.test.mts          # steps for assignments, and the tidy-up's rules (15)
node --experimental-strip-types tests/unit/formats.test.mts       # note formats, Cornell rows as flashcards (8)
node --experimental-strip-types tests/unit/ink.test.mts           # handwriting strokes: pressure, thinning, eraser, saved drawings (14)
node --experimental-strip-types tests/unit/notion-sync.test.mts   # Notion sync: page round trips, dry run writes nothing, real run both ways, never deletes, skips hidden pages and Seaglass-only blocks (27)
node --experimental-strip-types tests/unit/persona.test.mts       # Waffle's prompt untouched, Waffle's name and its own lines (7)
node --experimental-strip-types tests/unit/hidden.test.mts        # Hide from AI: what's scrubbed from AI results, refused inputs, blanked mentions (21)
```

## Notifications (real delivery)

```powershell
node tests/browser/push.cjs   # with SEAGLASS_URL set: subscribes Chrome, runs the cron at a task's time, checks the
                              # notification arrives through Google's push service, then Done and Snooze
```
Needs Google Chrome installed (Playwright's own Chromium has no push service) and internet access.

## API (Python 3, no packages needed)

Start the server with `npm run dev`. The `.dev.vars` mode matters:

| Suite | `.dev.vars` | Checks |
|---|---|---|
| `python tests/api/api.test.py` | `ANTHROPIC_API_KEY=mock` and `AUTH_OPEN=1` and `DEFAULT_AGENT_PERMISSIONS=free` | 37: pages, trash, history, sharing, uploads, sanitizer, locks |
| `python tests/api/agent.test.py` | `ANTHROPIC_API_KEY=mock` and `AUTH_OPEN=1` and `DEFAULT_AGENT_PERMISSIONS=free` | 36: Waffle's tools, streaming, undo/redo, conflicts, locks |
| `python tests/api/mcp.test.py` | `ANTHROPIC_API_KEY=mock`, `AUTH_OPEN=1` and `DEFAULT_AGENT_PERMISSIONS=free` and `PUBLIC_URL=` (blank); its OAuth sign-in part still sends the old access token and needs updating for accounts | MCP protocol, full OAuth flow, anti-CSRF, undo, study details |
| `python tests/api/capture.test.py` | same as mcp | 33: capture key and endpoint, Inbox and task parsing, transcription, search by meaning, the Waffle/MCP tool |
| `python tests/api/sync.test.py` | same as mcp | 64: sync over MCP: timestamps (MCP, app and Waffle edits), change feed and cursors, content hash, trash, metadata, safe writes, read_notes, paging, create_database |
| `python tests/api/hidden.test.py` | same as mcp | 35: Hide from AI: MCP and Waffle can't read, search, list, write, link to or undo hidden pages (or their sub-pages); mentions blanked; AI routes refuse; only the app can toggle it |
| `python tests/api/households.test.py` | same as mcp, on an EMPTY database (no accounts); set `SEAGLASS_STATE` to the test server's `--persist-to` folder | 29: two people on one copy: B (an account added by SQL) sees none of A's things on any GET route or MCP tool, and naming A's ids changes nothing |
| `python tests/api/invites.test.py` | `ANTHROPIC_API_KEY=mock`, `AUTH_OPEN=1`, no `SETUP_CODE`, on an EMPTY database; set `SEAGLASS_STATE` too | 36: two real accounts with sessions: invites (code, link, once only, cancel), joining, roles and their limits, separation of pages and files, removing a member deletes everything of theirs |
| `python tests/api/usage.test.py` | same as invites | 32: AI usage recorded per person, feature and model; daily, monthly and household limits stop the next request; kid accounts (teach mode refuses writing and rewriting, no web, can't change their own rules or delete themselves); owners reset a forgotten password |
| `python tests/api/family.test.py` | same as invites | 38: the shared Family space: everyone in a household sees and edits it, history says who, personal pages never reach it, only page/task/calendar routes work there, Family files open for the household, it closes outside a household and comes back
| `python tests/api/sharing.test.py` | same as invites | 44: a page shared with one person to view or edit: only that branch shows (never the owner's other pages, search, recent, undo or the assistant), view-only is locked, edits can't move or publish, history says who, files on the page open, unsharing, trashing and removing a member close it
| `python tests/api/setup.test.py` | same as invites | 27: setup after the account: keys saved in the app (checked, sealed, never sent back, last four shown), AI later and off (every AI route refuses), allowed models, the notification key Seaglass makes itself

Restart `npm run dev` after changing `.dev.vars`.

## Browser (Playwright)

```powershell
npm i -D playwright
npx playwright install chromium
```

Run with `.dev.vars` = `ANTHROPIC_API_KEY=mock` and `AUTH_OPEN=1` and `DEFAULT_AGENT_PERMISSIONS=free`. Each prints its checks; an optional
argument is a folder for screenshots.

| Script | Covers |
|---|---|
| `node tests/browser/editor.cjs` | Slash menu blocks, mentions, HTML round trip |
| `node tests/browser/databases.cjs` | Rows, status/date/tags, board drag, calendar |
| `node tests/browser/db-views.cjs` | List, gallery, timeline, grouping, templates (run right after `databases.cjs`) |
| `node tests/browser/conflicts.cjs` | No false conflicts; real outside edits raise the banner |
| `node tests/browser/jeff.cjs` | Waffle panel: tool cards, Undo/Redo, `/undo` `/redo`, live reload, conflict dialog |
| `node tests/browser/setup-sync.cjs` | Setup & status screen, install manifest, sync between devices |
| `node tests/browser/ai-tools.cjs` | Ask Waffle on selected text, photo to notes, practice test (mock model, `ANTHROPIC_API_KEY=mock`) |
| `node tests/browser/study-tools.cjs` | Grades database and summary, study streak, weekly review setting and screen, focus timer |
| `node tests/browser/offline.cjs` | Offline mode: reload offline, edit and tick tasks offline, sync on reconnect, conflict copy. Needs a PRODUCTION build: `npm run build` then `npx vite preview --port 5176` (see the file header); not in the default run |
| `node tests/browser/capture-ui.cjs` | Quick capture settings, share target, voice note recorder (fake microphone, mock transcription) |
| `node tests/browser/write.cjs` | `/` menu: Write with Waffle and Continue writing (mock model) |
| `python tests/api/thread.test.py` | The one ongoing conversation: old chats moved in, every turn saved, the model's window, new topic, rolling summary, search, paging. Needs an EMPTY database |
| `python tests/api/proactive.test.py` | Saved prompts, routines (timing, days, once per slot, undo), the hourly check-in (6 AM to 9 PM, no repeats), inbox accept/dismiss/feedback |
| `node tests/browser/proactive.cjs` | Settings dialog, inbox cards in the chat, badge, Add task, Ask, /name saved prompts in the chat and a page's / menu |
| `node tests/browser/waffle-moods.cjs` | Waffle's header moods follow the run: thinking, then comets for every tool call and web search (held ~1.8s so they show), then idle (mock model) |
| `node tests/browser/phone-overflow.cjs` | On a phone nothing pans sideways: long links in to-dos, callouts, toggles and columns wrap, long tool chips in the chat shorten with "…", only tables/boards/code scroll inside their own box |
| `node tests/browser/model-choice.cjs` | The model menu fits inside the chat window; the model and web switch you pick are saved on the server and another device starts from them; bad values refused |
| `node tests/browser/compose.cjs` | The chat message field sizes to its text without jumping: one switch to two rows while typing, one back while deleting, no hidden lines, prefills grow it |
| `node tests/browser/menus-fit.cjs` | A page's ⋯ menu at the bottom of a long sidebar list moves up to show in full (not cut off or behind Settings/Trash); Trash's description sits under its heading |
| `node tests/browser/study-tab.cjs` | The Study tab: subjects (create, colour, test date, rename, done, delete), one-tap Done / Exclude with Undo, studying a whole subject, Review all due, the five ways to study a page, the assistant's study tools; no flashcards panel on Home; Study is a phone tab (mock model, wiped database) |
| `node tests/browser/study-coach.cjs` | The assistant as study coach: its message and buttons after every kind of session, Chat (desktop and 390px), its study tools, the check-in's study plan. Mock model, wiped database. `node tests/unit/study-coach.test.mjs` covers the pure checks. |
| `node tests/browser/local-ear.cjs` | On-device speech with the REAL model (downloads about 55 MB; copy it into the test server's R2 first: `npm run voice:model -- --local --persist-to <its state folder>`): transcribes `tests/fixtures/speech.wav` in Chromium and WebKit, and a whole live voice turn sends nothing to Workers AI. Dev server, mock model. |
| `node tests/browser/live-voice.cjs` | Live voice with a fake microphone: listening, sending, spoken reply, interrupt, mute, end, device-voice fallback, recording fallback, 390px. Mock model. `node tests/unit/voice.test.mts` covers sentence splitting and what is sent to the voice services. |
| `node tests/browser/study-insights.cjs` | Time data: a quiz records seconds per question, rushing is spotted and shown under How you study; weak spots: a question missed twice highlights its paragraph, never saved, the page menu hides and shows it. Mock model, wiped database. |
| `node tests/browser/study-offline.cjs` | Quizzes offline: a quiz and a practice test fetched online play again offline, the finished session waits in the outbox and syncs when back online. Mock model, wiped database. |
| `node tests/browser/syllabus-lecture.cjs` | Snap a syllabus (read, untick a test, add the subject, tests and tagged tasks, Undo) and record a class (fake microphone, pieces of 2 s each turned into text, notes with flashcards and the transcript filed under the subject), 390px. Mock model, wiped database. |
| `node --experimental-strip-types tests/unit/handwriting-text.test.mts` | A drawing reads as its transcript in search text; ink colours and the transcript survive sanitizing. |
| `node tests/browser/notes-ink.cjs` | Pen widths (Fine is remembered and used, saved as the user writes even after Written ✓), the pens fading while writing, two- and three-finger taps for undo and redo, the empty-note hint; Note formats (Cornell as lines only, a filled row is a flashcard, the I. / A. / 1. outline, the chart, stacked callout lines, the ⋯ menu's Add a note format, the / menu) and handwriting (pen with pressure, palm rejection, highlighter, Turn into text, edit again, eraser, the top bar's pencil, Snap to lines, Cornell paper and its handwritten title naming the page, the lined Cornell sheet; only the iPad writes by hand: no pencil, / Handwriting or drawing editing on the iPhone and computer, what they type into a handwritten page is outlined on the iPad, Write this by hand replaces it, × keeps it). Mock model, wiped database. |
| `node tests/browser/hub.cjs` | A subject as a class hub: its class in Grades by name, the average by points, recent grades, what the next test needs (also on the test's screen), no Tasks card, 390px. Mock model, wiped database. |
| `node tests/browser/related.cjs` | "You wrote about this before": related notes on open (stored vector) and while writing (after a pause), not unrelated ones or itself, opens in the peek, × hides, 390px. Mock embeddings, wiped database. |
| `node tests/browser/date-picker.cjs [screenshot folder]` | The date picker on a task and in a database date cell (Tomorrow, a day from the calendar, Add time, Remind, Remove, Add a start date keeps the due day, Clear), a task with a start date is due on its last day (not overdue while under way, the sidebar count, the ⋯ menu's Tomorrow moves the due day), phone and iPad sheets in Chromium and WebKit. Mock model, wiped database. |
| `node tests/browser/links.cjs` | Links in pages: a click opens a web link in a new tab and a Seaglass link inside the app, the link card (arrow keys only), the Link dialog (change the words and the address, a long address becomes a short name, `/link`, Remove keeps the words, bad addresses refused), links on a locked page, the 390px dialog. Mock model, wiped database. |
| `node tests/browser/daily-home.cjs` | Home's Today plan (next test, study, due today, no Start buttons, tapping the study item opens how to study it) and daily notes (made once, the day's tasks, captures land in it once used, in their day and time even with no date sent or where it is already tomorrow in UTC, Wrap up my day and Undo, the 9:30 PM wrap-up once), 390px. Mock model, wiped database. |
| `node tests/browser/tasks-tidy.cjs` | Steps for an assignment (draft, remove one, added as linked tasks with dates, tick, Undo) and the tidy-up (empty page, duplicate, loose note found, a button in the conversation, Accept, Undo). Mock model, wiped database, needs `SEAGLASS_STATE`. |
| `node tests/browser/quick.cjs` | Quick actions in Ctrl+K: done with the tools, nothing in the conversation, no memories, one Undo for the run, "Do it" first for an instruction and absent for a search, the notice with Undo, 390px. Mock model, wiped database. |
| `node tests/browser/db-upgrades.cjs` | Database upgrades: Grades' Over time chart (a line per class, legend, tooltip), switched to bars and saved, CSV export of a view, CSV import (asks, new option and checkbox, US dates, Undo), a linked view on another page (pick, its own view kept, edits save to the database), 390px. Mock model, wiped database. |
| `node tests/browser/comments.cjs` | Comments on selected words (highlight, nothing written to the page, clicking opens it) and the assistant's suggested edits (refused unless once on the page as text, struck through with the new words, pill, Accept keeps bold, Reject, Ctrl+Z, `read_note` lists them), 390px. Mock model, wiped database, migration 0018. |
| `node tests/browser/files.cjs` | PDFs and files in pages: a PDF from the / menu becomes a file block, saved, served without the sandbox (other files keep it), Preview, the assistant's `read_file` (mock text, wrong name), a recording's player, 390px. Mock model, wiped database. |
| `node tests/browser/backups.cjs` | Automatic backups: made and checked, the download keeps pages sealed, a real restore with `scripts/restore-backup.mjs` brings a changed page back and removes a later one, `--remote` needs `--yes`, keeps 14, Settings > Backups (Back up now, download, 390px). Mock model, wiped database, needs `SEAGLASS_STATE`. |
| `node tests/browser/gallery.cjs` | The routine gallery (six starters, one fills the form, saved, no longer offered) and that the removed calendar feed stays gone. Mock model, wiped database. |
| `node tests/browser/push-quiet.cjs` | Quiet hours with real push (Google Chrome, like push.cjs): a High priority task comes through, an ordinary one is held, and one catch-up notification arrives when they end. |
| `node tests/browser/study-explain.cjs` | Explain it: prompts from the notes, feedback (got, missing, wrong with the fix), Try again scored on the first try, the session and misses saved, counted in the page's score, History retake with no model call, 390px. Mock model, wiped database. |
| `node tests/browser/study-grade.cjs` | The real grade after a test: asked only once the date has passed, saved to Grades with the subject as a class, compared with practice, Undo, Skip, a second test's average gap, 390px with 16px fields. Mock model, wiped database. |
| `node tests/browser/study-plan.cjs` | A study plan when a test is created: offered for a new dated test (no model call until asked), nothing on the test day, remove one, the rest become dated tasks with times, Undo, a later visit shows a row, the plain spread when the model fails, 390px. Mock model, wiped database. `study-coach.test.mjs` covers `draftPlan` and `fitPlan`. |
| `node tests/browser/study-resume.cjs` | Unfinished sessions: a quiz, blanks or practice test closed halfway survives a reload, is offered again and listed in the Study tab, resumes with no model call, and the finished session keeps the answers and time from before the close; Start over, Discard with Undo, a History retake kept apart; practice test at 390px. Mock model, wiped database. `node --experimental-strip-types tests/unit/resume.test.mts` covers the store. |
| `node tests/browser/study-misses.cjs` | Missed questions come back: kept from quizzes, blanks and tests, not counted when reviewed early, reworded in a review round from the Study tab (desktop and 390px), gone after two right answers once due; a perfect Match alone scores 85. Needs `SEAGLASS_STATE` (it moves due dates with wrangler). |
| `node tests/browser/study-history.cjs` | History: finished quizzes and practice tests are saved in full, can be reopened, and retake the same questions with no model call (desktop and 390px). Mock model, wiped database. |
| `node tests/browser/study-waffle.cjs` | What the assistant writes for Study: flashcards onto a page (no repeats, Undo, locked pages), questions for the games (saved until the notes change, New questions), both quiz screens at desktop and phone width |
| `python tests/api/vault.test.py` | Encryption at rest: what is really stored (needs `SEAGLASS_STATE`, see its header), old plaintext moved onto the key, files, status |
| `python tests/api/rotation.test.py` | Key rotation (rewrites `.dev.vars` while it runs; test server only) |
| `node --experimental-strip-types tests/unit/vault.test.mts` | The encryption scheme itself (tamper, wrong row, rotation, strict) |
| `node tests/browser/gestures.cjs` | Phone touch gestures with real swipes: drawer, edge-swipe back, task row swipes, sheet drag-down, tab bar slide, Waffle and peek dismiss |

Note: `editor.cjs` reports `details: false`; that check reads the editor's on-screen markup, while the
saved HTML (checked by the API suite) does contain the toggle.

## Screenshots

With the dev server running: `npm i --no-save playwright`, then
`node scripts/shoot.cjs page "#/p/<id>" 1440 900 dark` (saves to `shots/`, which is gitignored).
In Git Bash, run `export MSYS_NO_PATHCONV=1` first, otherwise `#/p/...` gets rewritten as a Windows path.

## Upgrading a real copy

```powershell
node tests/upgrade/run.mjs v0.2.0   # the last release's tag
```
Runs that release on a fresh database (a temporary git worktree), makes data through its own API (`tests/upgrade/seed.py`),
applies this checkout's migrations to the same database, then checks the old owner's pages, settings, saved prompt,
memory, conversation, capture key and shared page still work (`check.py`). Run it before releasing anything with a new
migration: migrations on `main` are append-only. Needs Python 3 and port 5175.
