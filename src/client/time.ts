// Time windows on dates. A date value is { start: "YYYY-MM-DD", end?, start_time?: "HH:MM", end_time?: "HH:MM" }:
// the times ride along on the same object, so views that only read the day (calendar, board, Jeff)
// keep working unchanged.

export interface Window { start_time?: string | null; end_time?: string | null }

/** Whether this browser's locale writes times on a 24-hour clock. */
const h24 = (() => { try { return /h2[34]/.test(new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hourCycle ?? ""); } catch { return false; } })();

const parts = (t: string) => { const [h, m] = t.split(":").map(Number); return { h, m }; };
const mer = (h: number) => (h < 12 ? "AM" : "PM");
const clock = (t: string, withMer = true) => {
  const { h, m } = parts(t);
  if (h24) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  const hh = h % 12 || 12;
  return `${hh}${m ? `:${String(m).padStart(2, "0")}` : ""}${withMer ? ` ${mer(h)}` : ""}`;
};

/** "3 PM", "3–5 PM", "11 AM–1 PM", or "15:00–17:00" on a 24-hour locale. "" without a start time. */
export function timeLabel(w: Window | null | undefined): string {
  const s = w?.start_time, e = w?.end_time;
  if (!s || !isTime(s)) return "";
  if (!e || !isTime(e)) return clock(s);
  const same = !h24 && mer(parts(s).h) === mer(parts(e).h);
  return `${clock(s, !same)}–${clock(e)}`;
}

/** One time on the locale's clock: "3 PM", "3:30 PM" or "15:30". "" if not a valid time. */
export const clockLabel = (t: unknown) => (isTime(t) ? clock(t) : "");

/** A date value that runs over several days (its end day is after its start day). */
export const isMultiDay = (v: { start?: unknown; end?: unknown } | null | undefined) =>
  typeof v?.start === "string" && typeof v?.end === "string" && v.end.slice(0, 10) > v.start.slice(0, 10);

/** The whole date: "Nov 7 3–5 PM" on one day, "Nov 7 3 PM → Nov 9 5 PM" over several (times optional).
 *  `day` formats a YYYY-MM-DD day. On several days end_time belongs to the end day. */
export function spanLabel(v: { start: string; end?: string; start_time?: string | null; end_time?: string | null }, day: (iso: string) => string): string {
  if (!isMultiDay(v)) { const tl = timeLabel(v); return day(v.start.slice(0, 10)) + (tl ? ` ${tl}` : ""); }
  const st = clockLabel(v.start_time), et = st ? clockLabel(v.end_time) : "";
  return `${day(v.start.slice(0, 10))}${st ? ` ${st}` : ""} → ${day(v.end!.slice(0, 10))}${et ? ` ${et}` : ""}`;
}

export const isTime = (t: unknown): t is string => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

const to24 = (h: number, m: number, meridiem?: string) => {
  if (meridiem) h = (h % 12) + (/p/i.test(meridiem) ? 12 : 0);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

/** Finds a time or time window in quick-add text: "3pm", "at 9:30am", "3-5pm", "11am-1pm", "15:00-17:00".
 *  Plain numbers ("chapter 4") are left alone: a time needs am/pm or a colon. */
export function takeTime(text: string): { text: string; start_time: string | null; end_time: string | null } {
  const range = /\s(?:at\s+|from\s+)?(\d{1,2})(?::([0-5]\d))?\s*(am|pm)?\s*(?:-|–|to)\s*(\d{1,2})(?::([0-5]\d))?\s*(am|pm)?(?=\s)/i.exec(text);
  if (range) {
    const [, h1, m1, a1, h2, m2, a2] = range;
    const ok = (a1 || a2) ? +h1 >= 1 && +h1 <= 12 && +h2 >= 1 && +h2 <= 12 : m1 !== undefined && m2 !== undefined && +h1 <= 23 && +h2 <= 23;
    if (ok) {
      let s = to24(+h1, +(m1 ?? 0), a1 ?? a2);
      const e = to24(+h2, +(m2 ?? 0), a2 ?? a1);
      // "11-1pm" means 11 AM to 1 PM: if borrowing the meridiem put the start after the end, flip it.
      if (!a1 && a2 && s >= e) s = to24(+h1, +(m1 ?? 0), /p/i.test(a2) ? "am" : "pm");
      return { text: text.slice(0, range.index) + " " + text.slice(range.index + range[0].length), start_time: s, end_time: e };
    }
  }
  const one = /\s(?:at\s+)?(\d{1,2})(?::([0-5]\d))?\s*(am|pm)(?=\s)/i.exec(text) ?? /\s(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)(?=\s)/.exec(text);
  if (one && (one[3] ? +one[1] >= 1 && +one[1] <= 12 : true)) {
    return { text: text.slice(0, one.index) + " " + text.slice(one.index + one[0].length), start_time: to24(+one[1], +(one[2] ?? 0), one[3]), end_time: null };
  }
  return { text, start_time: null, end_time: null };
}
