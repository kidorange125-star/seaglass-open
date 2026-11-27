// Cards for what the assistant says on its own (the hourly check-in) and routine reports, shown in the conversation. Notes can be asked
// about with one tap; proposals change nothing until you tap Accept (and can be undone afterwards, like any change
// the assistant makes). Thumbs up/down tell the next check-in what is and isn't worth saying.
import { useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { CalendarClock, Check, CornerUpLeft, ListPlus, Sparkles, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { api, type InboxItem } from "../api";
import { useStore } from "../store";
import { JeffFace } from "../icons";
import { agentName } from "../persona";
import { refreshUnread } from "../proactive";
import { timeAgo } from "./ui";

const md = (s: string) => ({ __html: DOMPurify.sanitize(marked.parse(s, { async: false, breaks: true }) as string).replace(/<a /g, '<a target="_blank" rel="noopener noreferrer" ') });
const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const STATUS: Record<string, string> = { accepted: "Accepted", dismissed: "Dismissed", done: "Done" };

export function InboxList({ items, onAsk, onChange, showDone = false }: { items: InboxItem[]; onAsk: (prompt: string, label: string) => void; onChange: (next: InboxItem[]) => void; showDone?: boolean }) {
  const s = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const update = (id: string, patch: Partial<InboxItem>) => onChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const act = async (it: InboxItem, what: "accept" | "dismiss" | "done") => {
    setBusy(it.id);
    try {
      const r = await api.inboxAct(it.id, what, localDate());
      update(it.id, { status: what === "accept" ? "accepted" : what === "dismiss" ? "dismissed" : "done", action: { ...it.action, run_id: r.run_id ?? it.action?.run_id, note_ids: r.note_ids ?? it.action?.note_ids } });
      if (what === "accept") { s.toast(it.action?.proposal?.type === "flashcards" ? "Flashcards added" : it.action?.proposal?.type === "tidy" ? "Tidied up" : "Added to My tasks"); void s.refreshTree(); dispatchEvent(new CustomEvent("seaglass:agent-changed")); }
    } catch (e) { s.toast((e as Error).message); }
    setBusy(null); void refreshUnread();
  };
  const undo = async (it: InboxItem) => {
    if (!it.action?.run_id) return;
    try { const r = await api.undoRun(it.action.run_id, true); s.toast(r.ok ? "Undone" : r.error); void s.refreshTree(); dispatchEvent(new CustomEvent("seaglass:agent-changed")); } catch (e) { s.toast((e as Error).message); }
  };
  const vote = async (it: InboxItem, v: number) => { const next = it.feedback === v ? 0 : v; update(it.id, { feedback: next }); try { await api.inboxFeedback(it.id, next); } catch { /* keep it local */ } };
  const ask = (it: InboxItem) => { onAsk(it.action!.prompt!, it.title); if (it.status === "new") void act(it, "done"); };

  const shown = showDone ? items : items.filter((i) => i.status === "new");
  if (!shown.length) return null;
  return (
    <div className="inbox-list">
      {shown.map((it) => {
        const p = it.action?.proposal, live = it.status === "new";
        return (
          <div key={it.id} className={`inbox-card ${live ? "" : "old"} ${it.urgent && live ? "urgent" : ""}`}>
            <div className="ib-head">
              <span className="ib-icon">{it.source === "routine" ? <CalendarClock size={15} /> : <JeffFace size={16} />}</span>
              <b>{it.title}</b>
              <small>{it.urgent && live ? "Soon · " : ""}{timeAgo(it.created_at)}{!live && STATUS[it.status] ? ` · ${STATUS[it.status]}` : ""}</small>
            </div>
            {it.source === "routine" ? <div className="ib-body ag-md" dangerouslySetInnerHTML={md(it.body)} /> : <p className="ib-body">{it.body}</p>}
            {p?.type === "add_task" && <div className="ib-prop"><ListPlus size={14} /> {p.title}{p.due ? <small> · due {p.due}{p.time ? ` ${p.time}` : ""}</small> : null}</div>}
            {p?.type === "flashcards" && <div className="ib-prop"><Sparkles size={14} /> {p.cards.length} flashcards: {p.cards.slice(0, 2).map((c) => c.q).join(" · ")}{p.cards.length > 2 ? " …" : ""}</div>}
            {p?.type === "study_plan" && <div className="ib-prop"><ListPlus size={14} /> {p.title}: {p.sessions.map((x) => x.title).slice(0, 3).join(" · ")}{p.sessions.length > 3 ? " …" : ""}</div>}
            <div className="ib-actions">
              {live && p && <button className="primary" disabled={busy === it.id} onClick={() => void act(it, "accept")}><Check size={14} /> {p.type === "add_task" ? "Add task" : p.type === "study_plan" ? `Add ${p.sessions.length} study sessions` : p.type === "tidy" ? `Tidy up (${p.trash.length + p.moves.length})` : `Add ${p.cards.length} flashcards`}</button>}
              {live && !p && it.action?.prompt && <button className="primary" onClick={() => ask(it)}>Ask {agentName()}</button>}
              {it.status === "accepted" && it.action?.run_id && <button onClick={() => void undo(it)}><CornerUpLeft size={13} /> Undo</button>}
              {it.source === "routine" && it.action?.run_id && (it.action.note_ids?.length ?? 0) > 0 && <button onClick={() => void undo(it)}><CornerUpLeft size={13} /> Undo its changes</button>}
              {it.source === "routine" && it.action?.note_ids?.[0] && <button onClick={() => s.go(`/p/${it.action!.note_ids![0]}`)}>Open page</button>}
              {live && <button className="ghost" disabled={busy === it.id} onClick={() => void act(it, it.source === "routine" ? "done" : "dismiss")}>{it.source === "routine" ? <><Check size={14} /> Done</> : <><X size={14} /> Dismiss</>}</button>}
              <span className="grow" />
              {it.source === "checkin" && <>
                <button className={`ghost icon-btn ${it.feedback > 0 ? "on" : ""}`} title="Helpful" aria-pressed={it.feedback > 0} onClick={() => void vote(it, 1)}><ThumbsUp size={14} /></button>
                <button className={`ghost icon-btn ${it.feedback < 0 ? "on" : ""}`} title="Not helpful: it won't bring this up again" aria-pressed={it.feedback < 0} onClick={() => void vote(it, -1)}><ThumbsDown size={14} /></button>
              </>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
