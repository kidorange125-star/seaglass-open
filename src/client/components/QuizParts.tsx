// The pieces both quizzes are made of (the Quiz game in DrillView, the Practice test in AiTools), so they look and
// behave the same: a track with one segment per question that colours in as you go, answer buttons, the "why" under
// an answer, and the score ring with the review list on the results.
import { Check, X } from "lucide-react";

export type Seg = "todo" | "now" | "right" | "wrong" | "open";

/** One segment per question: your run so far at a glance. "open" = answered, marked at the end (written answers). */
export function QuizTrack({ segs }: { segs: Seg[] }) {
  const done = segs.filter((x) => x !== "todo" && x !== "now").length;
  return <div className="qz-track" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={segs.length} aria-valuenow={done}>{segs.map((x, i) => <i key={i} className={x} />)}</div>;
}

export type ChoiceState = "" | "right" | "wrong" | "dim";

export function QuizChoice({ index, text, state, locked, onPick }: { index: number; text: string; state: ChoiceState; locked: boolean; onPick: () => void }) {
  return (
    <button className={`qz-opt ${state}`} disabled={locked} onClick={onPick}>
      <span className="qz-key" aria-hidden="true">{state === "right" ? <Check size={15} strokeWidth={3} /> : state === "wrong" ? <X size={15} strokeWidth={3} /> : "ABCDE"[index]}</span>
      <span className="qz-text">{text}</span>
    </button>
  );
}

export function QuizWhy({ right, text }: { right: boolean; text?: string }) {
  return <p className={`qz-why ${right ? "right" : "wrong"}`} role="status"><b>{right ? "Right." : "Not quite."}</b>{text ? ` ${text}` : ""}</p>;
}

/** Number keys and letters pick an answer: which option a key means, or -1. */
export function keyToOption(key: string, count: number) {
  const n = /^[1-9]$/.test(key) ? Number(key) - 1 : /^[a-e]$/i.test(key) ? key.toLowerCase().charCodeAt(0) - 97 : -1;
  return n < count ? n : -1;
}

export function ScoreRing({ right, total }: { right: number; total: number }) {
  const pct = total ? Math.round((right / total) * 100) : 0;
  return <div className={`drill-score ${pct >= 80 ? "great" : pct >= 50 ? "ok" : "low"}`} style={{ "--p": pct } as React.CSSProperties}><span><b>{pct}%</b><small>{right} of {total}</small></span></div>;
}

export interface Review { q: string; right: boolean; yours?: string; answer?: string; note?: string }

export function QuizReview({ items }: { items: Review[] }) {
  return (
    <div className="qz-review">
      {items.map((x, i) => (
        <div key={i} className={`qz-rev ${x.right ? "right" : "wrong"}`}>
          <span className="qz-key" aria-label={x.right ? "Right" : "Wrong"}>{x.right ? <Check size={15} strokeWidth={3} /> : <X size={15} strokeWidth={3} />}</span>
          <div className="t">
            <b>{x.q}</b>
            {x.yours !== undefined && !x.right && <span className="yours">{x.yours}</span>}
            {x.yours !== undefined && x.right && <span>{x.yours}</span>}
            {!x.right && x.answer && <span className="ans">{x.answer}</span>}
            {x.note && <small>{x.note}</small>}
          </div>
        </div>
      ))}
    </div>
  );
}
