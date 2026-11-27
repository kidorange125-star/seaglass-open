// The date picker, like Notion's: the date at the top, Today / Tomorrow / Next week, a month calendar (tap a day and
// it's saved), then "Add time" and "End date" only when wanted, Remind, and Clear. Used by My tasks (WhenPopover in
// Tasks.tsx) and every date cell in a database (Cells.tsx).
//
// For a task the date is when it's DUE. A task can also start earlier: with an end date on, the first date is when it
// starts and the end date is when it's due (Task.deadline, worker reminders.ts). Other databases' dates are plain
// start / end. The stored value keeps its shape: { start, end?, start_time?, end_time?, remind? }.
import { ReactNode, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { fitRemind, remindOptions, remindValue } from "../remind";
import { clockLabel } from "../time";

export interface DateVal { start: string; end?: string; start_time?: string; end_time?: string; remind?: string }

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const nextMonday = () => { const d = new Date(); d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7)); return iso(d); };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Any stored date value (an object, or a bare "YYYY-MM-DD" string) as a DateVal, or null. */
export function toDateVal(v: unknown): DateVal | null {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return { start: v.slice(0, 10) };
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.start !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(o.start)) return null;
  const start = o.start.slice(0, 10), end = typeof o.end === "string" && o.end.slice(0, 10) > start ? o.end.slice(0, 10) : undefined;
  const st = HHMM.test(String(o.start_time)) ? String(o.start_time) : undefined;
  const et = st && HHMM.test(String(o.end_time)) && (end || String(o.end_time) > st) ? String(o.end_time) : undefined;
  const rm = remindValue(o.remind);
  return { start, ...(end ? { end } : {}), ...(st ? { start_time: st } : {}), ...(et ? { end_time: et } : {}), ...(rm ? { remind: rm } : {}) };
}

/** Builds a clean value: an end only after the start, an end time only with a start time (and after it on one day). */
function build(start: string, end: string | null, st: string | null, et: string | null, remind: string): DateVal {
  const e = end && end > start ? end : null;
  const s = st && HHMM.test(st) ? st : null;
  const t = s && et && HHMM.test(et) && (e || et > s) ? et : null;
  const r = fitRemind(remind, !!s);
  return { start, ...(e ? { end: e } : {}), ...(s ? { start_time: s } : {}), ...(t ? { end_time: t } : {}), ...(r ? { remind: r } : {}) };
}

export function dayText(d: string) {
  const x = new Date(`${d}T12:00:00`), year = x.getFullYear() !== new Date().getFullYear();
  return x.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}) });
}

