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
- Adding members stays off (`POST /api/household/members` answers 501) until both pass.

## In 0.2

Private data per person, invites (link or code), owner and adult roles, removing a member. Later: a shared Family space,
sharing a page with a person, kid accounts.
