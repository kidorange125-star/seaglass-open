// Paper Lock: a page locked with a hand-drawn paper card. The page's real title, icon and words live in paper_pages (sealed,
// notes.ts paperLock); the page row is an empty placeholder hidden from AI and unshared, so nothing else in the app (search,
// history, export, Waffle, MCP, backups' readers) can meet the words. They come out only here, for a device holding an open
// lock (a "grant"), and a grant exists only after a phone scanned the card:
//   - a phone opening a page itself scans, and gets a secret (unlockDirect);
//   - any other device asks (requestUnlock: it keeps a secret nobody else sees, the phone gets a notification), and when the
//     phone scans the card for that request (approve) the secret becomes a grant.
// A scan is the card found by its edges, straightened, and read as a 200 x 120 grid of ink (client/paper/scan.ts, match.ts),
// compared here against the three scans made when the card was set up, which never leave the server; it must agree with two.
// Version 1 cards (the first scanner: one loose 40 x 24 map, no card edges) are RETIRED: a different card with a similar
// drawing opened the user's test page, so they open nothing and their pages stay locked for good (The user chose this; the trash still
// works). After 6 wrong scans in a row a card is blocked for 5 minutes. A grant lasts 10 minutes and slides while the
// page is open; the phone can end it at any time (relock), and so does closing the page.
import type { Env } from "./env";
import * as Vault from "./vault";
import * as N from "./notes";
import * as Push from "./push";
import { cleanHtml } from "./sanitize";
import { ENROLL, matchesCard, packBits, quality, score, unpackBits } from "../client/paper/match";

export const REQUEST_MS = 3 * 60_000;
export const GRANT_MS = 10 * 60_000;
const MAX_FAILS = 6;
const BLOCK_MS = 5 * 60_000;
const NEW_CARD_MS = 5 * 60_000; // a card made this minute can lock a page without being scanned again

/** An answer the app shows as it is (status = HTTP status; extra goes into the JSON). */
export class PaperError extends Error {
  constructor(public status: 400 | 403 | 404 | 409 | 423 | 429, message: string, public extra: Record<string, unknown> = {}) { super(message); }
}

/** A request from the app as it was before scans were { bits } (a phone still running the old version). */
export function notOldApp(b: Record<string, unknown>) {
  if (("map" in b || "maps" in b) && !("scan" in b) && !("scans" in b)) throw new PaperError(400, "Seaglass was just updated. Close it completely and open it again, then scan.", { update: true });
}

const now = () => Date.now();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
const secret = () => { const b = crypto.getRandomValues(new Uint8Array(32)); let s = ""; for (const x of b) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };

/** Paper Lock cards are drawn and scanned on a phone. (A user agent can be faked: the real protection is the card.) */
export const isPhone = (ua: string | undefined) => /iPhone|iPod|Android.*Mobile|Mobile.*Android/i.test(ua ?? "");
export function phoneOnly(ua: string | undefined) {
  if (!isPhone(ua)) throw new PaperError(403, "Paper Lock cards are drawn and scanned on your phone.");
}

/** "Windows · Chrome", from a user agent: what the phone's pop-up calls the device asking. */
export function deviceName(ua: string | undefined): string {
  const u = ua ?? "";
  const os = /iPhone/.test(u) ? "iPhone" : /iPad/.test(u) ? "iPad" : /Android/.test(u) ? (/Mobile/.test(u) ? "Android phone" : "Android tablet") : /Windows/.test(u) ? "Windows computer" : /Mac OS X|Macintosh/.test(u) ? "Mac" : /CrOS/.test(u) ? "Chromebook" : /Linux/.test(u) ? "Linux computer" : "A device";
  const app = /Edg\//.test(u) ? "Edge" : /Firefox\//.test(u) ? "Firefox" : /Chrome\/|CriOS\//.test(u) ? "Chrome" : /Safari\//.test(u) ? "Safari" : "browser";
  return `${os} · ${app}`;
}

// ---------------------------------------------------------------- cards

interface CardRow { id: string; name: string; template: string; created_at: number; fails: number; blocked_until: number; version: number; refresh_until: number }
const cardRow = (db: D1Database, id: string) => db.prepare("SELECT * FROM paper_cards WHERE id = ?").bind(id).first<CardRow>();
const cardName = async (r: CardRow) => (await Vault.open("paper_cards", r.id, "name", r.name)) ?? "My card";

