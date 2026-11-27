// Search by meaning, voice transcription and quick capture. Workers AI does the embeddings (bge-small, 384 dims)
// and speech to text (Whisper); vectors live in D1 and are compared by brute-force cosine, which is plenty for one
// person's notes. With ANTHROPIC_API_KEY=mock, embeddings are a cheap deterministic word hash (no AI calls) so the
// test suites are repeatable and free.
import * as Usage from "./usage";
import * as Daily from "./daily";
import * as Suggest from "./suggest";
import { localNow } from "./reminders";
import { heardFrom, type HeardRaw } from "../client/voice/text";
import type { Env } from "./env";
import { authMode } from "./claude-auth";
import * as N from "./notes";
import { HIDDEN_SQL } from "./hidden";
import * as Vault from "./vault";
import { takeTime } from "../client/time";
import { takeRepeat } from "../client/recur";

export const EMBED_MODEL = "@cf/baai/bge-small-en-v1.5";
export const DIMS = 384;
export const WHISPER = "@cf/openai/whisper-large-v3-turbo";

// ---------------------------------------------------------------- embeddings
function hashEmbed(text: string): number[] {
  const v = new Array<number>(DIMS).fill(0);
  for (const w of text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []) {
    let h = 2166136261;
    for (let i = 0; i < w.length; i++) { h ^= w.charCodeAt(i); h = Math.imul(h, 16777619); }
    v[(h >>> 0) % DIMS] += 1;
  }
  return v;
}
export function normalize(v: number[]): Float32Array {
  const n = Math.hypot(...v) || 1;
  return Float32Array.from(v, (x) => x / n);
}

/** Embeds texts (batched). Needs the AI binding (or mock mode). */
export async function embed(env: Env, texts: string[]): Promise<Float32Array[]> {
  if (authMode(env) === "mock") return texts.map((t) => normalize(hashEmbed(t)));
  if (!env.AI) throw new Error("Workers AI isn't available here");
  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += 20) {
    const r = (await env.AI.run(EMBED_MODEL, { text: texts.slice(i, i + 20) })) as { data?: number[][] };
    if (!r.data || r.data.length !== Math.min(20, texts.length - i)) throw new Error("unexpected embedding response");
    for (const row of r.data) out.push(normalize(row));
  }
  return out;
}
export const aiAvailable = (env: Env) => authMode(env) === "mock" || !!env.AI;

const toBlob = (v: Float32Array) => v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer;
const fromBlob = (b: ArrayBuffer | Uint8Array | number[]): Float32Array => {
  const u = b instanceof ArrayBuffer ? new Uint8Array(b) : Uint8Array.from(b as ArrayLike<number>);
  return new Float32Array(u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength));
};
const toBuf = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
const bytesOf = (b: ArrayBuffer | Uint8Array | number[]) => (b instanceof Uint8Array ? b : b instanceof ArrayBuffer ? new Uint8Array(b) : Uint8Array.from(b as ArrayLike<number>));
const embedText = (n: { title: string; text: string }) => `${n.title || "Untitled"}\n${n.text}`.slice(0, 2000);

/** Embeds notes that are new or changed since their last vector (a few per minute, from the cron), and drops
 *  vectors of notes that are gone. */
export async function indexPending(env: Env, limit = 15): Promise<number> {
  if (!aiAvailable(env)) return 0;
  const db = env.DB;
  const rows = (await db.prepare(
    `SELECT n.id, n.title, n.text, n.updated_at FROM notes n LEFT JOIN embeddings e ON e.owner_id = {owner} AND e.note_id = n.id
     WHERE n.owner_id = {owner} AND (n.deleted_at IS NULL AND n.is_template = 0 AND length(n.title) + length(n.text) > 8 AND (e.note_id IS NULL OR e.note_updated < n.updated_at) AND n.id NOT IN (${HIDDEN_SQL}))
     ORDER BY n.updated_at DESC LIMIT ?`,
  ).bind(limit).all<{ id: string; title: string; text: string; updated_at: number }>()).results;
  if (rows.length) {
    // Titles and text are sealed in D1: open them to embed, and seal the vectors too (they leak what a page is about).
    const plain = await Promise.all(rows.map(async (r) => ({ title: (await Vault.open("notes", r.id, "title", r.title)) ?? "", text: (await Vault.open("notes", r.id, "text", r.text)) ?? "" })));
    const vecs = await embed(env, plain.map(embedText));
    const t = Date.now();
    const sealed = await Promise.all(rows.map(async (r, i) => toBuf(await Vault.sealBytes("embeddings", r.id, "vec", new Uint8Array(toBlob(vecs[i]))))));
    await db.batch(rows.map((r, i) => db.prepare("INSERT OR REPLACE INTO embeddings (owner_id, note_id, vec, note_updated, embedded_at) VALUES ({owner}, ?,?,?,?)").bind(r.id, sealed[i], r.updated_at, t)));
  }
  // Also drop vectors of pages hidden from AI (including ones moved under a hidden page since).
  await db.prepare(`DELETE FROM embeddings WHERE owner_id = {owner} AND (note_id NOT IN (SELECT id FROM notes WHERE owner_id = {owner} AND (deleted_at IS NULL)) OR note_id IN (${HIDDEN_SQL}))`).run();
  return rows.length;
}

