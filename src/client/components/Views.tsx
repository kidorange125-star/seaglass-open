import { useEffect, useState } from "react";
import { coverCss } from "../covers";
import { clockLabel, timeLabel } from "../time";
import { CalendarClock, Trash2 } from "lucide-react";
import { IArrowUp, ICheckSquare, IClock, IPlus } from "../ui-icons";
import { QuickAdd, TaskRow, activeSorted, useTasks } from "./Tasks";
import { api } from "../api";
import { useStore } from "../store";
import { myName } from "../me";
import { JeffFace, PageIcon } from "../icons";
import { Chip } from "../db/Cells";
import { timeAgo } from "./ui";
import type { TreeNode } from "../types";
import { agentName } from "../persona";
import { TodayPlan } from "./TodayPlan";

type HomeData = Awaited<ReturnType<typeof api.home>>;

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const shift = (s: string, n: number) => { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n); return iso(d); };

function dueLabel(due: string, today: string): { text: string; cls: string } {
  const d = new Date(due + "T00:00:00");
  if (due < today) return { text: `Overdue · ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`, cls: "overdue" };
  if (due === today) return { text: "Today", cls: "today" };
  if (due === shift(today, 1)) return { text: "Tomorrow", cls: "soon" };
  if (due <= shift(today, 6)) return { text: `${d.toLocaleDateString(undefined, { weekday: "short" })} ${d.getDate()}`, cls: "soon" };
  return { text: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }), cls: "" };
}

/** A soft pastel taken from an emoji's own colours (like Notion's tinted card tops). Cached per emoji. */
const tintCache = new Map<string, string>();
function emojiTint(emoji: string | null | undefined): string | null {
  if (!emoji) return null;
  if (tintCache.has(emoji)) return tintCache.get(emoji)!;
  let out: string | null = null;
  try {
    const c = document.createElement("canvas"); c.width = c.height = 24;
    const g = c.getContext("2d", { willReadFrequently: true })!;
    g.font = '20px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; g.textBaseline = "middle"; g.textAlign = "center";
    g.fillText(emoji, 12, 13);
    const d = g.getImageData(0, 0, 24, 24).data; let r = 0, gr = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3]; if (a < 160) continue;
      const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
      if (mx - mn < 24) continue; // skip greys and outlines; we want the emoji's colour
      r += d[i]; gr += d[i + 1]; b += d[i + 2]; n++;
    }
    if (n > 8) { const mix = (v: number) => Math.round(v / n * 0.22 + 255 * 0.78); out = `rgb(${mix(r)}, ${mix(gr)}, ${mix(b)})`; }
  } catch { /* no canvas: fall back to grey */ }
  tintCache.set(emoji, out!);
  return out;
}

