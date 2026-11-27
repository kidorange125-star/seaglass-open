// Moves data that was stored before encryption was switched on (or under an older key) onto the current key.
// It runs by itself from the every-minute cron, a little at a time, until nothing is left; after that it costs
// one tiny read per minute. Nothing here changes what a page says: only the sealed columns are rewritten (no new
// revision, no history entry, no change-feed row, no updated_at bump). See vault.ts for the scheme.
import type { Env } from "./env";
import * as Vault from "./vault";
import * as N from "./notes";

const DONE_PREF = "vault_sealed_kid"; // the key id every row was last verified to be on

interface Spec { table: string; key: string; /** the id the value is bound to when it differs from the row key (history is bound to its page) */ aadFrom?: string; cols: readonly string[] }
const TEXT_TABLES: Spec[] = [
  { table: "notes", key: "id", cols: N.NOTE_SEALED },
  { table: "actions", key: "id", aadFrom: "note_id", cols: ["before_json", "after_json"] },
  { table: "comments", key: "id", cols: ["body", "anchor", "replace_with"] },
  { table: "memories", key: "id", cols: ["text"] },
  { table: "chats", key: "id", cols: ["title", "messages", "text"] },
  { table: "push_subs", key: "endpoint", cols: ["p256dh", "auth", "label"] },
  { table: "push_snooze", key: "note_id", cols: ["title", "body"] },
  { table: "study_subjects", key: "id", cols: ["name", "icon"] },
  { table: "study_exams", key: "id", cols: ["name", "grade"] },
  { table: "study_sets", key: "id", cols: ["data"] },
  { table: "study_sessions", key: "id", cols: ["data", "played"] },
  { table: "study_misses", key: "id", cols: ["data"] },
];

/** SQL: rows with any column that is plaintext or sealed with a different key. Only the key id is compared, in SQL. */
const staleWhere = (cols: readonly string[]) => cols.map((c) => `(${c} IS NOT NULL AND ${c} != '' AND ${c} NOT LIKE ?1)`).join(" OR ");
const pattern = (kid: string) => `~sg1~${kid}~%`;
const blobStale = (kid: string) => `(substr(vec, 1, 7) != X'53474231${kid}')`; // "SGB1" + key id

export interface SealStatus {
  enabled: boolean; key_id: string | null; strict: boolean; complete: boolean;
  tables: { name: string; remaining: number }[]; files: { sealed: number; remaining: number; checked: number };
}

async function remainingIn(db: D1Database, kid: string) {
  const out: { name: string; remaining: number }[] = [];
  for (const t of TEXT_TABLES) {
    const r = await db.prepare(`SELECT COUNT(*) AS n FROM ${t.table} WHERE ${staleWhere(t.cols)}`).bind(pattern(kid)).first<{ n: number }>();
    out.push({ name: t.table, remaining: r?.n ?? 0 });
  }
  const e = await db.prepare(`SELECT COUNT(*) AS n FROM embeddings WHERE ${blobStale(kid)}`).first<{ n: number }>();
  out.push({ name: "embeddings", remaining: e?.n ?? 0 });
  return out;
}

async function fileCounts(env: Env, kid: string, limit = 1000) {
  const l = await env.FILES.list({ limit, include: ["customMetadata"] });
  const objs = l.objects.filter((o) => !o.key.startsWith("__"));
  const sealed = objs.filter((o) => o.customMetadata?.sealed === kid).length;
  return { sealed, remaining: objs.length - sealed, checked: objs.length, truncated: l.truncated, objs };
}

/** Where things stand: how much is still readable as plaintext. Counts only; never reads content. */
export async function status(env: Env): Promise<SealStatus> {
  if (!Vault.hasKey(env)) return { enabled: false, key_id: null, strict: false, complete: false, tables: [], files: { sealed: 0, remaining: 0, checked: 0 } };
  const kid = await Vault.currentKeyId();
  const tables = await remainingIn(env.DB, kid);
  const f = await fileCounts(env, kid);
  return { enabled: true, key_id: kid, strict: await Vault.isStrict(), complete: tables.every((t) => t.remaining === 0) && f.remaining === 0 && !f.truncated, tables, files: { sealed: f.sealed, remaining: f.remaining, checked: f.checked } };
}