export interface Hit { id: string; title: string; icon: string | null; score: number; snippet: string }

/** The notes closest in meaning to a question. */
export async function searchByMeaning(env: Env, query: string, limit = 6): Promise<{ hits: Hit[]; indexed: number; pending: number }> {
  const db = env.DB;
  const [q] = await embed(env, [query.slice(0, 1000)]);
  const rows = (await db.prepare(
    `SELECT e.note_id AS id, e.vec, n.title, n.icon, n.text FROM embeddings e JOIN notes n ON n.owner_id = {owner} AND n.id = e.note_id WHERE e.owner_id = {owner} AND (n.deleted_at IS NULL) LIMIT 6000`,
  ).all<{ id: string; vec: ArrayBuffer; title: string; icon: string | null; text: string }>()).results;
  const scored = (await Promise.all(rows.map(async (r) => { const v = fromBlob(await Vault.openBytes("embeddings", r.id, "vec", bytesOf(r.vec))); let s = 0; for (let i = 0; i < DIMS; i++) s += v[i] * q[i]; return { r, s }; })))
    .filter((x) => x.s > 0.2).sort((a, b) => b.s - a.s).slice(0, limit);
  const shown = await Promise.all(scored.map(async ({ r, s }) => ({ r: { ...r, title: (await Vault.open("notes", r.id, "title", r.title)) ?? "", icon: await Vault.open("notes", r.id, "icon", r.icon), text: (await Vault.open("notes", r.id, "text", r.text)) ?? "" }, s })));
  const pending = (await db.prepare(`SELECT COUNT(*) AS n FROM notes n LEFT JOIN embeddings e ON e.owner_id = {owner} AND e.note_id = n.id WHERE n.owner_id = {owner} AND (n.deleted_at IS NULL AND n.is_template = 0 AND length(n.title) + length(n.text) > 8 AND (e.note_id IS NULL OR e.note_updated < n.updated_at) AND n.id NOT IN (${HIDDEN_SQL}))`).first<{ n: number }>())?.n ?? 0;
  return {
    indexed: rows.length, pending,
    hits: shown.map(({ r, s }) => ({ id: r.id, title: r.title || "Untitled", icon: r.icon, score: Math.round(s * 1000) / 1000, snippet: r.text.replace(/\s+/g, " ").slice(0, 220) })),
  };
}

// ---------------------------------------------------------------- "You wrote about this before" (#18)
/** Notes close in meaning to a page: to what the user's writing now (`text`, one embedding) or, without it, to the page as last
 *  indexed (its stored vector: no AI call). Not the page itself, its sub-pages, or database rows; only close matches. */
