// Explain it: The user explains an idea from their notes in their own words, and the assistant points out exactly what's off (worker
// ai.ts explainPrompts / checkExplain). Written answers are where their real misses are, so this counts like a practice test
// toward a page's score (MODE_WEIGHT). The first try at each prompt is what's scored; "Try again" lets them fix it and see the
// feedback change. Saved as an "explain" session with every answer, so History can retake the same prompts, and the ones
// The user didn't get right come back as missed questions. Full screen, the same .study shell as the practice test.
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useStore, type ExplainTarget } from "../store";
import { JeffAvatar } from "../icons";
import { IClose } from "../ui-icons";
import { agentName } from "../persona";
import { jeffModel } from "./AiTools";
import { QuizReview, QuizTrack, ScoreRing, type Seg } from "./QuizParts";
import { StudyCoach } from "./StudyCoach";
import { checkLine, POINTS_SEP, type ExplainCheck, type ExplainPrompt } from "../study/coach";

type Item = { text: string; first: ExplainCheck | null; firstText: string; check: ExplainCheck | null; tries: number; secs?: number };
const VERDICT: Record<ExplainCheck["verdict"], string> = { right: "Spot on", partly: "Partly there", off: "Not quite" };
const blank = (): Item => ({ text: "", first: null, firstText: "", check: null, tries: 0 });