export async function listCards(db: D1Database) {
  const rows = (await db.prepare("SELECT c.*, (SELECT COUNT(*) FROM paper_pages p WHERE p.card_id = c.id) AS pages FROM paper_cards c ORDER BY created_at").all<CardRow & { pages: number }>()).results;
  return Promise.all(rows.map(async (r) => ({ id: r.id, name: await cardName(r), pages: r.pages, created_at: r.created_at, blocked_until: r.blocked_until > now() ? r.blocked_until : 0, retired: r.version < 2 })));
}

/** Three setup scans, checked: each readable and full enough to be a key, all agreeing with each other. */
function setupScans(input: unknown): string[] {
  const raw = Array.isArray(input) ? input : [];
  if (raw.length !== 3) throw new PaperError(400, "Scan the card three times.");
  const reads = raw.map(unpackBits);
  if (reads.some((m) => !m)) throw new PaperError(400, "That scan didn't come through. Try again.");
  const rs = reads as Uint8Array[];
  for (const m of rs) { const q = quality(m); if (!q.ok) throw new PaperError(400, q.message, { quality: q.reason }); }
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
    if (score(rs[i], rs[j]) < ENROLL) throw new PaperError(400, "The three scans didn't agree. Hold the card flat and still, in even light, and scan again.", { quality: "disagree" });
  }
  return rs.map(packBits);
}

/** Makes a card from three scans of the drawing. */
export async function createCard(db: D1Database, input: { name?: unknown; scans?: unknown }) {
  const scans = setupScans(input.scans);
  const id = crypto.randomUUID(), name = String(input.name ?? "").trim().slice(0, 40) || "My card";
  await db.prepare("INSERT INTO paper_cards (id, name, template, created_at, version) VALUES (?,?,?,?,2)").bind(id, await Vault.seal("paper_cards", id, "name", name), await Vault.seal("paper_cards", id, "template", JSON.stringify(scans)), now()).run();
  return { id, name };
}

export async function deleteCard(db: D1Database, id: string) {
  const used = await db.prepare("SELECT COUNT(*) AS c FROM paper_pages WHERE card_id = ?").bind(id).first<{ c: number }>();
  if (used?.c) throw new PaperError(400, used.c === 1
    ? "This card still locks a page. Open that page with the card and choose Remove Paper Lock first, or the page is lost for good."
    : `This card still locks ${used.c} pages. Open each with the card and choose Remove Paper Lock first, or they are lost for good.`);
  const r = await db.prepare("DELETE FROM paper_cards WHERE id = ?").bind(id).run();
  return r.meta.changes > 0;
}

const RETIRED = "This page was locked with a card from the first scanner, which wasn't safe enough, so it can't be opened any more. You can move it to the trash.";

/** Checks a scan against a card. Wrong scans count; six in a row block the card for five minutes. A scan too poor to read
 *  (no drawing, too dark) is refused with what to change and doesn't count. A card from the first scanner opens nothing. */
async function verifyScan(db: D1Database, cardId: string, scanIn: unknown) {
  const card = await cardRow(db, cardId);
  if (!card) throw new PaperError(404, "That card doesn't exist any more.");
  if (card.version < 2) throw new PaperError(403, RETIRED, { retired: true });
  const t = now();
  if (card.blocked_until > t) throw new PaperError(429, `Too many wrong scans. Try again in ${Math.ceil((card.blocked_until - t) / 60_000)} minute${card.blocked_until - t > 60_000 ? "s" : ""}.`, { retry_at: card.blocked_until });
  const scan = (scanIn && typeof scanIn === "object" ? scanIn : {}) as { bits?: unknown };
  const bits = unpackBits(scan.bits);
  if (!bits) throw new PaperError(400, "That scan didn't come through. Try again.");
  const q = quality(bits);
  if (!q.ok && (q.reason === "blank" || q.reason === "dark")) throw new PaperError(400, q.message, { quality: q.reason });
  let setup: Uint8Array[] = [];
  try { setup = (JSON.parse((await Vault.open("paper_cards", card.id, "template", card.template)) ?? "") as string[]).map(unpackBits).filter((x): x is Uint8Array => !!x); } catch { /* unreadable: no match */ }
  if (setup.length > 0 && matchesCard(bits, setup)) {
    if (card.fails) await db.prepare("UPDATE paper_cards SET fails = 0 WHERE id = ?").bind(card.id).run();
    return card;
  }
  const fails = card.fails + 1;
  if (fails >= MAX_FAILS) {
    await db.prepare("UPDATE paper_cards SET fails = 0, blocked_until = ? WHERE id = ?").bind(t + BLOCK_MS, card.id).run();
    throw new PaperError(429, "That isn't the card, and that was the last try for now. Wait 5 minutes.", { retry_at: t + BLOCK_MS });
  }
  await db.prepare("UPDATE paper_cards SET fails = ? WHERE id = ?").bind(fails, card.id).run();
  throw new PaperError(403, "That doesn't look like the card.", { tries_left: MAX_FAILS - fails });
}