export async function related(env: Env, id: string, text: string | null, limit = 4): Promise<Hit[]> {
  const db = env.DB;
  let q: Float32Array | null = null;
  if (text && text.trim().length >= 40) {
    if (!aiAvailable(env)) return [];
    [q] = await embed(env, [text.slice(-1500)]);
  } else {
    const own = await db.prepare("SELECT vec FROM embeddings WHERE owner_id = {owner} AND (note_id = ?)").bind(id).first<{ vec: ArrayBuffer }>();
    if (!own) return [];
    q = fromBlob(await Vault.openBytes("embeddings", id, "vec", bytesOf(own.vec)));
  }
  const min = authMode(env) === "mock" ? 0.3 : 0.62; // bge-small: unrelated notes sit around 0.4 to 0.55
  const rows = (await db.prepare(
    `SELECT e.note_id AS id, e.vec, n.title, n.icon, n.text, n.parent_id, p.kind AS parent_kind FROM embeddings e JOIN notes n ON n.owner_id = {owner} AND n.id = e.note_id
     LEFT JOIN notes p ON p.owner_id = {owner} AND p.id = n.parent_id WHERE e.owner_id = {owner} AND (n.deleted_at IS NULL AND n.id != ?1 AND (n.parent_id IS NULL OR n.parent_id != ?1) AND n.kind = 'page' AND (p.kind IS NULL OR p.kind != 'database')) LIMIT 6000`,
  ).bind(id).all<{ id: string; vec: ArrayBuffer; title: string; icon: string | null; text: string }>()).results;
  const scored = (await Promise.all(rows.map(async (r) => { const v = fromBlob(await Vault.openBytes("embeddings", r.id, "vec", bytesOf(r.vec))); let s = 0; for (let i = 0; i < DIMS; i++) s += v[i] * q![i]; return { r, s }; })))
    .filter((x) => x.s >= min).sort((a, b) => b.s - a.s).slice(0, limit);
  return Promise.all(scored.map(async ({ r, s }) => ({
    id: r.id, title: (await Vault.open("notes", r.id, "title", r.title)) || "Untitled", icon: await Vault.open("notes", r.id, "icon", r.icon), score: Math.round(s * 1000) / 1000,
    snippet: ((await Vault.open("notes", r.id, "text", r.text)) ?? "").replace(/\s+/g, " ").slice(0, 160),
  })));
}

// ---------------------------------------------------------------- voice notes
export async function transcribe(env: Env, audio: ArrayBuffer): Promise<string> {
  if (authMode(env) === "mock") return "(mock) This is a transcribed voice note about photosynthesis.";
  if (!env.AI) throw new Error("Workers AI isn't available here");
  let bin = "";
  const u = new Uint8Array(audio);
  for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
  const r = (await env.AI.run(WHISPER, { audio: btoa(bin) })) as { text?: string };
  await Usage.record(env.DB, "voice to text", WHISPER);
  return String(r.text ?? "").trim();
}

/**
 * Live voice on devices that can't measure how loud the microphone is (iPhones): what has been said in the recording so far,
 * and how long it has been quiet since, so the app knows when the user's finished. The model's own voice detection drops silence
 * and noise before transcribing, which also keeps it from inventing words out of a quiet room.
 */
export async function hear(env: Env, audio: ArrayBuffer, lang?: string): Promise<{ text: string; duration: number; quiet: number }> {
  if (authMode(env) === "mock") return { text: "(mock) This is what you said.", duration: 3, quiet: 1.5 };
  if (!env.AI) throw new Error("Workers AI isn't available here");
  let bin = "";
  const u = new Uint8Array(audio);
  for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
  const r = (await env.AI.run(WHISPER, { audio: btoa(bin), vad_filter: true, condition_on_previous_text: false, ...(lang ? { language: lang } : {}) } as never)) as HeardRaw;
  await Usage.record(env.DB, "live listening", WHISPER);
  return heardFrom(r);
}

// ---------------------------------------------------------------- quick capture
// A separate, revocable token (only its hash is stored) lets an iPhone Shortcut or other script send text into
// Seaglass without holding an account password. It can only add: a task or a line in the Inbox page.

const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const getPref = async (db: D1Database, k: string) => (await db.prepare("SELECT value FROM prefs WHERE owner_id = {owner} AND (key = ?)").bind(k).first<{ value: string }>())?.value ?? null;
const setPref = (db: D1Database, k: string, v: string) => db.prepare("INSERT INTO prefs (owner_id, key, value) VALUES ({owner}, ?, ?) ON CONFLICT(owner_id, key) DO UPDATE SET value = excluded.value").bind(k, v).run();

