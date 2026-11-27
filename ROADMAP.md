# Roadmap

What's planned for Seaglass Open, roughly in order. Nothing here exists yet unless it says so.

## 0.2: households

- Separate everything per person: pages, the assistant's conversation and memory, study history and grades, tasks,
  reminders, search and settings, so family members can't see each other's private things.
- A test suite that signs in as two people and checks that neither can reach the other's data through any route or tool.
- Invite family members by link or QR code; roles (owner, adult, kid); a shared Family space for the calendar, groceries
  and chores; sharing a page or folder with a person (view, comment or edit).
- Kid accounts: Waffle teaches rather than answers homework, a daily AI allowance, web search only if a parent allows it.

## 0.3: your own AI keys

- A general assistant harness with an adapter per provider (Anthropic, OpenAI, Google, OpenRouter, Ollama or any compatible
  address) that keeps each provider's own strengths instead of the lowest common denominator, and a table of what each model
  can do so features adapt.
- Keys per household or per person, stored encrypted, never shown again after saving.
- Usage by person, feature and model; monthly and daily caps that stop spending before it happens; detailed controls for
  features, data, web access and automatic jobs.

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
