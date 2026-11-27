// The Calendar screen (#/calendar): events from the Calendar database plus every My tasks row that has a date, as a month
// grid or a day-by-day list (the list is the default on phones). Events open in the side peek like any row; a task's
// circle ticks it off. The Calendar database is made the first time an event is added (worker notes.ts ensureEventsDb).
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";
import { ICalendar } from "../ui-icons";
import { DatePicker, type DateVal } from "./DatePicker";
import { useTasks, type Task } from "./Tasks";
import type { Note } from "../types";

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDay = (s: string, n: number) => { const d = new Date(`${s}T00:00:00`); d.setDate(d.getDate() + n); return iso(d); };
const clock = (hm?: string | null) => {
  if (!hm) return "";
  const [h, m] = hm.split(":").map(Number);
  return `${h % 12 || 12}${m ? `:${pad(m)}` : ""} ${h < 12 ? "AM" : "PM"}`;
};

type Item = { kind: "event" | "task"; id: string; title: string; time: string; sortKey: string; done?: boolean; task?: Task; where?: string };

function eventOf(n: Note): { when: DateVal | null; where: string } {
  try {
    const p = JSON.parse(n.props || "{}") as { when?: DateVal; where?: string };
    return { when: p.when?.start ? p.when : null, where: typeof p.where === "string" ? p.where : "" };
  } catch { return { when: null, where: "" }; }
}

