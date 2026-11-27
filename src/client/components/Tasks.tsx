// The built-in to-do list ("My tasks"), modelled on Notion's My Tasks. It's an ordinary database underneath
// (created by the server, see ensureTasksDb), so Jeff, Claude, undo and sync all work on it as usual.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import { IBell, IClock, ICalendar, ICheckSquare, IDatabase, IFlag, IImage, IMore, IOpen, IPage, IPlus, ISearch, ITrash } from "../ui-icons";
import { CircleCheckBig as IDone } from "lucide-react";
import { committed, isTouch, settle, swipe } from "../gestures";
import { CoverPicker, Popover } from "./ui";
import { startFocus } from "./StudyTools";
import { OfflineQueued } from "../offline";
import { coverCss, randomCover } from "../covers";
import { clockLabel, isTime, takeTime, timeLabel } from "../time";
import { isRepeat, REPEAT_LABEL, REPEATS, rollRepeat, takeRepeat, type Repeat } from "../recur";
import { remindValue } from "../remind";
import type { Note } from "../types";
import { DatePicker, toDateVal, type DateVal } from "./DatePicker";

export interface Task {
  id: string; title: string; status: string; due: string | null; priority: string | null; tags: string[];
  /** Optional time window, "HH:MM". With an end day, end_time is the time on that day. */
  start_time: string | null; end_time: string | null;
  /** Last day of a task that runs over several days (after `due`, which is then its start), or null. */
  end: string | null;
  /** The day it's due: the end of a range over several days, else its date. Everything "due" or "overdue" uses this. */
  deadline: string | null;
  /** Repeating tasks move to their next date when completed. */
  repeat: Repeat | null;
  /** Own reminder setting (see remind.ts), "" for the default. */
  remind: string;
  props: Record<string, unknown>; updated_at: number;
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (n: number, from = new Date()) => { const d = new Date(from); d.setDate(d.getDate() + n); return iso(d); };
export const todayIso = () => iso(new Date());

const PRIORITY: Record<string, { label: string; cls: string }> = { high: { label: "High", cls: "tag-red" }, medium: { label: "Medium", cls: "tag-yellow" }, low: { label: "Low", cls: "tag-gray" } };
const TAGS: Record<string, { label: string; cls: string }> = { school: { label: "School", cls: "tag-blue" }, personal: { label: "Personal", cls: "tag-green" }, errands: { label: "Errands", cls: "tag-orange" } };

function toTask(n: Note): Task {
  let props: Record<string, unknown> = {};
  try { props = JSON.parse(n.props || "{}"); } catch { /* keep empty */ }
  const d = props.due as { start?: string; end?: string; start_time?: unknown; end_time?: unknown; remind?: unknown } | undefined;
  const due = d?.start?.slice(0, 10) ?? null;
  const start_time = due && isTime(d?.start_time) ? d.start_time : null;
  const end = due && typeof d?.end === "string" && d.end.slice(0, 10) > due ? d.end.slice(0, 10) : null;
  const end_time = start_time && isTime(d?.end_time) && (end || d.end_time > start_time) ? d.end_time : null;
  return { id: n.id, title: n.title, status: String(props.status ?? "todo"), due, start_time, end_time, end, deadline: end ?? due, repeat: isRepeat(props.repeat) ? props.repeat : null, remind: due ? remindValue(d?.remind) : "", priority: (props.priority as string) || null, tags: Array.isArray(props.tags) ? (props.tags as string[]) : [], props, updated_at: n.updated_at };
}

/** "Today", "Tomorrow", "Fri", "Nov 12"; overdue dates say how late they are. */
export function dueLabel(due: string, today = todayIso()) {
  const d = new Date(due + "T00:00:00");
  if (due === today) return { text: "Today", cls: "today" };
  if (due === addDays(1)) return { text: "Tomorrow", cls: "soon" };
  if (due === addDays(-1)) return { text: "Yesterday", cls: "overdue" };
  if (due < today) return { text: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }), cls: "overdue" };
  if (due <= addDays(6)) return { text: d.toLocaleDateString(undefined, { weekday: "long" }), cls: "soon" };
  return { text: d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" }), cls: "" };
}

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
/** Quick add: "Read chapter 4 fri 3-5pm #school !" -> title, due Friday 3-5 PM, tag School, high priority. */
export function parseQuickAdd(raw: string) {
  let text = ` ${raw.trim()} `; let due: string | null = null; let priority: string | null = null; const tags: string[] = [];
  const time = takeTime(text); text = time.text;
  const rep = takeRepeat(text); text = rep.text;
  text = text.replace(/\s!{1,3}(high)?(?=\s)/i, () => { priority = "high"; return " "; });
  text = text.replace(/\s#(\w+)(?=\s)/g, (m, t: string) => { const k = t.toLowerCase(); if (TAGS[k]) { tags.push(k); return " "; } return m; });
  // Date words count at the end ("Read ch 4 fri") or the start ("fri read ch 4").
  const dayAlt = DAYS.map((d) => `${d}|${d.slice(0, 3)}`).join("|");
  const words: [string, (w: string) => string][] = [
    ["today|tonight", () => addDays(0)], ["tomorrow|tmrw", () => addDays(1)], ["next week", () => addDays(7)],
    [dayAlt, (w) => { const want = DAYS.findIndex((d) => d.startsWith(w.toLowerCase().slice(0, 3))); return addDays(((want - new Date().getDay() + 7) % 7) || 7); }],
  ];
  outer: for (const [alt, f] of words) {
    for (const re of [new RegExp(`\\s(${alt})\\s*$`, "i"), new RegExp(`^\\s(${alt})(?=\\s)`, "i")]) {
      const m = re.exec(text);
      if (!m) continue;
      due = f(m[1]); text = text.slice(0, m.index) + " " + text.slice(m.index + m[0].length);
      break outer;
    }
  }
  // "every mon" starts on the next Monday (today if it's Monday); a time or a repeat with no day means today.
  if (rep.weekday !== null && !due) due = addDays((rep.weekday - new Date().getDay() + 7) % 7);
  if ((time.start_time || rep.repeat) && !due) due = addDays(0);
  return { title: text.replace(/\s+/g, " ").trim(), due, start_time: time.start_time, end_time: time.end_time, repeat: rep.repeat, priority, tags };
}

/** The due props for a day plus an optional window. */
const dueValue = (start: string, start_time?: string | null, end_time?: string | null, remind?: string, end?: string | null) => {
  const multi = !!end && end > start;
  return { start, ...(multi ? { end } : {}), ...(start_time ? { start_time } : {}), ...(start_time && end_time && (multi || end_time > start_time) ? { end_time } : {}), ...(remind ? { remind } : {}) };
};

/** Loads and edits the built-in to-do list. Rows reload whenever the sidebar tree changes (sync, Jeff, other tabs). */
export function useTasks() {
  const s = useStore();
  const dbId = s.tasksDbId;
  const [rows, setRows] = useState<Task[] | null>(null);
  const sig = useMemo(() => s.tree.filter((n) => n.parent_id === dbId).map((n) => n.id + n.updated_at).join(), [s.tree, dbId]);
  const load = useCallback(async () => {
    if (!dbId) return;
    try { setRows((await api.children(dbId)).filter((n) => !n.is_template).map(toTask)); } catch { /* keep what we have */ }
  }, [dbId]);
  useEffect(() => { void load(); }, [load, sig]);

  const save = async (t: Task, props: Record<string, unknown>) => {
    setRows((rs) => rs?.map((r) => (r.id === t.id ? toTask({ ...({} as Note), id: t.id, title: t.title, props: JSON.stringify(props), updated_at: Date.now() } as Note) : r)) ?? rs);
    try { await api.patch(t.id, { props }); await s.refreshTree(); } catch (e) { if (e instanceof OfflineQueued) return; s.toast((e as Error).message); void load(); }
  };
  return {
    dbId, rows,
    add: async (raw: string, extra: Partial<{ due: string | null }> = {}) => {
      if (!dbId) return;
      const q = parseQuickAdd(raw);
      if (!q.title) return;
      const due = extra.due !== undefined ? extra.due : q.due;
      const props: Record<string, unknown> = { status: "todo", ...(due ? { due: dueValue(due, q.start_time, q.end_time) } : {}), ...(q.priority ? { priority: q.priority } : {}), ...(q.repeat ? { repeat: q.repeat } : {}), ...(q.tags.length ? { tags: q.tags } : {}) };
      const n = await api.create({ parent_id: dbId, title: q.title, props });
      setRows((rs) => [...(rs ?? []), toTask(n)]);
      void s.refreshTree();
    },
    toggle: (t: Task) => {
      const props = { ...t.props, status: t.status === "done" ? "todo" : "done" };
      // A repeating task stays open and moves to its next date.
      const rolled = rollRepeat({ system: "tasks" }, props, todayIso());
      if (rolled) { s.toast(`Done. Next: ${dueLabel(rolled.next).text}`); return save(t, rolled.props); }
      return save(t, props);
    },
    setRepeat: (t: Task, repeat: Repeat | null) => {
      const p = { ...t.props };
      if (repeat) { p.repeat = repeat; if (!t.due) p.due = dueValue(todayIso()); } else delete p.repeat;
      return save(t, p);
    },
    // Today / Tomorrow / Next week move the DUE day and keep the time. A task that starts earlier keeps its start when
    // that's still before the new due day; otherwise it becomes a one-day task. Clearing the day clears everything.
    setDue: (t: Task, due: string | null) => {
      const p = { ...t.props };
      if (!due) { delete p.due; return save(t, p); }
      const keepStart = !!t.end && !!t.due && t.due < due;
      p.due = keepStart ? dueValue(t.due!, t.start_time, t.end_time, t.remind, due) : dueValue(due, t.start_time, t.end ? null : t.end_time, t.remind);
      return save(t, p);
    },
    /** The whole date value from the date picker (DatePicker.tsx), or null to clear it. */
    setDueValue: (t: Task, v: DateVal | null) => {
      const p = { ...t.props };
      if (v) p.due = v; else delete p.due;
      return save(t, p);
    },
    setPriority: (t: Task, priority: string | null) => { const p = { ...t.props }; if (priority) p.priority = priority; else delete p.priority; return save(t, p); },
    remove: async (t: Task) => { setRows((rs) => rs?.filter((r) => r.id !== t.id) ?? rs); await api.trash(t.id); await s.refreshTree(); s.toast("Task moved to Trash"); },
  };
}

type Api = ReturnType<typeof useTasks>;

/** Active tasks in the order you'd do them: overdue, today, then by date, then undated. */
export function activeSorted(rows: Task[]) {
  const key = (t: Task) => `${t.deadline ?? "9999"} ${t.end ? "99:99" : t.start_time ?? "99:99"}`;
  return rows.filter((t) => t.status !== "done").sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : (a.priority === "high" ? -1 : 0) - (b.priority === "high" ? -1 : 0));
}

