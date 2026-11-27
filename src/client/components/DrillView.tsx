// Study games on one or more pages, full screen like flashcard mode (same .study shell, so shortcuts and swipes
// underneath stay off): Quiz (multiple choice), Fill in the blanks (type the missing word) and Match (pair terms with
// their answers against the clock). The assistant writes the questions from the notes (worker/ai.ts, saved until the
// notes change); if it can't, the games fall back to the page's own flashcards (study/modes.ts). Nothing is saved to
// the flashcard schedule. A quiz or fill in the blanks closed halfway is kept on the device after every answer
// (study/resume.ts): opening it again offers to pick up where the user left off, and the Study tab lists it.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useStore, type Drill } from "../store";
import { extractCards, extractMarks, type Card } from "../study/cards";
import { answerMatches, blanksFromCards, blanksFromMarks, makeQuiz, matchRounds, shuffle, type BlankItem, type MatchTile, type QuizItem } from "../study/modes";
import { blanksFromSet, pairsToCards, quizFromSet, type StudyChange, type StudySet } from "../study/generated";
import type { PlayedItem } from "../study/coach";
import { JeffAvatar } from "../icons";
import { IClose } from "../ui-icons";
import { agentName } from "../persona";
import { jeffModel } from "./AiTools";
import { StudyCoach } from "./StudyCoach";
import { keyToOption, QuizChoice, QuizReview, QuizTrack, QuizWhy, ScoreRing, type ChoiceState, type Seg } from "./QuizParts";
import { timeAgo } from "./ui";
import { keepSet, offlineError, savedSet } from "../study/offline";
import { dropUnfinished, getUnfinished, keepUnfinished, resumeAt, resumeKey, type ResumeKind } from "../study/resume";

const NAMES: Record<Drill["mode"], string> = { quiz: "Quiz", blanks: "Fill in the blanks", match: "Match" };
const WRITING: Record<Drill["mode"], string> = { quiz: "your quiz", blanks: "your sentences", match: "your pairs" };
type Missed = { prompt: string; answer: string; yours?: string; why?: string };
type QuizSave = { round: QuizItem[]; i: number; picked: number | null; missed: (Missed & { cardId: string })[]; times?: number[] };
type BlanksSave = { round: BlankItem[]; i: number; val: string; result: null | "right" | "wrong" | "shown"; hint: boolean; missed: (Missed & { id: string })[]; times?: number[] };
/** Seconds on each question, from showing it to answering (study/coach.ts studyInsights): the clock restarts when the question changes. */
function useQuestionClock(at: unknown) {
  const shown = useRef(Date.now());
  useEffect(() => { shown.current = Date.now(); }, [at]);
  return () => Math.round((Date.now() - shown.current) / 100) / 10;
}
const withTime = (t: number[], i: number, secs: number) => { const n = [...t]; n[i] = secs; return n; };
/** A game's saved state to start from, and how long had been spent on it. */
type Resumed<T> = { state: T; elapsed: number };
/** Called after every answer: the state to keep (null once it's finished or back at the start), answered so far, total, seconds spent. */
type Keep<T> = (state: T | null, done: number, total: number, elapsed: number) => void;

/** Saves the game's state whenever one of `deps` changes, and once more as it closes so the time since the last answer counts. */
function useKeep<T>(keep: Keep<T> | undefined, state: () => T | null, done: number, total: number, began: { current: number }, deps: unknown[]) {
  const save = useRef(() => {});
  save.current = () => keep?.(state(), done, total, Math.round((Date.now() - began.current) / 1000));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => save.current(), deps);
  useEffect(() => () => save.current(), []);
}
/** What was being studied, for the assistant's message on the results screen. */
const Info = createContext<{ ids: string[]; title: string; mode: Drill["mode"] }>({ ids: [], title: "", mode: "quiz" });

