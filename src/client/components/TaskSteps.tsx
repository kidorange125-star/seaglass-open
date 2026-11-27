// Steps for a big assignment (#20), under a task's properties in My tasks: the steps it has (each a task of its own, tick to
// finish), and "Break into steps": the assistant drafts them with dates up to the due date (worker steps.ts), the user removes any,
// and the rest are added as linked tasks, undoable as one change.
import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";
import { JeffAvatar } from "../icons";
import { agentName } from "../persona";
import { jeffModel } from "./AiTools";
import type { Step } from "../steps";

type Have = { id: string; title: string; done: boolean; due: string | null };
const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const timeLabel = (t: string) => new Date(`2000-01-01T${t}:00`).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function TaskSteps({ id, done }: { id: string; done: boolean }) {
  const s = useStore();
  const [have, setHave] = useState<Have[] | null>(null);
  const [draft, setDraft] = useState<Step[] | null>(null);
  const [busy, setBusy] = useState<"" | "drafting" | "adding">("");
  const [err, setErr] = useState("");
  const load = useCallback(() => api.steps(id).then((r) => setHave(r.steps)).catch(() => setHave([])), [id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { addEventListener("seaglass:agent-changed", load); return () => removeEventListener("seaglass:agent-changed", load); }, [load]);
  const changed = () => { dispatchEvent(new CustomEvent("seaglass:agent-changed")); void s.refreshTree(); };

  const make = async () => {
    setBusy("drafting"); setErr("");
    try { setDraft((await api.stepsDraft(id, jeffModel())).steps); } catch (e) { setErr((e as Error).message); }
    setBusy("");
  };
  const add = async () => {
    if (!draft?.length) return;
    setBusy("adding"); setErr("");
    try {
      const r = await api.stepsAdd(id, draft);
      setDraft(null); changed(); void load();
      s.toast(`Added ${r.note_ids.length} step${r.note_ids.length === 1 ? "" : "s"} to My tasks`, { label: "Undo", run: () => void api.undoRun(r.run_id, true).then(() => { changed(); void load(); }) });
    } catch (e) { setErr((e as Error).message); }
    setBusy("");
  };
  const tick = async (x: Have) => {
    try {
      const n = await api.get(x.id);
      const props = { ...JSON.parse(n.props || "{}"), status: x.done ? "todo" : "done" };
      await api.patch(x.id, { props, revision: n.revision });
      setHave((h) => h?.map((y) => (y.id === x.id ? { ...y, done: !x.done } : y)) ?? h); changed();
    } catch (e) { s.toast((e as Error).message); }
  };

  if (have === null) return null;
  const left = have.filter((x) => !x.done).length;
  return (
    <section className="tsteps" aria-label="Steps">
      {have.length > 0 && <>
        <div className="tsteps-head"><b>Steps</b><small>{left ? `${left} of ${have.length} left` : "All done"}</small></div>
        <ul className="tsteps-list">{have.map((x) => (
          <li key={x.id} className={x.done ? "done" : ""}>
            <input type="checkbox" checked={x.done} aria-label={`${x.title}: ${x.done ? "done" : "not done"}`} onChange={() => void tick(x)} />
            <button className="tsteps-open" onClick={() => s.setPeek(x.id)}>{x.title}</button>
            {x.due && <small>{dayLabel(x.due)}</small>}
          </li>
        ))}</ul>
      </>}
      {draft ? (
        <div className="tsteps-draft">
          <p><JeffAvatar size={22} /> {draft.length} step{draft.length === 1 ? "" : "s"}. Remove any that don't fit; each becomes a task with its date.</p>
          <ol>{draft.map((x, k) => (
            <li key={k}>
              <span className="d">{x.date ? <><b>{dayLabel(x.date)}</b>{x.time && <small>{timeLabel(x.time)}</small>}</> : <small>No date</small>}</span>
              <span className="t">{x.title}</span>
              <button className="st-act" aria-label={`Remove ${x.title}`} disabled={!!busy} onClick={() => setDraft((d) => d && d.filter((_, j) => j !== k))}><X size={15} /></button>
            </li>
          ))}</ol>
          {err && <p className="when-err">{err}</p>}
          <div className="tsteps-actions">
            <button disabled={!!busy} onClick={() => setDraft(null)}>Cancel</button>
            <button className="primary" disabled={!!busy || !draft.length} onClick={() => void add()}>{busy === "adding" ? "Adding…" : `Add ${draft.length} step${draft.length === 1 ? "" : "s"}`}</button>
          </div>
        </div>
      ) : !done && (
        <div className="tsteps-actions start">
          <button disabled={!!busy} onClick={() => void make()}>{busy === "drafting" ? <><JeffAvatar size={18} mode="think" /> Breaking it down…</> : have.length ? "Add more steps" : `Break into steps with ${agentName()}`}</button>
          {err && <span className="when-err">{err}</span>}
        </div>
      )}
    </section>
  );
}