export function TaskRow({ t, api: A, compact = false }: { t: Task; api: Api; compact?: boolean }) {
  const s = useStore();
  const [menu, setMenu] = useState(false);
  const [when, setWhen] = useState(false);
  const done = t.status === "done";
  const today = todayIso();
  // A task over several days is due on its last day: its label and colour come from that day, with the start before
  // it until it has started.
  const d = t.deadline ? dueLabel(t.deadline) : null;
  const startL = t.end && t.due && t.due > today ? dueLabel(t.due) : null;
  const tl = t.end ? (t.end_time ? clockLabel(t.end_time) : "") : timeLabel(t);
  // Phones: swipe right to complete, swipe all the way left to move to Trash (Reminders-style).
  const wrap = useRef<HTMLDivElement>(null), row = useRef<HTMLDivElement>(null);
  const live = useRef({ t, A }); live.current = { t, A };
  useEffect(() => {
    const w = wrap.current, r = row.current;
    if (!w || !r || !isTouch()) return;
    const mark = (d: number) => { w.classList.toggle("sw-right", d > 0); w.classList.toggle("sw-left", d < 0); w.style.setProperty("--sw", String(Math.min(1, Math.abs(d) / (w.offsetWidth * (d > 0 ? 0.28 : 0.5))))); };
    const reset = () => { w.classList.remove("swiping", "sw-right", "sw-left"); w.style.removeProperty("--sw"); };
    return swipe(r, {
      axis: "x", dir: 0,
      canStart: (_x, e) => !(e.target as Element).closest?.("input:not([type=checkbox]), .popover"),
      onStart: () => w.classList.add("swiping"),
      onMove: (d) => { r.style.transform = `translateX(${d}px)`; mark(d); },
      onEnd: (d, v) => {
        const width = w.offsetWidth, { t: task, A: api } = live.current;
        if (d > 0 && committed(d, v, width, 1, 0.28)) { settle(r, "none", reset); void api.toggle(task); return; }
        if (d < 0 && committed(d, v, width, -1, 0.5)) { settle(r, `translateX(${-width}px)`, () => { reset(); void api.remove(task); }, 220); return; }
        settle(r, "none", reset);
      },
    });
  }, []);
  return (
    <div className={`task-wrap ${compact ? "compact" : ""}`} ref={wrap}>
    <div className="task-act" aria-hidden><span className="ta-done"><IDone size={18} /> {done ? "Not done" : "Done"}</span><span className="ta-del"><ITrash size={18} /> Trash</span></div>
    <div ref={row} className={`task ${done ? "done" : ""} ${t.status === "doing" ? "doing" : ""}`}>
      {/* The label gives the small box a full 44pt tap area on phones (Apple HIG). */}
      <label className="task-hit"><input type="checkbox" className="task-check" checked={done} aria-label={done ? `Mark "${t.title}" not done` : `Mark "${t.title}" done`} onChange={() => void A.toggle(t)} /></label>
      {!compact && <span className="task-ico"><IPage size={18} /></span>}
      {/* Phones: the title wraps and the date/tags sit on a line under it (Apple Reminders style). */}
      <div className="task-main">
        <a className="task-title" href={`#/p/${t.id}`} onClick={(e) => { if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); s.setPeek(t.id); }}>{t.title || "New task"}{t.status === "doing" && !compact && <span className="task-doing">In progress</span>}</a>
        <div className="task-meta">
          {t.status === "doing" && !compact && <span className="task-doing-meta">In progress</span>}
          {!compact && t.tags.map((g) => TAGS[g] && <span key={g} className={`chip sm ${TAGS[g].cls}`}>{TAGS[g].label}</span>)}
          {t.priority && PRIORITY[t.priority] && !done && <span className={`chip sm ${PRIORITY[t.priority].cls}`}>{PRIORITY[t.priority].label}</span>}
          <span className="rel task-when">
            <button className={`task-due ${d?.cls ?? "none"}`} title="Set a date and time" onClick={() => setWhen(!when)}>
              {d ? <>{startL && <>{startL.text}<span className="task-arrow" aria-label="to">→</span></>}{t.end && !startL && <span className="task-due-word">Due </span>}{d.text}{tl && <span className="task-time">{tl}</span>}{t.repeat && <span className="task-repeat" title={`Repeats ${REPEAT_LABEL[t.repeat].toLowerCase()}`} aria-label={`Repeats ${REPEAT_LABEL[t.repeat].toLowerCase()}`}>↻</span>}{t.remind && t.remind !== "none" && <span className="task-bell" title="Reminder set" aria-label="Reminder set"><IBell size={13} /></span>}</> : <ICalendar size={16} />}
            </button>
            {when && <WhenPopover t={t} api={A} onClose={() => setWhen(false)} />}
          </span>
        </div>
      </div>
      {!compact && (
        <span className="rel task-more">
          <button className="ghost icon-btn" title="More" onClick={() => setMenu(!menu)}><IMore size={18} /></button>
          {menu && (
            <Popover onClose={() => setMenu(false)} className="task-menu">
              {/* One way to set a date: the date picker (DatePicker.tsx), not a second list of days here. */}
              <button onClick={() => { setMenu(false); setWhen(true); }}><ICalendar size={18} /> {t.deadline ? "Change due date" : "Add a due date"}</button>
              <div className="mp-sep" />
              <div className="mp-title">Priority</div>
              {(["high", "medium", "low"] as const).map((p) => <button key={p} onClick={() => { setMenu(false); void A.setPriority(t, t.priority === p ? null : p); }}><IFlag size={18} /> {PRIORITY[p].label}{t.priority === p ? " ✓" : ""}</button>)}
              <div className="mp-sep" />
              <button onClick={() => { setMenu(false); startFocus(t.title, t.id); }}><IClock size={18} /> Focus for 25 min</button>
              <button onClick={() => { setMenu(false); s.go(`/p/${t.id}`); }}><IOpen size={18} /> Open as page</button>
              <button className="danger" onClick={() => { setMenu(false); void A.remove(t); }}><ITrash size={18} /> Delete</button>
            </Popover>
          )}
        </span>
      )}
    </div>
    </div>
  );
}