export function DrillView({ drill }: { drill: Drill }) {
  const s = useStore();
  const [title, setTitle] = useState("");
  const [loaded, setData] = useState<{ cards: Card[]; blanks: BlankItem[] } | null>(null);
  const [made, setMade] = useState<StudySet | null>(null);
  const [writing, setWriting] = useState(true);
  const [noWrite, setNoWrite] = useState(""); // why the assistant couldn't write this set
  const [round, setRound] = useState(0); // a new set restarts the game
  const [error, setError] = useState("");
  const toast = useRef(s.toast); toast.current = s.toast; // the store changes identity often; a new set must not follow it
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  // ---- unfinished: Match starts again, and a button asking for different questions means a fresh set
  const resumable = drill.mode !== "match" && !drill.change;
  const key = resumeKey(drill.mode as ResumeKind, drill.ids, drill.replay);
  const [saved] = useState(() => (resumable ? getUnfinished<QuizSave | BlanksSave>(key) : null));
  const [offer, setOffer] = useState(!!saved && !drill.resume); // "pick up where you left off?"
  const [resumed, setResumed] = useState<{ round: number; with: Resumed<QuizSave | BlanksSave> } | null>(() => (saved && drill.resume ? { round: 0, with: { state: saved.state, elapsed: saved.elapsed } } : null));
  const offerNow = useRef(offer); offerNow.current = offer;
  const titleNow = useRef(""); titleNow.current = drill.title ?? title;
  const madeNow = useRef<StudySet | null>(null); madeNow.current = made;
  const keep = useCallback<Keep<QuizSave | BlanksSave>>((state, done, total, elapsed) => {
    if (!resumable) return;
    if (!state) { dropUnfinished(key); return; }
    keepUnfinished({ key, kind: drill.mode as ResumeKind, ids: drill.ids, title: titleNow.current || "New page", replay: !!drill.replay, set: madeNow.current ?? undefined, at: Date.now(), done, total, elapsed, state });
  }, [resumable, key, drill.mode, drill.ids, drill.replay]);
  const close = useCallback(() => {
    if (resumable && !offerNow.current && getUnfinished(key)) toast.current("Saved where you left off. It's in the Study tab.");
    s.setDrill(null);
  }, [s, resumable, key]);

  const haveSet = useRef(false);
  const write = useCallback(async (fresh: boolean, change?: StudyChange) => {
    setWriting(true);
    try {
      const r = await api.studySet(drill.ids, drill.mode, fresh, jeffModel(), change);
      if (!live.current) return;
      setMade(r); setNoWrite(""); setRound((n) => n + 1); haveSet.current = true;
      keepSet(drill.mode, drill.ids, r); // for offline (study/offline.ts)
    } catch (e) {
      if (!live.current) return;
      const kept = offlineError(e) && !haveSet.current ? savedSet(drill.mode, drill.ids) : null;
      if (kept) { setMade(kept); setNoWrite(""); setRound((n) => n + 1); haveSet.current = true; toast.current("You're offline, so these are the questions you had last time"); setWriting(false); return; }
      if (haveSet.current) toast.current(`Couldn't write new questions: ${(e as Error).message}`); // keep the ones you have
      else setNoWrite((e as Error).message);
    }
    if (live.current) setWriting(false);
  }, [drill.ids, drill.mode]);

  useEffect(() => { // the questions: once the user's said whether to pick up where the user left off
    if (offer) return;
    if (drill.replay) { setMade(drill.replay); haveSet.current = true; setWriting(false); return; } // the same questions from History: no model
    if (resumed) { // the set it was playing, so no model call either (none if it came from the flashcards)
      if (saved?.set) { setMade(saved.set as StudySet); haveSet.current = true; }
      setWriting(false); return;
    }
    void write(!!drill.change, drill.change); // a button after the last session may have asked for different questions
  }, [offer, resumed, saved, drill.replay, drill.change, write]);

  useEffect(() => { // the page's notes: the title, and the flashcards a game falls back to
    if (drill.replay) { setTitle(drill.title ?? ""); setData({ cards: [], blanks: [] }); return; } // works even if the page has gone
    let on = true;
    Promise.all(drill.ids.map((id) => api.get(id))).then((notes) => {
      if (!on) return;
      const cards: Card[] = [], blanks: BlankItem[] = [], seen = new Set<string>();
      for (const n of notes) {
        // the same question on two pages of a subject is one card
        const cs = extractCards(n.html).filter((c) => !seen.has(c.id) && seen.add(c.id));
        cards.push(...cs);
        blanks.push(...blanksFromMarks(extractMarks(n.html)).map((x) => ({ ...x, id: `${n.id}-${x.id}` })), ...blanksFromCards(cs));
      }
      setTitle(drill.title ?? (notes[0]?.title || "New page"));
      setData({ cards, blanks });
    }).catch((e) => on && setError((e as Error).message));
    return () => { on = false; };
  }, [drill.ids, drill.title, drill.replay]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); close(); } };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  }, [close]);

  const onNew = made ? () => { setResumed(null); void write(true); } : undefined;
  const reason = noWrite && !made ? noWrite : "";
  const from = resumed && resumed.round === round ? resumed.with : undefined; // only the game it was saved from, not after "New questions"
  const data = loaded ?? (from || (error && made) ? { cards: [], blanks: [] } : null); // resuming, or a set kept for offline, needs nothing from the page
  const body = offer && saved ? (
    <div className="study-stage"><div className="study-empty drill-resume">
      <JeffAvatar size={56} />
      <b>Pick up where you left off?</b>
      <p>You were on {resumeAt(saved)}, {timeAgo(saved.at)}.</p>
      <div className="study-done-actions">
        <button onClick={() => { dropUnfinished(key); setOffer(false); }}>Start over</button>
        <button className="primary" autoFocus onClick={() => { setResumed({ round, with: { state: saved.state, elapsed: saved.elapsed } }); setOffer(false); }}>Resume</button>
      </div>
    </div></div>
  ) : error && !from && !made ? <p className="study-empty">Couldn't load this page: {error}</p>
    : !data || writing ? <div className="study-stage"><div className="study-empty drill-writing"><JeffAvatar size={64} mode="think" /><b>{agentName()} is writing {WRITING[drill.mode]}…</b><p>Just a few seconds. It stays saved until your notes change.</p></div></div>
    : drill.mode === "quiz" ? <QuizGame key={round} build={made?.mode === "quiz" ? () => quizFromSet(made.items) : () => makeQuiz(data.cards)} enough={made?.mode === "quiz" || data.cards.length >= 2 || !!from} reason={reason} resume={from as Resumed<QuizSave> | undefined} keep={keep as Keep<QuizSave>} onDone={close} onNew={onNew} />
    : drill.mode === "blanks" ? <BlanksGame key={round} items={made?.mode === "blanks" ? blanksFromSet(made.items) : data.blanks} reason={reason} resume={from as Resumed<BlanksSave> | undefined} keep={keep as Keep<BlanksSave>} onDone={close} onNew={onNew} />
    : <MatchGame key={round} cards={made?.mode === "match" ? pairsToCards(made.items) : data.cards} reason={reason} onDone={close} onNew={onNew} />;

  return (
    <div className="study drill" role="dialog" aria-label={`${NAMES[drill.mode]}: ${title}`}>
      <div className="study-top">
        <button className="ghost icon-btn" aria-label="Close (Esc)" title="Close (Esc)" onClick={close}><IClose size={20} /></button>
        <div className="study-title"><b>{title}</b><span className="study-practice">{NAMES[drill.mode]}</span></div>
        <span className="study-count" />
      </div>
      <Info.Provider value={{ ids: drill.ids, title: drill.title ?? title, mode: drill.mode }}>{body}</Info.Provider>
    </div>
  );
}