export function CalendarView() {
  const s = useStore();
  const tasks = useTasks();
  const [events, setEvents] = useState<Note[]>([]);
  const [mode, setMode] = useState<"month" | "list">(() => (window.innerWidth < 600 ? "list" : "month"));
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [adding, setAdding] = useState<string | null>(null);
  const today = iso(new Date());

  const dbId = s.eventsDbId;
  const sig = useMemo(() => s.tree.filter((n) => n.parent_id === dbId).map((n) => n.id + n.updated_at).join(), [s.tree, dbId]);
  const load = useCallback(async () => {
    if (!dbId) { setEvents([]); return; }
    try { setEvents((await api.children(dbId)).filter((n) => !n.is_template)); } catch { /* keep what we have */ }
  }, [dbId]);
  useEffect(() => { void load(); }, [load, sig]);

  // Everything by day: an event on every day it covers, a task on the day it's due.
  const byDay = useMemo(() => {
    const m = new Map<string, Item[]>();
    const put = (day: string, it: Item) => { const l = m.get(day) ?? []; l.push(it); m.set(day, l); };
    for (const n of events) {
      const { when, where } = eventOf(n);
      if (!when) continue;
      const end = when.end && when.end > when.start ? when.end : when.start;
      for (let d = when.start, i = 0; d <= end && i < 62; d = addDay(d, 1), i++) {
        const first = d === when.start;
        put(d, { kind: "event", id: n.id, title: n.title || "Untitled event", where, time: first ? clock(when.start_time) : "", sortKey: first ? when.start_time ?? "00:00" : "00:00" });
      }
    }
    for (const t of tasks.rows ?? []) {
      if (!t.deadline) continue;
      put(t.deadline, { kind: "task", id: t.id, title: t.title || "Untitled task", time: clock(t.end_time ?? t.start_time), sortKey: t.end_time ?? t.start_time ?? "99:99", done: t.status === "done", task: t });
    }
    for (const l of m.values()) l.sort((a, b) => (a.kind === b.kind ? a.sortKey.localeCompare(b.sortKey) : a.kind === "event" ? -1 : 1));
    return m;
  }, [events, tasks.rows]);

  const open = (it: Item) => s.setPeek(it.id);
  const chip = (it: Item) => (
    <div key={`${it.kind}-${it.id}`} className={`cal-item cal-${it.kind}${it.done ? " cal-done" : ""}`}>
      {it.kind === "task"
        ? <button className="cal-tick" aria-label={it.done ? `Mark ${it.title} not done` : `Mark ${it.title} done`} onClick={() => it.task && void tasks.toggle(it.task)} />
        : <span className="cal-dot" aria-hidden />}
      <button className="cal-title" onClick={() => open(it)}>
        {it.time && <span className="cal-time">{it.time}</span>}
        <span>{it.title}</span>
      </button>
    </div>
  );

  const month = cursor.getMonth();
  const first = new Date(cursor); first.setDate(1 - first.getDay());
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(first); d.setDate(first.getDate() + i); return iso(d); });
  // The list: today and the next 8 weeks, only days with something on them (today always shows).
  const listDays = Array.from({ length: 56 }, (_, i) => addDay(today, i)).filter((d) => d === today || byDay.has(d));

  const label = (d: string) => {
    if (d === today) return "Today";
    if (d === addDay(today, 1)) return "Tomorrow";
    return new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  };

  return (
    <div className="page cal-page">
      <div className="topbar">
        <div className="crumbs"><span className="cur"><ICalendar size={16} /> Calendar</span></div>
        <div className="actions">
          <div className="cal-mode" role="group" aria-label="Show as">
            <button className={mode === "month" ? "on" : ""} aria-pressed={mode === "month"} onClick={() => setMode("month")}>Month</button>
            <button className={mode === "list" ? "on" : ""} aria-pressed={mode === "list"} onClick={() => setMode("list")}>List</button>
          </div>
          <button className="primary cal-new" aria-label="New event" onClick={() => setAdding(today)}><Plus size={15} /><span>New event</span></button>
        </div>
      </div>
      <div className="scroll">
        <div className="cal-wrap">
          {mode === "month" ? (
            <>
              <div className="cal-head">
                <h1>{cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h1>
                <button className="icon-btn" aria-label="Previous month" onClick={() => setCursor(new Date(cursor.getFullYear(), month - 1, 1))}><ChevronLeft size={18} /></button>
                <button className="icon-btn" aria-label="Next month" onClick={() => setCursor(new Date(cursor.getFullYear(), month + 1, 1))}><ChevronRight size={18} /></button>
                <button className="ghost" onClick={() => { const d = new Date(); d.setDate(1); setCursor(d); }}>Today</button>
              </div>
              <div className="cal-month">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="cal-dow">{d}</div>)}
                {days.map((day) => {
                  const items = byDay.get(day) ?? [];
                  return (
                    <div key={day} className={`cal-day ${day === today ? "today" : ""} ${new Date(`${day}T00:00:00`).getMonth() !== month ? "other" : ""}`}>
                      <div className="cal-dn">
                        <span>{Number(day.slice(8))}</span>
                        <button className="ghost cal-add" aria-label={`Add an event on ${label(day)}`} onClick={() => setAdding(day)}><Plus size={13} /></button>
                      </div>
                      {items.slice(0, 4).map(chip)}
                      {items.length > 4 && <button className="cal-more" onClick={() => { setMode("list"); }}>{items.length - 4} more</button>}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="cal-list">
              {listDays.map((d) => (
                <section key={d} className={`cal-ld ${d === today ? "today" : ""}`}>
                  <h2>{label(d)} <button className="ghost cal-add" aria-label={`Add an event on ${label(d)}`} onClick={() => setAdding(d)}><Plus size={14} /></button></h2>
                  {(byDay.get(d) ?? []).length ? (byDay.get(d) ?? []).map(chip) : <p className="muted">Nothing planned.</p>}
                </section>
              ))}
              <p className="muted cal-foot">Showing the next 8 weeks. Switch to Month to look further ahead.</p>
            </div>
          )}
        </div>
      </div>
      {adding && <NewEvent day={adding} onClose={() => setAdding(null)} onAdded={() => { void s.refreshTree(); void load(); }} />}
    </div>
  );
}

function NewEvent({ day, onClose, onAdded }: { day: string; onClose: () => void; onAdded: () => void }) {
  const s = useStore();
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState<DateVal | null>({ start: day });
  const [where, setWhere] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!title.trim() || !when?.start || busy) return;
    setBusy(true);
    try {
      const cal = s.eventsDbId ?? (await api.ensureCalendar()).id;
      await api.create({ parent_id: cal, title: title.trim(), props: { when, ...(where.trim() ? { where: where.trim() } : {}) } });
      s.toast("Event added");
      onAdded();
      onClose();
    } catch (e) { s.toast((e as Error).message); setBusy(false); }
  };
  return (
    <div className="modal-back" onMouseDown={onClose} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <form className="modal cal-form" role="dialog" aria-label="New event" onMouseDown={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <h3>New event</h3>
        <input autoFocus placeholder="What's happening?" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Event name" />
        <input placeholder="Where (optional)" value={where} onChange={(e) => setWhere(e.target.value)} aria-label="Where" />
        <DatePicker value={when} onChange={setWhen} />
        <div className="cal-form-actions">
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!title.trim() || !when?.start || busy}>Add event</button>
        </div>
      </form>
    </div>
  );
}
