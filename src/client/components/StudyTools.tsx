// Study helpers: the grade summary above the Grades database, the study streak, a focus (Pomodoro) timer, and
// the weekly review screen (#/review, also opened by the Sunday notification).
import { useEffect, useMemo, useRef, useState } from "react";
import { Flame, Pause, Play, RotateCcw, Timer, X } from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";
import { PageIcon } from "../icons";
import { ICheckSquare } from "../ui-icons";
import { dueLabel, todayIso, useTasks, type Task } from "./Tasks";
import type { DbSchema, Note } from "../types";
import { classAverages, letter } from "../grades";
import { agentName } from "../persona";

// ---------------------------------------------------------------- grades
export function GradeSummary({ schema, rows }: { schema: DbSchema; rows: Note[] }) {
  const cls = schema.properties.find((p) => p.id === "class");
  const parsed = useMemo(() => rows.filter((r) => !r.is_template).map((r) => { try { return { props: JSON.parse(r.props || "{}") as Record<string, unknown> }; } catch { return { props: {} }; } }), [rows]);
  const list = classAverages(parsed, (id) => cls?.options?.find((o) => o.id === id)?.name ?? "");
  const all = classAverages(parsed.map((r) => ({ props: { ...r.props, class: "all" } })), () => "Overall")[0];
  if (!list.length) return <div className="grade-summary empty">Add an assignment below with a score and what it was out of (or ask {agentName()}: "add my Algebra test, 45 out of 50"). Each class's average shows up here.</div>;
  return (
    <div className="grade-summary">
      {list.map((c) => (
        <div key={c.name} className="grade-card">
          <span className="gc-class">{c.name}</span>
          <span className="gc-pct">{c.pct.toFixed(1)}%<b className={`gc-letter l-${letter(c.pct)[0]}`}>{letter(c.pct)}</b></span>
          <small>{c.n} graded</small>
        </div>
      ))}
      {list.length > 1 && all && <div className="grade-card overall"><span className="gc-class">Overall</span><span className="gc-pct">{all.pct.toFixed(1)}%<b className={`gc-letter l-${letter(all.pct)[0]}`}>{letter(all.pct)}</b></span><small>{all.n} graded</small></div>}
    </div>
  );
}

// ---------------------------------------------------------------- streak
const tzOffset = () => new Date().getTimezoneOffset();
export function useStreak(refresh?: unknown) {
  const [s, set] = useState<{ streak: number; today: boolean; dates: string[] } | null>(null);
  useEffect(() => { api.studyStreak(todayIso(), tzOffset()).then(set).catch(() => set(null)); }, [refresh]);
  return s;
}
export function StreakBadge({ streak, today }: { streak: number; today: boolean }) {
  if (!streak) return null;
  return <span className={`streak ${today ? "" : "at-risk"}`} title={today ? "You've studied today" : "Study today to keep your streak"}><Flame size={14} /> {streak}-day streak{today ? "" : " · study today to keep it"}</span>;
}

// ---------------------------------------------------------------- focus timer
/** study: what is being studied (from the Home plan), so a finished round counts as study time (a "focus" session). */
interface Focus { title: string; taskId: string | null; study?: { ids: string[]; title: string } | null; mode: "focus" | "break"; endsAt: number | null; left: number; rounds: number }
const KEY = "sg.focus";
const FOCUS_MS = 25 * 60_000, BREAK_MS = 5 * 60_000;
const load = (): Focus | null => { try { return JSON.parse(localStorage.getItem(KEY) ?? "null"); } catch { return null; } };
const save = (f: Focus | null) => { try { if (f) localStorage.setItem(KEY, JSON.stringify(f)); else localStorage.removeItem(KEY); } catch { /* storage unavailable */ } };

/** Start the focus timer (25 minutes) on a task or anything else. */
export const startFocus = (title: string, taskId: string | null = null, study: { ids: string[]; title: string } | null = null) => dispatchEvent(new CustomEvent("seaglass:focus", { detail: { title, taskId, study } }));

