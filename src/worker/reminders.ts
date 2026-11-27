// Which task notifications are due right now. Pure (no D1, no imports) so tests/unit/reminders.test.mts can
// drive it with plain data. The cron (push.ts) runs it every minute for each time zone a device is in.
//
// Rules:
//   - A task with a time (start_time) is reminded `remind` minutes before it starts. Without its own setting it
//     uses the default from Notifications settings (at the start time, unless changed). Only My tasks rows get
//     the default; rows in other databases are reminded only when they have their own setting.
//   - A task with a date but no time is listed in the daily summary. With its own setting it is also reminded
//     at 9:00 AM on the day (`remind` minutes earlier, so 1440 = 9:00 the day before).
//   - "none" turns a task's reminders off. Done tasks are never reminded.
//   - A My tasks row over several days is due on its END day (the start is when it begins): the summary, overdue and
//     "due this week" count the end, and a reminder without a time is on the end day.
//   - Reminders fire within WINDOW of their time (cron ticks can be skipped), never for a task edited after
//     its reminder time (you were just looking at it), and each one only once (the caller dedupes by key).

export const WINDOW_MS = 10 * 60_000;
export const DIGEST_WINDOW_MS = 30 * 60_000;
export const DAY_ONLY_AT = "09:00";
export const REMIND_CHOICES = [0, 5, 10, 15, 30, 60, 120, 1440];

export interface Prefs {
  /** Daily summary time "HH:MM", or "" for off. */
  digest: string;
  /** Default for timed tasks without their own setting: minutes before, or "none". */
  remind: string;
  /** Weekly review: "<day 0-6, 0 = Sunday>@HH:MM", or "" for off. */
  weekly: string;
  /** Quiet hours, e.g. school: "<days 0-6>@HH:MM-HH:MM" ("12345@08:00-15:00"), or "" for off. Only urgent things come through. */
  quiet: string;
}
export const DEFAULT_PREFS: Prefs = { digest: "08:00", remind: "0", weekly: "0@17:00", quiet: "" };
export const isWeekly = (v: unknown): v is string => typeof v === "string" && /^[0-6]@([01]\d|2[0-3]):[0-5]\d$/.test(v);
const QUIET = /^([0-6]{1,7})@(([01]\d|2[0-3]):[0-5]\d)-(([01]\d|2[0-3]):[0-5]\d)$/;
/** A quiet-hours setting: some days, and a start before its end on the same day. */
export const isQuiet = (v: unknown): v is string => { const m = typeof v === "string" ? QUIET.exec(v) : null; return !!m && m[2] < m[4] && new Set(m[1]).size === m[1].length; };

/** Whether it's quiet hours right now in `tz`. */
export function quietNow(quiet: string, now: number, tz: string): boolean {
  const m = QUIET.exec(quiet);
  if (!m || !isQuiet(quiet)) return false;
  const l = localNow(now, tz), dow = new Date(`${l.date}T12:00:00Z`).getUTCDay();
  return m[1].includes(String(dow)) && l.time >= m[2] && l.time < m[4];
}

/** A task that should come through quiet hours: its priority is High or Urgent. */
export function isUrgent(row: Row): boolean {
  const v = row.props.priority;
  if (typeof v !== "string" || !v) return false;
  const opt = row.schema.properties?.find((p) => p.id === "priority")?.options?.find((o) => o.id === v);
  return /^(high|urgent)\b/i.test(opt?.name ?? v);
}

export interface Row {
  id: string; title: string; props: Record<string, unknown>; updated_at: number;
  schema: { system?: string; properties?: { id: string; name: string; type: string; options?: { id: string; name: string }[] }[] };
  db_title: string;
}
export interface Reminder { key: string; id: string; title: string; body: string; fireAt: number; tasks: boolean; /** comes through quiet hours */ urgent: boolean }
export interface Digest { key: string; title: string; body: string; count: number }

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isHHMM = (x: unknown): x is string => typeof x === "string" && HHMM.test(x);

/** Minutes-before from a stored value, null for "none", undefined for "not set". */
export function parseRemind(v: unknown): number | null | undefined {
  if (v === "none") return null;
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,5}$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= 10080 ? n : undefined;
}

// ------------------------------------------------------------------ time zones
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function parts(ms: number, tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    fmtCache.set(tz, f);
  }
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
  return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second };
}
export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}
/** The wall-clock date and time in `tz` at instant `ms`. */
export function localNow(ms: number, tz: string) {
  const p = parts(ms, tz);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { date: `${p.y}-${pad(p.mo)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.mi)}` };
}
/** The instant when it is `date` `time` on the wall clock in `tz`. Times skipped by a DST jump move forward. */
export function zonedToUtc(date: string, time: string, tz: string): number {
  const [y, mo, d] = date.split("-").map(Number), [h, mi] = time.split(":").map(Number);
  const want = Date.UTC(y, mo - 1, d, h, mi);
  const offset = (ms: number) => { const p = parts(ms, tz); return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - ms; };
  const t1 = want - offset(want), t2 = want - offset(t1); // second pass settles DST edges
  const hits = (t: number) => { const p = parts(t, tz); return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) === want; };
  return hits(t2) ? t2 : hits(t1) ? t1 : Math.max(t1, t2); // neither: the time doesn't exist that day (spring forward)
}

