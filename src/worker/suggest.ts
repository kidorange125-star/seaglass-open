// the user's time zone and a short picture of where things stand (what's due, open tasks, recent pages, flashcards due,
// memories), used by the hourly check-in (proactive.ts). Titles, dates and statuses only, never whole pages.
// (This file used to also write the empty-chat "smart suggestions"; those were replaced by the check-in's messages.)
import * as N from "./notes";
import { hiddenIds } from "./hidden";
import * as M from "./memory";
import { isTimeZone, localNow } from "./reminders";

const getPref = async (db: D1Database, k: string) => (await db.prepare("SELECT value FROM prefs WHERE owner_id = {owner} AND (key = ?)").bind(k).first<{ value: string }>())?.value ?? null;
const setPref = (db: D1Database, k: string, v: string) => db.prepare("INSERT INTO prefs (owner_id, key, value) VALUES ({owner}, ?, ?) ON CONFLICT(owner_id, key) DO UPDATE SET value = excluded.value").bind(k, v).run();

/** the user's time zone: the one the app last reported, else a notification device's, else UTC. */
export async function userTz(db: D1Database): Promise<string> {
  const tz = await getPref(db, "tz");
  if (tz && isTimeZone(tz)) return tz;
  const sub = await db.prepare("SELECT tz FROM push_subs WHERE owner_id = {owner} ORDER BY seen_at DESC LIMIT 1").first<{ tz: string }>();
  return sub?.tz && isTimeZone(sub.tz) ? sub.tz : "UTC";
}
export async function rememberTz(db: D1Database, tz: unknown) {
  if (typeof tz !== "string" || !isTimeZone(tz)) return;
  if ((await getPref(db, "tz")) !== tz) await setPref(db, "tz", tz);
}

export const hourKey = (now: number, tz: string) => { const l = localNow(now, tz); return `${l.date} ${l.time.slice(0, 2)}`; };

/** What the check-in sees first: titles, dates and statuses only (plus Waffle's memories), never whole pages. */
export async function context(db: D1Database, now: number, tz: string): Promise<string> {
  const l = localNow(now, tz);
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: tz }).format(new Date(now));
  const home = await N.homeData(db), hidden = await hiddenIds(db); // pages hidden from AI are left out
  home.upcoming = (home.upcoming as { id: string }[]).filter((u) => !hidden.has(u.id));
  type Up = { title: string; due: string; end: string | null; start_time: string | null; db_title: string; status: { name: string } | null };
  const upcoming = (home.upcoming as Up[]).slice(0, 15).map((u) => {
    // Weekday and "in N days" spelled out: models get weekdays wrong when they have to work them out from a date.
    const day = (iso: string) => {
      const n = Math.round((Date.parse(`${iso}T12:00:00Z`) - Date.parse(`${l.date}T12:00:00Z`)) / 86_400_000);
      const wd = new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
      return `${wd} ${iso} (${n === 0 ? "today" : n === 1 ? "tomorrow" : n === -1 ? "yesterday" : n > 0 ? `in ${n} days` : `${-n} days ago`})`;
    };
    // Over several days it's due on its end day; the start is when it begins.
    const deadline = u.end ?? u.due;
    const when = u.end ? `${day(u.end)} (started ${day(u.due)}${u.start_time ? ` at ${u.start_time}` : ""})` : `${day(u.due)}${u.start_time ? ` at ${u.start_time}` : ""}`;
    const tag = deadline < l.date ? "OVERDUE" : deadline === l.date ? "TODAY" : "";
    return `- ${tag ? `[${tag}] ` : ""}"${u.title}" (${u.db_title}) due ${when}${u.status ? `, status ${u.status.name}` : ""}`;
  });
  // Open tasks without a date (dated ones are already in `upcoming`).
  const undated: string[] = [];
  const tasks = await db.prepare("SELECT id FROM notes WHERE owner_id = {owner} AND (kind = 'database' AND system = 'tasks' AND deleted_at IS NULL) LIMIT 1").first<{ id: string }>();
  if (tasks) {
    for (const r of await N.listChildren(db, tasks.id)) {
      if (r.is_template || (r as N.Note & { dated?: number }).dated || hidden.has(r.id)) continue;
      try { const p = JSON.parse(r.props || "{}") as { status?: string }; if (p.status !== "done") undated.push(`- "${r.title || "Untitled"}"`); } catch { /* skip */ }
      if (undated.length >= 10) break;
    }
  }
  const recent = ((await N.recentNotes(db, 8)) as { id: string; title: string; updated_at: number }[]).filter((r) => !hidden.has(r.id)).map((r) => `- "${r.title || "Untitled"}" (edited ${localNow(r.updated_at, tz).date})`);
  const cards = (await db.prepare("SELECT COUNT(*) AS n FROM study s JOIN notes n ON n.owner_id = {owner} AND n.id = s.note_id WHERE s.owner_id = {owner} AND (n.deleted_at IS NULL AND s.due <= ?)").bind(l.date).first<{ n: number }>())?.n ?? 0;
  const mems = (await M.listMemories(db, 25)).map((m) => `- ${m.text}`);
  return [
    `Now: ${weekday} ${l.date}, ${l.time} (${tz}).`,
    `Upcoming and overdue (from their databases):\n${upcoming.join("\n") || "- nothing dated"}`,
    `Open tasks with no date:\n${undated.join("\n") || "- none"}`,
    `Recently edited pages:\n${recent.join("\n") || "- none"}`,
    `Flashcards due today: ${cards}`,
    `What Waffle remembers about the user:\n${mems.join("\n") || "- nothing yet"}`,
  ].join("\n\n");
}
