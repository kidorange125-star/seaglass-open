// A daily note's live part (#19, worker daily.ts): that day's tasks, tickable, a quick add, and "Wrap up my day" (the
// assistant adds three short lines to the note; it does this by itself at 9:30 PM too). The note below is ordinary text.
import { useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import { JeffAvatar } from "../icons";
import { agentName } from "../persona";
import { QuickAdd, TaskRow, useTasks } from "./Tasks";

export function DailyPanel({ id, date }: { id: string; date: string }) {
  const s = useStore();
  const tasks = useTasks();
  const [busy, setBusy] = useState(false);
  const rows = (tasks.rows ?? []).filter((t) => t.due === date || (t.end && t.due && t.due <= date && t.end >= date));
  const wrap = async () => {
    setBusy(true);
    try {
      const r = await api.dailyWrap(id, date);
      if (!r) s.toast("Nothing to add");
      else { dispatchEvent(new CustomEvent("seaglass:agent-changed")); s.toast(`${agentName()} wrapped up your day`, { label: "Undo", run: () => void api.undoRun(r.run_id, true).then(() => dispatchEvent(new CustomEvent("seaglass:agent-changed"))) }); }
    } catch (e) { s.toast((e as Error).message); }
    setBusy(false);
  };
  return (
    <section className="daily-panel" aria-label="This day">
      <div className="dp-head"><b>{rows.length ? `${rows.length} task${rows.length === 1 ? "" : "s"} this day` : "No tasks this day"}</b>
        <button className="ghost" disabled={busy} onClick={() => void wrap()}><JeffAvatar size={18} mode={busy ? "think" : undefined} /> {busy ? "Wrapping up…" : "Wrap up my day"}</button>
      </div>
      {tasks.dbId && <div className="task-list compact">
        {rows.map((t) => <TaskRow key={t.id} t={t} api={tasks} compact />)}
        <QuickAdd api={tasks} />
      </div>}
    </section>
  );
}