function chime() {
  try {
    const ctx = new AudioContext();
    [0, 0.18, 0.36].forEach((t, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = [660, 880, 990][i]; o.type = "sine";
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.5);
      o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.55);
    });
  } catch { /* no audio */ }
}
async function notify(title: string, body: string) {
  try {
    if (Notification.permission !== "granted") return;
    const reg = await navigator.serviceWorker?.getRegistration("/");
    await reg?.showNotification(title, { body, icon: "/icon-192.png", tag: "focus" });
  } catch { /* not supported */ }
}

export function FocusTimer() {
  const s = useStore();
  const [f, setF] = useState<Focus | null>(load);
  const [, tick] = useState(0);
  // the end time of the round already handled: two ticks (or two intervals while React re-mounts) never finish the same round twice
  const fired = useRef<number | null>(null);
  const set = (next: Focus | null) => { save(next); setF(next); };
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent<{ title: string; taskId: string | null; study?: { ids: string[]; title: string } | null }>).detail; set({ title: d.title || "Focus", taskId: d.taskId, study: d.study ?? null, mode: "focus", endsAt: Date.now() + FOCUS_MS, left: FOCUS_MS, rounds: 0 }); };
    addEventListener("seaglass:focus", on); return () => removeEventListener("seaglass:focus", on);
  }, []);
  useEffect(() => {
    if (!f?.endsAt) return;
    const t = setInterval(() => {
      tick((x) => x + 1);
      if (f.endsAt && Date.now() >= f.endsAt && fired.current !== f.endsAt) {
        fired.current = f.endsAt;
        chime();
        if (f.mode === "focus") {
          void notify("Focus session done", `Nice work on “${f.title}”. Take a 5 minute break.`);
          s.toast("Focus session done. Break time");
          if (f.study?.ids.length) void api.studySession({ mode: "focus", ids: f.study.ids, title: f.study.title, right: 0, total: 0, missed: [], seconds: Math.round(FOCUS_MS / 1000) }, false).catch(() => {}); // counts as study time
          set({ ...f, mode: "break", endsAt: Date.now() + BREAK_MS, left: BREAK_MS, rounds: f.rounds + 1 });
        } else {
          void notify("Break's over", `Ready for another round on “${f.title}”?`);
          s.toast("Break's over");
          set({ ...f, mode: "focus", endsAt: null, left: FOCUS_MS });
        }
      }
    }, 500);
    return () => clearInterval(t);
  }, [f]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!f) return null;
  const left = f.endsAt ? Math.max(0, f.endsAt - Date.now()) : f.left;
  const mm = String(Math.floor(left / 60_000)).padStart(2, "0"), ss = String(Math.floor((left % 60_000) / 1000)).padStart(2, "0");
  const total = f.mode === "focus" ? FOCUS_MS : BREAK_MS;
  return (
    <div className={`focus-pill ${f.mode}`} role="timer" aria-label={`${f.mode === "focus" ? "Focus" : "Break"}: ${mm}:${ss} left`}>
      <span className="fp-ring" style={{ "--p": String(1 - left / total) } as React.CSSProperties}><Timer size={15} /></span>
      <span className="fp-text"><b>{mm}:{ss}</b><small>{f.mode === "focus" ? f.title : "Break"}{f.rounds ? ` · ${f.rounds} done` : ""}</small></span>
      {f.endsAt
        ? <button className="ghost icon-btn" aria-label="Pause" onClick={() => set({ ...f, endsAt: null, left })}><Pause size={16} /></button>
        : <button className="ghost icon-btn" aria-label="Start" onClick={() => set({ ...f, endsAt: Date.now() + f.left })}><Play size={16} /></button>}
      <button className="ghost icon-btn" aria-label="Restart" onClick={() => set({ ...f, endsAt: Date.now() + total, left: total })}><RotateCcw size={15} /></button>
      <button className="ghost icon-btn" aria-label="Stop the timer" onClick={() => set(null)}><X size={16} /></button>
    </div>
  );
}