/** When a task is due (and, if wanted, when it starts and at what time): the shared date picker, plus Repeat. */
export function WhenPopover({ t, api: A, onClose }: { t: Task; api: Api; onClose: () => void }) {
  return (
    <Popover onClose={onClose} className="when-pop">
      <DatePicker tasks value={toDateVal(t.props.due)} onChange={(v) => void A.setDueValue(t, v)}>
        <label className="dp-row"><span>Repeat</span>
          <select value={t.repeat ?? ""} onChange={(e) => void A.setRepeat(t, (e.target.value || null) as Repeat | null)}>
            <option value="">Never</option>
            {REPEATS.map((r) => <option key={r} value={r}>{REPEAT_LABEL[r]}</option>)}
          </select>
        </label>
      </DatePicker>
    </Popover>
  );
}

/** "+ New task" that turns into an input, like Notion. Enter adds and keeps the input open for the next one. */
export function QuickAdd({ api: A, autoFocus = false, placeholder = "New task" }: { api: Api; autoFocus?: boolean; placeholder?: string }) {
  const [v, setV] = useState("");
  const [open, setOpen] = useState(autoFocus);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) ref.current?.focus(); }, [open]);
  useEffect(() => {
    const h = () => setOpen(true);
    addEventListener("seaglass:new-task", h); return () => removeEventListener("seaglass:new-task", h);
  }, []);
  if (!open) return <button className="task-add" onClick={() => setOpen(true)}><IPlus size={18} /> {placeholder}</button>;
  const q = parseQuickAdd(v);
  return (
    <div className="task-add editing">
      <IPlus size={18} />
      <input ref={ref} value={v} placeholder="Task name, then 'fri', '3-5pm', 'every mon', #school or !"
        onChange={(e) => setV(e.target.value)} onBlur={() => { if (!v.trim()) setOpen(false); }}
        onKeyDown={(e) => { if (e.key === "Enter" && v.trim()) { void A.add(v); setV(""); } if (e.key === "Escape") { setV(""); setOpen(false); } }} />
      {(q.due || q.priority || q.tags.length > 0) && <span className="task-parse">{q.due && dueLabel(q.due).text}{q.start_time && ` ${timeLabel(q)}`}{q.repeat && ` · ${REPEAT_LABEL[q.repeat]}`}{q.priority && " · High"}{q.tags.map((t) => ` · ${TAGS[t].label}`)}</span>}
    </div>
  );
}


