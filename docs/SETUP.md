# Setting up Seaglass

Seaglass runs on your own Cloudflare account: a Worker, a D1 database, an R2 bucket for files and a KV namespace for
sign-in tokens. The free Workers plan is enough to try it; Workers Paid ($5 a month) gives the room a busy copy needs.

## 1. Deploy

**With the button.** Click **Deploy to Cloudflare** in the README. Cloudflare copies this repository to your GitHub account,
makes the database, bucket and namespace, and deploys. Later pushes to your copy deploy by themselves.

**From the command line.**

```powershell
git clone https://github.com/<you>/seaglass-open
cd seaglass-open
npm install
npx wrangler login
npx wrangler deploy
```

Wrangler makes the D1 database, R2 bucket and KV namespace the first time (the ids in `wrangler.jsonc` are left out on
purpose). Then apply the database tables:

```powershell
npx wrangler d1 migrations apply seaglass --remote
```

## 2. Set the two required secrets

**`SETUP_CODE`** is any phrase you choose. The setup screen asks for it, so nobody who finds your new address first can make
the owner account. Keep it until setup is done; you can delete it afterwards.

**`DATA_KEY`** encrypts everything private before it's stored. **If you lose it, every note is lost**, so save it in a
password manager before anything else.

```powershell
npx wrangler secret put SETUP_CODE
npm run data:keygen -- --out data-key.txt --put
```

The second line writes a new key to `data-key.txt` (move it into your password manager, then delete the file) and stores
the same key as the Worker secret. In the Cloudflare dashboard you can also add both under your Worker, Settings, Variables
and secrets; a `DATA_KEY` must be 32 random bytes in base64url, which `npm run data:keygen -- --print` makes.

Then turn on strict encryption, so plaintext is refused once everything is sealed:

```powershell
npx wrangler secret put VAULT_STRICT    # type 1
```

## 3. Open it

Open your Worker's address (`https://seaglass.<your-subdomain>.workers.dev`) and set `PUBLIC_URL` in `wrangler.jsonc` to it
(no trailing slash), then deploy again. The setup screen asks:

1. **Who it's for**: just you, or your household. You can change this in Settings > Account & household. (Family members get
   their own accounts in a coming release.)
2. **Your account**: the setup code, your name (what Waffle calls you), a username and a password of 10+ characters.

Settings > Setup & status lists everything that's connected and what's missing.

## 4. Turn on Waffle (optional)

Waffle uses Claude. Either store an API key:

```powershell
npx wrangler secret put ANTHROPIC_API_KEY
```

or, to keep no key at all, use workload identity federation: Seaglass signs short-lived identity tokens and the Claude API
trusts them. Make the Worker's signing key with `npm run wif:keygen` (it prints the key for `wrangler secret put
WIF_SIGNING_KEY`), then in the Claude Console add a custom OIDC issuer at `<PUBLIC_URL>/wif`, a federation rule for subject
`seaglass`, and a service account, and copy their ids into the `ANTHROPIC_*` variables in `wrangler.jsonc`.

## 5. Optional extras

| What | How |
|---|---|
| Task reminders (Web Push) | `npm run push:keygen`, then `npx wrangler secret put VAPID_PRIVATE_KEY` |
| A nicer speaking voice for live voice | `ELEVENLABS_API_KEY`, or `OPENROUTER_API_KEY` for Gemini speech; without either, the device's own voice speaks |
| Live voice heard on the device | `npm run voice:model -- --remote` copies the small speech-to-text model into your bucket |
| Connect Claude to your notes | Claude Desktop or claude.ai: add a custom connector at `<PUBLIC_URL>/mcp` and sign in. Claude Code: `claude mcp add --transport http seaglass <PUBLIC_URL>/mcp` |

## Updating

With the deploy button, Cloudflare deploys every push to your copy. To take a new Seaglass release, sync your fork on
GitHub. When a release adds database tables, apply them (`npx wrangler d1 migrations apply seaglass --remote`; a backup is
in Settings > Backups) before or right after it deploys.

## Local development

```powershell
npm install
copy .dev.vars.example .dev.vars
npm run data:keygen -- --dev
npm run db:local
npm run dev
```

Open http://localhost:5173. On localhost the setup screen doesn't need a setup code.
