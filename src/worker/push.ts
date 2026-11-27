// Task notifications: devices (push_subs), preferences, the every-minute reminder run and the actions on a
// notification (Done, Snooze). Tables in migrations/0004_push.sql. Sending is in webpush.ts, timing rules in
// reminders.ts.
import type { Env } from "./env";
import * as N from "./notes";
import * as Vault from "./vault";
import { rollRepeat } from "../client/recur";
import { DEFAULT_PREFS, isHHMM, isQuiet, isTimeZone, isWeekly, localNow, parseRemind, planReminders, quietNow, type Prefs, type Row } from "./reminders";
import { isPushEndpoint, rawPublicKey, b64url, sendPush, type PushSub } from "./webpush";

export interface SubRow { endpoint: string; p256dh: string; auth: string; tz: string; label: string; created_at: number; seen_at: number; last_error: string | null }

// ---------------------------------------------------------------- keys
export function vapidKey(env: Env): JsonWebKey | null {
  if (!env.VAPID_PRIVATE_KEY) return null;
  try {
    const k = JSON.parse(env.VAPID_PRIVATE_KEY) as JsonWebKey;
    return k.kty === "EC" && k.crv === "P-256" && k.d && k.x && k.y ? k : null;
  } catch { return null; }
}
export const vapidPublic = (env: Env) => { const k = vapidKey(env); return k ? b64url(rawPublicKey(k)) : null; };
/** VAPID "sub": who runs this app. Push services want an https: or mailto: URL. */
const subject = (env: Env) => (env.PUBLIC_URL?.startsWith("https://") ? env.PUBLIC_URL.replace(/\/+$/, "") : "mailto:seaglass@localhost.localdomain");

// ---------------------------------------------------------------- prefs
export async function getPrefs(db: D1Database): Promise<Prefs> {
  const r = await db.prepare("SELECT value FROM prefs WHERE owner_id = {owner} AND (key = 'notifications')").first<{ value: string }>();
  try { return { ...DEFAULT_PREFS, ...(r ? (JSON.parse(r.value) as Partial<Prefs>) : {}) }; } catch { return DEFAULT_PREFS; }
}
export async function setPrefs(db: D1Database, input: Partial<Record<keyof Prefs, unknown>>): Promise<Prefs> {
  const cur = await getPrefs(db);
  const next: Prefs = { ...cur };
  if ("digest" in input) {
    if (input.digest !== "" && !isHHMM(input.digest)) throw new N.BadRequest("digest must be HH:MM or empty");
    next.digest = input.digest as string;
  }
  if ("weekly" in input) {
    if (input.weekly !== "" && !isWeekly(input.weekly)) throw new N.BadRequest('weekly must be "<day 0-6>@HH:MM" or empty');
    next.weekly = input.weekly as string;
  }
  if ("quiet" in input) {
    if (input.quiet !== "" && !isQuiet(input.quiet)) throw new N.BadRequest('quiet must be "<days 0-6>@HH:MM-HH:MM" (start before end) or empty');
    next.quiet = input.quiet as string;
  }
  if ("remind" in input) {
    const r = parseRemind(input.remind);
    if (r === undefined) throw new N.BadRequest('remind must be minutes before (0-10080) or "none"');
    next.remind = r === null ? "none" : String(r);
  }
  await db.prepare("INSERT INTO prefs (owner_id, key, value) VALUES ({owner}, 'notifications', ?) ON CONFLICT(owner_id, key) DO UPDATE SET value = excluded.value").bind(JSON.stringify(next)).run();
  return next;
}