export function Home() {
  const s = useStore();
  const [data, setData] = useState<HomeData | null>(null);
  const [ask, setAsk] = useState("");
  const tasks = useTasks();
  useEffect(() => { api.home().then(setData).catch(() => setData({ recent: [], upcoming: [] })); }, [s.tree]);

  const now = new Date();
  const h = now.getHours();
  const greeting = h < 5 ? "Burning the midnight oil" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const today = iso(now);
  const recent = (data?.recent ?? []).filter((n) => n.id !== s.tasksDbId);
  const upcoming = (data?.upcoming ?? []).filter((u) => u.db_id !== s.tasksDbId && u.due >= shift(today, -7) && u.due <= shift(today, 14)).slice(0, 6);
  const myTasks = activeSorted(tasks.rows ?? []).slice(0, 6);
  const askJeff = () => { const q = ask.trim(); if (!q) return; s.setAgentOpen(true); setTimeout(() => window.dispatchEvent(new CustomEvent("seaglass:agent-ask", { detail: q })), 60); setAsk(""); };

  return (
    <div className="home">
      <header className="hero">
        <h1>{myName() ? `${greeting}, ${myName()}` : greeting}</h1>
      </header>

      <form className="home-ask" onSubmit={(e) => { e.preventDefault(); askJeff(); }}>
        <JeffFace size={22} />
        <input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder={`Ask ${agentName()} anything, or say what to make…`} aria-label={`Ask ${agentName()}`} />
        <button className="home-ask-send" disabled={!ask.trim()} title={`Ask ${agentName()}`}><IArrowUp size={16} /></button>
      </form>

      <TodayPlan tasks={tasks.rows} />

      <section className="home-panel">
        <h3><IClock size={16} /> Recently visited</h3>
        <div className="jcards">
          {!data && [0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton jcard-skel" />)}
          {recent.map((n) => {
            const tint = n.cover ? null : emojiTint(n.icon);
            return (
              <a key={n.id} href={`#/p/${n.id}`} className="jcard">
                <div className={`jband ${n.cover ? "has-cover" : ""}`} style={n.cover ? { background: coverCss(n.cover) } : tint ? { background: tint } : undefined} />
                <span className="jicon"><PageIcon icon={n.icon} kind={n.kind} size={26} /></span>
                <b>{n.title || "New page"}</b>
                <small>{timeAgo(n.updated_at)}</small>
              </a>
            );
          })}
          {data && <button className="jcard jnew" onClick={() => void s.newPage()}><span className="jicon"><IPlus size={22} /></span><b>New page</b></button>}
        </div>
      </section>

      {tasks.dbId && (
        <section className="home-panel home-tasks">
          <h3><ICheckSquare size={16} /> My tasks <a className="home-more" href="#/tasks">View all</a></h3>
          <div className="task-list compact">
            {myTasks.map((t) => <TaskRow key={t.id} t={t} api={tasks} compact />)}
            {tasks.rows !== null && !myTasks.length && <p className="up-empty">Nothing to do right now.</p>}
            <QuickAdd api={tasks} />
          </div>
        </section>
      )}

      {upcoming.length > 0 && (
        <section className="home-panel upcoming">
          <h3><CalendarClock size={16} /> Upcoming</h3>
          <ul>
            {upcoming.map((u) => {
              const d = dueLabel(u.due, today);
              return (
                <li key={u.id}>
                  <a href={`#/p/${u.id}`} onClick={(e) => { if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); s.setPeek(u.id); }}>
                    <span className={`due ${d.cls}`}>{d.text}{u.end
                      ? <small className="due-time">{u.start_time ? `${clockLabel(u.start_time)} ` : ""}→ {dueLabel(u.end, today).text}{u.end_time ? ` ${clockLabel(u.end_time)}` : ""}</small>
                      : u.start_time && <small className="due-time">{timeLabel(u)}</small>}</span>
                    <span className="ut"><b>{u.title}</b><small><PageIcon icon={u.db_icon} kind="database" size={12} /> {u.db_title}{u.status && <Chip o={u.status} small />}</small></span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

export function Trash() {
  const s = useStore();
  const [items, setItems] = useState<(TreeNode & { deleted_at: number })[]>([]);
  const load = () => api.trashList().then(setItems).catch(() => {});
  useEffect(() => { void load(); }, []);
  return (
    <div className="home">
      <div className="hero"><h1>Trash</h1><p>Pages stay here until you delete them forever. Restoring a page brings its sub-pages back too.</p></div>
      {items.length > 0 && <button className="danger" onClick={async () => { if (await s.confirm("Permanently delete everything in the trash? This can't be undone.")) { await api.emptyTrash(); void load(); s.toast("Trash emptied"); } }}><Trash2 size={15} /> Empty trash</button>}
      {items.length > 0 && (
        <div className="trash-list">
          {items.map((n) => (
            <div key={n.id} className="trash-row">
              <span className="ico"><PageIcon icon={n.icon} kind={n.kind} /></span><b>{n.title || "New page"}</b><small>deleted {timeAgo(n.deleted_at)}</small>
              <button onClick={async () => { await api.restore(n.id); await s.refreshTree(); void load(); s.toast("Restored"); }}>Restore</button>
              <button className="danger" onClick={async () => { if (await s.confirm("Delete this forever?")) { await api.purge(n.id); void load(); } }}>Delete forever</button>
            </div>
          ))}
        </div>
      )}
      {!items.length && <div className="empty-state"><Trash2 size={34} /><b>The trash is empty</b><span>Deleted pages will show up here.</span></div>}
    </div>
  );
}