// ---------------------------------------------------------------- locking a page

/** Locks a page with a card. A card made a minute ago needs no second scan; an older one is scanned again to prove the card is in hand. */
export async function lockPage(db: D1Database, noteId: string, cardId: string, scan?: unknown) {
  const card = await cardRow(db, cardId);
  if (!card) throw new PaperError(404, "That card doesn't exist any more.");
  if (card.version < 2) throw new PaperError(400, "That card was made with the first scanner, which wasn't safe enough. Make a new card for this page.");
  if (now() - card.created_at > NEW_CARD_MS) await verifyScan(db, cardId, scan);
  const n = await N.paperLock(db, noteId, cardId);
  if (!n) throw new PaperError(404, "That page doesn't exist.");
  return n;
}

export async function cardOf(db: D1Database, noteId: string) {
  const r = await db.prepare("SELECT n.paper_lock AS card_id FROM notes n WHERE n.id = ? AND n.paper_lock IS NOT NULL").bind(noteId).first<{ card_id: string }>();
  if (!r) throw new PaperError(404, "That page isn't locked with a paper card.");
  const card = await cardRow(db, r.card_id);
  return { id: r.card_id, name: card ? await cardName(card) : "A card that was deleted", missing: !card, retired: !!card && card.version < 2 };
}

// ---------------------------------------------------------------- opening: requests and grants

const sweep = async (db: D1Database) => {
  const t = now();
  await db.batch([
    db.prepare("DELETE FROM paper_grants WHERE expires_at < ?").bind(t),
    db.prepare("UPDATE paper_requests SET status = 'expired' WHERE status = 'pending' AND expires_at < ?").bind(t),
    db.prepare("DELETE FROM paper_requests WHERE created_at < ?").bind(t - 24 * 3600_000),
  ]);
};

/** A device asks to open a page. It gets a secret that is useless until the phone scans the card; the phone is told. */
export async function requestUnlock(env: Env, noteId: string, ua: string | undefined) {
  const db = env.DB;
  await sweep(db);
  const card = await cardOf(db, noteId);
  if (card.retired || card.missing) throw new PaperError(403, RETIRED);
  const pending = await db.prepare("SELECT COUNT(*) AS c FROM paper_requests WHERE status = 'pending'").first<{ c: number }>();
  if ((pending?.c ?? 0) >= 6) throw new PaperError(429, "Too many requests waiting. Answer the ones on your phone first.");
  const id = crypto.randomUUID(), sec = secret(), t = now(), device = deviceName(ua);
  await db.prepare("INSERT INTO paper_requests (id, note_id, secret_hash, device, status, created_at, expires_at) VALUES (?,?,?,?, 'pending', ?, ?)").bind(id, noteId, await sha(sec), device, t, t + REQUEST_MS).run();
  // the notification says who asks and which card, never which page
  await Push.notifyPhones(env, { title: "Unlock request", body: `${device} wants to open a paper-locked page. Scan "${card.name}" to allow it.`, tag: `paper-${id}`, url: `/?paper=${id}`, id });
  return { id, secret: sec, expires_at: t + REQUEST_MS };
}

/** The requests waiting for the phone. */
export async function pendingRequests(db: D1Database) {
  await sweep(db);
  const rows = (await db.prepare("SELECT id, note_id, device, created_at, expires_at FROM paper_requests WHERE status = 'pending' ORDER BY created_at").all<{ id: string; note_id: string; device: string; created_at: number; expires_at: number }>()).results;
  const out = [];
  for (const r of rows) {
    try { out.push({ id: r.id, device: r.device, card: (await cardOf(db, r.note_id)).name, card_id: (await cardOf(db, r.note_id)).id, created_at: r.created_at, expires_at: r.expires_at }); } catch { /* the page was unlocked for good meanwhile */ }
  }
  return out;
}