// ---------------------------------------------------------------- devices
export async function listSubs(db: D1Database) {
  const rows = (await db.prepare("SELECT * FROM push_subs WHERE owner_id = {owner} ORDER BY created_at").all<SubRow>()).results;
  // The device keys (and its name) are sealed in D1; the endpoint stays readable because it is the row's key.
  return Promise.all(rows.map(async (r) => ({ ...r, p256dh: (await Vault.open("push_subs", r.endpoint, "p256dh", r.p256dh)) ?? "", auth: (await Vault.open("push_subs", r.endpoint, "auth", r.auth)) ?? "", label: (await Vault.open("push_subs", r.endpoint, "label", r.label)) ?? "" })));
}
export async function saveSub(db: D1Database, input: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown }; tz?: unknown; label?: unknown }) {
  const endpoint = String(input.endpoint ?? ""), p256dh = String(input.keys?.p256dh ?? ""), auth = String(input.keys?.auth ?? "");
  if (endpoint.length > 1000 || !isPushEndpoint(endpoint)) throw new N.BadRequest("not a push service address");
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,32}$/.test(auth)) throw new N.BadRequest("bad subscription keys");
  if (!isTimeZone(input.tz)) throw new N.BadRequest("bad time zone");
  const label = String(input.label ?? "").slice(0, 60);
  const t = Date.now();
  await db.prepare(
    `INSERT INTO push_subs (owner_id, endpoint, p256dh, auth, tz, label, created_at, seen_at) VALUES ({owner}, ?,?,?,?,?,?,?)
     ON CONFLICT(endpoint) DO UPDATE SET owner_id = excluded.owner_id, p256dh = excluded.p256dh, auth = excluded.auth, tz = excluded.tz, label = excluded.label, seen_at = excluded.seen_at, last_error = NULL`,
  ).bind(endpoint, await Vault.seal("push_subs", endpoint, "p256dh", p256dh), await Vault.seal("push_subs", endpoint, "auth", auth), input.tz, await Vault.seal("push_subs", endpoint, "label", label), t, t).run();
  return { ok: true };
}
export async function deleteSub(db: D1Database, endpoint: string) {
  const r = await db.prepare("DELETE FROM push_subs WHERE owner_id = {owner} AND (endpoint = ?)").bind(endpoint).run();
  return r.meta.changes > 0;
}

// ---------------------------------------------------------------- sending
export interface Payload { title: string; body: string; tag: string; url: string; id?: string; actions?: { action: string; title: string }[] }

/** Sends to each device, drops dead subscriptions, and records the last error on the others. */
export async function sendAll(env: Env, subs: SubRow[], payload: Payload) {
  const key = vapidKey(env);
  if (!key) return { sent: 0, failed: subs.length, errors: ["VAPID_PRIVATE_KEY is not set"] };
  let sent = 0, failed = 0;
  const errors: string[] = [];
  await Promise.all(subs.map(async (s) => {
    const r = await sendPush(s as PushSub, payload, key, subject(env), { topic: payload.tag });
    if (r.ok) { sent++; if (s.last_error) await env.DB.prepare("UPDATE push_subs SET last_error = NULL WHERE owner_id = {owner} AND (endpoint = ?)").bind(s.endpoint).run(); return; }
    failed++;
    errors.push(`${r.status} ${r.detail}`.trim());
    if (r.gone) await env.DB.prepare("DELETE FROM push_subs WHERE owner_id = {owner} AND (endpoint = ?)").bind(s.endpoint).run();
    else await env.DB.prepare("UPDATE push_subs SET last_error = ? WHERE owner_id = {owner} AND (endpoint = ?)").bind(`${r.status} ${r.detail}`.slice(0, 300), s.endpoint).run();
  }));
  return { sent, failed, errors };
}

const taskActions = [{ action: "done", title: "Done" }, { action: "snooze", title: "Snooze 10 min" }];

/** Claims a reminder key; false if it was already sent (so overlapping runs can't send twice). */
async function claim(db: D1Database, key: string, t: number) {
  const r = await db.prepare("INSERT OR IGNORE INTO push_sent (owner_id, key, sent_at) VALUES ({owner}, ?, ?)").bind(key, t).run();
  return r.meta.changes > 0;
}

/** Dated rows from every database, with their schema, for planReminders. The LIKE can't use an index, so this
 *  reads every note once a minute (~1440 x notes D1 rows a day): fine for one person, the place to look if the
 *  free-tier read budget ever gets tight. It only runs when at least one device has notifications on. */
async function datedRows(db: D1Database): Promise<Row[]> {
  const rs = (await db.prepare(
    `SELECT n.id, n.title, n.props, n.updated_at, p.id AS db_id, p.title AS db_title, p.db_schema
     FROM notes n JOIN notes p ON p.owner_id = {owner} AND p.id = n.parent_id
     WHERE n.owner_id = {owner} AND (n.deleted_at IS NULL AND p.deleted_at IS NULL AND p.kind = 'database' AND n.is_template = 0 AND n.dated = 1)
     LIMIT 2000`,
  ).all<{ id: string; title: string; props: string; updated_at: number; db_id: string; db_title: string; db_schema: string | null }>()).results;
  const out: Row[] = [];
  const schemas = new Map<string, Promise<[string | null, string | null]>>(); // each database's title and schema, opened once
  for (const r of rs) {
    try {
      if (!schemas.has(r.db_id)) schemas.set(r.db_id, Promise.all([Vault.open("notes", r.db_id, "db_schema", r.db_schema), Vault.open("notes", r.db_id, "title", r.db_title)]));
      const [schema, dbTitle] = await schemas.get(r.db_id)!;
      const props = (await Vault.open("notes", r.id, "props", r.props)) ?? "{}";
      out.push({ id: r.id, title: (await Vault.open("notes", r.id, "title", r.title)) ?? "", props: JSON.parse(props || "{}"), updated_at: r.updated_at, schema: JSON.parse(schema || "{}"), db_title: dbTitle || "Untitled" });
    } catch (e) { if (e instanceof Vault.VaultError) throw e; /* skip unreadable rows */ }
  }
  return out;
}

