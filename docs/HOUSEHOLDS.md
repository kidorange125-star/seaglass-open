# 0.2: one Seaglass, several people

Goal: family members each get their own account, and **nobody can see anyone else's private things**: pages, the
assistant's conversation and memory, study history, grades, tasks, reminders, settings. The server enforces this; it is
not hidden in the interface. (Whoever holds `DATA_KEY` can still read the whole database, as today.)

## How it's built

1. **A scope per request, passed explicitly.** `{ userId }`, built from the session cookie, the OAuth grant's
   `props.user`, the quick-capture key's owner, or the cron's loop over users. Never kept in module state: one Worker
   isolate serves requests for different people at the same time.
2. **An `owner_id` column on every personal table**, set on insert and filtered on every read, update and delete through
   one helper. Migration `0023_owners.sql` adds the columns and gives every existing row to the first account. `prefs`
   is rebuilt with `(owner_id, key)` as its key; household-wide settings use `owner_id = ''`.
3. **The Vault as a backstop.** Every private value is already opened through `Vault.open` / `openNote`. They take the
   scope and the row's owner and throw when they differ, so a missed filter fails closed instead of leaking.
4. **Ids are checked, not only lists.** Any id a request or tool can name (a page, a parent or move target, a relation,
   a linked database view, a template, a mention, an undo run, an approval) that belongs to someone else is "not found".

## Easy to miss

- One-of-a-kind lookups: My tasks, Grades and Calendar databases (`system`), the daily notes root, the thread and its
  summary, memories, time zone, assistant permissions, `ownerName()`, the `devOpen` test user.
- Jobs with no request: reminders, routines, check-ins, the tidy-up, the wrap-up and indexing loop over users;
  notifications go only to that person's devices.
- Shared views: latest undo, the runs list, the change feed, search, search by meaning and "related".
- Outside SQL: uploaded files in R2 and their text caches, export, backup download and restore (owner only), OAuth grants
  when someone leaves.
- Devices: the service worker cache, the offline queue and `sg.*` storage are per device; they're cleared or keyed by user
  on sign-in, for a shared tablet.

## Proof before it ships

- `npm run check:scope` lists every query on a personal table without `owner_id` (or a `scope-ok: why` note). It must be 0.
- A canary crawl: two real accounts; a unique marker in everything A owns; as B, every route (from the router's own list)
  and every assistant and MCP tool with A's ids, then the cron. The marker must never appear and A's data must not change.
- Adding members stayed off until both passed (they do, in 0.2).

## Where it stands

- Done: `owner_id` on every personal table (0023), every query scoped (`check:scope` is 0), the scoped and system
  databases (`scope.ts`), and every way in: signed-in requests, the quick-capture key (its owner), public shared pages
  (the page's owner), MCP (the approving account, `props.user`), and the cron (each account in turn; backups, sealing,
  OAuth clean-up and the feed prune stay system-wide). Uploaded files record their owner in R2 metadata. API suites pass.
- Done too: invites (a one-time code and a link, 7 days, only its hash stored; `household.ts`, migration 0024), owner and
  adult roles (backups, encryption upkeep and household settings are owner-only; there is always an owner), removing a
  member or leaving (their rows in every personal table, their R2 files and text caches, sessions and MCP grants are
  deleted), file reads checked against the file's owner (or a page they shared publicly), and a new person signing in
  on a device clearing the last person's offline copies and `sg.*` storage (`offline.ts` `forgetOtherPerson`).
- Proof: `tests/api/households.test.py` (a second person crawls every GET route and MCP tool with the first person's ids)
  and `tests/api/invites.test.py` (two real accounts: joining, roles, separation, removal), with every other suite green.
- Upgrading from 0.1: 0023 gives every existing row to the first account (tested by running 0.1, making data, then
  migrating and signing in). A 0.1 backup restored into 0.2 does the same (`scripts/backup-sql.mjs` `beforeOwners`).
- Removed members: their things leave the live database at once, and the nightly backups (kept 14 days) age them out.
- Later: the Vault owner backstop (a second check inside `Vault.open`), kid accounts, a shared Family space.

## In 0.2

Private data per person, invites (link or code), owner and adult roles, removing a member. Later: a shared Family space,
sharing a page with a person, kid accounts.
