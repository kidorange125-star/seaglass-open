// History: every finished quiz, fill in the blanks, match and practice test, newest first. Open one to see each question
// and what you answered, then retake exactly those questions, or just the ones you missed (no model call: they're the
// saved ones). Sessions from before this was saved in full only have their score and misses. Data: worker/coach.ts.
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ListChecks, PenLine, Puzzle, Sparkles, TextCursorInput } from "lucide-react";
import { api, type PastSession, type PastSummary } from "../api";
import { useStore, type PastTarget } from "../store";
import { IClose } from "../ui-icons";
import { QuizReview, ScoreRing } from "./QuizParts";
import { explainFromPlayed, pctOf, reviewOf, setFromPlayed, testFromPlayed } from "../study/coach";

const NAMES: Record<PastSummary["mode"], string> = { quiz: "Quiz", blanks: "Fill in the blanks", match: "Match", test: "Practice test", explain: "Explain it", cards: "Flashcards", chat: "Chat", focus: "Focus" };
const ICON = { quiz: <ListChecks size={20} />, blanks: <TextCursorInput size={20} />, match: <Puzzle size={20} />, test: <Sparkles size={20} />, explain: <PenLine size={20} /> } as Record<PastSummary["mode"], React.ReactNode>;
const when = (at: number) => new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function StudyHistory({ target }: { target: PastTarget }) {
  const s = useStore();
  const [list, setList] = useState<PastSummary[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<PastSession | null>(null);
  const [opening, setOpening] = useState("");

  const store = useRef(s); store.current = s; // the store changes identity often
  const shown = useRef(open); shown.current = open;
  useEffect(() => {
    if (target.ids && !target.ids.length) { setList([]); return; }
    let on = true;
    api.studyHistory(target.ids).then((r) => { if (on) setList(r.sessions); }).catch((e) => { if (on) setError((e as Error).message); });
    return () => { on = false; };
  }, [target.ids]);
  useEffect(() => { if (target.open) api.studyPast(target.open).then(setOpen).catch(() => {}); }, [target.open]); // straight to one from the tab's Recent
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key !== "Escape") return; e.preventDefault(); if (shown.current) setOpen(null); else store.current.setPast(null); };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  }, []);

  const view = async (p: PastSummary) => {
    setOpening(p.id);
    try { setOpen(await api.studyPast(p.id)); } catch (e) { s.toast(`Couldn't open that one: ${(e as Error).message}`); }
    setOpening("");
  };
  const retake = (p: PastSession, onlyMissed: boolean) => {
    const items = onlyMissed ? (p.played ?? []).filter((x) => !x.right) : p.played ?? [];
    if (!items.length) return;
    s.setPast(null);
    if (p.mode === "test") s.setQuiz(p.ids, testFromPlayed(items));
    else if (p.mode === "explain") s.setExplain({ ids: p.ids, title: p.title, replay: explainFromPlayed(items), nonce: Date.now() });
    else if (p.mode === "quiz" || p.mode === "blanks" || p.mode === "match") s.setDrill({ ids: p.ids, title: p.title, mode: p.mode, nonce: Date.now(), replay: setFromPlayed(p.mode, items) });
  };

  const wrong = open?.played?.filter((x) => !x.right).length ?? 0;
  const heading = open ? NAMES[open.mode] : "History";
  const sub = open ? open.title : target.title ?? "All your quizzes and tests";
  return (
    <div className="study study-history" role="dialog" aria-label={heading}>
      <div className="study-top">
        {open
          ? <button className="ghost icon-btn" aria-label="Back to History" title="Back (Esc)" onClick={() => setOpen(null)}><ChevronLeft size={22} /></button>
          : <button className="ghost icon-btn" aria-label="Close (Esc)" title="Close (Esc)" onClick={() => s.setPast(null)}><IClose size={20} /></button>}
        <div className="study-title"><b>{heading}</b><span className="study-practice">{sub}</span></div>
        <span className="study-count" />
      </div>
      <div className="study-stage drill-end">
        {open ? (
          <div className="study-empty drill-results">
            <ScoreRing right={open.right} total={open.total} />
            <p className="sh-when">{when(open.created_at)}{open.seconds ? ` · ${open.seconds < 60 ? "under a minute" : `${Math.round(open.seconds / 60)} min`}` : ""}</p>
            {open.played
              ? <QuizReview items={open.played.map(reviewOf)} />
              : <>
                <p>This one is from before full history was saved, so only what you missed is here.</p>
                {open.missed.length > 0 && <QuizReview items={open.missed.map((m) => ({ q: m.q, right: false, yours: m.yours, answer: m.a }))} />}
              </>}
            <div className="study-done-actions">
              {wrong > 0 && <button onClick={() => retake(open, true)}>Retake the {wrong} missed</button>}
              {open.played && <button className="primary" onClick={() => retake(open, false)}>Retake</button>}
              <button className={open.played ? "" : "primary"} onClick={() => setOpen(null)}>Back</button>
            </div>
          </div>
        ) : error ? <p className="study-empty">Couldn't load your history: {error}</p>
          : list === null ? <div className="sh-list"><div className="st-skel" /></div>
          : !list.length ? <div className="study-empty"><b>Nothing here yet</b><p>Finish a quiz, fill in the blanks, match or practice test and it'll be saved here to look back on or retake.</p></div>
          : (
            <div className="sh-list">
              {list.map((p) => {
                const pct = pctOf(p);
                return (
                  <button key={p.id} className="sh-row" disabled={!!opening} onClick={() => void view(p)}>
                    <span className="i">{ICON[p.mode]}</span>
                    <span className="t"><b>{p.title}</b><small>{NAMES[p.mode]} · {when(p.created_at)}</small></span>
                    <span className={`sh-score ${pct >= 80 ? "great" : pct >= 50 ? "ok" : "low"}`}>{pct}%</span>
                  </button>
                );
              })}
            </div>
          )}
      </div>
    </div>
  );
}
