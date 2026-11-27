// The screen for choosing how to study: a test, one page, or a whole subject. Shows how it's going and when it's graded,
// suggests the way of studying that would help most (`bestMode`, no model call), lets you narrow it to some pages, and
// lists every way to study with your last score in each. A full-screen .study overlay; the games open on top of it and
// come back here when they end.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { History, Layers, ListChecks, MessageCircle, Pencil, PenLine, Puzzle, Sparkles, TextCursorInput, Wand2 } from "lucide-react";
import { api, type PastSummary, type StudyDeck, type StudyExam, type StudyProgress, type StudySubject } from "../api";
import { useStore, type PickTarget } from "../store";
import { JeffAvatar } from "../icons";
import { IClose } from "../ui-icons";
import { agentName } from "../persona";
import { jeffModel } from "./AiTools";
import { todayIso } from "./Tasks";
import { bestMode, pctOf, type SessionMode } from "../study/coach";
import { examLabel, ExamEditor, level, SubjectMark } from "./StudyEditors";
import { StudyPlan } from "./StudyPlan";
import { outlookLine } from "../grades";

type Overview = { subjects: StudySubject[]; exams: StudyExam[]; decks: StudyDeck[]; progress: StudyProgress };
type Mode = "quiz" | "test" | "explain" | "blanks" | "match" | "cards" | "chat";
const NAMES: Record<Mode, string> = { quiz: "Quiz", test: "Practice test", explain: "Explain it", blanks: "Fill in the blanks", match: "Match", cards: "Flashcards", chat: "Chat" };
const ICONS: Record<Mode, React.ReactNode> = { quiz: <ListChecks size={20} />, test: <Sparkles size={20} />, explain: <PenLine size={20} />, blanks: <TextCursorInput size={20} />, match: <Puzzle size={20} />, cards: <Layers size={20} />, chat: <MessageCircle size={20} /> };

/** "What do I need on this test?" (#10): from the subject's class in Grades (worker hub.ts), for a test still ahead. */
function NeedLine({ subjectId, exam, today }: { subjectId: string; exam: StudyExam; today: string }) {
  const [line, setLine] = useState("");
  useEffect(() => {
    if (!exam.exam_date || exam.exam_date < today || exam.done_at) return;
    let on = true;
    api.subjectHub(subjectId, today).then((h) => {
      const o = h.next?.outlook, avg = h.average;
      if (on && o && avg?.pct != null && avg.letter) setLine(outlookLine({ pct: avg.pct, letter: avg.letter, keep: o.keep, up: o.up }, exam.name));
    }).catch(() => {});
    return () => { on = false; };
  }, [subjectId, exam.id, exam.exam_date, exam.done_at, exam.name, today]);
  return line ? <p className="pk-need">{line}</p> : null;
}

