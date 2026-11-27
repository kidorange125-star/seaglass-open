// The Study tab (#/study). At the top, the one thing most worth doing next and how the week is going. Below that subjects
// are folders (a colour and an emoji); open one to see its tests (a name, a date and the pages each covers) and any pages
// not in a test. Tapping a test or a page opens StudyPick, the screen for choosing how to study it. Scores, the streak and
// "last studied" come from finished sessions (worker/coach.ts `progress`), not the flashcard schedule. In the code a test
// is an "exam", because a Practice test is a way of studying. The assistant manages all this too (agent.ts). Data: worker/study.ts.
import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpenCheck, Camera, Check, Mic, CheckCircle2, ChevronLeft, Clock3, EyeOff, Folder, History, Layers, ListChecks, MoreHorizontal, Pencil, PenLine, Pin, Plus, Puzzle, RotateCcw, Sparkles, TextCursorInput, X } from "lucide-react";
import { CHANGED, dropUnfinished, keepUnfinished, resumeAt, unfinished, type Unfinished } from "../study/resume";
import type { StudySet } from "../study/generated";
import { isGraded, practiceGap, type TestQuestion } from "../study/coach";
import { GradeAsk } from "./StudyGrade";
import { SubjectHub } from "./SubjectHub";
import { SyllabusDialog } from "./SyllabusDialog";
import { LectureRecorder } from "./LectureRecorder";
import { api, type PastSummary, type StudyDeck, type StudyExam, type StudyProgress, type StudySubject } from "../api";
import { useStore, type PickTarget } from "../store";
import { JeffAvatar, PageIcon } from "../icons";
import { useStreak } from "./StudyTools";
import { Popover, timeAgo } from "./ui";
import { agentName } from "../persona";
import { nextStudy, pctOf, type PageProgress, type SessionMode } from "../study/coach";
import { examLabel, ExamEditor, level, PagePicker, SubjectEditor, SubjectMark } from "./StudyEditors";

const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const SEL_KEY = "sg.study.subject";
const NO_PROGRESS: StudyProgress = { pages: {}, week: { sessions: 0, avg: null }, recent: [] };
const PAST_ICON: Partial<Record<SessionMode, React.ReactNode>> = { quiz: <ListChecks size={18} />, blanks: <TextCursorInput size={18} />, match: <Puzzle size={18} />, test: <Sparkles size={18} />, explain: <PenLine size={18} /> };
const MODE_WORD: Record<SessionMode, string> = { cards: "Flashcards", quiz: "Quiz", blanks: "Fill in the blanks", match: "Match", test: "Practice test", explain: "Explain it", chat: "Chat", focus: "Focus" };
const MISSED_TITLE = "Missed questions"; // the title worker/misses.ts gives a review round
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
type Data = { subjects: StudySubject[]; exams: StudyExam[]; decks: StudyDeck[]; progress: StudyProgress; misses?: { open: number; due: number } };

function average(ids: string[], progress: StudyProgress) {
  const scores = ids.map((id) => progress.pages[id]?.score).filter((x): x is number => typeof x === "number");
  return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
}

