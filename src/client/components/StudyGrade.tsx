// "How did it go?": once a test's date has passed, the Study tab asks for the grade the user got. Saving puts it in Grades (the
// subject as the class, category Test), marks the test done and keeps what practice predicted beside it (worker study.ts
// logGrade), so over time the app learns how well practice scores predict real ones. Skip marks it done with no grade.
import { useState } from "react";
import { X } from "lucide-react";
import { api, type StudyExam, type StudySubject } from "../api";
import { useStore } from "../store";
import { cleanGrade, gradeVsPractice, isGraded } from "../study/coach";

const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });

export function GradeAsk({ exam, subject, onChanged, onClose }: { exam: StudyExam; subject?: StudySubject; onChanged: () => void; onClose: () => void }) {
  const s = useStore();
  const [score, setScore] = useState("");
  const [outof, setOutof] = useState("100");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const got = cleanGrade(score, outof);
  const changed = () => { dispatchEvent(new CustomEvent("seaglass:agent-changed")); onChanged(); };
  const undo = async () => { try { await api.clearGrade(exam.id); changed(); } catch (e) { s.toast((e as Error).message); } };

  const save = async (skip: boolean) => {
    setBusy(true); setErr("");
    try {
      await api.logGrade(exam.id, skip ? { skip: true } : { score, outof });
      changed();
      if (skip) { s.toast(`${exam.name} is done`, { label: "Undo", run: () => void undo() }); onClose(); }
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const g = exam.grade;
  if (isGraded(g)) return ( // just saved: what it means, then it goes away
    <section className="st-grade done" aria-label={`Grade for ${exam.name}`}>
      <span className={`st-grade-pct ${g.pct >= 80 ? "great" : g.pct >= 50 ? "ok" : "low"}`}>{Math.round(g.pct)}%</span>
      <p><b>{exam.name}: saved to Grades.</b> {gradeVsPractice(g.pct, g.practice)}</p>
      <button className="ghost" onClick={() => void undo()}>Undo</button>
      <button className="st-act" aria-label="Close" title="Close" onClick={onClose}><X size={16} /></button>
    </section>
  );
  return (
    <form className="st-grade" aria-label={`How did ${exam.name} go?`} onSubmit={(e) => { e.preventDefault(); if (got && !busy) void save(false); }}>
      <p>{subject && <i className={`st-dot c-${subject.color}`} />}<b>How did {exam.name} go?</b> It was {exam.exam_date ? dayLabel(exam.exam_date) : "recently"}. Add your grade to see how it compares with your practice.</p>
      <div className="st-grade-row">
        <input inputMode="decimal" placeholder="Score" aria-label="Your score" value={score} onChange={(e) => setScore(e.target.value)} />
        <span>out of</span>
        <input inputMode="decimal" aria-label="Out of" value={outof} onChange={(e) => setOutof(e.target.value)} />
        {got && <small>{got.pct}%</small>}
        <span className="sp" />
        <button type="button" className="ghost" disabled={busy} onClick={() => void save(true)}>Skip</button>
        <button type="submit" className="primary" disabled={!got || busy}>{busy ? "Saving…" : "Save to Grades"}</button>
      </div>
      {err && <p className="when-err">{err}</p>}
    </form>
  );
}