function Empty({ need, reason, onDone }: { need: string; reason?: string; onDone: () => void }) {
  return (
    <div className="study-stage"><div className="study-empty">
      <JeffAvatar size={56} />
      <b>Not enough to play with yet</b>
      {reason && <p>{reason}</p>}
      <p>{need} Write more on the page, or add a <strong>toggle</strong> (title = question, inside = answer) or a line like <code>Osmosis :: water moving across a membrane</code>.</p>
      <div className="study-done-actions"><button className="primary" onClick={onDone}>Done</button></div>
    </div></div>
  );
}

/** Shown above a game when the assistant couldn't write it and it came from the page's own flashcards instead. */
function Fallback({ reason }: { reason: string }) {
  return reason ? <p className="drill-note">{agentName()} couldn't write this one, so it comes straight from your flashcards. <span>{reason}</span></p> : null;
}

function Results({ right, total, missed, played, began, track, extra, onRetry, onAgain, onDone, onNew }: { right: number; total: number; missed: Missed[]; played: PlayedItem[]; began: number; track?: Seg[]; extra?: string; onRetry?: () => void; onAgain: () => void; onDone: () => void; onNew?: () => void }) {
  const pct = total ? Math.round((right / total) * 100) : 0;
  const info = useContext(Info);
  return (
    <div className="study-stage drill-end"><div className="study-empty drill-results">
      <ScoreRing right={right} total={total} />
      <b>{pct === 100 ? "Perfect!" : pct >= 80 ? "Nice work" : pct >= 50 ? "Getting there" : "Keep practising"}</b>
      {extra && <p>{extra}</p>}
      <StudyCoach session={{ ...info, right, total, missed: missed.map((m) => ({ q: m.prompt, a: m.answer, yours: m.yours })), played, seconds: Math.round((Date.now() - began) / 1000) }} />
      {track && <QuizTrack segs={track} />}
      {missed.length > 0 && <QuizReview items={missed.map((m) => ({ q: m.prompt, right: false, yours: m.yours, answer: m.answer, note: m.why }))} />}
      <div className="study-done-actions">
        {onRetry && missed.length > 0 && <button onClick={onRetry}>Try the {missed.length} missed</button>}
        <button onClick={onAgain}>Play again</button>
        {onNew && <button onClick={onNew}>New questions</button>}
        <button className="primary" onClick={onDone}>Done</button>
      </div>
    </div></div>
  );
}