export async function requestStatus(db: D1Database, id: string) {
  await sweep(db);
  const r = await db.prepare("SELECT status FROM paper_requests WHERE id = ?").bind(id).first<{ status: string }>();
  return { status: r?.status ?? "expired" };
}

const grantFor = async (db: D1Database, noteId: string, sec: string | undefined) => {
  if (!sec) return null;
  return db.prepare("SELECT id, expires_at FROM paper_grants WHERE secret_hash = ? AND note_id = ? AND expires_at > ?").bind(await sha(sec), noteId, now()).first<{ id: string; expires_at: number }>();
};

/** The phone scanned the card for a request: the asking device's secret becomes a grant. */
export async function approve(db: D1Database, requestId: string, scan: unknown) {
  await sweep(db);
  const r = await db.prepare("SELECT * FROM paper_requests WHERE id = ? AND status = 'pending'").bind(requestId).first<{ id: string; note_id: string; secret_hash: string; device: string }>();
  if (!r) throw new PaperError(404, "That request has run out or was answered already.");
  const card = await cardOf(db, r.note_id);
  await verifyScan(db, card.id, scan);
  const t = now(), gid = crypto.randomUUID();
  await db.batch([
    db.prepare("INSERT OR REPLACE INTO paper_grants (id, secret_hash, note_id, device, created_at, expires_at) VALUES (?,?,?,?,?,?)").bind(gid, r.secret_hash, r.note_id, r.device, t, t + GRANT_MS),
    db.prepare("UPDATE paper_requests SET status = 'approved' WHERE id = ?").bind(requestId),
  ]);
  return { ok: true, device: r.device, grant_id: gid, card: card.name };
}

export async function deny(db: D1Database, requestId: string) {
  const r = await db.prepare("UPDATE paper_requests SET status = 'denied' WHERE id = ? AND status = 'pending'").bind(requestId).run();
  return { ok: r.meta.changes > 0 };
}

/** The phone opening a page itself: scan, and the phone gets the secret straight away. */
export async function unlockDirect(db: D1Database, noteId: string, scan: unknown, ua: string | undefined) {
  await sweep(db);
  const card = await cardOf(db, noteId);
  await verifyScan(db, card.id, scan);
  const sec = secret(), t = now(), gid = crypto.randomUUID();
  await db.prepare("INSERT INTO paper_grants (id, secret_hash, note_id, device, created_at, expires_at) VALUES (?,?,?,?,?,?)").bind(gid, await sha(sec), noteId, deviceName(ua), t, t + GRANT_MS).run();
  return { secret: sec, grant_id: gid };
}

/** Ends an open lock: by the device's own secret (closing the page), by the grant's id (the phone's Relock) or by the request it answered. */
export async function relock(db: D1Database, input: { secret?: unknown; grant_id?: unknown; request_id?: unknown }) {
  let n = 0;
  if (typeof input.secret === "string" && input.secret) n += (await db.prepare("DELETE FROM paper_grants WHERE secret_hash = ?").bind(await sha(input.secret)).run()).meta.changes;
  if (typeof input.grant_id === "string" && input.grant_id) n += (await db.prepare("DELETE FROM paper_grants WHERE id = ?").bind(input.grant_id).run()).meta.changes;
  if (typeof input.request_id === "string" && input.request_id) {
    const r = await db.prepare("SELECT secret_hash FROM paper_requests WHERE id = ?").bind(input.request_id).first<{ secret_hash: string }>();
    if (r) {
      n += (await db.prepare("DELETE FROM paper_grants WHERE secret_hash = ?").bind(r.secret_hash).run()).meta.changes;
      await db.prepare("UPDATE paper_requests SET status = 'relocked' WHERE id = ?").bind(input.request_id).run();
    }
  }
  return { ok: true, closed: n };
}

/** What is open right now, for the phone's list (the card, never the page). */
export async function activeGrants(db: D1Database) {
  await sweep(db);
  const rows = (await db.prepare("SELECT id, note_id, device, created_at, expires_at FROM paper_grants ORDER BY created_at DESC").all<{ id: string; note_id: string; device: string; created_at: number; expires_at: number }>()).results;
  const out = [];
  for (const r of rows) { try { out.push({ id: r.id, device: r.device, card: (await cardOf(db, r.note_id)).name, since: r.created_at, expires_at: r.expires_at }); } catch { /* gone */ } }
  return out;
}

