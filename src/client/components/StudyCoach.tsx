// What the assistant says when a study session ends. Saves the session, shows typing dots while it writes something about
// how this one really went, then offers next steps. The buttons do the work themselves: rewrite the questions, open another
// way to study, or move into Chat to plan or talk it through. If the model can't be reached it still cheers (study/coach.ts).
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import { JeffAvatar } from "../icons";
import { agentName } from "../persona";
import { offlineError, queueSession } from "../study/offline";
import { cleanCoach, planOpener, talkOpener, type CoachOffer, type CoachReply, type PlayedSession } from "../study/coach";

export function StudyCoach({ session }: { session: PlayedSession }) {
  const s = useStore();
  const [reply, setReply] = useState<CoachReply | null>(null);
  const [queued, setQueued] = useState(false);
  const first = useRef(session).current; // the screen re-renders; the session it reports doesn't change
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    api.studySession(first).then((r) => setReply(r.coach ?? cleanCoach({}, first))).catch((e) => {
      if (offlineError(e)) { queueSession(first); setQueued(true); } // sent when the connection returns (study/offline.ts)
      setReply(cleanCoach({}, first));
    });
  }, [first]);

  const run = (o: CoachOffer) => {
    const { ids, title, mode, missed } = first, nonce = Date.now();
    s.setDrill(null); s.setStudy(null); s.setQuiz(null); s.setExplain(null);
    if (o.do === "harder" || o.do === "easier" || o.do === "focus") {
      const game = mode === "quiz" || mode === "blanks" || mode === "match" ? mode : "quiz";
      s.setDrill({ ids, title, mode: game, nonce, change: { kind: o.do, ...(o.do === "focus" ? { missed: missed.map((m) => m.q).slice(0, 15) } : {}) } });
    } else if (o.do === "quiz" || o.do === "blanks" || o.do === "match") s.setDrill({ ids, title, mode: o.do, nonce });
    else if (o.do === "test") s.setQuiz(ids);
    else if (o.do === "explain") s.setExplain({ ids, title, nonce });
    else if (o.do === "cards") s.setStudy(ids.length === 1 ? ids[0] : { ids, title });
    else if (o.do === "plan") s.setStudyChat({ ids, title, nonce, opener: planOpener(first) });
    else s.setStudyChat({ ids, title, nonce, opener: talkOpener(first, reply?.text ?? "") });
  };

  return (
    <div className="coach" aria-live="polite">
      <JeffAvatar size={36} mode={reply ? "idle" : "think"} />
      <div className="coach-col">
        {queued && <div className="coach-offline">You're offline. This session is saved on this device and syncs when you're back online.</div>}
        {reply ? <div className="tx-bubble them coach-text">{reply.text}</div> : <div className="tx-bubble them tx-typing" aria-label={`${agentName()} is typing`}><i /><i /><i /></div>}
        {reply && <div className="tx-chips coach-chips">{reply.offers.map((o, i) => <button key={o.do} className={i === 0 ? "primary" : ""} onClick={() => run(o)}>{o.label}</button>)}</div>}
      </div>
    </div>
  );
}