// ---------------------------------------------------------------- weekly review
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export function ReviewView() {
  const s = useStore();
  const A = useTasks();
  const today = todayIso();
  const [cards, setCards] = useState<{ id: string; title: string; icon: string | null; due: number }[]>([]);
  const [recent, setRecent] = useState<{ id: string; title: string; icon: string | null; kind: string; updated_at: number }[]>([]);
  const streak = useStreak();
  useEffect(() => {
    api.studyDue(today).then(setCards).catch(() => setCards([]));
    api.recent().then((r) => setRecent((r as (typeof recent[number] & { parent_id?: string | null })[]).filter((n) => Date.now() - n.updated_at < 7 * 86_400_000 && s.byId.get(n.parent_id ?? "")?.kind !== "database").slice(0, 10))).catch(() => setRecent([]));
  }, [today]);
  const open = (A.rows ?? []).filter((t) => t.status !== "done");
  const overdue = open.filter((t) => t.deadline && t.deadline < today);
  const week = open.filter((t) => t.deadline && t.deadline >= today && t.deadline < addDays(today, 7)).sort((a, b) => `${a.deadline}${a.start_time ?? ""}`.localeCompare(`${b.deadline}${b.start_time ?? ""}`));
  const undated = open.filter((t) => !t.due);
  const finish = () => { try { localStorage.setItem("sg.review.last", today); } catch { /* storage */ } s.toast("Weekly review done. Have a good week!"); s.go("/"); };
  const row = (t: Task, fixes: boolean) => (
    <div key={t.id} className="rv-task">
      <button className="rv-check" aria-label={`Mark "${t.title}" done`} onClick={() => void A.toggle(t)}><ICheckSquare size={18} /></button>
      <button className="rv-title" onClick={() => s.setPeek(t.id)}>{t.title || "New task"}<small>{t.deadline ? dueLabel(t.deadline).text : "No date"}</small></button>
      {fixes && <span className="rv-moves">
        <button onClick={() => void A.setDue(t, today)}>Today</button>
        <button onClick={() => void A.setDue(t, addDays(today, 1))}>Tomorrow</button>
        <button onClick={() => void A.setDue(t, addDays(today, 7))}>Next week</button>
      </span>}
    </div>
  );
  return (
    <div className="page review-page">
      <div className="topbar"><div className="crumbs"><span className="cur">Weekly review</span></div><div className="actions" /></div>
      <div className="scroll">
        <div className="review">
          <h1>Weekly review</h1>
          <p className="rv-lead">A few minutes to clear what slipped, see what's coming, and keep your studying on track.{streak?.streak ? <> <StreakBadge {...streak} /></> : null}</p>
          <section><h3>Overdue <span className="rv-n">{overdue.length}</span></h3>
            {overdue.length ? overdue.map((t) => row(t, true)) : <p className="rv-empty">Nothing overdue.</p>}</section>
          <section><h3>Next 7 days <span className="rv-n">{week.length}</span></h3>
            {week.length ? week.map((t) => row(t, false)) : <p className="rv-empty">Nothing due this week.</p>}</section>
          {undated.length > 0 && <section><h3>No date yet <span className="rv-n">{undated.length}</span></h3>{undated.slice(0, 8).map((t) => row(t, true))}</section>}
          <section><h3>Flashcards to review <span className="rv-n">{cards.reduce((n, c) => n + c.due, 0)}</span></h3>
            {cards.length ? cards.map((c) => <button key={c.id} className="study-due" onClick={() => s.setStudy(c.id)}><PageIcon icon={c.icon} kind="page" size={18} /><span className="t">{c.title || "New page"}</span><span className="n">{c.due} due</span></button>) : <p className="rv-empty">All caught up.</p>}</section>
          {recent.length > 0 && <section><h3>You worked on</h3>{recent.map((n) => <a key={n.id} className="rv-page" href={`#/p/${n.id}`}><PageIcon icon={n.icon} kind={n.kind as "page"} size={18} /> {n.title || "New page"}</a>)}</section>}
          <button className="primary rv-done" onClick={finish}>Finish review</button>
        </div>
      </div>
    </div>
  );
}