/** Keeps an open lock open while the page is, and says whether it still is. */
export async function ping(db: D1Database, noteId: string, sec: string | undefined) {
  const g = await grantFor(db, noteId, sec);
  if (!g) throw new PaperError(423, "This page is locked again.", { paper: true });
  await db.prepare("UPDATE paper_grants SET expires_at = ? WHERE id = ?").bind(now() + GRANT_MS, g.id).run();
  return { ok: true };
}

// ---------------------------------------------------------------- the words

interface PageRow { title: string; icon: string | null; html: string; revision: number; updated_at: number }
const openPage = async (id: string, r: PageRow) => ({
  title: (await Vault.open("paper_pages", id, "title", r.title)) ?? "", icon: await Vault.open("paper_pages", id, "icon", r.icon),
  html: (await Vault.open("paper_pages", id, "html", r.html)) ?? "", paper_rev: r.revision, updated_at: r.updated_at,
});

/** The page as the editor wants it: the placeholder's own fields with the real title, icon and words, and the paper revision. */
async function merged(db: D1Database, id: string, row: PageRow) {
  const n = await N.getNote(db, id);
  return { ...n!, ...(await openPage(id, row)), paper_unlocked: true, ai_hidden_inherited: false };
}

export async function readPage(db: D1Database, noteId: string, sec: string | undefined) {
  if (!(await grantFor(db, noteId, sec))) throw new PaperError(423, "This page is locked.", { paper: true });
  const row = await db.prepare("SELECT title, icon, html, revision, updated_at FROM paper_pages WHERE note_id = ?").bind(noteId).first<PageRow>();
  if (!row) throw new PaperError(404, "The words of this page are missing.");
  await db.prepare("UPDATE paper_grants SET expires_at = ? WHERE secret_hash = ?").bind(now() + GRANT_MS, await sha(sec!)).run();
  return merged(db, noteId, row);
}

export async function savePage(db: D1Database, noteId: string, sec: string | undefined, patch: { title?: unknown; html?: unknown; icon?: unknown; revision?: unknown }) {
  if (!(await grantFor(db, noteId, sec))) throw new PaperError(423, "This page is locked again, so that wasn't saved.", { paper: true });
  const row = await db.prepare("SELECT title, icon, html, revision, updated_at FROM paper_pages WHERE note_id = ?").bind(noteId).first<PageRow>();
  if (!row) throw new PaperError(404, "The words of this page are missing.");
  if (patch.revision !== undefined && Number(patch.revision) !== row.revision) throw new PaperError(409, "conflict", { current: await merged(db, noteId, row) });
  const cur = await openPage(noteId, row), t = now();
  const title = "title" in patch ? String(patch.title ?? "").slice(0, 300) : cur.title;
  const icon = "icon" in patch ? (patch.icon ? String(patch.icon).slice(0, 16) : null) : cur.icon;
  const html = "html" in patch ? cleanHtml(String(patch.html ?? "")) : cur.html;
  const res = await db.batch([
    db.prepare("UPDATE paper_pages SET title=?, icon=?, html=?, revision=revision+1, updated_at=? WHERE note_id=? AND revision=?").bind(await Vault.seal("paper_pages", noteId, "title", title), await Vault.seal("paper_pages", noteId, "icon", icon), await Vault.seal("paper_pages", noteId, "html", html), t, noteId, row.revision),
    db.prepare("UPDATE notes SET updated_at = ? WHERE id = ?").bind(t, noteId), // so other devices see "edited just now", never what changed
  ]);
  if (!res[0].meta.changes) throw new PaperError(409, "conflict", { current: await merged(db, noteId, (await db.prepare("SELECT title, icon, html, revision, updated_at FROM paper_pages WHERE note_id = ?").bind(noteId).first<PageRow>())!) });
  return merged(db, noteId, { title: (await Vault.seal("paper_pages", noteId, "title", title))!, icon: await Vault.seal("paper_pages", noteId, "icon", icon), html: (await Vault.seal("paper_pages", noteId, "html", html))!, revision: row.revision + 1, updated_at: t });
}

/** Takes the lock off a page for good (the page is open, so the card was scanned). */
export async function removeLock(db: D1Database, noteId: string, sec: string | undefined) {
  if (!(await grantFor(db, noteId, sec))) throw new PaperError(423, "This page is locked.", { paper: true });
  const n = await N.paperUnlockForever(db, noteId);
  if (!n) throw new PaperError(404, "That page isn't locked with a paper card.");
  return n;
}
