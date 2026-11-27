// Encryption at rest. Everything private that Seaglass stores (page titles and content, history snapshots, chats,
// Waffle's memories, comments, search vectors, push keys, uploaded files) is sealed with AES-256-GCM before it
// reaches D1 or R2, using a key that lives only in a Worker secret (DATA_KEY). A copy of the database, a D1
// export, Time Travel, or the Cloudflare dashboard's data browser shows only ciphertext.
//
// How it's built:
//  - One 256-bit master key (DATA_KEY, base64) → HKDF-SHA-256 → a separate AES key per kind of data, so a
//    weakness in one place can't be replayed against another.
//  - A fresh random 96-bit nonce for every value (the same text never encrypts the same way twice).
//  - The value's address is bound in as AAD ("table:row id:column"). A sealed value copied into another row or
//    column fails to open instead of showing the wrong thing, and tampering is detected (GCM tag).
//  - Each value records which key sealed it, so keys can be rotated: DATA_KEY_PREVIOUS keeps old keys readable
//    while `reseal` moves everything onto the new one.
//  - The server must read plaintext to search, sync and talk to Waffle, so this protects stored data, not a
//    compromised Worker or Cloudflare account (see docs/SECURITY.md for the exact limits).
import type { Env } from "./env";

const TEXT_PREFIX = "~sg1~";
const BYTES_MAGIC = [0x53, 0x47, 0x42, 0x31]; // "SGB1"
const KID_LEN = 3; // bytes of the key id (first bytes of SHA-256 of a label + the key)
const IV_LEN = 12;
const enc = new TextEncoder();
const dec = new TextDecoder();

export type Purpose = "notes" | "history" | "chats" | "memory" | "push" | "index" | "files" | "proactive" | "secrets";
/** Which key protects which table. Tables not listed are not encrypted (ids, timestamps, counters). */
const PURPOSE_OF: Record<string, Purpose> = {
  notes: "notes", comments: "notes", actions: "history", chats: "chats", memories: "memory",
  push_subs: "push", push_snooze: "push", embeddings: "index", files: "files", prefs: "memory", inbox: "proactive", prompts: "proactive", routines: "proactive", thread: "chats", study_subjects: "notes", study_exams: "notes", study_sessions: "notes", study_misses: "notes", study_sets: "notes", household_keys: "secrets",
};

export class VaultError extends Error {}

interface Ring { current: string; keys: Map<string, CryptoKey>; masters: Map<string, CryptoKey>; strict: boolean }
let ring: Promise<Ring> | null = null;
let ringFor = "";

const b64 = (bytes: Uint8Array) => { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const unb64 = (s: string) => { const t = s.replace(/-/g, "+").replace(/_/g, "/"); const bin = atob(t + "=".repeat((4 - (t.length % 4)) % 4)); return Uint8Array.from(bin, (c) => c.charCodeAt(0)); };
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

/** Parses one base64 (or base64url) key. Must be exactly 32 random bytes. */
function parseKey(v: string): Uint8Array {
  let raw: Uint8Array;
  try { raw = unb64(v.trim()); } catch { throw new VaultError("DATA_KEY is not valid base64"); }
  if (raw.length !== 32) throw new VaultError("DATA_KEY must be 32 random bytes, base64 encoded (make one with: npm run data:keygen)");
  return raw;
}

async function keyId(raw: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array([...enc.encode("seaglass-kid-v1"), ...raw])));
  return hex(d.slice(0, KID_LEN));
}

async function derive(master: CryptoKey, purpose: Purpose): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("seaglass-vault-v1"), info: enc.encode(`seaglass/${purpose}`) },
    master, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"],
  );
}

async function buildRing(env: Env): Promise<Ring> {
  if (!env.DATA_KEY) throw new VaultError("no_data_key");
  const raws = [env.DATA_KEY, ...(env.DATA_KEY_PREVIOUS ?? "").split(",").map((s) => s.trim()).filter(Boolean)].map(parseKey);
  const masters = new Map<string, CryptoKey>();
  const keys = new Map<string, CryptoKey>();
  let current = "";
  for (const [i, raw] of raws.entries()) {
    const kid = await keyId(raw);
    if (i === 0) current = kid;
    const m = await crypto.subtle.importKey("raw", raw as BufferSource, "HKDF", false, ["deriveKey"]);
    masters.set(kid, m);
    for (const p of Object.values(PURPOSE_OF)) if (!keys.has(`${kid}/${p}`)) keys.set(`${kid}/${p}`, await derive(m, p));
  }
  return { current, keys, masters, strict: (env.VAULT_STRICT ?? "").trim() === "1" };
}

/** Call at the start of every request / scheduled run. Cheap after the first call in an isolate. */
export function configure(env: Env) {
  const fp = `${env.DATA_KEY ?? ""}|${env.DATA_KEY_PREVIOUS ?? ""}|${env.VAULT_STRICT ?? ""}`;
  if (!ring || fp !== ringFor) { ringFor = fp; ring = buildRing(env); ring.catch(() => {}); }
  return ring;
}
const R = async () => { if (!ring) throw new VaultError("no_data_key"); return ring; };

export const hasKey = (env: Env) => !!env.DATA_KEY;
export const isSealedText = (v: unknown): v is string => typeof v === "string" && v.startsWith(TEXT_PREFIX);
export const isSealedBytes = (b: Uint8Array) => b.length > 4 + KID_LEN + IV_LEN && BYTES_MAGIC.every((x, i) => b[i] === x);