function Progress({ at, of }: { at: number; of: number }) {
  return <div className="study-bar"><span style={{ width: `${Math.min(100, (at / Math.max(1, of)) * 100)}%` }} /></div>;
}

// ---------------------------------------------------------------- quiz
function QuizGame({ build, enough, reason, resume, keep, onDone, onNew }: { build: () => QuizItem[]; enough: boolean; reason: string; resume?: Resumed<QuizSave>; keep?: Keep<QuizSave>; onDone: () => void; onNew?: () => void }) {
  const [round, setRound] = useState(() => resume?.state.round ?? build());
  const [i, setI] = useState(resume?.state.i ?? 0);
  const [picked, setPicked] = useState<number | null>(resume?.state.picked ?? null);
  const [missed, setMissed] = useState<(Missed & { cardId: string })[]>(resume?.state.missed ?? []);
  const began = useRef(Date.now() - (resume?.elapsed ?? 0) * 1000);
  const [times, setTimes] = useState<number[]>(resume?.state.times ?? []);
  const clock = useQuestionClock(`${i}|${round.length}`);
  useKeep(keep, () => (i < round.length && (i > 0 || picked !== null) ? { round, i, picked, missed, times } : null), i + (picked === null ? 0 : 1), round.length, began, [round, i, picked, missed]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const q: QuizItem | undefined = round[i];
  const next = useCallback(() => { if (timer.current) clearTimeout(timer.current); timer.current = null; setPicked(null); setI((x) => x + 1); }, []);
  const pick = useCallback((k: number) => {
    if (!q || picked !== null) return;
    setPicked(k); setTimes((t) => withTime(t, i, clock()));
    if (k !== q.answer) setMissed((m) => [...m, { cardId: q.cardId, prompt: q.prompt, yours: q.options[k], answer: q.options[q.answer], why: q.why }]);
    else if (!q.why) timer.current = setTimeout(next, 700); // nothing to read, so move on
  }, [q, picked, next]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!q || e.ctrlKey || e.metaKey || e.altKey) return;
      const n = keyToOption(e.key, q.options.length);
      if (n >= 0 && picked === null) { e.preventDefault(); pick(n); }
      else if ((e.key === "Enter" || e.key === " ") && picked !== null) { e.preventDefault(); next(); }
    };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  }, [q, picked, pick, next]);
  const restart = (only?: Set<string>) => { began.current = Date.now(); setRound(build().filter((x) => !only || only.has(x.cardId))); setI(0); setPicked(null); setMissed([]); setTimes([]); };

  if (!enough) return <Empty need="A quiz needs a little more to go on." reason={reason} onDone={onDone} />;
  const wrongIds = new Set(missed.map((m) => m.cardId));
  const track: Seg[] = round.map((x, k) => (k < i ? (wrongIds.has(x.cardId) ? "wrong" : "right") : k > i ? "todo" : picked === null ? "now" : picked === x.answer ? "right" : "wrong"));
  if (!q) return <Results right={round.length - missed.length} total={round.length} missed={missed} track={track} began={began.current} played={round.map((x, k) => { const m = missed.find((y) => y.cardId === x.cardId), answer = x.options[x.answer]; return { type: "mcq", q: x.prompt, answer, right: !m, yours: m?.yours ?? answer, options: x.options, correct: x.answer, why: x.why, ...(x.miss ? { miss: x.miss } : {}), ...(times[k] ? { secs: times[k] } : {}) }; })} onRetry={() => restart(wrongIds)} onAgain={() => restart()} onDone={onDone} onNew={onNew} />;
  const stateOf = (k: number): ChoiceState => (picked === null ? "" : k === q.answer ? "right" : k === picked ? "wrong" : "dim");
  return (
    <>
      <QuizTrack segs={track} />
      <Fallback reason={reason} />
      <div className="study-stage qz-stage">
        <div className="qz">
          <span className="qz-kicker">{q.reverse ? "Which term is this?" : `Question ${i + 1}`} <small>of {round.length}</small></span>
          <h2 className="qz-q">{q.prompt}</h2>
          <div className="qz-options">{q.options.map((o, k) => <QuizChoice key={k} index={k} text={o} state={stateOf(k)} locked={picked !== null} onPick={() => pick(k)} />)}</div>
          {picked !== null && (q.why || picked !== q.answer) && <QuizWhy right={picked === q.answer} text={q.why} />}
        </div>
      </div>
      <div className="study-foot qz-foot"><button className={`primary study-show ${picked === null ? "qz-wait" : ""}`} tabIndex={picked === null ? -1 : 0} onClick={next}>{i + 1 < round.length ? "Next" : "See results"} <kbd>Enter</kbd></button></div>
    </>
  );
}

