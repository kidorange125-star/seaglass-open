# Seaglass

A private notes app you run yourself, on your own Cloudflare account. Pages and databases like Notion, a study system
that quizzes you on your own notes, handwriting on an iPad, and **Waffle**, an assistant that can read and edit your notes
when you ask it to. Everything private is encrypted before it's stored.

This is **Seaglass Open**, the open-source edition, released under the [Apache License 2.0](LICENSE).

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/kidorange125-star/seaglass-open)

## What's in it

- **Pages and databases**: rich text, toggles, callouts, math, code, tables, files and PDFs; databases with table, board,
  list, gallery, calendar, timeline and chart views; formulas, relations and CSV import and export.
- **My tasks and the Calendar**: tasks with due dates, times, repeats and reminders; a calendar of events and dated tasks.
- **Study**: flashcards from your notes, quizzes, fill in the blanks, matching, practice tests, "explain it" checks,
  missed questions that come back, study plans for a test date, grades and what the next test needs.
- **Waffle**, the assistant (needs a Claude API key): chat, live voice, quick actions from search, writing help, notes from a
  photo or a recorded class, and routines that run on a schedule if you turn them on.
- **Privacy tools**: Hide from AI on any page, locked pages, and page history and undo for every change, including the
  assistant's.
- **Connect Claude** to your notes over MCP (Claude Desktop, claude.ai, Claude Code), with an account sign-in.
- **Works on your phone**: installs as an app, works offline, sends task reminders.
- **You decide what the assistant may do**: each kind of action (adding, editing, trashing, memory, routines, web) is Allow,
  Ask or Never. By default Waffle asks before it changes anything, with Approve and Don't right in the chat.
- **A first visit you can try before setting anything up**: write a first page, take a quick quiz, meet Waffle, then make
  your account (username and password; just you or a household).
- **A household, each person private**: invite family members with a code or a link (Settings > Account & household).
  Everyone gets their own account, and their pages, tasks, study, assistant and files are theirs alone: the server keeps
  them apart, not just the screens. Owners invite (a code, a link or a QR code), change roles and remove people.
- **A Family space**: shared pages, Family tasks and a calendar for the household, next to everyone's private space.
- **Share a page with one person**: to view or to edit, from the page's Share menu. They see that page and its sub-pages,
  nothing else.
- **Bring your notes with you**: import from Notion (databases too), Obsidian, Markdown folders, Apple Notes, Google Keep
  and Evernote, with links, pictures, checklists and dates (Settings > Import from other apps).
- **Kid accounts**: the assistant teaches instead of doing homework, with no web search and a small daily AI allowance
  unless a parent changes them.
- **AI usage you can see and cap**: what each person and feature costs, with daily and monthly limits (Settings > AI
  usage) that stop the next request, not the bill after it.

## What's not in it yet

Seaglass Open is new (0.2). Next come other AI providers besides Claude and updating from
inside the app. See the [roadmap](ROADMAP.md).

## Run your own

1. Click **Deploy to Cloudflare** above (or follow the command-line steps in [docs/SETUP.md](docs/SETUP.md)).
2. Set two secrets for the new Worker: `SETUP_CODE` (any phrase; it proves the new copy is yours) and `DATA_KEY` (the
   encryption key; **keep a copy in a password manager: losing it loses every note**). [docs/SETUP.md](docs/SETUP.md) shows how.
3. Open your Worker's address. Seaglass asks who it's for, makes your account, then walks you through connecting Claude
   (or skipping AI), what the assistant may do, inviting your household and this device.

Waffle needs a Claude API key (`ANTHROPIC_API_KEY`); everything else works without one.

## Develop

```
npm install
cp .dev.vars.example .dev.vars
npm run data:keygen -- --dev
npm run db:local
npm run dev            # http://localhost:5173
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [tests/README.md](tests/README.md).

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Cover images are public domain (see
`public/covers/CREDITS.md`).