const purposeOf = (table: string): Purpose => {
  const p = PURPOSE_OF[table];
  if (!p) throw new VaultError(`no key for table ${table}`);
  return p;
};
const aadOf = (table: string, id: string, col: string) => enc.encode(`seaglass:${table}:${id}:${col}`);

async function gcmSeal(r: Ring, table: string, id: string, col: string, data: Uint8Array) {
  const key = r.keys.get(`${r.current}/${purposeOf(table)}`)!;
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aadOf(table, id, col) }, key, data as BufferSource));
  return { iv, ct };
}
async function gcmOpen(r: Ring, kid: string, table: string, id: string, col: string, iv: Uint8Array, ct: Uint8Array) {
  const key = r.keys.get(`${kid}/${purposeOf(table)}`);
  if (!key) throw new VaultError("This data was sealed with a key that isn't available (is DATA_KEY_PREVIOUS missing?)");
  try { return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: aadOf(table, id, col) }, key, ct as BufferSource)); }
  catch { throw new VaultError(`Couldn't decrypt ${table}.${col}: wrong key, or the data was changed or moved`); }
}

/** Seals text. null and "" stay as they are (they carry nothing). */
export async function seal(table: string, id: string, col: string, value: string | null | undefined): Promise<string | null> {
  if (value === null || value === undefined) return null;
  if (value === "") return "";
  const r = await R();
  const { iv, ct } = await gcmSeal(r, table, id, col, enc.encode(value));
  const body = new Uint8Array(IV_LEN + ct.length); body.set(iv); body.set(ct, IV_LEN);
  return `${TEXT_PREFIX}${r.current}~${b64(body)}`;
}

/** Opens text. Values that were stored before encryption was switched on pass through (until VAULT_STRICT=1). */
export async function open(table: string, id: string, col: string, stored: string | null | undefined): Promise<string | null> {
  if (stored === null || stored === undefined) return null;
  if (stored === "") return "";
  const r = await R();
  if (!isSealedText(stored)) {
    if (r.strict) throw new VaultError(`${table}.${col} is not encrypted (strict mode)`);
    return stored;
  }
  const rest = stored.slice(TEXT_PREFIX.length);
  const cut = rest.indexOf("~");
  if (cut < 1) throw new VaultError(`${table}.${col} has a damaged ciphertext`);
  const body = unb64(rest.slice(cut + 1));
  if (body.length < IV_LEN + 16) throw new VaultError(`${table}.${col} has a damaged ciphertext`);
  return dec.decode(await gcmOpen(r, rest.slice(0, cut), table, id, col, body.slice(0, IV_LEN), body.slice(IV_LEN)));
}

/** Seals bytes (files, search vectors): "SGB1" | key id | nonce | ciphertext+tag. */
export async function sealBytes(table: string, id: string, col: string, data: Uint8Array): Promise<Uint8Array> {
  const r = await R();
  const { iv, ct } = await gcmSeal(r, table, id, col, data);
  const kid = unhex(r.current);
  const out = new Uint8Array(4 + KID_LEN + IV_LEN + ct.length);
  out.set(BYTES_MAGIC); out.set(kid, 4); out.set(iv, 4 + KID_LEN); out.set(ct, 4 + KID_LEN + IV_LEN);
  return out;
}
const unhex = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));

export async function openBytes(table: string, id: string, col: string, stored: Uint8Array): Promise<Uint8Array> {
  const r = await R();
  if (!isSealedBytes(stored)) {
    if (r.strict) throw new VaultError(`${table}.${col} is not encrypted (strict mode)`);
    return stored;
  }
  const kid = hex(stored.slice(4, 4 + KID_LEN));
  const iv = stored.slice(4 + KID_LEN, 4 + KID_LEN + IV_LEN);
  return gcmOpen(r, kid, table, id, col, iv, stored.slice(4 + KID_LEN + IV_LEN));
}

/** True when this value is plaintext or was sealed with an older key (so a backfill should seal it again). */
export async function needsSeal(stored: unknown): Promise<boolean> {
  if (typeof stored !== "string" || stored === "") return false;
  if (!isSealedText(stored)) return true;
  const r = await R();
  const rest = stored.slice(TEXT_PREFIX.length);
  return rest.slice(0, rest.indexOf("~")) !== r.current;
}
export async function bytesNeedSeal(stored: Uint8Array): Promise<boolean> {
  if (!isSealedBytes(stored)) return true;
  const r = await R();
  return hex(stored.slice(4, 4 + KID_LEN)) !== r.current;
}

/** Short fingerprint of the current key, for the status screen (never the key itself). */
export async function currentKeyId(): Promise<string> { return (await R()).current; }
export const isStrict = async () => (await R()).strict;

/** Convenience for rows: seal / open several columns of one row at once. Columns that aren't present are skipped. */
export async function sealRow<T extends Record<string, unknown>>(table: string, id: string, row: T, cols: readonly string[]): Promise<T> {
  const out: Record<string, unknown> = { ...row };
  await Promise.all(cols.map(async (c) => { if (typeof row[c] === "string") out[c] = await seal(table, id, c, row[c] as string); }));
  return out as T;
}
export async function openRow<T extends Record<string, unknown>>(table: string, row: T, cols: readonly string[], id?: string): Promise<T> {
  const rid = id ?? String(row.id ?? "");
  const out: Record<string, unknown> = { ...row };
  await Promise.all(cols.map(async (c) => { if (typeof row[c] === "string") out[c] = await open(table, rid, c, row[c] as string); }));
  return out as T;
}