// ---------------------------------------------------------------- fill in the blanks
function BlanksGame({ items, reason, resume, keep, onDone, onNew }: { items: BlankItem[]; reason: string; resume?: Resumed<BlanksSave>; keep?: Keep<BlanksSave>; onDone: () => void; onNew?: () => void }) {
  const [round, setRound] = useState(() => resume?.state.round ?? shuffle(items));
  const [i, setI] = useState(resume?.state.i ?? 0);
  const [val, setVal] = useState(resume?.state.result ? resume.state.val : "");
  const [result, setResult] = useState<null | "right" | "wrong" | "shown">(resume?.state.result ?? null);
  const [hint, setHint] = useState(resume?.state.hint ?? false);
  const [missed, setMissed] = useState<(Missed & { id: string })[]>(resume?.state.missed ?? []);
  const began = useRef(Date.now() - (resume?.elapsed ?? 0) * 1000);
  // what's typed but not yet checked isn't kept (no save per keystroke)
  const [times, setTimes] = useState<number[]>(resume?.state.times ?? []);
  const clock = useQuestionClock(`${i}|${round.length}`);
  useKeep(keep, () => (i < round.length && (i > 0 || result) ? { round, i, val: result ? val : "", result, hint, missed, times } : null), i + (result ? 1 : 0), round.length, began, [round, i, result, hint, missed]);
  const input = useRef<HTMLInputElement>(null), nextBtn = useRef<HTMLButtonElement>(null);
  const it = round[i];
  // the field locks once checked, so Enter moves on from the Next button
  useEffect(() => { if (!result) input.current?.focus(); else nextBtn.current?.focus(); }, [i, result]);
  const next = () => { setI((x) => x + 1); setVal(""); setResult(null); setHint(false); };
  const check = () => {
    if (!it || result) return;
    if (!val.trim()) return;
    const ok = answerMatches(it.answer, val);
    setResult(ok ? "right" : "wrong"); setTimes((t) => withTime(t, i, clock()));
    if (!ok) setMissed((m) => [...m, { id: it.id, prompt: `${it.before}_____${it.after}`.trim(), answer: it.answer, yours: val.trim() }]);
  };
  const reveal = () => { if (!it || result) return; setResult("shown"); setTimes((t) => withTime(t, i, clock())); setMissed((m) => [...m, { id: it.id, prompt: `${it.before}_____${it.after}`.trim(), answer: it.answer }]); };
  const restart = (only?: Set<string>) => { began.current = Date.now(); setRound(shuffle(only ? items.filter((x) => only.has(x.id)) : items)); setI(0); setVal(""); setResult(null); setHint(false); setMissed([]); setTimes([]); };

  if (!round.length) return <Empty need="Fill in the blanks needs a little more to go on." reason={reason} onDone={onDone} />;
  if (!it) return <Results right={round.length - missed.length} total={round.length} missed={missed} began={began.current} played={round.map((x, k) => { const m = missed.find((y) => y.id === x.id); return { type: "blank", q: `${x.before}_____${x.after}`.trim(), answer: x.answer, right: !m, yours: m ? m.yours : x.answer, before: x.before, after: x.after, clue: x.clue, ...(times[k] ? { secs: times[k] } : {}) }; })} onRetry={() => restart(new Set(missed.map((m) => m.id)))} onAgain={() => restart()} onDone={onDone} onNew={onNew} />;
  const width = `${Math.max(5, Math.min(22, it.answer.length + 2))}ch`;
  return (
    <>
      <Progress at={i} of={round.length} />
      <Fallback reason={reason} />
      <div className="study-stage">
        <form className="drill-q" onSubmit={(e) => { e.preventDefault(); if (result) next(); else check(); }}>
          <span className="drill-kicker">Fill in the blank · {i + 1} of {round.length}</span>
          {it.clue && <div className="drill-clue">{it.clue}</div>}
          <div className="drill-sentence">
            {it.before}
            <span className={`drill-blank ${result ?? ""}`}>
              {result && result !== "right"
                ? <><s>{val || "…"}</s> <b>{it.answer}</b></>
                : <input ref={input} value={val} disabled={!!result} onChange={(e) => setVal(e.target.value)} style={{ width }} aria-label="Missing word" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder={hint ? `${it.answer[0]}…` : ""} />}
            </span>
            {it.after}
          </div>
          <div className="drill-row">
            {!result ? <>
              <button type="button" className="ghost" onClick={() => setHint(true)} disabled={hint}>Hint</button>
              <button type="button" className="ghost" onClick={reveal}>Show answer</button>
              <button type="submit" className="primary" disabled={!val.trim()}>Check <kbd>Enter</kbd></button>
            </> : <>
              <span className={`drill-verdict ${result}`}>{result === "right" ? "Correct!" : result === "wrong" ? "Not quite" : "Here's the answer"}</span>
              <button ref={nextBtn} type="submit" className="primary">Next <kbd>Enter</kbd></button>
            </>}
          </div>
        </form>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- match
function MatchGame({ cards, reason, onDone, onNew }: { cards: Card[]; reason: string; onDone: () => void; onNew?: () => void }) {
  const [rounds, setRounds] = useState(() => matchRounds(cards));
  const [r, setR] = useState(0);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<MatchTile | null>(null);
  const [bad, setBad] = useState<string[]>([]);
  const [mistakes, setMistakes] = useState(0);
  const [start, setStart] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [end, setEnd] = useState<number | null>(null);
  const tiles = rounds[r] ?? [];
  useEffect(() => { if (end) return; const t = setInterval(() => setNow(Date.now()), 200); return () => clearInterval(t); }, [end]);
  useEffect(() => {
    if (!tiles.length || gone.size < tiles.length) return;
    const t = setTimeout(() => { if (r + 1 < rounds.length) { setR(r + 1); setGone(new Set()); } else setEnd(Date.now()); }, 350);
    return () => clearTimeout(t);
  }, [gone, tiles.length, r, rounds.length]);
  const tap = (t: MatchTile) => {
    if (gone.has(t.key) || bad.length) return;
    if (!sel) { setSel(t); return; }
    if (sel.key === t.key) { setSel(null); return; }
    if (sel.pair === t.pair && sel.side !== t.side) { setGone((g) => new Set(g).add(sel.key).add(t.key)); setSel(null); return; }
    setMistakes((m) => m + 1); setBad([sel.key, t.key]); setSel(null);
    setTimeout(() => setBad([]), 550);
  };
  const again = () => { setRounds(matchRounds(cards)); setR(0); setGone(new Set()); setSel(null); setMistakes(0); setStart(Date.now()); setNow(Date.now()); setEnd(null); };
  const secs = Math.floor(((end ?? now) - start) / 1000);
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  const matched = useMemo(() => rounds.slice(0, r).reduce((n, x) => n + x.length / 2, 0) + gone.size / 2, [rounds, r, gone]);

  if (cards.length < 2) return <Empty need="Match needs at least two pairs to play." reason={reason} onDone={onDone} />;
  if (end) return <Results right={cards.length} total={cards.length + mistakes} missed={[]} began={start} played={cards.map((c) => ({ type: "pair", q: c.question, answer: c.answerText, right: true }))} extra={`All ${cards.length} matched in ${clock} with ${mistakes} wrong pair${mistakes === 1 ? "" : "s"}.`} onAgain={again} onDone={onDone} onNew={onNew} />;
  return (
    <>
      <Progress at={matched} of={cards.length} />
      <Fallback reason={reason} />
      <div className="study-stage">
        <div className="drill-match">
          <div className="drill-match-top"><span className="drill-kicker">Tap a term, then its answer · round {r + 1} of {rounds.length}</span><span className="drill-clock">{clock}</span></div>
          <div className="drill-tiles">
            {tiles.map((t) => (
              <button key={t.key} className={`tile ${t.side} ${gone.has(t.key) ? "gone" : ""} ${sel?.key === t.key ? "sel" : ""} ${bad.includes(t.key) ? "bad" : ""}`} disabled={gone.has(t.key)} onClick={() => tap(t)}>{t.text}</button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
