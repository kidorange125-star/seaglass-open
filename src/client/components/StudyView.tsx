// Study mode: flashcards from a page (or several: a subject, or everything due), with spaced repetition. Full screen,
// one card at a time: Space shows the answer, 1-4 grades it (Again / Hard / Good / Easy). "Again" brings the card back
// later in the session. Cards come from the pages themselves (see study/cards.ts); progress is saved per page and
// card (study/srs.ts), so a card keeps its schedule whichever session reviews it.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useStore, type StudyTarget } from "../store";
import { extractCards, type Card } from "../study/cards";
import { GRADES, hint, newState, review, type CardState, type Grade } from "../study/srs";
import { JeffAvatar } from "../icons";
import { IClose } from "../ui-icons";
import { dueLabel } from "./Tasks";
import { agentName } from "../persona";
import { StudyCoach } from "./StudyCoach";
import type { SessionMiss } from "../study/coach";

const NEW_PER_SESSION = 20;
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const LABEL: Record<Grade, string> = { again: "Again", hard: "Hard", good: "Good", easy: "Easy" };

type PCard = Card & { note: string; key: string };

export function StudyView({ target }: { target: StudyTarget }) {
  const s = useStore();
  const today = useMemo(todayIso, []);
  const ids = useMemo(() => (typeof target === "string" ? [target] : target.ids), [target]);
  const dueOnly = typeof target !== "string" && !!target.dueOnly;
  const [title, setTitle] = useState(typeof target === "string" ? "" : target.title);
  const [cards, setCards] = useState<PCard[] | null>(null);
  const [states, setStates] = useState<Map<string, CardState>>(new Map());
  const [queue, setQueue] = useState<string[]>([]);
  const [pos, setPos] = useState(0);
  const [shown, setShown] = useState(false);
  const [practice, setPractice] = useState(false);
  const [stats, setStats] = useState({ reviewed: 0, again: 0 });
  const [missed, setMissed] = useState<SessionMiss[]>([]);
  const [error, setError] = useState("");
  const began = useRef(Date.now());

  const close = useCallback(() => s.setStudy(null), [s]);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const loaded = await Promise.all(ids.map(async (nid) => {
          const [note, rows] = await Promise.all([api.get(nid), api.studyStates(nid)]);
          return { nid, note, rows };
        }));
        if (!live) return;
        const found: PCard[] = [], map = new Map<string, CardState>();
        for (const { nid, note, rows } of loaded) {
          const cs = extractCards(note.html);
          found.push(...cs.map((c) => ({ ...c, note: nid, key: `${nid}:${c.id}` })));
          for (const r of rows) map.set(`${nid}:${r.card_id}`, { ease: r.ease, interval: r.interval, reps: r.reps, lapses: r.lapses, due: r.due });
          if (rows.length) void api.studyPrune(nid, cs.map((c) => c.id)).catch(() => {});
        }
        if (typeof target === "string") setTitle(loaded[0]?.note.title || "New page");
        setCards(found); setStates(map);
        const due = found.filter((c) => map.get(c.key) && map.get(c.key)!.due <= today).map((c) => c.key);
        const fresh = dueOnly ? [] : found.filter((c) => !map.has(c.key)).slice(0, NEW_PER_SESSION).map((c) => c.key);
        setQueue([...due, ...fresh]);
      } catch (e) { if (live) setError((e as Error).message); }
    })();
    return () => { live = false; };
  }, [ids, today, dueOnly, target]);

  const byId = useMemo(() => new Map((cards ?? []).map((c) => [c.key, c])), [cards]);
  const card = queue[pos] ? byId.get(queue[pos]) : undefined;
  const state = card ? states.get(card.key) ?? newState(today) : undefined;
  const finished = cards !== null && pos >= queue.length;

  const grade = useCallback((g: Grade) => {
    if (!card || !state || !shown) return;
    const next = review(state, g, today);
    if (!practice) {
      setStates((m) => new Map(m).set(card.key, next));
      void api.studySave(card.note, card.id, next).catch(() => s.toast("Couldn't save that answer. Check your connection."));
    }
    setStats((x) => ({ reviewed: x.reviewed + 1, again: x.again + (g === "again" ? 1 : 0) }));
    if (g === "again") { setQueue((q) => [...q, card.key]); setMissed((m) => (m.some((x) => x.q === card.question) ? m : [...m, { q: card.question, a: card.answerText }])); }
    setPos((p) => p + 1); setShown(false);
  }, [card, state, shown, today, practice, s]);

  const practiceAll = () => { setPractice(true); setQueue((cards ?? []).map((c) => c.key)); setPos(0); setShown(false); setStats({ reviewed: 0, again: 0 }); setMissed([]); };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (finished || !card) return;
      if (!shown && (e.key === " " || e.key === "Enter")) { e.preventDefault(); setShown(true); return; }
      const i = ["1", "2", "3", "4"].indexOf(e.key);
      if (shown && i >= 0) { e.preventDefault(); grade(GRADES[i]); }
    };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  }, [card, shown, finished, grade, close]);

  const nextReview = useMemo(() => {
    const ds = [...states.values()].map((x) => x.due).filter((d) => d > today).sort();
    return ds[0] ? dueLabel(ds[0], today).text : null;
  }, [states, today]);
  const left = Math.max(0, queue.length - pos);

  return (
    <div className="study" role="dialog" aria-label={`Study ${title}`}>
      <div className="study-top">
        <button className="ghost icon-btn" aria-label="Close study mode (Esc)" title="Close (Esc)" onClick={close}><IClose size={20} /></button>
        <div className="study-title"><b>{title}</b>{practice && <span className="study-practice">Practice: progress isn't saved</span>}</div>
        <span className="study-count">{cards && !finished ? `${left} left` : ""}</span>
      </div>
      {cards && queue.length > 0 && <div className="study-bar"><span style={{ width: `${Math.min(100, (pos / queue.length) * 100)}%` }} /></div>}

      <div className="study-stage">
        {error ? <p className="study-empty">Couldn't load this page: {error}</p>
          : cards === null ? <div className="study-card skeleton" />
          : cards.length === 0 ? (
            <div className="study-empty">
              <JeffAvatar size={56} />
              <b>{ids.length > 1 ? "No flashcards on these pages yet" : "No flashcards on this page yet"}</b>
              <p>Write a <strong>toggle</strong> (its title is the question, what's inside is the answer) or a line like <code>Mitosis :: cell division into two identical cells</code>. Or ask {agentName()} to make flashcards from your notes.</p>
            </div>
          ) : finished ? (
            <div className="study-empty">
              <JeffAvatar size={56} />
              <b>{stats.reviewed ? "Session complete" : "You're all caught up"}</b>
              <p>{stats.reviewed ? `You reviewed ${stats.reviewed} card${stats.reviewed === 1 ? "" : "s"}${stats.again ? `, ${stats.again} needed another look` : ""}.` : (ids.length > 1 ? "Nothing is due here right now." : "Nothing is due on this page right now.")}
                {!practice && nextReview ? ` Next review: ${nextReview}.` : ""}</p>
              {stats.reviewed > 0 && <StudyCoach session={{ mode: "cards", ids, title, right: Math.max(0, stats.reviewed - stats.again), total: stats.reviewed, missed, seconds: Math.round((Date.now() - began.current) / 1000) }} />}
              <div className="study-done-actions">
                <button onClick={practiceAll}>Practice all {cards.length} anyway</button>
                <button className="primary" onClick={close}>Done</button>
              </div>
            </div>
          ) : card && (
            <div className={`study-card ${shown ? "shown" : ""}`} onClick={() => !shown && setShown(true)}>
              {!states.has(card.key) && !practice && <span className="study-new">New</span>}
              {ids.length > 1 && <span className="study-from">{s.byId.get(card.note)?.title || ""}</span>}
              <div className="study-q">{card.question}</div>
              {shown && <><div className="study-sep" /><div className="study-a" dangerouslySetInnerHTML={{ __html: card.answerHtml }} /></>}
            </div>
          )}
      </div>

      {card && !finished && (
        <div className="study-foot">
          {!shown ? <button className="primary study-show" onClick={() => setShown(true)}>Show answer <kbd>Space</kbd></button>
            : <div className="study-grades">
                {GRADES.map((g, i) => (
                  <button key={g} className={`grade-${g}`} onClick={() => grade(g)}>
                    <b>{LABEL[g]}</b><small>{state ? hint(state, g, today) : ""}</small><kbd>{i + 1}</kbd>
                  </button>
                ))}
              </div>}
        </div>
      )}
    </div>
  );
}
