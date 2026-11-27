// Automatic backups (#15). Every night (and from "Back up now" in Settings > Backups) the whole database is copied into
// R2 as one file: every table's rows as JSON, gzipped, then sealed like an uploaded file (vault.ts, "files" key, so the
// key-rotation cron re-seals backups too). Columns that are sealed in D1 stay sealed inside it, so a backup is useless
// without DATA_KEY. Each backup is checked straight after it's written: read back, opened, unzipped, parsed, row counts
// compared, and a few note titles decrypted. The newest KEEP are kept. scripts/restore-backup.mjs puts one back.
// Search-by-meaning vectors (embeddings) are left out: they're large and the cron rebuilds them.
import type { Env } from "./env";
import * as Vault from "./vault";

const PREFIX = "backups/";
export const KEEP = 14;
const STATUS = "backup_status";
const PAGE = 400;
const SKIP = /^(_cf_|d1_|sqlite_)/;
const LEAVE_OUT = new Set(["embeddings"]);
const NAME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.sgb$/;

export interface Dump { app: "seaglass"; kind: "backup"; v: 1; at: number; counts: Record<string, number>; tables: Record<string, Record<string, unknown>[]> }
export interface Status { at: number; ok: boolean; name?: string; bytes?: number; rows?: number; tables?: number; error?: string; checked?: string }
export interface Item { name: string; at: number; bytes: number }

const b64 = (b: Uint8Array) => { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
/** A D1 value as JSON: blobs (they come back as byte arrays) become { $b64 }. */
const jsonValue = (v: unknown): unknown => v instanceof ArrayBuffer ? { $b64: b64(new Uint8Array(v)) } : ArrayBuffer.isView(v) ? { $b64: b64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) } : Array.isArray(v) ? { $b64: b64(Uint8Array.from(v as number[])) } : v;

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
export const gzip = (d: Uint8Array) => pipe(d, new CompressionStream("gzip"));
export const gunzip = (d: Uint8Array) => pipe(d, new DecompressionStream("gzip"));

/** Every table worth keeping, in name order. */
export async function tables(db: D1Database) {
  const r = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all<{ name: string }>();
  return r.results.map((x) => x.name).filter((n) => !SKIP.test(n) && !LEAVE_OUT.has(n) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(n));
}

/** Reads every row of every table, a page at a time (by rowid, so big tables don't hit D1's response limit). */
export async function dump(db: D1Database, now = Date.now()): Promise<Dump> {
  const out: Dump = { app: "seaglass", kind: "backup", v: 1, at: now, counts: {}, tables: {} };
  for (const t of await tables(db)) {
    const rows: Record<string, unknown>[] = [];
    let after = Number.MIN_SAFE_INTEGER;
    for (;;) {
      const page = (await db.prepare(`SELECT rowid AS "__rid", * FROM "${t}" WHERE rowid > ? ORDER BY rowid LIMIT ${PAGE}`).bind(after).all<Record<string, unknown>>()).results;
      for (const r of page) {
        after = Number(r.__rid);
        const row: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(r)) if (k !== "__rid") row[k] = jsonValue(v);
        rows.push(row);
      }
      if (page.length < PAGE) break;
    }
    out.tables[t] = rows;
    out.counts[t] = rows.length;
  }
  return out;
}

const nameFor = (at: number) => `${new Date(at).toISOString().slice(0, 19).replace(/:/g, "-")}Z.sgb`;
const keyOf = (name: string) => `${PREFIX}${name}`;
export const validName = (n: string) => NAME.test(n);

/** Opens a stored backup back into its tables. Throws if it can't be decrypted, unzipped or read. */
export async function load(env: Env, name: string): Promise<Dump | null> {
  const obj = await env.FILES.get(keyOf(name));
  if (!obj) return null;
  const plain = await Vault.openBytes("files", keyOf(name), "body", new Uint8Array(await obj.arrayBuffer()));
  const d = JSON.parse(new TextDecoder().decode(await gunzip(plain))) as Dump;
  if (d.app !== "seaglass" || d.kind !== "backup" || d.v !== 1) throw new Error("not a Seaglass backup");
  return d;
}