export function StudyPick({ target }: { target: PickTarget }) {
  const s = useStore();
  const today = useMemo(todayIso, []);
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [past, setPast] = useState<PastSummary[]>([]);
  const [off, setOff] = useState<Set<string>>(new Set()); // pages left out of this session
  const [edit, setEdit] = useState(false);
  const [making, setMaking] = useState<{ done: number; total: number } | null>(null);
  const store = useRef(s); store.current = s;
  const close = useCallback(() => store.current.setPick(null), []);

  // a failed reload (offline, say) keeps what's on screen; only a first load with nothing to show says so
  const load = useCallback(() => api.studyOverview(today).then(setData).catch((e) => setData((d) => { if (!d) setError((e as Error).message); return d; })), [today]);
  useEffect(() => { void load(); }, [load, s.drill, s.quiz, s.explain, s.studyId, s.studyChat, s.past]); // again when a session ends
  useEffect(() => { addEventListener("seaglass:agent-changed", load); return () => removeEventListener("seaglass:agent-changed", load); }, [load]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelectorAll(".study").length > 1 || document.querySelector(".popover")) return; // a game or menu on top gets it
      e.preventDefault(); close();
    };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  }, [close]);

  const exam = target.kind === "exam" ? data?.exams.find((e) => e.id === target.id) ?? null : null;
  const page = target.kind === "page" ? data?.decks.find((d) => d.id === target.id) ?? null : null;
  const subject = data?.subjects.find((x) => x.id === (target.kind === "subject" ? target.id : exam?.subject_id ?? page?.subject_id)) ?? null;
  const missing = !!data && (target.kind === "exam" ? !exam : target.kind === "page" ? !page : !subject);
  useEffect(() => { if (missing) close(); }, [missing, close]);

  const progress = data?.progress;
  const scoreOf = useCallback((d: StudyDeck) => progress?.pages[d.id]?.score ?? -1, [progress]);
  const pages = useMemo(() => {
    const list = !data ? [] : exam ? data.decks.filter((d) => exam.page_ids.includes(d.id) && !d.excluded) : page ? [page] : data.decks.filter((d) => d.subject_id === subject?.id && !d.excluded && !d.done_at);
    return [...list].sort((a, b) => scoreOf(a) - scoreOf(b) || b.updated_at - a.updated_at);
  }, [data, exam, page, subject, scoreOf]);
  const chosen = pages.filter((d) => !off.has(d.id));
  const allKey = pages.map((d) => d.id).join();
  useEffect(() => { if (allKey) api.studyHistory(allKey.split(",")).then((r) => setPast(r.sessions)).catch(() => {}); }, [allKey, s.drill, s.quiz, s.explain, s.past]);

  const title = exam?.name ?? page?.title ?? subject?.name ?? "";
  const shownTitle = title || "New page";
  const date = exam ? exam.exam_date
    : page ? (data?.exams.filter((e) => page.exam_ids.includes(e.id) && !e.done_at && e.exam_date && e.exam_date >= today).map((e) => e.exam_date!).sort()[0] ?? subject?.exam_date ?? null)
    : subject?.exam_date ?? null;
  const label = date ? examLabel(date, today) : null;
  const scores = chosen.map((d) => progress?.pages[d.id]?.score).filter((x): x is number => typeof x === "number");
  const average = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const best = bestMode(average, label ? label.days : null);
  const practised = pages.filter((d) => progress?.pages[d.id]).length;
  const cards = chosen.reduce((n, d) => n + d.cards, 0), due = chosen.reduce((n, d) => n + d.due, 0);

  const lastOf = useMemo(() => {
    const m = new Map<SessionMode, number>();
    for (const p of past) if (!m.has(p.mode) && p.total) m.set(p.mode, pctOf(p)); // newest first
    return m;
  }, [past]);

  const start = (m: Mode) => {
    if (!chosen.length) return;
    const ids = chosen.map((d) => d.id), name = chosen.length === pages.length ? shownTitle : chosen.length === 1 ? chosen[0].title || "New page" : `${shownTitle} (${chosen.length} pages)`;
    if (m === "cards") s.setStudy(ids.length === 1 && target.kind === "page" ? ids[0] : { ids, title: name, dueOnly: due > 0 });
    else if (m === "test") s.setQuiz(ids);
    else if (m === "explain") s.setExplain({ ids, title: name, nonce: Date.now() });
    else if (m === "chat") s.setStudyChat({ ids, title: name, nonce: Date.now() });
    else s.setDrill({ ids, title: name, mode: m, nonce: Date.now() });
  };

  // The assistant writes flashcards onto each page, one at a time; one Undo takes them all back off.
  const makeCards = async () => {
    if (making || !chosen.length) return;
    setMaking({ done: 0, total: chosen.length });
    const runs: string[] = []; let added = 0, failed = "";
    for (const d of chosen) {
      try { const r = await api.aiCards(d.id, jeffModel()); added += r.added; if (r.run_id) runs.push(r.run_id); }
      catch (e) { failed = (e as Error).message; }
      setMaking((m) => m && { ...m, done: m.done + 1 });
    }
    setMaking(null);
    const changed = () => { dispatchEvent(new CustomEvent("seaglass:agent-changed")); void store.current.refreshTree(); };
    changed();
    if (added) s.toast(`${agentName()} added ${added} flashcard${added === 1 ? "" : "s"}${failed ? `, but one page failed: ${failed}` : ""}`, { label: "Undo", run: () => void Promise.all(runs.map((r) => api.undoRun(r, true))).then(changed) });
    else s.toast(failed || "No new flashcards: the ones already there cover it");
  };

  const toggle = (id: string) => setOff((o) => { const n = new Set(o); if (!n.delete(id)) n.add(id); return n; });
  const row = (m: Mode, blurb: string) => {
    const last = lastOf.get(m as SessionMode);
    return (
      <button key={m} className="st-mode" disabled={!chosen.length} onClick={() => start(m)}>
        <span className="i">{ICONS[m]}</span>
        <span className="t"><b>{NAMES[m]}</b><small>{blurb}</small></span>
        {last !== undefined && <span className={`sh-score ${level(last)}`} title={`Your last score here: ${last}%`}>{last}%</span>}
      </button>
    );
  };

  return (
    <div className="study study-picker" role="dialog" aria-label={`Study ${shownTitle}`}>
      <div className="study-top">
        <button className="ghost icon-btn" aria-label="Close (Esc)" title="Close (Esc)" onClick={close}><IClose size={20} /></button>
        <div className="study-title"><b>How do you want to study?</b></div>
        <span className="study-count">
          {exam && subject && <span className="rel">
            <button className="ghost icon-btn" aria-label="Edit test" title="Edit test" onClick={() => setEdit((v) => !v)}><Pencil size={17} /></button>
            {edit && data && <ExamEditor subject={subject} exam={exam} decks={data.decks} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); void load(); }} onDeleted={close} />}
          </span>}
        </span>
      </div>
      <div className="study-stage drill-end">
        {error ? <p className="study-empty">Couldn't load this: {error}</p> : !data ? <div className="study-pick"><div className="st-skel" /></div> : (
          <div className="study-pick">
            <header className={`pk-head c-${subject?.color ?? "blue"}`}>
              {subject && <SubjectMark subject={subject} big />}
              <div className="t">
                <h1>{shownTitle}</h1>
                <p>{exam && subject ? `${subject.name} · ` : page && subject ? `${subject.name} · ` : ""}<span className={label?.soon ? "st-exam soon" : ""}>{label ? label.text : "No date set"}</span></p>
              </div>
              {average !== null && <span className={`st-ring big ${level(average)}`} style={{ "--p": average } as React.CSSProperties} title="From your recent results"><span>{average}%</span></span>}
            </header>

            {exam && subject && <NeedLine subjectId={subject.id} exam={exam} today={today} />}
            {exam && pages.length > 0 && <StudyPlan exam={exam} today={today} fresh={!!target.fresh} />}

            {pages.length > 1 && (
              <section className="pk-scope" aria-label="Pages to study">
                <div className="st-bars">{pages.map((d) => { const x = progress?.pages[d.id]?.score; return <i key={d.id} className={typeof x === "number" ? level(x) : ""} />; })}</div>
                <p className="pk-note">{practised ? `${practised} of ${pages.length} pages practised. ` : "Not practised yet. "}Tap a page to leave it out.</p>
                <div className="pk-chips">{pages.map((d) => { const x = progress?.pages[d.id]?.score; return <button key={d.id} aria-pressed={!off.has(d.id)} className={off.has(d.id) ? "" : "on"} onClick={() => toggle(d.id)}>{d.title || "New page"}{typeof x === "number" && <small>{x}%</small>}</button>; })}</div>
              </section>
            )}
            {!pages.length && <div className="st-empty"><b>Nothing to study yet</b><p>{exam ? "Add the pages this test covers with the pencil above." : "Add a page to this subject first."}</p></div>}

            {chosen.length > 0 && (
              <button className="pk-best" onClick={() => start(best.mode)}>
                <JeffAvatar size={40} />
                <span className="t"><small>{agentName()} suggests</small><b>{NAMES[best.mode]}</b><span>{best.why}</span></span>
                <span className="pk-go">Start</span>
              </button>
            )}

            {pages.length > 0 && <>
              <section className="pk-group"><h2>Test yourself</h2><div className="st-modes">
                {row("quiz", "Pick the right answer, and see why")}
                {row("test", "Choice and written, graded at the end")}
                {row("explain", `Say it in your own words; ${agentName()} points out what's off`)}
              </div></section>
              <section className="pk-group"><h2>Practise</h2><div className="st-modes">
                {row("blanks", "Type the missing word")}
                {row("match", "Pair them, beat the clock")}
                {row("cards", due ? `${due} due now` : cards ? `${cards} card${cards === 1 ? "" : "s"}` : "None yet")}
              </div></section>
              <section className="pk-group"><h2>Talk it through</h2><div className="st-modes">
                {row("chat", `Study by talking with ${agentName()}`)}
              </div></section>
              <section className="pk-group"><h2>More</h2><div className="st-modes">
                <button className="st-mode" disabled={!!making || !chosen.length} onClick={() => void makeCards()}><span className="i"><Wand2 size={20} /></span><span className="t"><b>{cards ? "More flashcards" : "Make flashcards"}</b><small>{making ? `Writing ${Math.min(making.done + 1, making.total)} of ${making.total}…` : `${agentName()} writes them`}</small></span></button>
                <button className="st-mode" onClick={() => s.setPast({ ids: pages.map((d) => d.id), title: shownTitle })}><span className="i"><History size={20} /></span><span className="t"><b>History</b><small>Look back and retake</small></span></button>
              </div></section>
            </>}

            {target.kind === "page" && page && <a className="pk-open" href={`#/p/${page.id}`} onClick={close}>Open the page</a>}
          </div>
        )}
      </div>
    </div>
  );
}