// ---------------------------------------------------------------- quiet hours
// Held during quiet hours: a line for each thing that would have buzzed, sealed in prefs, sent as one notification when they end.
const HELD = "push_held";
async function heldList(db: D1Database): Promise<string[]> {
  const r = await db.prepare("SELECT value FROM prefs WHERE owner_id = {owner} AND (key = ?)").bind(HELD).first<{ value: string }>();
  if (!r) return [];
  try { return JSON.parse((await Vault.open("prefs", HELD, "value", r.value)) ?? "[]") as string[]; } catch { return []; }
}
async function hold(db: D1Database, lines: string[]) {
  if (!lines.length) return;
  const all = [...(await heldList(db)), ...lines].slice(-30);
  await db.prepare("INSERT INTO prefs (owner_id, key, value) VALUES ({owner}, ?, ?) ON CONFLICT(owner_id, key) DO UPDATE SET value = excluded.value").bind(HELD, await Vault.seal("prefs", HELD, "value", JSON.stringify(all))).run();
}
/** Whether it's quiet hours for them now (in the time zone of their devices). */
export async function isQuietNow(db: D1Database, now = Date.now(), subs?: SubRow[]) {
  const prefs = await getPrefs(db);
  if (!prefs.quiet) return false;
  const list = subs ?? await listSubs(db);
  return list.some((s) => isTimeZone(s.tz) && quietNow(prefs.quiet, now, s.tz));
}
/** A notification from the assistant (a check-in, a routine): sent now, or held until quiet hours end unless it's urgent. */
export async function notifyAll(env: Env, payload: Payload, urgent: boolean) {
  if (!vapidKey(env)) return;
  const subs = await listSubs(env.DB);
  if (!subs.length) return;
  if (!urgent && (await isQuietNow(env.DB, Date.now(), subs))) { await hold(env.DB, [`${payload.title}: ${payload.body}`.slice(0, 200)]); return; }
  await sendAll(env, subs, payload);
}

/** A notification for phones only. Never held back by quiet hours: someone is waiting. */
export async function notifyPhones(env: Env, payload: Payload) {
  if (!vapidKey(env)) return;
  const subs = (await listSubs(env.DB)).filter((s) => /^(iPhone|Android)/.test(s.label));
  if (subs.length) await sendAll(env, subs, payload);
}