/** The restore check: everything that was written reads back the same, and sealed note titles still open with this key. */
export async function verify(env: Env, name: string, want: Dump) {
  const got = await load(env, name);
  if (!got) throw new Error("the backup wasn't there when read back");
  for (const [t, n] of Object.entries(want.counts)) if ((got.tables[t]?.length ?? -1) !== n) throw new Error(`${t} came back with ${got.tables[t]?.length ?? 0} rows, not ${n}`);
  const notes = (got.tables.notes ?? []).filter((r) => typeof r.title === "string" && r.title).slice(0, 5);
  for (const r of notes) await Vault.open("notes", String(r.id), "title", r.title as string);
  return `${Object.keys(got.tables).length} tables and ${Object.values(got.counts).reduce((a, b) => a + b, 0)} rows read back; ${notes.length} note titles opened`;
}

async function setStatus(db: D1Database, s: Status) {
  await db.prepare("INSERT INTO prefs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(STATUS, JSON.stringify(s)).run();
}
export async function status(db: D1Database): Promise<Status | null> {
  const v = (await db.prepare("SELECT value FROM prefs WHERE key = ?").bind(STATUS).first<{ value: string }>())?.value;
  try { return v ? JSON.parse(v) as Status : null; } catch { return null; }
}

export async function list(env: Env): Promise<Item[]> {
  const items: Item[] = [];
  let cursor: string | undefined;
  do {
    const l = await env.FILES.list({ prefix: PREFIX, cursor });
    for (const o of l.objects) {
      const name = o.key.slice(PREFIX.length);
      if (validName(name)) items.push({ name, at: Date.parse(name.replace(/T(\d{2})-(\d{2})-(\d{2})Z\.sgb$/, "T$1:$2:$3Z")), bytes: o.size });
    }
    cursor = l.truncated ? l.cursor : undefined;
  } while (cursor);
  return items.sort((a, b) => b.at - a.at);
}

/** The very first backup doesn't wait for the night: the every-minute cron makes one as soon as none has ever been made.
 *  The status row is claimed first (insert-if-missing), so two cron ticks can't both start one. */
export async function firstRun(env: Env, now = Date.now()) {
  const claim = await env.DB.prepare("INSERT OR IGNORE INTO prefs (key, value) VALUES (?, ?)").bind(STATUS, JSON.stringify({ at: now, ok: false, error: "The first backup is running" } satisfies Status)).run();
  return claim.meta.changes ? run(env, now) : null;
}

/** Makes a backup, checks it, keeps the newest KEEP, and records how it went. */
export async function run(env: Env, now = Date.now()): Promise<Status> {
  const name = nameFor(now);
  try {
    const d = await dump(env.DB, now);
    const sealed = await Vault.sealBytes("files", keyOf(name), "body", await gzip(new TextEncoder().encode(JSON.stringify(d))));
    await env.FILES.put(keyOf(name), sealed, { httpMetadata: { contentType: "application/octet-stream" }, customMetadata: { sealed: await Vault.currentKeyId(), kind: "backup" } });
    const checked = await verify(env, name, d);
    const old = (await list(env)).slice(KEEP);
    if (old.length) await env.FILES.delete(old.map((o) => keyOf(o.name)));
    const s: Status = { at: now, ok: true, name, bytes: sealed.length, rows: Object.values(d.counts).reduce((a, b) => a + b, 0), tables: Object.keys(d.counts).length, checked };
    await setStatus(env.DB, s);
    return s;
  } catch (e) {
    const s: Status = { at: now, ok: false, name, error: (e as Error).message || String(e) };
    console.error("backup failed", s.error);
    await setStatus(env.DB, s).catch(() => {});
    return s;
  }
}
