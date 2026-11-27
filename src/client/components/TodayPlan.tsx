// Home as a daily plan (#13): one short list of what today is about: the next test, the study most worth doing (nextStudy,
// no model call), and what's due today or overdue. Tapping an item opens it. "Today's note" opens the daily note (#19,
// worker daily.ts).
import { useEffect, useMemo, useState } from "react";
import { api, type StudyDeck, type StudyExam, type StudyProgress, type StudySubject } from "../api";
import { useStore } from "../store";
import { ICalendar, IStudy } from "../ui-icons";
import { nextStudy } from "../study/coach";
import { activeSorted, type Task } from "./Tasks";
import { examLabel } from "./StudyEditors";
import { clockLabel } from "../time";

type Overview = { subjects: StudySubject[]; exams: StudyExam[]; decks: StudyDeck[]; progress: StudyProgress };
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function TodayPlan({ tasks }: { tasks: Task[] | null }) {
  const s = useStore();
  const today = useMemo(() => iso(new Date()), []);
  const [o, setO] = useState<Overview | null>(null);
  useEffect(() => { api.studyOverview(today).then(setO).catch(() => {}); }, [today, s.drill, s.quiz, s.explain]);

  const due = useMemo(() => activeSorted(tasks ?? []).filter((t) => t.deadline && t.deadline <= today).slice(0, 5), [tasks, today]);
  const plan = useMemo(() => {
    if (!o) return { study: null, test: null };
    const subjectOf = new Map(o.subjects.map((x) => [x.id, x]));
    const live = o.decks.filter((d) => !d.excluded && !d.done_at && !(d.subject_id && subjectOf.get(d.subject_id)?.done_at));
    const examFor = (d: StudyDeck) => {
      const e = d.exam_ids.map((id) => o.exams.find((x) => x.id === id)).filter((x): x is StudyExam => !!x && !x.done_at && !!x.exam_date && x.exam_date >= today).sort((a, b) => a.exam_date!.localeCompare(b.exam_date!))[0];
      return e ? { id: e.id, name: e.name, exam_date: e.exam_date } : null;
    };
    const study = nextStudy(live.map((d) => ({ id: d.id, title: d.title || "New page", score: o.progress.pages[d.id]?.score ?? null, last_at: o.progress.pages[d.id]?.last_at ?? null, exam: examFor(d) })), today, Date.now());
    const test = o.exams.filter((e) => !e.done_at && e.exam_date && e.exam_date >= today && !subjectOf.get(e.subject_id)?.done_at).sort((a, b) => a.exam_date!.localeCompare(b.exam_date!))[0] ?? null;
    return { study, test: test && examLabel(test.exam_date!, today).days <= 14 ? test : null };
  }, [o, today]);

  const openToday = async () => {
    try { const d = await api.daily(today); await s.refreshTree(); s.go(`/p/${d.id}`); } catch (e) { s.toast((e as Error).message); }
  };
  const nothing = !due.length && !plan.study && !plan.test;

  return (
    <section className="home-panel today-plan" aria-label="Today">
      <h3><ICalendar size={16} /> Today <button className="home-more ghost" onClick={() => void openToday()}>Today's note</button></h3>
      <ul className="tp-list">
        {plan.test && (
          <li className="tp-test">
            <span className="tp-ico"><IStudy size={16} /></span>
            <button className="tp-main" onClick={() => s.setPick({ kind: "exam", id: plan.test!.id })}><b>{plan.test.name}</b><small>{examLabel(plan.test.exam_date!, today).text}</small></button>
          </li>
        )}
        {plan.study && (
          <li>
            <span className="tp-ico"><IStudy size={16} /></span>
            <button className="tp-main" onClick={() => s.setPick(plan.study!.exam_id ? { kind: "exam", id: plan.study!.exam_id } : { kind: "page", id: plan.study!.id })}><b>Study {plan.study.title}</b><small>{plan.study.text}</small></button>
          </li>
        )}
        {due.map((t) => (
          <li key={t.id}>
            <span className="tp-ico"><span className={`tp-dot ${t.deadline! < today ? "late" : ""}`} /></span>
            <button className="tp-main" onClick={() => s.setPeek(t.id)}><b>{t.title || "Untitled"}</b><small>{t.deadline! < today ? "Overdue" : t.start_time && !t.end ? clockLabel(t.start_time) : "Due today"}</small></button>
          </li>
        ))}
        {nothing && o && tasks !== null && <li className="tp-empty">A clear day. Nothing's due and your studying is on track.</li>}
      </ul>
    </section>
  );
}
