// Jeff's one-shot tools in the app: Ask Jeff on selected text (in the editor), photo to notes, and practice tests.
// They use the model picked in Jeff's model menu. Server side: src/worker/ai.ts.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor as TipEditor } from "@tiptap/react";
import { getHTMLFromFragment } from "@tiptap/core";
import { BookOpen, Camera, ListChecks, Minus, Plus, Sparkles, SpellCheck, Wand2, List } from "lucide-react";
import { api, ApiError } from "../api";
import { useStore } from "../store";
import { aiHiddenIn } from "../aiHidden";
import { JeffAvatar, JeffFace } from "../icons";
import { IClose } from "../ui-icons";
import { Popover, timeAgo } from "./ui";
import { agentName } from "../persona";
import { keepTest, offlineError, savedTest } from "../study/offline";
import { dropUnfinished, getUnfinished, keepUnfinished, resumeAt, resumeKey } from "../study/resume";
import { keyToOption, QuizChoice, QuizReview, QuizTrack, QuizWhy, ScoreRing, type Seg } from "./QuizParts";

/** The model chosen in Jeff's model menu on this device ("" = server default). */
import { StudyCoach } from "./StudyCoach";
import type { TestQuestion } from "../study/coach";

export const jeffModel = () => { try { return localStorage.getItem("sg.agent.model") || undefined; } catch { return undefined; } };
const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : (e as Error)?.message || "Something went wrong");

// ---------------------------------------------------------------- Ask Jeff on selected text
const REWRITES: [string, string, typeof Wand2][] = [
  ["improve", "Improve writing", Wand2], ["fix", "Fix spelling & grammar", SpellCheck], ["shorter", "Make shorter", Minus],
  ["longer", "Make longer", Plus], ["simplify", "Simplify", Sparkles], ["bullets", "Turn into a list", List],
];

/** The "Ask Jeff" button + menu shown with a text selection (desktop bubble and the phone toolbar). */
export function AskJeffMenu({ editor, noteId, compact = false }: { editor: TipEditor; noteId?: string; compact?: boolean }) {
  const s = useStore();
  const hidden = aiHiddenIn(s.tree, noteId);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [explain, setExplain] = useState<{ text: string; at: number } | null>(null);
  const selection = () => {
    const { from, to } = editor.state.selection;
    const html = getHTMLFromFragment(editor.state.selection.content().content, editor.schema).replace(/ data-id="[0-9a-f-]{36}"/g, "");
    const text = editor.state.doc.textBetween(from, to, "\n");
    return { from, to, html, text };
  };
  const run = async (action: string) => {
    const sel = selection();
    if (!sel.text.trim()) return;
    setOpen(false);
    if (action === "flashcards" || action === "tasks") {
      const prompt = action === "flashcards"
        ? `Make flashcards from this part of the page I'm on, and add them at the end of the page under a "Flashcards" heading (one toggle per card):\n\n${sel.text}`
        : `Add the things to do in this text to My tasks (with due dates if it mentions them), then list what you added:\n\n${sel.text}`;
      s.setAgentOpen(true);
      setTimeout(() => dispatchEvent(new CustomEvent("seaglass:agent-ask", { detail: prompt })), 120);
      return;
    }
    setBusy(action);
    try {
      const r = await api.aiSelection(action, sel.html, jeffModel(), noteId);
      if (action === "explain") setExplain({ text: r.explanation ?? "", at: sel.to });
      else if (r.html) {
        editor.chain().focus().insertContentAt({ from: sel.from, to: sel.to }, r.html).run();
        s.toast(`${agentName()} rewrote it. Ctrl+Z to undo`);
      }
    } catch (e) { s.toast(errMsg(e)); }
    setBusy(null);
  };
  const insertExplanation = () => {
    if (!explain) return;
    const safe = explain.text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
    const end = Math.min(editor.state.doc.content.size, editor.state.doc.resolve(explain.at).after(1));
    editor.chain().focus().insertContentAt(end, `<div data-type="callout" data-emoji="💡"><p>${safe}</p></div>`).run();
    setExplain(null);
  };
  if (hidden) return null; // the page is hidden from AI
  return (
    <span className="rel ask-jeff">
      <button className={`ask-jeff-btn ${compact ? "compact" : ""}`} title={`Ask ${agentName()}`} aria-label={`Ask ${agentName()} about the selection`} onMouseDown={(e) => e.preventDefault()} onPointerDown={(e) => e.preventDefault()} onClick={() => setOpen(!open)} disabled={!!busy}>
        <span className="aj-face"><JeffFace size={compact ? 20 : 16} /></span>{!compact && (busy ? "Writing…" : `Ask ${agentName()}`)}
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} className="ask-jeff-pop">
          <div className="mp-title">Edit with {agentName()}</div>
          {REWRITES.map(([id, label, I]) => <button key={id} onMouseDown={(e) => e.preventDefault()} onClick={() => void run(id)}><I size={17} /> {label}</button>)}
          <div className="mp-sep" />
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => void run("explain")}><BookOpen size={17} /> Explain this</button>
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => void run("flashcards")}><Sparkles size={17} /> Make flashcards</button>
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => void run("tasks")}><ListChecks size={17} /> Make tasks</button>
        </Popover>
      )}
      {explain && (
        <Popover onClose={() => setExplain(null)} className="ask-jeff-pop explain">
          <div className="aj-explain"><JeffAvatar size={28} /><p>{explain.text}</p></div>
          <div className="aj-explain-actions">
            <button className="ghost" onClick={() => { void navigator.clipboard?.writeText(explain.text); s.toast("Copied"); }}>Copy</button>
            <button className="primary" onClick={insertExplanation}>Insert below</button>
          </div>
        </Popover>
      )}
    </span>
  );
}

