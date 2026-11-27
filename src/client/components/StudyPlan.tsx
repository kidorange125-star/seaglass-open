// A study plan for a test, on its StudyPick screen. The assistant drafts sessions from today to the day before (worker
// coach.ts `planForExam`, one Haiku call, a plain spread if that fails); the user looks them over, drops any the user doesn't want, and
// adds the rest to My tasks as dated tasks (reminders for the ones with a time), undoable as one change. Open straight
// away for a test the user just created; otherwise a "Plan study sessions" row.
import { useState } from "react";
import { CalendarPlus, X } from "lucide-react";
import { api, type StudyExam } from "../api";
import { useStore } from "../store";
import { JeffAvatar } from "../icons";
import { agentName } from "../persona";
import { daysUntil, type PlanSession } from "../study/coach";

type Step = "closed" | "offer" | "loading" | "review" | "adding" | "added";
const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const timeLabel = (t: string) => new Date(`2000-01-01T${t}:00`).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const inDays = (n: number) => (n === 1 ? "tomorrow" : `in ${n} days`);

export function StudyPlan({ exam, today, fresh }: { exam: StudyExam; today: string; fresh: boolean }) {
  const s = useStore();
  const [step, setStep] = useState<Step>(fresh ? "offer" : "closed");
  const [plan, setPlan] = useState<{ sessions: PlanSession[]; drafted: boolean } | null>(null);
  const [err, setErr] = useState("");
  const days = exam.exam_date ? daysUntil(today, exam.exam_date) : -1;
  if (!exam.exam_date || exam.done_at || days < 1) return null;
  const changed = () => dispatchEvent(new CustomEvent("seaglass:agent-changed"));

  const make = async () => {
    setStep("loading"); setErr("");
    try { const r = await api.examPlan(exam.id); setPlan({ sessions: r.sessions, drafted: r.drafted }); setStep("review"); }
    catch (e) { setErr((e as Error).message); setStep(fresh ? "offer" : "closed"); }
  };
  const add = async () => {
    if (!plan?.sessions.length) return;
    setStep("adding"); setErr("");
    try {
      const r = await api.addPlan(plan.sessions);
      setStep("added"); changed();
      const n = plan.sessions.length;
      s.toast(`Added ${n} study session${n === 1 ? "" : "s"} to My tasks`, { label: "Undo", run: () => void api.undoRun(r.run_id, true).then(() => { setStep("review"); changed(); }) });
    } catch (e) { setErr((e as Error).message); setStep("review"); }
  };
  const drop = (k: number) => setPlan((p) => p && { ...p, sessions: p.sessions.filter((_, j) => j !== k) });

  if (step === "closed") return (
    <button className="pk-plan-open" onClick={() => void make()}>
      <CalendarPlus size={18} /><span className="t"><b>Plan study sessions</b><small>Spread out before {exam.name}, {inDays(days)}</small></span>
      {err && <small className="when-err">{err}</small>}
    </button>
  );
  return (
    <section className="pk-plan" aria-label="Study plan">
      {step === "offer" && <>
        <div className="pk-plan-top"><JeffAvatar size={40} /><p><b>{exam.name} is {inDays(days)}.</b> Want study sessions spread out before it? {agentName()} puts your weakest pages first.</p></div>
        {err && <p className="when-err">{err}</p>}
        <div className="pk-plan-actions"><button onClick={() => setStep("closed")}>Not now</button><button className="primary" onClick={() => void make()}>Plan my sessions</button></div>
      </>}
      {step === "loading" && <div className="pk-plan-top"><JeffAvatar size={40} mode="think" /><p><b>Planning your sessions…</b> Weakest pages first, a light review the day before.</p></div>}
      {(step === "review" || step === "adding") && plan && <>
        <div className="pk-plan-top"><JeffAvatar size={40} /><p><b>{plan.sessions.length ? `${plan.sessions.length} session${plan.sessions.length === 1 ? "" : "s"} before ${dayLabel(exam.exam_date)}` : "No sessions left"}</b>
          {plan.drafted ? ` ${agentName()} couldn't plan this one, so here's a simple spread. Give them times in My tasks to get reminders.` : " Each one with a time gets a reminder. Remove any that don't work."}</p></div>
        <ol className="pk-plan-list">
          {plan.sessions.map((x, k) => (
            <li key={`${x.date}-${k}`}>
              <span className="d"><b>{dayLabel(x.date)}</b>{x.time && <small>{timeLabel(x.time)}</small>}</span>
              <span className="t">{x.title.startsWith(`${exam.name}: `) ? x.title.slice(exam.name.length + 2).replace(/^./, (c) => c.toUpperCase()) : x.title}</span>
              <button className="st-act" aria-label={`Remove ${x.title}`} title="Remove" disabled={step === "adding"} onClick={() => drop(k)}><X size={16} /></button>
            </li>
          ))}
        </ol>
        {err && <p className="when-err">{err}</p>}
        <div className="pk-plan-actions">
          <button disabled={step === "adding"} onClick={() => { setPlan(null); setStep("closed"); }}>Cancel</button>
          <button className="primary" disabled={step === "adding" || !plan.sessions.length} onClick={() => void add()}>{step === "adding" ? "Adding…" : `Add ${plan.sessions.length} to My tasks`}</button>
        </div>
      </>}
      {step === "added" && <div className="pk-plan-top"><JeffAvatar size={40} /><p><b>They're in My tasks.</b> {plan?.sessions.some((x) => x.time) ? "You'll get a reminder before each one." : "Add times there to get reminders."}</p></div>}
    </section>
  );
}