async function sealSome(env: Env, kid: string, rowBudget: number, fileBudget: number): Promise<number> {
  const db = env.DB;
  let work = 0;
  for (const t of TEXT_TABLES) {
    if (rowBudget <= 0) break;
    const rows = (await db.prepare(`SELECT * FROM ${t.table} WHERE ${staleWhere(t.cols)} LIMIT ${Math.min(rowBudget, 50)}`).bind(pattern(kid)).all<Record<string, unknown>>()).results;
    if (!rows.length) continue;
    const stmts: D1PreparedStatement[] = [];
    for (const r of rows) {
      const aad = String(r[t.aadFrom ?? t.key]);
      const sets: string[] = [], binds: unknown[] = [];
      const plain: Record<string, string | null> = {};
      for (const c of t.cols) {
        const v = r[c];
        if (typeof v !== "string") continue;
        plain[c] = await Vault.open(t.table, aad, c, v); // accepts plaintext and any key still in the ring
        sets.push(`${c} = ?`); binds.push(await Vault.seal(t.table, aad, c, plain[c]));
      }
      if (t.table === "notes") {
        // The two plain flags are recomputed from what the row really says (a write made before this upgrade didn't set them).
        sets.push("system = ?", "dated = ?"); binds.push(N.systemOf(String(r.kind), plain.db_schema ?? null), N.datedOf(plain.props));
      }
      // Only if the row is still exactly what was read: a save made in the meantime (already sealed) must never be overwritten.
      const same = t.cols.filter((c) => typeof r[c] === "string");
      if (sets.length) stmts.push(db.prepare(`UPDATE ${t.table} SET ${sets.join(", ")} WHERE ${t.key} = ? AND ${same.map((c) => `${c} IS ?`).join(" AND ")}`).bind(...binds, r[t.key], ...same.map((c) => r[c])));
    }
    if (stmts.length) await db.batch(stmts);
    work += rows.length; rowBudget -= rows.length;
  }
  if (rowBudget > 0) {
    const rows = (await db.prepare(`SELECT note_id, vec FROM embeddings WHERE ${blobStale(kid)} LIMIT ${Math.min(rowBudget, 50)}`).all<{ note_id: string; vec: ArrayBuffer | number[] }>()).results;
    if (rows.length) {
      const stmts: D1PreparedStatement[] = [];
      for (const r of rows) {
        const raw = r.vec instanceof ArrayBuffer ? new Uint8Array(r.vec) : Uint8Array.from(r.vec as ArrayLike<number>);
        const sealed = await Vault.sealBytes("embeddings", r.note_id, "vec", await Vault.openBytes("embeddings", r.note_id, "vec", raw));
        stmts.push(db.prepare("UPDATE embeddings SET vec = ? WHERE note_id = ? AND vec IS ?").bind(sealed.buffer.slice(sealed.byteOffset, sealed.byteOffset + sealed.byteLength), r.note_id, r.vec));
      }
      await db.batch(stmts);
      work += rows.length;
    }
  }
  if (fileBudget > 0) {
    const f = await fileCounts(env, kid);
    for (const o of f.objs.filter((x) => x.customMetadata?.sealed !== kid).slice(0, fileBudget)) {
      const obj = await env.FILES.get(o.key);
      if (!obj) continue;
      const plain = await Vault.openBytes("files", o.key, "body", new Uint8Array(await obj.arrayBuffer()));
      await env.FILES.put(o.key, await Vault.sealBytes("files", o.key, "body", plain), { httpMetadata: obj.httpMetadata, customMetadata: { sealed: kid } });
      work++;
    }
  }
  return work;
}

const getPref = async (db: D1Database, k: string) => (await db.prepare("SELECT value FROM prefs WHERE key = ?").bind(k).first<{ value: string }>())?.value ?? null;

/** Cron entry point: a few rows per run until everything is on the current key, then one cheap read per minute. */
export async function maybeBackfill(env: Env): Promise<number> {
  if (!Vault.hasKey(env)) return 0;
  const kid = await Vault.currentKeyId();
  if ((await getPref(env.DB, DONE_PREF)) === kid) return 0;
  const work = await sealSome(env, kid, 120, 6);
  if (work === 0) {
    // Nothing left to seal this pass: record it, but only if the files are fully done too (the list is capped at 1000).
    const s = await status(env);
    if (s.complete) await env.DB.prepare("INSERT INTO prefs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(DONE_PREF, kid).run();
  }
  return work;
}

/** Manual run (Settings, or the owner calling the API): a bigger bite, then the new status. */
export async function sealNow(env: Env): Promise<SealStatus & { sealed: number }> {
  if (!Vault.hasKey(env)) throw new Vault.VaultError("no_data_key");
  const kid = await Vault.currentKeyId();
  const sealed = await sealSome(env, kid, 200, 10);
  const s = await status(env);
  if (s.complete) await env.DB.prepare("INSERT INTO prefs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(DONE_PREF, kid).run();
  else await env.DB.prepare("DELETE FROM prefs WHERE key = ?").bind(DONE_PREF).run();
  return { ...s, sealed };
}