// ---------------------------------------------------------------- photo to notes
/** Downscales a photo to a JPEG (max 2000px side) so it uploads fast and stays within the vision limits. */
async function toJpeg(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error("That file isn't an image this browser can open")); i.src = url; });
    const scale = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.85).split(",")[1];
  } finally { URL.revokeObjectURL(url); }
}

export function PhotoNotesDialog() {
  const s = useStore();
  const [cards, setCards] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const parent = s.route.kind === "page" ? s.route.id : null;
  const close = () => { if (!busy) s.setPhotoOpen(false); };
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") close(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); });
  const go = async (f?: File) => {
    if (!f) return;
    setBusy(true); setErr("");
    try {
      const image = await toJpeg(f);
      const r = await api.aiPhoto({ image, media_type: "image/jpeg", parent_id: parent, flashcards: cards, model: jeffModel() });
      await s.refreshTree();
      s.setPhotoOpen(false);
      s.go(`/p/${r.id}`);
      s.toast(`Made “${r.title}” from your photo`);
    } catch (e) { setErr(errMsg(e)); }
    setBusy(false);
  };
  return (
    <div className="modal-back" onMouseDown={close}>
      <div className="modal photo-notes" role="dialog" aria-label="Photo to notes" onMouseDown={(e) => e.stopPropagation()}>
        <div className="memory-head">
          <span className="notify-ico"><Camera size={20} /></span>
          <div><b>Photo to notes</b><small>Take or pick a photo of handwritten notes, a whiteboard, a worksheet or slides. {agentName()} turns it into a clean page{parent ? " inside this one" : ""}.</small></div>
          <button className="ghost icon-btn" aria-label="Close" onClick={close} disabled={busy}><IClose size={18} /></button>
        </div>
        {busy ? (
          <div className="pn-busy"><JeffAvatar size={56} /><b>Reading your photo…</b><small>This takes about 10 to 30 seconds.</small></div>
        ) : (
          <>
            <label className="pn-opt"><input type="checkbox" checked={cards} onChange={(e) => setCards(e.target.checked)} /> Also make flashcards</label>
            <button className="primary pn-pick" onClick={() => input.current?.click()}><Camera size={18} /> Take or choose a photo</button>
            {err && <p className="when-err">{err}</p>}
          </>
        )}
        <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { void go(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- practice tests
type Q = TestQuestion;
interface A { pick?: number; text?: string; correct?: boolean; feedback?: string }

type TestSave = { qs: Q[]; answers: A[]; i: number; count: number; times?: number[] };

export function QuizView({ ids, replay, resume }: { ids: string[]; replay?: TestQuestion[]; resume?: boolean }) {
  const s = useStore();
  // a test closed halfway is kept on the device after every answer (study/resume.ts); `resume` goes straight back in
  const key = resumeKey("test", ids, replay);
  const [saved] = useState(() => getUnfinished<TestSave>(key));
  const from = saved && resume ? saved : null;
  const [count, setCount] = useState(from?.state.count ?? 8);
  const [phase, setPhase] = useState<"offer" | "setup" | "loading" | "asking" | "grading" | "done">(saved && !resume ? "offer" : from || replay ? "asking" : "setup"); // from History: the same questions, straight in
  const [qs, setQs] = useState<Q[]>(from?.state.qs ?? replay ?? []);
  const [answers, setAnswers] = useState<A[]>(() => from?.state.answers ?? (replay ?? []).map(() => ({})));
  const [i, setI] = useState(from?.state.i ?? 0);
  const [err, setErr] = useState("");
  const [times, setTimes] = useState<number[]>(from?.state.times ?? []);
  const shownAt = useRef(Date.now());
  useEffect(() => { shownAt.current = Date.now(); }, [i, qs]);
  const timeIt = (k: number) => setTimes((t) => { if (t[k]) return t; const n = [...t]; n[k] = Math.round((Date.now() - shownAt.current) / 100) / 10; return n; });
  const title = useMemo(() => ids.map((id) => s.byId.get(id)?.title || "this page").join(", "), [ids, s.byId]);
  const close = () => {
    if ((phase === "asking" || phase === "grading") && getUnfinished(key)) s.toast("Saved where you left off. It's in the Study tab.");
    s.setQuiz(null);
  };
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") close(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); });

  const began = useRef(Date.now() - (from?.elapsed ?? 0) * 1000);
  const pickUp = () => {
    if (!saved) return;
    setQs(saved.state.qs); setAnswers(saved.state.answers); setI(saved.state.i); setCount(saved.state.count);
    began.current = Date.now() - saved.elapsed * 1000; setPhase("asking");
  };
  const startOver = () => {
    dropUnfinished(key);
    if (replay) { began.current = Date.now(); setQs(replay); setAnswers(replay.map(() => ({}))); setI(0); setPhase("asking"); }
    else setPhase("setup");
  };
  // keep it after every answer, and as it closes so the time since the last answer counts; forget it once it's
  // finished or nothing's been answered
  const persist = useRef(() => {});
  persist.current = () => {
    if (phase === "done") { dropUnfinished(key); return; }
    if (phase !== "asking" && phase !== "grading") return;
    if (i === 0 && !answers.some((x) => x.pick !== undefined || x.text?.trim())) { dropUnfinished(key); return; }
    keepUnfinished({ key, kind: "test", ids, title, replay: !!replay, at: Date.now(), done: i, total: qs.length, elapsed: Math.round((Date.now() - began.current) / 1000), state: { qs, answers, i, count, times } });
  };
  useEffect(() => persist.current(), [phase, answers, i, qs]);
  useEffect(() => () => persist.current(), []);
  const start = async () => {
    setPhase("loading"); setErr("");
    try {
      const r = await api.aiQuiz(ids, count, jeffModel());
      began.current = Date.now();
      setQs(r.questions); setAnswers(r.questions.map(() => ({}))); setI(0); setPhase("asking");
      keepTest(ids, r.questions); // for offline (study/offline.ts)
    } catch (e) {
      const kept = offlineError(e) ? savedTest(ids) : null;
      if (kept) { began.current = Date.now(); setQs(kept); setAnswers(kept.map(() => ({}))); setI(0); setPhase("asking"); s.toast("You're offline, so this is the test you had last time"); return; }
      setErr(errMsg(e)); setPhase("setup");
    }
  };
  const retake = () => { began.current = Date.now(); setAnswers(qs.map(() => ({}))); setTimes([]); setI(0); setPhase("asking"); };
  const set = (k: number, a: A) => setAnswers((xs) => xs.map((x, j) => (j === k ? { ...x, ...a } : x)));
  const q = qs[i], a = answers[i] ?? {};
  const pickMcq = (n: number) => { if (a.pick !== undefined || !q) return; timeIt(i); set(i, { pick: n, correct: n === q.answer }); };
  const finish = async () => {
    setPhase("grading");
    const shortIdx = qs.map((x, k) => (x.type === "short" ? k : -1)).filter((k) => k >= 0);
    try {
      if (shortIdx.length) {
        const r = await api.aiGrade(shortIdx.map((k) => ({ q: qs[k].q, expected: String(qs[k].answer), answer: answers[k].text ?? "" })), jeffModel());
        setAnswers((xs) => xs.map((x, k) => { const j = shortIdx.indexOf(k); return j < 0 ? x : { ...x, correct: !!(x.text ?? "").trim() && r.results[j]?.correct, feedback: r.results[j]?.feedback }; }));
      }
    } catch (e) { s.toast(`Couldn't grade the written answers: ${errMsg(e)}`); }
    setPhase("done");
  };
  const next = () => { timeIt(i); if (i + 1 < qs.length) setI(i + 1); else void finish(); };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (phase !== "asking" || !q || e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement).tagName === "TEXTAREA") return;
      const n = q.type === "mcq" ? keyToOption(e.key, q.options!.length) : -1;
      if (n >= 0 && a.pick === undefined) { e.preventDefault(); pickMcq(n); }
      else if ((e.key === "Enter" || e.key === " ") && (q.type !== "mcq" || a.pick !== undefined)) { e.preventDefault(); next(); }
    };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  });
  const track: Seg[] = qs.map((x, k) => {
    const y = answers[k] ?? {};
    if (phase === "done") return y.correct ? "right" : "wrong";
    if (x.type === "short") return k < i || phase === "grading" ? "open" : k === i ? "now" : "todo";
    return y.pick !== undefined ? (y.correct ? "right" : "wrong") : k === i ? "now" : "todo";
  });
  const score = answers.filter((x) => x.correct).length;
  const missed = qs.map((x, k) => ({ x, a: answers[k] })).filter(({ a: y }) => !y.correct);
  const saveMissed = async () => {
    const id = ids[0];
    try {
      const note = await api.get(id);
      const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
      const cards = missed.map(({ x }) => `<details><summary>${esc(x.q)}</summary><div data-type="detailsContent"><p>${esc(x.type === "mcq" ? x.options![x.answer as number] : String(x.answer))}${x.explanation ? ` (${esc(x.explanation)})` : ""}</p></div></details>`).join("");
      await api.patch(id, { html: `${note.html}<h2>Missed in a practice test</h2>${cards}`, revision: note.revision });
      s.toast(`Added ${missed.length} flashcard${missed.length === 1 ? "" : "s"} to “${note.title || "the page"}”`);
      dispatchEvent(new CustomEvent("seaglass:agent-changed"));
    } catch (e) { s.toast(errMsg(e)); }
  };

  return (
    <div className="study quiz" role="dialog" aria-label="Practice test">
      <div className="study-top">
        <button className="ghost icon-btn" aria-label="Close" onClick={close}><IClose size={20} /></button>
        <div className="study-title"><b>Practice test</b><span className="study-practice">{title}</span></div>
        <span className="study-count">{phase === "asking" ? `${i + 1} / ${qs.length}` : ""}</span>
      </div>
      {qs.length > 0 && phase !== "setup" && phase !== "loading" && phase !== "offer" ?<QuizTrack segs={track} /> : <div className="qz-track-gap" />}
      <div className={`study-stage ${phase === "asking" ? "qz-stage" : phase === "done" ? "drill-end" : ""}`}>
        {phase === "offer" && saved && (
          <div className="study-empty drill-resume">
            <JeffAvatar size={56} />
            <b>Pick up where you left off?</b>
            <p>You were on {resumeAt(saved)}, {timeAgo(saved.at)}.</p>
            <div className="study-done-actions">
              <button onClick={startOver}>Start over</button>
              <button className="primary" autoFocus onClick={pickUp}>Resume</button>
            </div>
          </div>
        )}
        {phase === "setup" && (
          <div className="study-empty">
            <JeffAvatar size={56} />
            <b>Test yourself on {title}</b>
            <p>{agentName()} writes questions from your notes: multiple choice and short answers. Written answers are graded at the end.</p>
            <div className="seg quiz-count">{[5, 8, 12].map((n) => <button key={n} className={count === n ? "on" : ""} onClick={() => setCount(n)}>{n} questions</button>)}</div>
            {err && <p className="when-err">{err}</p>}
            <div className="study-done-actions"><button className="primary" onClick={() => void start()}>Start</button></div>
          </div>
        )}
        {(phase === "loading" || phase === "grading") && (
          <div className="study-empty"><JeffAvatar size={56} /><b>{phase === "loading" ? "Writing your questions…" : "Grading your answers…"}</b></div>
        )}
        {phase === "asking" && q && (
          <div className="qz">
            <span className="qz-kicker">Question {i + 1} <small>of {qs.length}</small></span>
            <h2 className="qz-q">{q.q}</h2>
            {q.type === "mcq" ? (
              <>
                <div className="qz-options">
                  {q.options!.map((o, n) => <QuizChoice key={n} index={n} text={o} locked={a.pick !== undefined} onPick={() => pickMcq(n)} state={a.pick === undefined ? "" : n === q.answer ? "right" : n === a.pick ? "wrong" : "dim"} />)}
                </div>
                {a.pick !== undefined && (q.explanation || !a.correct) && <QuizWhy right={!!a.correct} text={q.explanation} />}
              </>
            ) : (
              <textarea className="qz-write" rows={4} autoFocus placeholder="Write your answer. It's graded at the end." value={a.text ?? ""} onChange={(e) => set(i, { text: e.target.value })} />
            )}
          </div>
        )}
        {phase === "done" && (
          <div className="study-empty drill-results">
            <ScoreRing right={score} total={qs.length} />
            <b>{score === qs.length ? "Perfect!" : score >= qs.length * 0.8 ? "Nice work" : score >= qs.length * 0.5 ? "Getting there" : "Keep practising"}</b>
            <p>{score === qs.length ? "You got every question." : "Everything you answered is below, and you can turn the ones you missed into flashcards."}</p>
            <StudyCoach session={{ mode: "test", ids, title, right: score, total: qs.length, missed: missed.map(({ x, a: y }) => ({ q: x.q, a: x.type === "mcq" ? x.options![x.answer as number] : String(x.answer), yours: x.type === "mcq" ? (y.pick !== undefined ? x.options![y.pick] : undefined) : y.text?.trim() || undefined })),
              seconds: Math.round((Date.now() - began.current) / 1000),
              played: qs.map((x, k) => {
                const y = answers[k];
                return { type: x.type, q: x.q, answer: x.type === "mcq" ? x.options![x.answer as number] : String(x.answer), right: !!y.correct, yours: x.type === "mcq" ? (y.pick !== undefined ? x.options![y.pick] : undefined) : y.text?.trim() || undefined, why: x.explanation, feedback: y.feedback, ...(x.type === "mcq" ? { options: x.options, correct: x.answer as number } : {}), ...(times[k] ? { secs: times[k] } : {}) };
              }) }} />
            <QuizReview items={qs.map((x, k) => ({
              q: x.q, right: !!answers[k].correct,
              yours: x.type === "mcq" ? (answers[k].pick !== undefined ? x.options![answers[k].pick!] : "(skipped)") : answers[k].text?.trim() || "(blank)",
              answer: x.type === "mcq" ? x.options![x.answer as number] : String(x.answer),
              note: answers[k].feedback || (answers[k].correct ? undefined : x.explanation),
            }))} />
          </div>
        )}
      </div>
      <div className="study-foot">
        {phase === "asking" && <button className={`primary study-show ${q?.type === "mcq" && a.pick === undefined ? "qz-wait" : ""}`} tabIndex={q?.type === "mcq" && a.pick === undefined ? -1 : 0} onClick={next}>{i + 1 < qs.length ? "Next" : "Finish"}{q?.type === "mcq" && <kbd>Enter</kbd>}</button>}
        {phase === "done" && (
          <div className="study-done-actions">
            {missed.length > 0 && <button className="primary" onClick={() => void saveMissed()}>Save {missed.length} missed as flashcards</button>}
            <button onClick={retake}>Retake</button>
            <button onClick={() => setPhase("setup")}>New test</button>
            <button className="ghost" onClick={close}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
}