// ------------------------------------------------------------------ formatting
export function clock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
function before(min: number): string {
  if (min === 0) return "Now";
  if (min < 60) return `In ${min} min`;
  if (min % 1440 === 0) return min === 1440 ? "Tomorrow" : `In ${min / 1440} days`;
  if (min % 60 === 0) return `In ${min / 60} hour${min === 60 ? "" : "s"}`;
  return `In ${Math.floor(min / 60)} h ${min % 60} min`;
}
const addDay = (date: string, n: number) => { const t = new Date(`${date}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

// ------------------------------------------------------------------ rows
export function isDone(schema: Row["schema"], props: Record<string, unknown>): boolean {
  const ps = schema.properties ?? [];
  const statusProp = ps.find((p) => p.type === "status") ?? ps.find((p) => p.type === "select" && /status|state/i.test(p.name));
  const opt = statusProp?.options?.find((o) => o.id === props[statusProp.id]);
  if (opt && /^(done|complete|completed|finished)$/i.test(opt.name)) return true;
  const box = ps.find((p) => p.type === "checkbox" && /done|complete/i.test(p.name));
  return !!box && props[box.id] === true;
}
/** The row's date value (the first date property that has one). */
export function dateOf(row: Row): { date: string; end: string | null; start_time: string | null; end_time: string | null; remind: number | null | undefined } | null {
  for (const p of row.schema.properties ?? []) {
    if (p.type !== "date") continue;
    const v = row.props[p.id] as { start?: unknown; end?: unknown; start_time?: unknown; end_time?: unknown; remind?: unknown } | undefined;
    if (!v || typeof v !== "object" || typeof v.start !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(v.start)) continue;
    const date = v.start.slice(0, 10);
    const end = typeof v.end === "string" && v.end.slice(0, 10) > date ? v.end.slice(0, 10) : null;
    const start_time = isHHMM(v.start_time) ? v.start_time : null;
    // Over several days the end time is on the end day; on one day it has to come after the start.
    return { date, end, start_time, end_time: start_time && isHHMM(v.end_time) && (end || v.end_time > start_time) ? v.end_time : null, remind: parseRemind(v.remind) };
  }
  return null;
}

export function planReminders(rows: Row[], now: number, tz: string, prefs: Prefs, cardsDue = 0): { reminders: Reminder[]; digest: Digest | null; weekly: Digest | null } {
  const reminders: Reminder[] = [];
  const today = localNow(now, tz).date;
  const defaultRemind = parseRemind(prefs.remind);
  const dueToday: string[] = [];
  let overdue = 0, week = 0;
  const weekEnd = addDay(today, 7);

  for (const row of rows) {
    const tasks = row.schema.system === "tasks";
    if (isDone(row.schema, row.props)) continue;
    const d = dateOf(row);
    if (!d) continue;
    const deadline = tasks && d.end ? d.end : d.date;
    if (tasks) {
      if (deadline === today) dueToday.push(d.start_time && !d.end ? `${row.title || "Untitled"} (${clock(d.start_time)})` : row.title || "Untitled");
      else if (deadline < today) overdue++;
      if (deadline >= today && deadline < weekEnd) week++;
    }

    const remind = d.remind !== undefined ? d.remind : d.start_time && tasks ? defaultRemind ?? null : null;
    if (remind === null || remind === undefined) continue;
    // Without a time a task is reminded on the day it's due (the end day of a range); with one, before it starts.
    const day = d.start_time ? d.date : deadline;
    const at = zonedToUtc(day, d.start_time ?? DAY_ONLY_AT, tz);
    const fireAt = at - remind * 60_000;
    if (fireAt > now || fireAt <= now - WINDOW_MS || row.updated_at > fireAt) continue;
    const until = d.end ? ` → ${new Date(`${d.end}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}${d.end_time ? ` ${clock(d.end_time)}` : ""}` : "";
    const when = d.start_time ? `${clock(d.start_time)}${d.end_time && !d.end ? `–${clock(d.end_time)}` : ""}${until}` : day === addDay(today, 1) ? "Due tomorrow" : day === today ? "Due today" : "";
    const lead = d.start_time ? before(remind) : "";
    const body = [lead && when ? `${lead} · ${when}` : lead || when, tasks ? "" : row.db_title].filter(Boolean).join(" · ");
    reminders.push({ key: `r|${row.id}|${day}|${d.start_time ?? ""}|${remind}|${tz}`, id: row.id, title: row.title || "Untitled", body, fireAt, tasks, urgent: isUrgent(row) });
  }

  let digest: Digest | null = null;
  if (isHHMM(prefs.digest) && (dueToday.length || overdue)) {
    const at = zonedToUtc(today, prefs.digest, tz);
    if (now >= at && now < at + DIGEST_WINDOW_MS) {
      const n = dueToday.length;
      const title = n ? `${n} task${n === 1 ? "" : "s"} today` : `${overdue} overdue task${overdue === 1 ? "" : "s"}`;
      const list = dueToday.slice(0, 4).join(", ") + (n > 4 ? `, +${n - 4} more` : "");
      const body = [list, n && overdue ? `${overdue} overdue` : ""].filter(Boolean).join(" · ") || "Open My tasks to catch up";
      digest = { key: `d|${today}|${tz}`, title, body, count: n + overdue };
    }
  }
  // Weekly review: on the chosen day and time, what's overdue, what's coming up and how many cards are due.
  let weekly: Digest | null = null;
  if (isWeekly(prefs.weekly)) {
    const [dow, time] = prefs.weekly.split("@");
    const localDow = new Date(`${today}T12:00:00Z`).getUTCDay();
    const at = zonedToUtc(today, time, tz);
    if (String(localDow) === dow && now >= at && now < at + DIGEST_WINDOW_MS) {
      const parts = [overdue ? `${overdue} overdue` : "", `${week} due this week`, cardsDue ? `${cardsDue} flashcard${cardsDue === 1 ? "" : "s"} to review` : ""].filter(Boolean);
      weekly = { key: `w|${today}|${tz}`, title: "Time for your weekly review", body: parts.join(" · "), count: overdue + week };
    }
  }
  return { reminders, digest, weekly };
}