export function ExplainView({ target }: { target: ExplainTarget }) {
  const s = useStore();
  const { ids, replay } = target;
  const [count, setCount] = useState(3);
  const [phase, setPhase] = useState<"setup" | "loading" | "asking" | "checking" | "done">(replay?.length ? "asking" : "setup");
  const [prompts, setPrompts] = useState<ExplainPrompt[]>(replay ?? []);
  const [items, setItems] = useState<Item[]>(() => (replay ?? []).map(blank));
  const [i, setI] = useState(0);
  const [err, setErr] = useState("");
  const title = useMemo(() => target.title ?? ids.map((id) => s.byId.get(id)?.title || "this page").join(", "), [target.title, ids, s.byId]);
  const began = useRef(Date.now());
  const shownAt = useRef(Date.now()); // the clock for each idea, to its first check
  useEffect(() => { shownAt.current = Date.now(); }, [i, prompts]);
  const box = useRef<HTMLTextAreaElement>(null);
  const close = () => s.setExplain(null);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") close(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); });

  const start = async () => {
    setPhase("loading"); setErr("");
    try {
      const r = await api.explainPrompts(ids, count, jeffModel());
      began.current = Date.now();
      setPrompts(r.prompts); setItems(r.prompts.map(blank)); setI(0); setPhase("asking");
    } catch (e) { setErr((e as Error).message); setPhase("setup"); }
  };
  const p = prompts[i], it = items[i] ?? blank();
  const set = (k: number, x: Partial<Item>) => setItems((xs) => xs.map((y, j) => (j === k ? { ...y, ...x } : y)));
  const check = async () => {
    const text = it.text.trim();
    if (!p || !text || phase === "checking") return;
    setPhase("checking"); setErr("");
    try {
      const c = await api.checkExplain({ ids, q: p.q, points: p.points, answer: text, model: jeffModel() });
      set(i, { check: c, tries: it.tries + 1, ...(it.first ? {} : { first: c, firstText: text, secs: Math.round((Date.now() - shownAt.current) / 100) / 10 }) }); // the first try is the one scored
    } catch (e) { setErr((e as Error).message); }
    setPhase("asking");
  };
  const again = () => { set(i, { check: null }); setTimeout(() => box.current?.focus(), 0); };
  const next = () => { if (i + 1 < prompts.length) { setI(i + 1); setErr(""); } else setPhase("done"); };
  const restart = () => { began.current = Date.now(); setItems(prompts.map(blank)); setI(0); setPhase("asking"); };

  const right = items.filter((x) => x.first?.verdict === "right").length;
  const track: Seg[] = prompts.map((_, k) => { const f = items[k]?.first; return f ? (f.verdict === "right" ? "right" : "wrong") : k === i ? "now" : "todo"; });
  const c = it.check;

  return (
    <div className="study quiz explain" role="dialog" aria-label="Explain it">
      <div className="study-top">
        <button className="ghost icon-btn" aria-label="Close (Esc)" title="Close (Esc)" onClick={close}><IClose size={20} /></button>
        <div className="study-title"><b>Explain it</b><span className="study-practice">{title}</span></div>
        <span className="study-count">{phase === "asking" || phase === "checking" ? `${i + 1} / ${prompts.length}` : ""}</span>
      </div>
      {prompts.length > 0 && phase !== "setup" && phase !== "loading" ? <QuizTrack segs={track} /> : <div className="qz-track-gap" />}
      <div className={`study-stage ${phase === "asking" || phase === "checking" ? "qz-stage" : phase === "done" ? "drill-end" : ""}`}>
        {phase === "setup" && (
          <div className="study-empty">
            <JeffAvatar size={56} />
            <b>Explain {title} in your own words</b>
            <p>{agentName()} picks the big ideas from your notes. Write each one out like you would on a test, and {agentName()} tells you exactly what's missing or off.</p>
            <div className="seg quiz-count">{[3, 5].map((n) => <button key={n} className={count === n ? "on" : ""} onClick={() => setCount(n)}>{n} ideas</button>)}</div>
            {err && <p className="when-err">{err}</p>}
            <div className="study-done-actions"><button className="primary" onClick={() => void start()}>Start</button></div>
          </div>
        )}
        {phase === "loading" && <div className="study-empty"><JeffAvatar size={56} mode="think" /><b>Picking the big ideas…</b></div>}
        {(phase === "asking" || phase === "checking") && p && (
          <div className="qz ex">
            <span className="qz-kicker">Idea {i + 1} <small>of {prompts.length}</small></span>
            <h2 className="qz-q">{p.q}</h2>
            {!c ? (
              <>
                <textarea ref={box} className="qz-write" rows={6} autoFocus placeholder="Explain it the way you'd write it on a test." value={it.text} disabled={phase === "checking"}
                  onChange={(e) => set(i, { text: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void check(); } }} />
                {err && <p className="when-err">{err}</p>}
              </>
            ) : (
              <div className={`ex-check ${c.verdict}`} aria-live="polite">
                <b className="ex-verdict">{VERDICT[c.verdict]}{it.tries > 1 ? <small> on try {it.tries}</small> : null}</b>
                <blockquote className="ex-said">{it.text.trim()}</blockquote>
                {c.got.length > 0 && <div className="ex-list got"><h4>You got</h4><ul>{c.got.map((x, k) => <li key={k}>{x}</li>)}</ul></div>}
                {c.missing.length > 0 && <div className="ex-list missing"><h4>Missing</h4><ul>{c.missing.map((x, k) => <li key={k}>{x}</li>)}</ul></div>}
                {c.wrong.length > 0 && <div className="ex-list wrong"><h4>Not quite right</h4><ul>{c.wrong.map((w, k) => <li key={k}>{w.said && <><s>{w.said}</s> </>}{w.fix}</li>)}</ul></div>}
                {c.tip && <p className="ex-tip"><JeffAvatar size={24} /> {c.tip}</p>}
                {it.tries > 1 && it.first && it.first.verdict !== "right" && <p className="ex-note">Your first try is what counts toward your score.</p>}
              </div>
            )}
          </div>
        )}
        {phase === "done" && (
          <div className="study-empty drill-results">
            <ScoreRing right={right} total={prompts.length} />
            <b>{right === prompts.length ? "You explained every one" : right >= prompts.length * 0.6 ? "Nice work" : "Getting there"}</b>
            <StudyCoach session={{ mode: "explain", ids, title, right, total: prompts.length,
              missed: prompts.map((q, k) => ({ q, x: items[k] })).filter(({ x }) => x.first?.verdict !== "right").map(({ q, x }) => ({ q: q.q, a: q.points.join("; "), yours: x.firstText.slice(0, 200) || undefined })),
              seconds: Math.round((Date.now() - began.current) / 1000),
              played: prompts.map((q, k) => ({ type: "short" as const, q: q.q, answer: q.points.join(POINTS_SEP), right: items[k].first?.verdict === "right", yours: items[k].firstText || undefined, feedback: items[k].first ? checkLine(items[k].first!) : undefined, ...(items[k].secs ? { secs: items[k].secs } : {}) })) }} />
            <QuizReview items={prompts.map((q, k) => ({ q: q.q, right: items[k].first?.verdict === "right", yours: items[k].firstText || "(skipped)", answer: q.points.join("; "), note: items[k].first ? checkLine(items[k].first!) : undefined }))} />
          </div>
        )}
      </div>
      <div className="study-foot">
        {phase !== "done" && phase !== "setup" && phase !== "loading" && p && (!c
          ? <div className="study-done-actions ex-actions">
              <button className="ghost" disabled={phase === "checking"} onClick={next}>Skip</button>
              <button className="primary" disabled={!it.text.trim() || phase === "checking"} onClick={() => void check()}>{phase === "checking" ? "Checking…" : "Check"}{phase !== "checking" && <kbd>Ctrl Enter</kbd>}</button>
            </div>
          : <div className="study-done-actions ex-actions">
              {c.verdict !== "right" && <button onClick={again}>Try again</button>}
              <button className="primary" autoFocus onClick={next}>{i + 1 < prompts.length ? "Next idea" : "See results"}</button>
            </div>)}
        {phase === "done" && (
          <div className="study-done-actions">
            <button onClick={restart}>Explain them again</button>
            <button onClick={() => setPhase("setup")}>New ideas</button>
            <button className="ghost" onClick={close}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
}