export function DatePicker({ value, onChange, tasks = false, children }: {
  value: DateVal | null;
  onChange: (v: DateVal | null) => void;
  /** My tasks: the date is the due date; with an end date the first one is when it starts. */
  tasks?: boolean;
  /** Extra rows above Clear (Repeat, for tasks). */
  children?: ReactNode;
}) {
  const v = value;
  const today = iso(new Date());
  const [wantEnd, setWantEnd] = useState(!!v?.end);
  // A task with a start date opens on its due day: that's the one that usually moves.
  const [active, setActive] = useState<"start" | "end">(tasks && v?.end ? "end" : "start");
  const [wantTime, setWantTime] = useState(!!v?.start_time);
  const [wantEndTime, setWantEndTime] = useState(!!v?.end_time);
  const shown = v ? (active === "end" && v.end ? v.end : v.start) : today;
  const [month, setMonth] = useState(() => shown.slice(0, 7));
  const remind = v?.remind ?? "";

  const put = (start: string, end: string | null, st = v?.start_time ?? null, et = v?.end_time ?? null) => onChange(build(start, end, st, et, remind));
  /** A day from the calendar or a shortcut goes to the date being edited. */
  const pick = (d: string) => {
    setMonth(d.slice(0, 7));
    if (!v || !wantEnd) { put(d, null, v ? v.start_time ?? null : null, v ? v.end_time ?? null : null); return; }
    // The second date of a pair: the earlier day is the start, the later the end (due, for a task).
    if (!v.end) { if (d !== v.start) put(d < v.start ? d : v.start, d < v.start ? v.start : d); setActive(tasks ? "start" : "end"); return; }
    if (active === "end") { if (d > v.start) put(v.start, d); else put(d, v.end); return; }
    if (d < v.end) put(d, v.end); else put(v.end, d > v.end ? d : null);
  };
  const addSecond = () => { setWantEnd(true); setActive(tasks ? "start" : "end"); };
  const dropSecond = () => { setWantEnd(false); setActive("start"); if (v?.end) put(tasks ? v.end : v.start, null); };
  // While a pair is half chosen, a task's one date is its due date (the start is still to pick).
  const pending = wantEnd && !!v && !v.end;
  const startDay = pending && tasks ? undefined : v?.start, endDay = v?.end ?? (pending && tasks ? v?.start : undefined);

  // the month grid: 6 weeks from the Sunday on or before the 1st
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1), from = new Date(y, m - 1, 1 - first.getDay());
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(from); d.setDate(from.getDate() + i); return iso(d); });
  const shift = (n: number) => { const d = new Date(y, m - 1 + n, 1); setMonth(iso(d).slice(0, 7)); };
  const monthName = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2026, 1, 1 + i).toLocaleDateString(undefined, { weekday: "narrow" })); // Feb 1 2026 is a Sunday

  const startLabel = tasks ? (wantEnd ? "Starts" : "Due") : wantEnd ? "Start" : "Date";
  const endLabel = tasks ? "Due" : "End";
  const field = (which: "start" | "end", label: string, d: string | undefined, t: string | undefined) => (
    <button type="button" className={`dp-field ${wantEnd && active === which ? "on" : ""}`} onClick={() => { setActive(which); if (d) setMonth(d.slice(0, 7)); }} aria-pressed={wantEnd ? active === which : undefined}>
      <small>{label}</small><span>{d ? dayText(d) : wantEnd && v ? "Pick a day" : "No date"}{d && t ? `, ${clockLabel(t)}` : ""}</span>
    </button>
  );

  return (
    <div className="dp">
      <div className={`dp-fields ${wantEnd ? "two" : ""}`}>
        {field("start", startLabel, startDay, startDay ? v?.start_time : undefined)}
        {wantEnd && field("end", endLabel, endDay, v?.end ? v.end_time : undefined)}
      </div>
      <div className="dp-quick">
        <button type="button" onClick={() => pick(today)}>Today</button>
        <button type="button" onClick={() => pick(addDays(1))}>Tomorrow</button>
        <button type="button" onClick={() => pick(nextMonday())}>Next week</button>
      </div>
      <div className="dp-cal">
        <div className="dp-month">
          <b>{monthName}</b>
          <button type="button" className="ghost" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft size={18} /></button>
          <button type="button" className="ghost" aria-label="Next month" onClick={() => shift(1)}><ChevronRight size={18} /></button>
        </div>
        <div className="dp-grid" role="grid" aria-label={monthName}>
          {weekdays.map((w, i) => <span key={i} className="dp-wd" aria-hidden>{w}</span>)}
          {days.map((d) => {
            const sel = !!v && (d === v.start || d === v.end);
            const inside = !!v?.end && d > v.start && d < v.end;
            return (
              <button type="button" key={d} onClick={() => pick(d)} aria-label={dayText(d)} aria-pressed={sel}
                className={`dp-day ${d.slice(0, 7) !== month ? "out" : ""} ${d === today ? "today" : ""} ${sel ? "sel" : ""} ${inside ? "inside" : ""} ${v?.end && d === v.start ? "first" : ""} ${v?.end && d === v.end ? "last" : ""}`}>
                {Number(d.slice(8))}
              </button>
            );
          })}
        </div>
      </div>

      {v && (wantTime ? (
        <div className="dp-row dp-times">
          <span>{v.end ? "Starts at" : "Time"}</span>
          <input type="time" step={300} value={v.start_time ?? ""} aria-label="Time" onChange={(e) => { const t = e.target.value; put(v.start, v.end ?? null, t || null, t ? v.end_time ?? null : null); }} />
          {wantEndTime || v.end_time
            ? <><span className="dp-to">{v.end ? "Due at" : "to"}</span><input type="time" step={300} value={v.end_time ?? ""} aria-label="End time" onChange={(e) => put(v.start, v.end ?? null, v.start_time ?? null, e.target.value || null)} /></>
            : v.start_time && <button type="button" className="ghost dp-link" onClick={() => setWantEndTime(true)}>{v.end ? "Add due time" : "Add end time"}</button>}
          <button type="button" className="ghost dp-link" onClick={() => { setWantTime(false); setWantEndTime(false); put(v.start, v.end ?? null, null, null); }}>Remove</button>
        </div>
      ) : (
        <div className="dp-adds">
          <button type="button" className="ghost dp-link" onClick={() => { setWantTime(true); put(v.start, v.end ?? null, "09:00", null); }}>Add time</button>
          {!wantEnd && <button type="button" className="ghost dp-link" onClick={addSecond}>{tasks ? "Add a start date" : "Add end date"}</button>}
        </div>
      ))}
      {v && wantTime && !wantEnd && <div className="dp-adds"><button type="button" className="ghost dp-link" onClick={addSecond}>{tasks ? "Add a start date" : "Add end date"}</button></div>}
      {v && wantEnd && <div className="dp-adds"><button type="button" className="ghost dp-link" onClick={dropSecond}>{tasks ? "No start date" : "Remove end date"}</button></div>}
      {tasks && wantEnd && <p className="dp-hint">{pending ? "Pick the day you'll start. It's still due on the day it was." : "It's due on the last day; the first is when you start."}</p>}

      {children}
      {v && <label className="dp-row dp-remind"><span>Remind</span>
        <select value={remind} onChange={(e) => onChange(build(v.start, v.end ?? null, v.start_time ?? null, v.end_time ?? null, e.target.value))}>
          {remindOptions(!!v.start_time).map(([val, l]) => <option key={val} value={val}>{l}</option>)}
        </select>
      </label>}
      {v && <div className="dp-foot"><button type="button" className="ghost" onClick={() => { setWantEnd(false); setWantTime(false); setWantEndTime(false); setActive("start"); onChange(null); }}>Clear</button></div>}
    </div>
  );
}