/** The every-minute run: snoozed reminders, task reminders and the daily summary, for every device. */
export async function runReminders(env: Env, now = Date.now()) {
  const db = env.DB;
  if (!vapidKey(env)) return { skipped: "no VAPID key" };
  const subs = await listSubs(db);
  if (!subs.length) return { skipped: "no devices" };
  let sent = 0;
  const prefs = await getPrefs(db);
  const quietAll = await isQuietNow(db, now, subs);

  // a snoozed reminder waits out quiet hours (it stays due, so it goes once they end)
  const snoozed = quietAll ? [] : await Promise.all((await db.prepare("SELECT * FROM push_snooze WHERE owner_id = {owner} AND (fire_at <= ?)").bind(now).all<{ note_id: string; title: string; body: string }>()).results
    .map(async (s) => ({ ...s, title: (await Vault.open("push_snooze", s.note_id, "title", s.title)) ?? "", body: (await Vault.open("push_snooze", s.note_id, "body", s.body)) ?? "" })));
  for (const s of snoozed) {
    await db.prepare("DELETE FROM push_snooze WHERE owner_id = {owner} AND (note_id = ?)").bind(s.note_id).run();
    sent += (await sendAll(env, subs, { title: s.title, body: s.body || "Snoozed reminder", tag: `task-${s.note_id}`, url: `/?peek=${s.note_id}#/tasks`, id: s.note_id, actions: taskActions })).sent;
  }

  const rows = await datedRows(db);
  const held: string[] = [];
  const byTz = new Map<string, SubRow[]>();
  for (const s of subs) byTz.set(s.tz, [...(byTz.get(s.tz) ?? []), s]);
  for (const [tz, group] of byTz) {
    if (!isTimeZone(tz)) continue;
    const cardsDue = (await db.prepare("SELECT COUNT(*) AS n FROM study s JOIN notes n ON n.owner_id = {owner} AND n.id = s.note_id WHERE s.owner_id = {owner} AND (n.deleted_at IS NULL AND s.due <= ?)").bind(localNow(now, tz).date).first<{ n: number }>())?.n ?? 0;
    const plan = planReminders(rows, now, tz, prefs, cardsDue);
    const quiet = quietNow(prefs.quiet, now, tz);
    for (const r of plan.reminders) {
      if (!(await claim(db, r.key, now))) continue;
      if (quiet && !r.urgent) { held.push(`${r.title}${r.body ? ` (${r.body})` : ""}`); continue; } // only High or Urgent priority comes through
      sent += (await sendAll(env, group, { title: r.title, body: r.body, tag: `task-${r.id}`, url: `/?peek=${r.id}#/tasks`, id: r.id, actions: taskActions })).sent;
    }
    if (plan.digest && (await claim(db, plan.digest.key, now))) {
      if (quiet) held.push(`${plan.digest.title}: ${plan.digest.body}`);
      else sent += (await sendAll(env, group, { title: plan.digest.title, body: plan.digest.body, tag: `digest-${localNow(now, tz).date}`, url: "/#/tasks" })).sent;
    }
    if (plan.weekly && (await claim(db, plan.weekly.key, now))) {
      if (quiet) held.push(`${plan.weekly.title}: ${plan.weekly.body}`);
      else sent += (await sendAll(env, group, { title: plan.weekly.title, body: plan.weekly.body, tag: `weekly-${localNow(now, tz).date}`, url: "/#/review" })).sent;
    }
  }
  await hold(db, held);
  // quiet hours are over: everything held, in one notification
  if (!quietAll) {
    const was = await heldList(db);
    if (was.length) {
      await db.prepare("DELETE FROM prefs WHERE owner_id = {owner} AND (key = ?)").bind(HELD).run();
      sent += (await sendAll(env, subs, { title: `While quiet hours were on: ${was.length} notification${was.length === 1 ? "" : "s"}`, body: was.slice(0, 4).join(" · ") + (was.length > 4 ? ` · +${was.length - 4} more` : ""), tag: "quiet-catch-up", url: "/#/tasks" })).sent;
    }
  }
  await db.prepare("DELETE FROM push_sent WHERE owner_id = {owner} AND (sent_at < ?)").bind(now - 8 * 86_400_000).run();
  return { sent };
}

// ---------------------------------------------------------------- notification buttons
/** "Done" marks the task complete (a repeating one moves to its next date); "Snooze" re-sends it in 10 minutes. */
export async function notificationAction(env: Env, id: string, action: string, today: string) {
  const db = env.DB;
  const row = await N.getNote(db, id);
  if (!row || !row.parent_id) return { ok: false, error: "not found" };
  if (action === "snooze") {
    await db.prepare("INSERT INTO push_snooze (owner_id, note_id, fire_at, title, body) VALUES ({owner}, ?,?,?,?) ON CONFLICT(note_id) DO UPDATE SET fire_at = excluded.fire_at WHERE push_snooze.owner_id = excluded.owner_id")
      .bind(id, Date.now() + 10 * 60_000, await Vault.seal("push_snooze", id, "title", row.title || "Untitled"), await Vault.seal("push_snooze", id, "body", "Snoozed reminder")).run();
    return { ok: true };
  }
  if (action !== "done") return { ok: false, error: "unknown action" };
  const parent = await N.getNote(db, row.parent_id);
  type P = { id: string; name: string; type: string; options?: { id: string; name: string }[] };
  let schema: { system?: string; properties?: P[] } = {}, props: Record<string, unknown> = {};
  try { schema = JSON.parse(parent?.db_schema || "{}"); props = JSON.parse(row.props || "{}"); } catch { return { ok: false, error: "unreadable" }; }
  const ps = schema.properties ?? [];
  const status = ps.find((p) => p.type === "status") ?? ps.find((p) => p.type === "select" && /status|state/i.test(p.name));
  const doneOpt = status?.options?.find((o) => /^(done|complete|completed|finished)$/i.test(o.name));
  const box = ps.find((p) => p.type === "checkbox" && /done|complete/i.test(p.name));
  if (status && doneOpt) props[status.id] = doneOpt.id;
  else if (box) props[box.id] = true;
  else return { ok: false, error: "this row has no done state" };
  const rolled = rollRepeat(schema, props, /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : new Date().toISOString().slice(0, 10));
  await N.patchNote(db, id, { props: rolled ? rolled.props : props }, { source: "user", runId: crypto.randomUUID() });
  return { ok: true, next: rolled?.next ?? null };
}