export function StudyTab() {
  const s = useStore();
  const streak = useStreak(`${!!s.drill}${!!s.quiz}${!!s.explain}${!!s.studyId}${!!s.studyChat}`); // again when a session ends
  const today = useMemo(todayIso, []);
  const [data, setData] = useState<Data | null>(null);
  const [view, setViewState] = useState<string>(() => { try { return localStorage.getItem(SEL_KEY) || "all"; } catch { return "all"; } }); // "all", or a subject id
  const setView = useCallback((v: string) => { setViewState(v); try { localStorage.setItem(SEL_KEY, v); } catch { /* storage unavailable */ } }, []);
  const [edit, setEdit] = useState<StudySubject | "new" | null>(null);
  const [newExam, setNewExam] = useState(false);
  const [adding, setAdding] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [syllabus, setSyllabus] = useState(false);
  // record a class (#12): from here or a subject's screen (which picks its subject)
  const [lecture, setLecture] = useState<{ subjectId: string | null } | null>(null);
  useEffect(() => { const on = (e: Event) => setLecture({ subjectId: (e as CustomEvent<{ subjectId?: string }>).detail?.subjectId ?? null }); addEventListener("seaglass:lecture", on); return () => removeEventListener("seaglass:lecture", on); }, []);
  // what the time data says (#7): nothing until there's enough of it
  const [tips, setTips] = useState<string[]>([]);
  useEffect(() => { api.studyInsights().then((r) => setTips(r.lines)).catch(() => {}); }, [s.drill, s.quiz, s.explain]);
  // quizzes, blanks and tests closed halfway, kept on this device (study/resume.ts)
  const [later, setLater] = useState(() => unfinished());
  useEffect(() => {
    const f = () => setLater(unfinished());
    addEventListener(CHANGED, f); addEventListener("focus", f);
    return () => { removeEventListener(CHANGED, f); removeEventListener("focus", f); };
  }, []);
  const pickUp = (u: Unfinished) => {
    if (u.kind === "test") s.setQuiz(u.ids, u.replay ? (u.state as { qs: TestQuestion[] }).qs : undefined, true);
    else s.setDrill({ ids: u.ids, title: u.title, mode: u.kind, nonce: Date.now(), resume: true, ...(u.replay && u.set ? { replay: u.set as StudySet } : {}) });
  };
  const discard = (u: Unfinished) => { dropUnfinished(u.key); s.toast(`Discarded the unfinished ${MODE_WORD[u.kind].toLowerCase()}`, { label: "Undo", run: () => keepUnfinished(u, u.at) }); };

  const load = useCallback(() => api.studyOverview(today).then(setData).catch(() => setData((d) => d ?? { subjects: [], exams: [], decks: [], progress: NO_PROGRESS })), [today]);
  // reload after a session ends, after the assistant changes something, and when the tab comes back into view
  useEffect(() => { void load(); }, [load, s.studyId, s.drill, s.quiz, s.explain, s.studyChat, s.past, s.pick, s.tree]);
  useEffect(() => {
    const f = () => void load();
    addEventListener("seaglass:agent-changed", f); addEventListener("focus", f);
    return () => { removeEventListener("seaglass:agent-changed", f); removeEventListener("focus", f); };
  }, [load]);

  const subjects = data?.subjects ?? [], exams = data?.exams ?? [], decks = data?.decks ?? [], progress = data?.progress ?? NO_PROGRESS;
  const subjectOf = useMemo(() => new Map(subjects.map((x) => [x.id, x])), [subjects]);
  const examOf = useMemo(() => new Map(exams.map((x) => [x.id, x])), [exams]);
  const finished = (d: StudyDeck) => d.exam_ids.length > 0 && d.exam_ids.every((id) => examOf.get(id)?.done_at); // all its tests are over
  const active = decks.filter((d) => !d.excluded && !d.done_at && !(d.subject_id && subjectOf.get(d.subject_id)?.done_at) && !finished(d));
  const done = decks.filter((d) => !d.excluded && (d.done_at || (d.subject_id && subjectOf.get(d.subject_id)?.done_at)));
  const hidden = decks.filter((d) => d.excluded);
  const cur = view !== "all" ? subjectOf.get(view) ?? null : null;
  useEffect(() => { if (data && view !== "all" && !subjectOf.has(view)) setView("all"); }, [data, view, subjectOf, setView]);
  const dueAll = active.filter((d) => d.due > 0);
  // tests whose date has passed with no grade yet (oldest first), and any graded here a moment ago until the user closes them
  const [justGraded, setJustGraded] = useState<Set<string>>(new Set());
  const askGrade = exams.filter((e) => (!e.done_at && !e.grade && e.exam_date && e.exam_date < today && !subjectOf.get(e.subject_id)?.done_at) || justGraded.has(e.id))
    .sort((a, b) => (a.exam_date ?? "").localeCompare(b.exam_date ?? "")).slice(0, 3);
  const gap = practiceGap(exams.map((e) => e.grade));
  const misses = data?.misses ?? { open: 0, due: 0 };
  // Questions the user missed, back reworded once they're due (worker misses.ts). No model call until the user taps.
  const reviewMisses = async () => {
    const open = later.find((u) => u.kind === "quiz" && u.replay && u.title === MISSED_TITLE);
    if (open) { pickUp(open); return; } // finish the review already under way: no new rewording
    setReviewing(true);
    try {
      const r = await api.missReview();
      s.setDrill({ ids: r.ids, title: r.title, mode: "quiz", nonce: Date.now(), replay: { mode: "quiz", items: r.items } });
    } catch (e) { s.toast((e as Error).message); }
    finally { setReviewing(false); }
  };

  // what a page is being studied for: its soonest open test, or a date set on the subject itself
  const examFor = (d: StudyDeck) => {
    const open = d.exam_ids.map((id) => examOf.get(id)).filter((e): e is StudyExam => !!e && !e.done_at && !!e.exam_date && e.exam_date >= today).sort((a, b) => a.exam_date!.localeCompare(b.exam_date!))[0];
    if (open) return { id: open.id, name: open.name, exam_date: open.exam_date };
    const sub = d.subject_id ? subjectOf.get(d.subject_id) : undefined;
    return sub?.exam_date && !exams.some((e) => e.subject_id === sub.id && !e.done_at) ? { id: null, name: `${sub.name} test`, exam_date: sub.exam_date } : null;
  };
  const next = nextStudy(active.map((d) => { const p = progress.pages[d.id]; return { id: d.id, title: d.title || "New page", score: p?.score ?? null, last_at: p?.last_at ?? null, exam: examFor(d) }; }), today, Date.now());
  const nextDeck = next ? decks.find((d) => d.id === next.id) : undefined;
  const nextColor = nextDeck?.subject_id ? subjectOf.get(nextDeck.subject_id)?.color : undefined;
  const upcoming = [
    ...exams.filter((e) => !e.done_at && e.exam_date && e.exam_date >= today && !subjectOf.get(e.subject_id)?.done_at).map((e) => ({ name: e.name, date: e.exam_date!, color: subjectOf.get(e.subject_id)?.color ?? "blue" })),
    ...subjects.filter((x) => x.exam_date && !x.done_at && x.exam_date >= today && !exams.some((e) => e.subject_id === x.id && !e.done_at)).map((x) => ({ name: x.name, date: x.exam_date!, color: x.color })),
  ].sort((a, b) => a.date.localeCompare(b.date))[0];

  const pick = (t: PickTarget) => s.setPick(t);
  const page = async (id: string, b: Parameters<typeof api.setStudyPage>[1], msg?: string, undo?: Parameters<typeof api.setStudyPage>[1]) => {
    try {
      await api.setStudyPage(id, b); await load();
      if (msg) s.toast(msg, undo ? { label: "Undo", run: () => void api.setStudyPage(id, undo).then(load) } : undefined);
    } catch (e) { s.toast((e as Error).message); }
  };
  const exclude = new Set(decks.filter((d) => !d.excluded && !d.done_at).map((d) => d.id));
  const weakest = (a: StudyDeck, b: StudyDeck) => (progress.pages[a.id]?.score ?? -1) - (progress.pages[b.id]?.score ?? -1) || b.updated_at - a.updated_at;
  const deckRow = (d: StudyDeck) => (
    <DeckRow key={d.id} d={d} progress={progress.pages[d.id]} subjects={subjects} exams={exams} onOpen={() => pick({ kind: "page", id: d.id })}
      onDone={() => page(d.id, { done: true }, `“${d.title || "New page"}” is done`, { done: false })}
      onExclude={() => page(d.id, { excluded: true }, `Excluded “${d.title || "New page"}” from Study`, { excluded: false })}
      onMove={(sub) => page(d.id, { subject: sub }, sub ? `Moved to ${subjectOf.get(sub)?.name}` : "Removed from its subject")}
      onExam={(e) => page(d.id, { exam: e.id }, `Added to ${e.name}`)}
      onPin={() => page(d.id, { pinned: !d.pinned }, d.pinned ? "Unpinned" : "Pinned to Study")} />
  );

  return (
    <div className="home study-tab">
      {lecture && <LectureRecorder subjects={subjects.filter((x) => !x.done_at).map((x) => ({ id: x.id, name: x.name }))} subjectId={lecture.subjectId} onClose={() => { setLecture(null); void load(); }} />}
      {cur ? (
        <SubjectScreen subject={cur} exams={exams.filter((e) => e.subject_id === cur.id)} decks={decks} active={active} progress={progress} today={today} deckRow={deckRow} weakest={weakest}
          editing={edit !== null && edit !== "new" && edit.id === cur.id} onEdit={() => setEdit(cur)} onCloseEdit={() => setEdit(null)} onBack={() => setView("all")}
          onChanged={(x) => { setEdit(null); void load(); if (x === "deleted") setView("all"); }} reload={load} newExam={newExam} setNewExam={setNewExam}
          adding={adding} setAdding={setAdding} exclude={exclude} onAddPage={(id) => { setAdding(false); void page(id, { pinned: true, excluded: false, done: false, subject: cur.id }, `Added to ${cur.name}`); }} />
      ) : (
        <>
          <div className="hero"><h1>Study</h1><p>Quizzes, tests and games {agentName()} writes from your notes, and how you're doing on them.</p></div>

          <section className="st-today">
            <div className={`st-next ${nextColor ? `c-${nextColor}` : ""}`}>
              <JeffAvatar size={44} />
              <div className="t">
                {data === null ? <div className="st-next-wait" /> : <p className="st-next-line">{next ? next.text : active.length ? "Everything's in good shape right now." : `Add a page and ${agentName()} will start quizzing you on it.`}</p>}
                {next && <div className="st-next-go">
                  <button className="primary" onClick={() => pick(next.exam_id ? { kind: "exam", id: next.exam_id } : { kind: "page", id: next.id })}>Study this</button>
                  <button onClick={() => s.setStudyChat({ ids: [next.id], title: next.title, nonce: Date.now() })}>Talk it through</button>
                </div>}
              </div>
            </div>
            <div className="st-stats">
              <div className="st-stat"><b>{streak?.streak ?? 0}</b><span>day streak</span><WeekDots dates={streak?.dates ?? []} today={today} /></div>
              <div className="st-stat"><b>{progress.week.sessions}</b><span>{progress.week.sessions === 1 ? "session" : "sessions"} this week</span></div>
              <div className="st-stat"><b>{progress.week.avg === null ? "–" : `${progress.week.avg}%`}</b><span>average this week</span></div>
              {upcoming && <div className="st-stat st-next-exam"><span className={`st-exam ${examLabel(upcoming.date, today).soon ? "soon" : ""}`}><i className={`st-dot c-${upcoming.color}`} />{upcoming.name}</span><span className={examLabel(upcoming.date, today).soon ? "st-exam soon" : "st-exam"}>{examLabel(upcoming.date, today).text}</span></div>}
              {gap && <div className="st-stat" title="Your real test grades compared with your practice scores before each test"><b>{gap.avg > 0 ? "+" : ""}{gap.avg}</b><span>real vs practice, {plural(gap.n, "test")}</span></div>}
              {misses.open > 0 && !misses.due && <div className="st-stat"><b>{misses.open}</b><span>missed {misses.open === 1 ? "question" : "questions"} coming back</span></div>}
              {misses.due > 0 && <button className="st-review st-misses" disabled={reviewing} onClick={() => void reviewMisses()}><RotateCcw size={16} /> {reviewing ? "Getting them ready…" : `Review ${misses.due} missed ${misses.due === 1 ? "question" : "questions"}`}</button>}
              {dueAll.length > 0 && <button className="st-review" onClick={() => s.setStudy({ ids: dueAll.map((d) => d.id), title: "Everything due", dueOnly: true })}><Layers size={16} /> Review all {dueAll.reduce((n, d) => n + d.due, 0)} due</button>}
            </div>
          </section>

          {askGrade.length > 0 && <section className="st-grades">{askGrade.map((e) => (
            <GradeAsk key={e.id} exam={e} subject={subjectOf.get(e.subject_id)} onChanged={() => { setJustGraded((x) => new Set(x).add(e.id)); void load(); }}
              onClose={() => setJustGraded((x) => { const n = new Set(x); n.delete(e.id); return n; })} />
          ))}</section>}

          {tips.length > 0 && (
            <section className="st-tips" aria-label="How you study">
              <div className="st-head"><h3>How you study</h3></div>
              <ul>{tips.map((t, k) => <li key={k}><Clock3 size={16} />{t}</li>)}</ul>
            </section>
          )}

          {later.length > 0 && (
            <section className="st-unfinished">
              <div className="st-head"><h3>Unfinished</h3></div>
              <div className="st-list">{later.map((u) => (
                <div key={u.key} className="st-later">
                  <button className="st-past" onClick={() => pickUp(u)}>
                    <span className="i">{PAST_ICON[u.kind]}</span>
                    <span className="t"><b>{u.title}</b><small>{MODE_WORD[u.kind]} · {resumeAt(u)} · {timeAgo(u.at)}</small></span>
                    <span className="st-resume">Resume</span>
                  </button>
                  <button className="st-act" title="Discard" aria-label={`Discard the unfinished ${MODE_WORD[u.kind].toLowerCase()}`} onClick={() => discard(u)}><X size={17} /></button>
                </div>
              ))}</div>
            </section>
          )}

          <section className="st-decks">
            <div className="st-head">
              <h3>Subjects</h3>
              <button className="ghost st-pick" onClick={() => s.setPast({})}><History size={15} /> History</button>
              <button className="ghost st-pick st-syllabus" onClick={() => setSyllabus(true)} title="A photo of a syllabus becomes the subject, its tests and assignments"><Camera size={15} /> Syllabus</button>
              <button className="ghost st-pick st-record" onClick={() => setLecture({ subjectId: null })} title="Record a class and get notes with flashcards"><Mic size={15} /> Record<span className="st-long"> a class</span></button>
              {syllabus && <SyllabusDialog onClose={() => setSyllabus(false)} onAdded={(id) => { setSyllabus(false); void load().then(() => setView(id)); }} />}
              <span className="rel">
                <button className="ghost st-pick st-add-subject" onClick={() => setEdit("new")}><Plus size={15} /> Subject</button>
                {edit === "new" && <SubjectEditor onClose={() => setEdit(null)} onSaved={(x) => { setEdit(null); void load().then(() => setView(x.id)); }} />}
              </span>
            </div>
            {data === null ? <div className="st-skel" /> : subjects.filter((x) => !x.done_at).length ? (
              <div className="st-folders">
                {subjects.filter((x) => !x.done_at).map((x) => <FolderCard key={x.id} subject={x} exams={exams.filter((e) => e.subject_id === x.id && !e.done_at)} decks={active.filter((d) => d.subject_id === x.id)} progress={progress} today={today} onOpen={() => setView(x.id)} />)}
              </div>
            ) : (
              <div className="st-empty">
                <BookOpenCheck size={28} />
                <b>Make a folder for each class</b>
                <p>A subject holds your tests, each with its date and the pages it covers. {agentName()} writes quizzes, tests and games from them.</p>
                <button onClick={() => setEdit("new")}><Plus size={15} /> Add a subject</button>
              </div>
            )}
          </section>

          {(active.some((d) => !d.subject_id) || data !== null) && (
            <section className="st-loose">
              <div className="st-head">
                <h3>{active.some((d) => !d.subject_id) ? "Pages without a subject" : ""}</h3>
                <span className="rel">
                  <button className="ghost st-pick" onClick={() => setAdding((v) => !v)}><Plus size={15} /> Add a page</button>
                  {adding && <PagePicker exclude={exclude} onClose={() => setAdding(false)} onPick={(id) => { setAdding(false); void page(id, { pinned: true, excluded: false, done: false }, "Added to Study"); }} />}
                </span>
              </div>
              <div className="st-list">{active.filter((d) => !d.subject_id).sort(weakest).map(deckRow)}</div>
            </section>
          )}

          {progress.recent.length > 0 && (
            <section className="st-recent">
              <div className="st-head"><h3>Recent</h3><button className="ghost st-pick" onClick={() => s.setPast({})}>See all</button></div>
              <div className="st-list">{progress.recent.map((p) => <PastRow key={p.id} p={p} onOpen={() => s.setPast({ open: p.id })} />)}</div>
            </section>
          )}

          {(done.length > 0 || hidden.length > 0 || subjects.some((x) => x.done_at)) && (
            <section className="st-archive">
              {(done.length > 0 || subjects.some((x) => x.done_at)) && (
                <>
                  <button className="st-fold" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)}><CheckCircle2 size={16} /> Done <small>{done.length}</small></button>
                  {showDone && <div className="st-list st-muted">
                    {subjects.filter((x) => x.done_at).map((x) => (
                      <div key={x.id} className="st-arch-row"><SubjectMark subject={x} /><span className="t"><b>{x.name}</b><small>Subject · done {timeAgo(x.done_at!)}</small></span>
                        <button onClick={() => void api.updateSubject(x.id, { done: false }).then(load)}><RotateCcw size={14} /> Bring back</button></div>
                    ))}
                    {done.map((d) => (
                      <div key={d.id} className="st-arch-row"><PageIcon icon={d.icon} kind="page" size={18} /><span className="t"><b>{d.title || "New page"}</b><small>{d.done_at ? `Done ${timeAgo(d.done_at)}` : "Its subject is done"}</small></span>
                        {d.done_at && <button onClick={() => void page(d.id, { done: false }, "Back in Study")}><RotateCcw size={14} /> Bring back</button>}</div>
                    ))}
                  </div>}
                </>
              )}
              {hidden.length > 0 && (
                <>
                  <button className="st-fold" aria-expanded={showHidden} onClick={() => setShowHidden((v) => !v)}><EyeOff size={16} /> Excluded <small>{hidden.length}</small></button>
                  {showHidden && <div className="st-list st-muted">
                    {hidden.map((d) => (
                      <div key={d.id} className="st-arch-row"><PageIcon icon={d.icon} kind="page" size={18} /><span className="t"><b>{d.title || "New page"}</b><small>Not shown in Study</small></span>
                        <button onClick={() => void page(d.id, { excluded: false }, "Back in Study")}><RotateCcw size={14} /> Include</button></div>
                    ))}
                  </div>}
                </>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function WeekDots({ dates, today }: { dates: string[]; today: string }) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${today}T12:00:00`); d.setDate(d.getDate() - 6 + i);
    return { iso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, label: d.toLocaleDateString(undefined, { weekday: "narrow" }) };
  });
  return <div className="st-week" aria-label={`Studied on ${days.filter((d) => dates.includes(d.iso)).length} of the last 7 days`}>{days.map((d) => <span key={d.iso} className={`${dates.includes(d.iso) ? "on" : ""} ${d.iso === today ? "now" : ""}`}><i />{d.label}</span>)}</div>;
}

function PastRow({ p, onOpen }: { p: PastSummary; onOpen: () => void }) {
  const at = pctOf(p);
  return <button className="st-past" onClick={onOpen}><span className="i">{PAST_ICON[p.mode]}</span><span className="t"><b>{p.title}</b><small>{MODE_WORD[p.mode]} · {timeAgo(p.created_at)}</small></span><span className={`sh-score ${level(at)}`}>{at}%</span></button>;
}

function Bars({ ids, progress }: { ids: string[]; progress: StudyProgress }) {
  return <div className="st-bars">{ids.map((id) => { const x = progress.pages[id]?.score; return <i key={id} className={typeof x === "number" ? level(x) : ""} />; })}</div>;
}

function FolderCard({ subject, exams, decks, progress, today, onOpen }: { subject: StudySubject; exams: StudyExam[]; decks: StudyDeck[]; progress: StudyProgress; today: string; onOpen: () => void }) {
  const label = subject.exam_date ? examLabel(subject.exam_date, today) : null;
  return (
    <button className={`st-folder c-${subject.color}`} onClick={onOpen}>
      <span className="st-folder-mark">{subject.icon ?? <Folder size={26} />}</span>
      <b>{subject.name}</b>
      <small>{exams.length ? plural(exams.length, "test") : plural(decks.length, "page")}</small>
      {label && !label.past && <small className={label.soon ? "st-exam soon" : "st-exam"}>{label.text}</small>}
      {decks.length > 0 && <Bars ids={decks.map((d) => d.id)} progress={progress} />}
    </button>
  );
}

function ExamRow({ exam, decks, progress, today, onOpen }: { exam: StudyExam; decks: StudyDeck[]; progress: StudyProgress; today: string; onOpen: () => void }) {
  const ids = exam.page_ids.filter((id) => decks.some((d) => d.id === id)), score = average(ids, progress);
  const label = exam.exam_date ? examLabel(exam.exam_date, today) : null;
  const d = exam.exam_date ? new Date(`${exam.exam_date}T12:00:00`) : null;
  return (
    <button className="st-xrow" onClick={onOpen}>
      <span className={`st-cal ${label?.soon ? "soon" : ""}`}>{d ? <><small>{d.toLocaleDateString(undefined, { month: "short" })}</small><b>{d.getDate()}</b></> : <small>No date</small>}</span>
      <span className="t"><b>{exam.name}</b><small>{plural(ids.length, "page")}{label ? ` · ${label.text.replace(/ · .*/, "")}` : ""}</small></span>
      {score !== null && <span className={`st-ring ${level(score)}`} style={{ "--p": score } as React.CSSProperties} title="From your recent results"><span>{score}%</span></span>}
    </button>
  );
}

function SubjectScreen({ subject, exams, decks, active, progress, today, deckRow, weakest, editing, onEdit, onCloseEdit, onBack, onChanged, reload, newExam, setNewExam, adding, setAdding, exclude, onAddPage }: {
  subject: StudySubject; exams: StudyExam[]; decks: StudyDeck[]; active: StudyDeck[]; progress: StudyProgress; today: string; deckRow: (d: StudyDeck) => React.ReactNode; weakest: (a: StudyDeck, b: StudyDeck) => number;
  editing: boolean; onEdit: () => void; onCloseEdit: () => void; onBack: () => void; onChanged: (x?: "deleted") => void; reload: () => Promise<unknown>;
  newExam: boolean; setNewExam: (v: boolean) => void; adding: boolean; setAdding: (v: boolean) => void; exclude: Set<string>; onAddPage: (id: string) => void;
}) {
  const s = useStore();
  const [showFinished, setShowFinished] = useState(false);
  const mine = active.filter((d) => d.subject_id === subject.id), ids = mine.map((d) => d.id);
  const open = exams.filter((e) => !e.done_at).sort((a, b) => (a.exam_date ?? "9").localeCompare(b.exam_date ?? "9"));
  const finished = exams.filter((e) => e.done_at);
  const loose = mine.filter((d) => !d.exam_ids.length).sort(weakest);
  const practised = mine.filter((d) => progress.pages[d.id]).length, score = average(ids, progress);
  const exam = subject.exam_date ? examLabel(subject.exam_date, today) : null;
  return (
    <>
      <button className="ghost st-back" onClick={onBack}><ChevronLeft size={18} /> Study</button>
      <section className={`st-subject c-${subject.color}`}>
        <div className="st-subject-top">
          <SubjectMark subject={subject} big />
          <div className="t"><h2>{subject.name}</h2>
            <span className={`st-exam ${exam?.soon ? "soon" : ""}`}>{exam ? exam.text : "No test date yet"}</span>
          </div>
          <span className="rel">
            <button className="ghost icon-btn" aria-label="Edit subject" title="Edit subject" onClick={onEdit}><Pencil size={17} /></button>
            {editing && <SubjectEditor subject={subject} hasExams={exams.length > 0} onClose={onCloseEdit} onSaved={() => onChanged()} onDeleted={() => onChanged("deleted")} />}
          </span>
        </div>
        <div className="st-mastery">
          <Bars ids={ids} progress={progress} />
          <div className="legend"><span>{practised ? `${practised} of ${plural(ids.length, "page")} practised` : "Not practised yet"}</span>{score !== null && <b>{score}%</b>}</div>
        </div>
        <div className="st-subject-actions">
          <button className="primary" disabled={!ids.length} onClick={() => s.setPick({ kind: "subject", id: subject.id })}>Study all of {subject.name}</button>
          <button onClick={() => dispatchEvent(new CustomEvent("seaglass:lecture", { detail: { subjectId: subject.id } }))}><Mic size={15} /> Record a class</button>
          <button disabled={!ids.length} onClick={() => s.setPast({ ids, title: subject.name })}><History size={15} /> History</button>
          <button className="ghost" onClick={async () => { await api.updateSubject(subject.id, { done: true }); s.toast(`${subject.name} is done`, { label: "Undo", run: () => void api.updateSubject(subject.id, { done: false }).then(() => onChanged()) }); onChanged("deleted"); }}><Check size={15} /> Done with {subject.name}</button>
        </div>
      </section>

      <SubjectHub subject={subject} today={today} />

      <section className="st-decks">
        <div className="st-head">
          <h3>Tests</h3>
          <span className="rel">
            <button className="ghost st-pick" onClick={() => setNewExam(!newExam)}><Plus size={15} /> New test</button>
            {newExam && <ExamEditor subject={subject} decks={decks} firstTest={!exams.length} defaultDate={!exams.length ? subject.exam_date ?? undefined : undefined} onClose={() => setNewExam(false)} onSaved={(x) => { setNewExam(false); void reload().then(() => s.setPick({ kind: "exam", id: x.id, fresh: true })); }} />}
          </span>
        </div>
        {open.length ? <div className="st-list">{open.map((e) => <ExamRow key={e.id} exam={e} decks={mine} progress={progress} today={today} onOpen={() => s.setPick({ kind: "exam", id: e.id })} />)}</div>
          : <div className="st-empty st-empty-small"><b>No tests yet</b><p>Add one with its date and the pages it covers, and it'll count down here.</p><button onClick={() => setNewExam(true)}><Plus size={15} /> New test</button></div>}
      </section>

      <section className="st-loose">
        <div className="st-head">
          <h3>{open.length ? "Pages not in a test" : "Pages"}</h3>
          <span className="rel">
            <button className="ghost st-pick" onClick={() => setAdding(!adding)}><Plus size={15} /> Add a page</button>
            {adding && <PagePicker exclude={exclude} onClose={() => setAdding(false)} onPick={onAddPage} />}
          </span>
        </div>
        <div className="st-list">{loose.map(deckRow)}</div>
      </section>

      {finished.length > 0 && (
        <section className="st-archive">
          <button className="st-fold" aria-expanded={showFinished} onClick={() => setShowFinished((v) => !v)}><CheckCircle2 size={16} /> Finished tests <small>{finished.length}</small></button>
          {showFinished && <div className="st-list st-muted">
            {finished.map((e) => <div key={e.id} className="st-arch-row"><span className="t"><b>{e.name}</b><small>Done {timeAgo(e.done_at!)}{isGraded(e.grade) ? ` · you got ${Math.round(e.grade.pct)}%${e.grade.practice !== null ? ` (practice ${e.grade.practice}%)` : ""}` : ""}</small></span><button onClick={() => void api.updateExam(e.id, { done: false }).then(reload)}><RotateCcw size={14} /> Bring back</button></div>)}
          </div>}
        </section>
      )}
    </>
  );
}

function DeckRow({ d, progress, subjects, exams, onOpen, onDone, onExclude, onMove, onExam, onPin }: {
  d: StudyDeck; progress?: PageProgress; subjects: StudySubject[]; exams: StudyExam[]; onOpen: () => void; onDone: () => void; onExclude: () => void; onMove: (subject: string | null) => void; onExam: (e: StudyExam) => void; onPin: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const sub = subjects.find((x) => x.id === d.subject_id);
  const score = progress?.score ?? null;
  const tests = exams.filter((e) => e.subject_id === d.subject_id && !e.done_at && !d.exam_ids.includes(e.id));
  return (
    <div className="st-deck">
      <div className="st-deck-row">
        <button className="st-deck-head" onClick={onOpen}>
          <PageIcon icon={d.icon} kind="page" size={20} />
          <span className="t"><b>{d.title || "New page"}</b><small>{deckLine(d, progress)}</small></span>
          {score !== null && <span className={`st-ring ${level(score)}`} style={{ "--p": score } as React.CSSProperties} title={`${score}% from your recent results`}><span>{score}%</span></span>}
          {d.due > 0 && <span className="st-due">{d.due} due</span>}
        </button>
        <button className="st-act" title="Done: finished studying this" aria-label="Mark done" onClick={onDone}><Check size={17} /></button>
        <span className="rel">
          <button className="st-act" title="More" aria-label="More" onClick={() => setMenu((v) => !v)}><MoreHorizontal size={17} /></button>
          {menu && (
            <Popover onClose={() => setMenu(false)} className="st-menu">
              <div className="mp-title">Subject</div>
              {subjects.filter((x) => !x.done_at).map((x) => (
                <button key={x.id} onClick={() => { setMenu(false); onMove(x.id); }}><SubjectMark subject={x} /> {x.name}{x.id === d.subject_id && <span className="ag-check">✓</span>}</button>
              ))}
              {sub && <button onClick={() => { setMenu(false); onMove(null); }}>No subject</button>}
              {!subjects.length && <span className="st-menu-note">Make a subject with “+ Subject” above</span>}
              {tests.length > 0 && <div className="mp-title">Add to a test</div>}
              {tests.map((e) => <button key={e.id} onClick={() => { setMenu(false); onExam(e); }}>{e.name}</button>)}
              <div className="mp-title">Page</div>
              <button onClick={() => { setMenu(false); onDone(); }}><Check size={16} /> Mark done</button>
              <button onClick={() => { setMenu(false); onExclude(); }}><EyeOff size={16} /> Exclude from Study</button>
              {!d.cards || d.pinned ? <button onClick={() => { setMenu(false); onPin(); }}><Pin size={16} /> {d.pinned ? "Unpin" : "Pin to Study"}</button> : null}
              <a className="st-menu-link" href={`#/p/${d.id}`} onClick={() => setMenu(false)}>Open page</a>
            </Popover>
          )}
        </span>
      </div>
    </div>
  );
}

function deckLine(d: StudyDeck, p?: PageProgress) {
  if (p) return `${MODE_WORD[p.last_mode]}${p.last_pct === null ? "" : ` ${p.last_pct}%`} · ${timeAgo(p.last_at)}`;
  return d.last_studied ? `Flashcards · ${timeAgo(d.last_studied)}` : "Not practised yet";
}
