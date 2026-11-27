// "You wrote about this before" (#18): under a page, a quiet strip of notes close in meaning (worker semantic.ts related).
// On open it uses the page as last indexed (no AI call); while the user writes, the latest part of the text after a pause, at most
// every 20 seconds and only once it has changed enough. Tapping one opens it in the side peek; × hides the strip for the visit.
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";
import { PageIcon } from "../icons";

type Hit = { id: string; title: string; icon: string | null; score: number; snippet: string };
const PAUSE = 3000, EVERY = 20_000, CHANGE = 60;
const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

export function RelatedNotes({ id, title, html }: { id: string; title: string; html: string }) {
  const s = useStore();
  const [hits, setHits] = useState<Hit[]>([]);
  const [hidden, setHidden] = useState(false);
  const last = useRef<{ text: string; at: number } | null>(null);

  useEffect(() => { let on = true; setHits([]); last.current = null; api.related(id).then((r) => on && setHits(r.hits)).catch(() => {}); return () => { on = false; }; }, [id]);
  useEffect(() => {
    const text = plain(html);
    if (text.length < 80) return;
    const t = setTimeout(() => {
      const prev = last.current;
      if (prev && (Date.now() - prev.at < EVERY || Math.abs(text.length - prev.text.length) < CHANGE)) return;
      last.current = { text, at: Date.now() };
      api.related(id, `${title}\n${text.slice(-1200)}`).then((r) => { if (r.hits.length) setHits(r.hits); }).catch(() => {});
    }, PAUSE);
    return () => clearTimeout(t);
  }, [id, title, html]);

  if (hidden || !hits.length) return null;
  return (
    <aside className="related" aria-label="You wrote about this before">
      <div className="related-head"><small>You wrote about this before</small><button className="ghost icon-btn" aria-label="Hide" title="Hide" onClick={() => setHidden(true)}><X size={14} /></button></div>
      <div className="related-list">{hits.map((h) => (
        <button key={h.id} className="related-item" title={h.snippet} onClick={() => s.setPeek(h.id)}>
          <PageIcon icon={h.icon} kind="page" size={16} /><span className="t"><b>{h.title}</b><small>{h.snippet}</small></span>
        </button>
      ))}</div>
    </aside>
  );
}
