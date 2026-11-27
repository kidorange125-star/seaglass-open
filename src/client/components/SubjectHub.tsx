// A subject as a class hub (#9) with "what do I need on this test?" (#10): on the subject's screen in the Study tab, its
// class in Grades (linked by name, or picked here), the class average and recent grades, and what the next test needs to
// keep or raise the letter. Homework stays in My tasks. Data: worker hub.ts.
import { useCallback, useEffect, useState } from "react";
import { api, type StudySubject } from "../api";
import { useStore } from "../store";
import { level } from "./StudyEditors";

type Hub = Awaited<ReturnType<typeof api.subjectHub>>;
const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function SubjectHub({ subject, today }: { subject: StudySubject; today: string }) {
  const s = useStore();
  const [hub, setHub] = useState<Hub | null>(null);
  const load = useCallback(() => api.subjectHub(subject.id, today).then(setHub).catch(() => {}), [subject.id, today]);
  useEffect(() => { void load(); }, [load, subject.grade_class]);
  useEffect(() => { addEventListener("seaglass:agent-changed", load); addEventListener("focus", load); return () => { removeEventListener("seaglass:agent-changed", load); removeEventListener("focus", load); }; }, [load]);

  const link = async (v: string) => { try { await api.updateSubject(subject.id, { grade_class: v || null }); await load(); } catch (e) { s.toast((e as Error).message); } };
  if (!hub) return null;
  const avg = hub.average;

  return (
    <div className="sh-hub">
      <section className="sh-card sh-grades" aria-label={`${subject.name} grades`}>
        <div className="sh-card-head"><b>Grades</b>
          {hub.classes.length > 0 && <select aria-label="Class in Grades" value={hub.linked ? hub.class?.id ?? "" : ""} onChange={(e) => void link(e.target.value)}>
            <option value="">{hub.class && !hub.linked ? `Class: ${hub.class.name}` : "Class with the same name"}</option>
            {hub.classes.map((o) => <option key={o.id} value={o.id}>Class: {o.name}</option>)}
          </select>}
        </div>
        {avg && avg.pct !== null ? <>
          <div className="sh-avg"><span className={`sh-big ${level(avg.pct)}`}>{avg.pct}%</span><b>{avg.letter}</b><small>{avg.graded} graded</small></div>
          {hub.next?.outlook && <p className="sh-need">{hub.next.outlook.line}</p>}
          <ul className="sh-glist">{hub.grades.map((g) => <li key={g.id}><button onClick={() => s.setPeek(g.id)}><span className="t">{g.title}</span><small>{g.date ? dayLabel(g.date) : ""}</small><b className={level(g.pct)}>{Math.round(g.pct)}%</b></button></li>)}</ul>
        </> : <p className="sh-empty">{hub.class ? `Nothing graded in ${hub.class.name} yet.` : `No grades for ${subject.name} yet. The grade you log after a test shows up here.`}</p>}
      </section>
    </div>
  );
}
