# Roadmap

What's planned for Seaglass Open, roughly in order. Nothing here exists yet unless it says so.

## 0.2: households (done)

- Everything is separate per person: pages, the assistant's conversation and memory, study history and grades, tasks,
  reminders, search, settings and uploaded files, so family members can't see each other's private things.
- Test suites that sign in as two people and check that neither can reach the other's data through any route or tool.
- Invite family members with a code or a link; owner and adult roles; removing someone (or leaving) deletes their things.

## 0.2.1: kids and AI limits (done)

- A QR code for invites, made on the device.
- Kid accounts: the assistant teaches instead of doing homework, no web search and a small daily AI allowance unless
  an owner changes them; kids can't connect outside apps or delete their own account. Owners can set a new password
  for anyone who forgot theirs.
- AI usage per person, feature and model (Settings > AI usage), with daily and monthly limits per person and a monthly
  limit for the whole household, checked before every request.

## 0.2.x: households, continued

- A shared Family space for the calendar, groceries and chores; sharing a page or folder with a person (view, comment
  or edit).

## 0.3: your own AI keys

- A general assistant harness with an adapter per provider (Anthropic, OpenAI, Google, OpenRouter, Ollama or any compatible
  address) that keeps each provider's own strengths instead of the lowest common denominator, and a table of what each model
  can do so features adapt.
- Keys per household or per person, stored encrypted, never shown again after saving.
- Detailed controls for features, data, web access and automatic jobs (usage and spending limits arrived in 0.2.1).

## 0.4: setup and updates

- Updates from inside the app: Settings > About shows a new release; Update brings your copy up to date and deploys it,
  backing up and applying database changes first. Stable and Beta channels.
- The boot screen says what's happening while Seaglass sets up or updates.
- Import from Notion, Obsidian and Markdown, Apple Notes, Google Keep and Evernote; export everything any time.
- A "try it first" demo household; starter sets (student, family, writer).
- A printable recovery kit for the owner (the encryption key and a way back in).

## Later

- Guests from outside the household, and per-page encryption keys so sharing doesn't widen who can read what.
- Plugins (blocks, assistant tools, importers, themes) with declared permissions.
- Translations; an accessibility pass; a Docker image for home servers.