/** My tasks' cover lives on the tasks database itself, so its full database page shows the same one. */
function useTasksCover(dbId: string | null) {
  const s = useStore();
  const [cover, setCover] = useState<string | null>(null);
  useEffect(() => {
    if (!dbId) return;
    let live = true;
    api.get(dbId).then((n) => { if (live) setCover(n.cover); }).catch(() => {});
    const h = (e: Event) => { const d = (e as CustomEvent<{ id: string; note: Note }>).detail; if (d?.id === dbId) setCover(d.note.cover); };
    addEventListener("seaglass:note-patched", h);
    return () => { live = false; removeEventListener("seaglass:note-patched", h); };
  }, [dbId]);
  const save = async (next: string | null) => {
    if (!dbId) return;
    const before = cover;
    setCover(next);
    try { await api.patch(dbId, { cover: next }); } catch (e) { setCover(before); s.toast((e as Error).message); }
  };
  return [cover, save] as const;
}

/** The My tasks page (#/tasks), laid out like Notion's My Tasks: a plain title, a view pill, quiet tools
 *  and a blue New task button, then one flat list sorted by due date with "+ New task" at the end. */
export function TasksView() {
  const s = useStore();
  const A = useTasks();
  const [tab, setTab] = useState<"todo" | "done">("todo");
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const active = useMemo(() => activeSorted(A.rows ?? []), [A.rows]);
  const done = useMemo(() => (A.rows ?? []).filter((t) => t.status === "done").sort((a, b) => b.updated_at - a.updated_at), [A.rows]);
  const match = (t: Task) => !q.trim() || t.title.toLowerCase().includes(q.trim().toLowerCase());
  const list = (tab === "todo" ? active : done).filter(match);
  const [cover, setCover] = useTasksCover(A.dbId);
  const [coverPop, setCoverPop] = useState(false);

  return (
    <div className="page tasks-page">
      <div className="topbar">
        <div className="crumbs"><span className="cur"><ICheckSquare size={16} /> My tasks</span></div>
        <div className="actions" />
      </div>
      <div className="scroll">
        {cover && (
          <div className="cover" style={{ background: coverCss(cover) }}>
            <div className="cover-actions rel">
              <button onClick={() => setCoverPop(true)}>Change cover</button>
              {coverPop && <CoverPicker current={cover} onPick={(c) => void setCover(c)} onRemove={() => void setCover(null)} onClose={() => setCoverPop(false)} />}
            </div>
          </div>
        )}
        <div className={`body ${cover ? "has-cover" : ""}`}>
          {!cover && A.dbId && (
            <div className="head-actions">
              <button className="ghost" onClick={() => void setCover(randomCover())}><IImage size={18} /> Add cover</button>
            </div>
          )}
          <h1 className="title tasks-title">My tasks</h1>
          <div className="tasks-bar">
            <div className="tabs">
              <button className={`tab ${tab === "todo" ? "on" : ""}`} onClick={() => setTab("todo")}><ICheckSquare size={16} /> To do</button>
              <button className={`tab ${tab === "done" ? "on" : ""}`} onClick={() => setTab("done")}><IDone size={16} /> Done</button>
            </div>
            <div className="tools">
              {searching
                ? <input className="tasks-search" autoFocus placeholder="Search tasks…" value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => { if (!q) setSearching(false); }} onKeyDown={(e) => { if (e.key === "Escape") { setQ(""); setSearching(false); } }} />
                : <button className="ghost icon-btn" title="Search" onClick={() => setSearching(true)}><ISearch size={18} /></button>}
              {A.dbId && <button className="ghost icon-btn" title="Board, calendar and all properties" onClick={() => s.go(`/p/${A.dbId}`)}><IDatabase size={18} /></button>}
              <button className="primary" onClick={() => { setTab("todo"); window.dispatchEvent(new Event("seaglass:new-task")); }}>New task</button>
            </div>
          </div>
          <div className="task-list flat">
            {list.map((t) => <TaskRow key={t.id} t={t} api={A} />)}
            {tab === "todo" && <QuickAdd api={A} />}
            {A.rows !== null && !list.length && tab === "done" && <p className="tasks-empty">{q ? "No finished tasks match." : "Finished tasks show up here."}</p>}
            {A.rows !== null && !list.length && tab === "todo" && q && <p className="tasks-empty">No tasks match.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
