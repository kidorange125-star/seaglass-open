// Keys set up in the app (Setup and Settings > Setup & status) instead of with `wrangler secret put`: the Claude API
// key, the voice keys, and the notification signing key, which Seaglass makes for itself the first time it's needed.
// Stored sealed in household_keys (migration 0026), never sent back to the app, and only the owner can change them. A
// Worker secret of the same name always wins, so a copy set up from the command line behaves exactly as before.
import type { Env } from "./env";
import * as Vault from "./vault";

export const KEYS = {
  ANTHROPIC_API_KEY: { label: "Claude API key", test: /^sk-ant-[A-Za-z0-9_-]{20,}$/, example: "sk-ant-…" },
  ELEVENLABS_API_KEY: { label: "ElevenLabs API key (spoken replies)", test: /^(sk_)?[A-Za-z0-9]{24,}$/, example: "sk_…" },
  OPENROUTER_API_KEY: { label: "OpenRouter API key (spoken replies)", test: /^sk-or-[A-Za-z0-9_-]{20,}$/, example: "sk-or-…" },
} as const;
export type KeyName = keyof typeof KEYS;
type Stored = Partial<Record<KeyName | "VAPID_PRIVATE_KEY", string>>;
const ALL = [...Object.keys(KEYS), "VAPID_PRIVATE_KEY"] as (KeyName | "VAPID_PRIVATE_KEY")[];

// One read per isolate every 30 s at most; a save in this isolate clears it at once.
let cache: { at: number; keys: Stored } | null = null;
const TTL = 30_000;

async function stored(db: D1Database): Promise<Stored> {
  if (cache && Date.now() - cache.at < TTL) return cache.keys;
  const rows = (await db.prepare("SELECT name, value FROM household_keys").all<{ name: string; value: string }>().catch(() => ({ results: [] as { name: string; value: string }[] }))).results;
  const keys: Stored = {};
  for (const r of rows) if ((ALL as string[]).includes(r.name)) keys[r.name as KeyName] = (await Vault.open("household_keys", r.name, "value", r.value)) ?? undefined;
  cache = { at: Date.now(), keys };
  return keys;
}

/** env with any key the Worker secrets don't set filled in from the app's saved keys. */
export async function fill<E extends Env>(env: E): Promise<E> {
  const keys = await stored(env.DB);
  const out = { ...env, KEY_SOURCES: {} } as E;
  for (const name of ALL) {
    if (env[name]) out.KEY_SOURCES![name] = "secret";
    else if (keys[name]) { (out as Env)[name] = keys[name]; out.KEY_SOURCES![name] = "saved"; }
  }
  if (!out.VAPID_PRIVATE_KEY) out.VAPID_PRIVATE_KEY = await makeVapid(env.DB);
  return out;
}

/** Notifications need a signing key; make one the first time, keep it (sealed) for good. */
async function makeVapid(db: D1Database): Promise<string | undefined> {
  try {
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const jwk = JSON.stringify(await crypto.subtle.exportKey("jwk", pair.privateKey));
    // Two requests at once: the first insert wins and both use it.
    await db.prepare("INSERT OR IGNORE INTO household_keys (name, value, hint, updated_at, updated_by) VALUES ('VAPID_PRIVATE_KEY', ?, 'made by Seaglass', ?, 'seaglass')")
      .bind(await Vault.seal("household_keys", "VAPID_PRIVATE_KEY", "value", jwk), Date.now()).run();
    cache = null;
    return (await stored(db)).VAPID_PRIVATE_KEY;
  } catch { return undefined; } // before the table exists (a copy mid-upgrade): notifications just stay off
}

/** What's set, and where from. Never the values. */
export async function status(env: Env) {
  const rows = (await env.DB.prepare("SELECT name, hint, updated_at FROM household_keys").all<{ name: string; hint: string; updated_at: number }>()).results;
  const saved = new Map(rows.map((r) => [r.name, r]));
  return (Object.keys(KEYS) as KeyName[]).map((name) => ({
    name, label: KEYS[name].label, example: KEYS[name].example,
    // A Worker secret wins over a saved key, so it's what's in use even when one is saved too.
    source: env.KEY_SOURCES?.[name] ?? null, saved: saved.has(name),
    hint: saved.get(name)?.hint ?? "", updated_at: saved.get(name)?.updated_at ?? null,
  }));
}

/** A Claude key is tried with one tiny request before it's kept. */
async function tryClaude(key: string): Promise<string | null> {
  try {
    const r = await fetch("https://api.anthropic.com/v1/models?limit=1", { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" }, signal: AbortSignal.timeout(10_000) });
    if (r.ok) return null;
    if (r.status === 401 || r.status === 403) return "Claude didn't accept that key. Check you copied all of it, and that it hasn't been turned off in the Claude Console.";
    return `Claude couldn't be reached to check the key (${r.status}). Try again in a moment.`;
  } catch { return "Claude couldn't be reached to check the key. Check this copy can reach the internet, then try again."; }
}

export async function save(env: Env, name: KeyName, raw: unknown, by: string, check = true): Promise<string | null> {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!KEYS[name].test.test(value)) return `That doesn't look like a ${KEYS[name].label}. It starts with ${KEYS[name].example}`;
  if (check && name === "ANTHROPIC_API_KEY") { const bad = await tryClaude(value); if (bad) return bad; }
  await env.DB.prepare(`INSERT INTO household_keys (name, value, hint, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET value = excluded.value, hint = excluded.hint, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
    .bind(name, await Vault.seal("household_keys", name, "value", value), `…${value.slice(-4)}`, Date.now(), by).run();
  cache = null;
  return null;
}

export async function remove(env: Env, name: KeyName) {
  await env.DB.prepare("DELETE FROM household_keys WHERE name = ?").bind(name).run();
  cache = null;
}

export const isKeyName = (s: string): s is KeyName => s in KEYS;