export async function makeCaptureToken(db: D1Database) {
  const raw = crypto.getRandomValues(new Uint8Array(24));
  const token = `sgc_${btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
  await setPref(db, "capture_token", await sha256(token));
  return token;
}
export const captureEnabled = async (db: D1Database) => !!(await getPref(db, "capture_token"));
export const revokeCaptureToken = (db: D1Database) => db.prepare("DELETE FROM prefs WHERE owner_id = {owner} AND (key = 'capture_token')").run();
/** Whose quick-capture key this is (run on the system database), or null. The key is random, so its hash is looked up. */
export async function captureOwner(sys: D1Database, token: string): Promise<string | null> {
  if (!token.startsWith("sgc_")) return null;
  const r = await sys.prepare("SELECT owner_id FROM prefs WHERE key = 'capture_token' AND value = ? /*any-owner*/").bind(await sha256(token)).first<{ owner_id: string }>();
  return r?.owner_id ?? null;
}
export async function checkCaptureToken(db: D1Database, token: string) {
  const want = await getPref(db, "capture_token");
  if (!want || !token.startsWith("sgc_")) return false;
  const got = await sha256(token);
  let d = 0; for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ (got.charCodeAt(i) || 0);
  return d === 0 && got.length === want.length;
}

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** "Call Sam tomorrow 3pm every mon" -> title and due date/time/repeat. `today` is the caller's local date. */
export function parseCapture(raw: string, today: string) {
  let text = ` ${raw.trim()} `;
  const time = takeTime(text); text = time.text;
  const rep = takeRepeat(text); text = rep.text;
  let due: string | null = null;
  const base = new Date(`${today}T12:00:00Z`);
  text = text.replace(/\s(today|tomorrow|tonight|(?:next\s+)?(sun|mon|tue|wed|thu|fri|sat)[a-z]*)(?=\s)/i, (_m, word: string, day?: string) => {
    const w = word.toLowerCase();
    if (w === "today" || w === "tonight") due = today;
    else if (w === "tomorrow") { const d = new Date(base); d.setUTCDate(d.getUTCDate() + 1); due = iso(d); }
    else if (day) {
      const want = DAYS.indexOf(day.toLowerCase().slice(0, 3)); const d = new Date(base);
      do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() !== want);
      due = iso(d);
    }
    return " ";
  });
  if (!due && (time.start_time || rep.repeat)) due = today;
  return { title: text.replace(/\s+/g, " ").trim(), due, start_time: time.start_time, end_time: time.end_time, repeat: rep.repeat };
}

export async function capture(env: Env, b: { text?: unknown; type?: unknown; url?: unknown; title?: unknown; today?: unknown; tz?: unknown }) {
  const text = String(b.text ?? "").trim().slice(0, 20_000), url = String(b.url ?? "").trim().slice(0, 2000), title = String(b.title ?? "").trim().slice(0, 300);
  const body = text || [title, url].filter(Boolean).join(" ");
  if (!body) throw new N.BadRequest("send some text, a title or a url");
  const db = env.DB;
  const ctx: N.Ctx = { source: "user", runId: crypto.randomUUID() };
  // their local day: the device sends it (and its time zone, kept for later); a Shortcut may send neither, and then it's
  // their saved time zone's day, not the server's UTC one (which is already tomorrow on their evenings)
  await Suggest.rememberTz(db, b.tz);
  const today = /^\d{4}-\d{2}-\d{2}$/.test(String(b.today ?? "")) ? String(b.today) : localNow(Date.now(), await Suggest.userTz(db)).date;
  const asTask = b.type === "task" || (b.type !== "note" && /^(todo|task|remind me to)\b[:\s]/i.test(body));
  if (asTask) {
    const tasks = await N.ensureTasksDb(db, ctx, today);
    const p = parseCapture(body.replace(/^(todo|task|remind me to)\b[:\s]*/i, ""), today);
    const props: Record<string, unknown> = { status: "todo", ...(p.due ? { due: { start: p.due, ...(p.start_time ? { start_time: p.start_time } : {}), ...(p.start_time && p.end_time ? { end_time: p.end_time } : {}) } } : {}), ...(p.repeat ? { repeat: p.repeat } : {}) };
    const n = await N.createNote(db, { parent_id: tasks.id, title: p.title || body.slice(0, 120), props }, ctx);
    return { ok: true, kind: "task", id: n.id, title: n.title, due: p.due };
  }
  const line = url && !text ? `<a href="${esc(url)}">${esc(title || url)}</a>` : `${esc(text || title)}${url ? ` <a href="${esc(url)}">${esc(url)}</a>` : ""}`;
  // Once the user uses daily notes, a capture is a timed line in today's note (daily.ts); before that, a line in the Inbox page.
  const daily = await Daily.captureLine(db, line, Date.now(), ctx, today);
  if (daily) return { ok: true, kind: "note", id: daily.id, title: daily.title };
  // A line in the Inbox page (created on first use; a new one if the old one was trashed or deleted).
  let inbox = null as N.Note | null;
  const saved = await getPref(db, "inbox_id");
  if (saved) inbox = await N.getNote(db, saved);
  if (!inbox) { inbox = await N.createNote(db, { title: "Inbox", icon: "📥", html: "<p>Things you sent to Seaglass (Shortcuts, the share sheet) land here. Sort them whenever you like.</p>" }, ctx); await setPref(db, "inbox_id", inbox.id); }
  await N.patchNote(db, inbox.id, { html: `${inbox.html}<p>${line}</p>` }, ctx);
  return { ok: true, kind: "note", id: inbox.id, title: "Inbox" };
}
