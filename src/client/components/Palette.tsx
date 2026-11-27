// Search, in the spirit of macOS Spotlight: one glass bar, a Top Hit picked by score, and when nothing fits
// (or what you typed reads like a question) an "Ask Jeff" tab slides in. Tab switches to it; Enter asks.
import { inFamily } from "../space";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { startFocus } from "./StudyTools";
import { Moon, PanelLeft, Zap } from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";
import { JeffFace, PageIcon } from "../icons";
import { IArrowUp, ICalendar, ICheckSquare, ICompose, IDatabase, IHome, ISearch, ITrash } from "../ui-icons";
import { EDITION } from "../edition";
import type { SearchHit, TreeNode } from "../types";
import { agentName } from "../persona";

interface Item { key: string; kind: "page" | "text" | "command" | "ask" | "do"; icon: ReactNode; title: string; sub?: string; hint?: string; score: number; run: () => void }

const QUESTION = /^(what|whats|what's|why|how|when|who|whos|where|which|can|could|should|would|is|are|am|do|does|did|will|explain|summari[sz]e|tell me|help|write|draft|make|create|plan|brainstorm|give me|find me|compare|list)\b/i;
// An instruction to carry out (#43 quick actions): starts with a doing word, e.g. "add a task to review chapter 5 tomorrow at 5".
const ACTION = /^(add|create|make|new|put|move|rename|mark|check off|tick|complete|finish|remind|schedule|set|change|update|delete|trash|remove|archive|file|tag|log|record|note down|jot|append|turn|plan|book)\b/i;
export const looksLikeAction = (q: string) => ACTION.test(q.trim()) && q.trim().split(/\s+/).length >= 3;
export const looksLikeQuestion = (q: string) => /\?\s*$/.test(q) || QUESTION.test(q.trim()) || q.trim().split(/\s+/).length >= 6;

/** Spotlight-ish title score: exact > prefix > every word starts a word > substring > letters in order. 0 = no match. */
export function scoreTitle(title: string, query: string): number {
  const t = title.toLowerCase().trim(), q = query.toLowerCase().trim();
  if (!q || !t) return 0;
  if (t === q) return 100;
  if (t.startsWith(q)) return 92 - Math.min(10, (t.length - q.length) / 4);
  const words = q.split(/\s+/);
  const starts = t.split(/[\s\-_/:.,]+/);
  if (words.every((w) => starts.some((s) => s.startsWith(w)))) return 82;
  if (t.includes(q)) return 74;
  if (words.every((w) => t.includes(w))) return 66;
  // letters in order (e.g. "cns" -> "Cornell Notes System"); tighter runs score higher
  let i = 0, gaps = 0, last = -1;
  for (const ch of q.replace(/\s+/g, "")) { const j = t.indexOf(ch, i); if (j < 0) return 0; if (last >= 0) gaps += j - last - 1; last = j; i = j + 1; }
  return Math.max(30, 58 - gaps * 2);
}

export function Palette() {
  const s = useStore();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [sel, setSel] = useState(0);
  const [askMode, setAskMode] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { if (s.paletteOpen) { setQ(""); setSel(0); setAskMode(false); setTimeout(() => input.current?.focus(), 0); } }, [s.paletteOpen]);
  useEffect(() => {
    if (!q.trim()) { setHits([]); return; }
    const t = setTimeout(() => api.search(q).then(setHits).catch(() => {}), 120);
    return () => clearTimeout(t);
  }, [q]);

  const close = () => s.setPaletteOpen(false);
  const pathOf = (n: TreeNode) => { const out: string[] = []; for (let p = n.parent_id ? s.byId.get(n.parent_id) : undefined; p && out.length < 3; p = p.parent_id ? s.byId.get(p.parent_id) : undefined) out.unshift(p.title || "New page"); return out.join(" / "); };
  // Quick action: done in the background, a notice says what changed, with Undo (the whole run).
  const doIt = async (text: string) => {
    close();
    s.toast(`${agentName()} is on it…`);
    const page = s.route.kind === "page" ? (s.route as { id: string }).id : null;
    try {
      const r = await api.quick(text, page);
      window.dispatchEvent(new CustomEvent("seaglass:agent-changed"));
      void s.refreshTree();
      const what = r.line || r.done.join(". ") || r.error || r.failed[0] || "Nothing changed"; // its own line says it best
      const undo = r.changes > 0 ? { label: "Undo", run: async () => { try { await api.undoRun(r.run_id); window.dispatchEvent(new CustomEvent("seaglass:agent-changed")); void s.refreshTree(); s.toast("Undone"); } catch (e) { s.toast((e as Error).message); } } } : undefined;
      s.toast(what.length > 160 ? `${what.slice(0, 157)}…` : what, undo);
    } catch (e) { s.toast((e as Error).message || "That didn't work. Try asking in the chat."); }
  };
  const ask = (text: string) => { close(); s.setAgentOpen(true); setTimeout(() => window.dispatchEvent(new CustomEvent("seaglass:agent-ask", { detail: text })), 60); };

  const { items, top, question } = useMemo(() => {
    const query = q.trim();
    const recentRank = new Map(s.recents.map((id, i) => [id, i]));
    const boost = (id: string) => { const r = recentRank.get(id); return r === undefined ? 0 : Math.max(0, 8 - r); };
    const commands: Omit<Item, "score">[] = [
      { key: "c-new", kind: "command", icon: <ICompose size={20} />, title: "New page", hint: "Ctrl Alt N", run: () => void s.newPage() },
      { key: "c-task", kind: "command", icon: <ICheckSquare size={20} />, title: inFamily ? "Family tasks" : "My tasks", run: () => s.go("/tasks") },
      ...(EDITION.calendar ? [{ key: "c-cal", kind: "command" as const, icon: <ICalendar size={20} />, title: "Calendar", run: () => s.go("/calendar") }] : []),
      { key: "c-db", kind: "command", icon: <IDatabase size={20} />, title: "New database", run: () => void s.newPage({ kind: "database", title: "Untitled database" }) },
      { key: "c-home", kind: "command", icon: <IHome size={20} />, title: "Go home", run: () => s.go("/") },
      ...(inFamily ? [] : [{ key: "c-jeff", kind: "command" as const, icon: <JeffFace size={20} />, title: `Ask ${agentName()}`, hint: "Ctrl J", run: () => s.setAgentOpen(true) }]),
      ...(inFamily ? [] : [{ key: "c-grades", kind: "command" as const, icon: <ICheckSquare size={20} />, title: "Grades", run: async () => { const r = await api.ensureGrades(); await s.refreshTree(); s.go(`/p/${r.id}`); } }]),
      ...(inFamily ? [] : [{ key: "c-review", kind: "command" as const, icon: <ICheckSquare size={20} />, title: "Weekly review", run: () => s.go("/review") }]),
      ...(inFamily ? [] : [{ key: "c-focus", kind: "command" as const, icon: <ICheckSquare size={20} />, title: "Start a 25 minute focus timer", run: () => startFocus("Focus") }]),
      ...(inFamily ? [] : [{ key: "c-voice", kind: "command" as const, icon: <ICompose size={20} />, title: "Record a voice note", run: () => s.setVoiceOpen(true) }]),
      ...(inFamily ? [] : [{ key: "c-photo", kind: "command" as const, icon: <ICompose size={20} />, title: "Photo to notes", run: () => s.setPhotoOpen(true) }]),
      ...(s.route.kind === "page" && !inFamily ? [{ key: "c-quiz", kind: "command" as const, icon: <ICheckSquare size={20} />, title: "Practice test on this page", run: () => s.setQuiz([(s.route as { id: string }).id]) }] : []),
      { key: "c-trash", kind: "command", icon: <ITrash size={20} />, title: "Open trash", run: () => s.go("/trash") },
      { key: "c-side", kind: "command", icon: <PanelLeft size={18} />, title: "Toggle sidebar", hint: "Ctrl \\", run: s.toggleSidebar },
      { key: "c-theme", kind: "command", icon: <Moon size={18} />, title: "Switch theme", hint: "Ctrl Shift L", run: () => s.setTheme(s.theme === "dark" ? "light" : s.theme === "light" ? "system" : "dark") },
    ];
    if (!query) {
      const recent = s.recents.map((id) => s.byId.get(id)).filter((n): n is TreeNode => !!n && !n.is_template).slice(0, 6);
      const items: Item[] = [
        ...recent.map((n) => ({ key: n.id, kind: "page" as const, icon: <PageIcon icon={n.icon} kind={n.kind} size={18} />, title: n.title || "New page", sub: pathOf(n), score: 0, run: () => s.go(`/p/${n.id}`) })),
        ...commands.slice(0, 5).map((c) => ({ ...c, score: 0 })),
      ];
      return { items, top: null as Item | null, question: false };
    }
    // Titles from the local tree (instant, fuzzy), then page text from the server.
    const pages: Item[] = s.tree.filter((n) => !n.is_template).map((n) => ({ n, sc: scoreTitle(n.title || "", query) })).filter((x) => x.sc > 0)
      .map(({ n, sc }) => ({ key: n.id, kind: "page" as const, icon: <PageIcon icon={n.icon} kind={n.kind} size={18} />, title: n.title || "New page", sub: pathOf(n), score: sc + boost(n.id), run: () => s.go(`/p/${n.id}`) }));
    const seen = new Set(pages.map((p) => p.key));
    const text: Item[] = hits.filter((h) => !seen.has(h.id) && !h.is_template).map((h) => ({
      key: `t-${h.id}`, kind: "text" as const, icon: <PageIcon icon={h.icon} kind={h.kind} size={18} />, title: h.title || "New page",
      sub: (h.snippet ?? "").replace(/\s+/g, " ").trim(), score: 34 + boost(h.id), run: () => s.go(`/p/${h.id}`),
    }));
    const cmds: Item[] = commands.map((c) => ({ ...c, score: scoreTitle(c.title, query) * 0.9 })).filter((c) => c.score >= 40);
    const all = [...pages, ...text, ...cmds].sort((a, b) => b.score - a.score);
    const best = all[0];
    const question = looksLikeQuestion(query);
    const action = !inFamily && looksLikeAction(query); // the assistant is personal, not part of the Family space
    // An exact or near-exact title or command (85+) is what the user meant, even if it reads like a question or an instruction
    // ("Record a voice note", a page called "Plan for finals").
    const strong = !!best && best.score >= 85;
    const top = strong ? best : best && best.score >= 60 && !question && !action ? best : null;
    const askItem: Item = { key: "ask", kind: "ask", icon: <JeffFace size={22} />, title: query, sub: `Ask ${agentName()}`, score: 0, run: () => ask(query) };
    // "Do it" (#43) when the text isn't a search or a command: first when it reads like an instruction.
    const doItem: Item | null = action || (!top && query.split(/\s+/).length >= 3) ? { key: "do", kind: "do", icon: <Zap size={20} />, title: query, sub: `${agentName()} does it now, no chat`, score: 0, run: () => void doIt(query) } : null;
    // A question (or no good match) puts Ask first; otherwise it waits at the end.
    const base = question || !top ? [askItem, ...all.slice(0, 12)] : [...all.slice(0, 12), askItem];
    const items = strong ? [...all.slice(0, 12), askItem, ...(doItem ? [doItem] : [])] : !doItem ? base : action ? [doItem, ...base] : [...base, doItem];
    return { items, top, question };
  }, [q, hits, s.tree, s.recents]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => { document.querySelector(".spot .sp-row.on")?.scrollIntoView({ block: "nearest" }); }, [sel]);
  if (!s.paletteOpen) return null;

  const showAskTab = !!q.trim() && (question || !top);
  const go = (i: number) => { const r = items[i]; if (r) { if (r.kind !== "ask") close(); r.run(); } };
  const groups: { label: string; rows: { item: Item; i: number }[] }[] = [];
  items.forEach((item, i) => {
    const label = !q.trim() ? (item.kind === "page" ? "Recent" : "Commands")
      : item.kind === "ask" ? "Ask" : item.kind === "do" ? "Do it" : item === top ? "Top Hit" : item.kind === "command" ? "Commands" : item.kind === "text" ? "In your notes" : "Pages";
    const g = groups[groups.length - 1];
    if (g && g.label === label) g.rows.push({ item, i }); else groups.push({ label, rows: [{ item, i }] });
  });

  return (
    <div className="spot-back" onMouseDown={close}>
      <div className={`spot ${q.trim() ? "has-q" : ""} ${askMode ? "ask-mode" : ""}`} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Search">
        <div className="spot-bar">
          {askMode ? <span className="spot-token"><JeffFace size={18} /> Ask {agentName()}</span> : <ISearch size={22} />}
          <input ref={input} value={q} placeholder={askMode ? "Ask anything…" : "Search Seaglass"} spellCheck={false}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); if (!askMode) setSel((x) => Math.min(items.length - 1, x + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); if (!askMode) setSel((x) => Math.max(0, x - 1)); }
              else if (e.key === "Tab" && q.trim()) { e.preventDefault(); setAskMode((v) => !v); }
              else if (e.key === "Enter") { e.preventDefault(); if (askMode) { if (q.trim()) ask(q.trim()); } else go(sel); }
              else if (e.key === "Escape") { e.preventDefault(); if (askMode) setAskMode(false); else close(); }
              else if (e.key === "Backspace" && askMode && !q) setAskMode(false);
            }} />
          {showAskTab && !askMode && (
            <button className="spot-asktab" title={`Ask ${agentName()} (Tab)`} onMouseDown={(e) => e.preventDefault()} onClick={() => setAskMode(true)}>
              <JeffFace size={16} /> Ask <kbd>Tab</kbd>
            </button>
          )}
          <button className="spot-cancel" onMouseDown={(e) => e.preventDefault()} onClick={close}>Cancel</button>
          {askMode && <button className="spot-send" disabled={!q.trim()} title={`Ask ${agentName()} (Enter)`} onClick={() => ask(q.trim())}><IArrowUp size={16} /></button>}
        </div>
        {askMode ? (
          <div className="spot-list">
            <div className="spot-askhelp"><JeffFace size={34} /><div><b>{q.trim() ? `“${q.trim()}”` : `Ask ${agentName()} anything`}</b><span>{agentName()} reads your notes to answer, and can write pages and tasks for you. Press Enter to ask, Esc to go back to search.</span></div></div>
          </div>
        ) : (
          (q.trim() || items.length > 0) && (
            <div className="spot-list">
              {groups.map((g) => (
                <div key={g.label + g.rows[0].i} className="sp-group">
                  <div className="sp-head">{g.label}</div>
                  {g.rows.map(({ item, i }) => (
                    <div key={item.key} className={`sp-row k-${item.kind} ${item === top ? "top" : ""} ${i === sel ? "on" : ""}`} onMouseMove={() => setSel(i)} onClick={() => go(i)}>
                      <span className="sp-ico">{item.icon}</span>
                      <span className="sp-t">
                        <b>{item.kind === "ask" ? <>Ask {agentName()}: <i>{item.title}</i></> : item.kind === "do" ? <>Do it: <i>{item.title}</i></> : item.title}</b>
                        {item.sub && item.kind !== "ask" && <small>{item.sub}</small>}
                      </span>
                      {item.hint && <kbd>{item.hint}</kbd>}
                      {i === sel && <span className="sp-enter">↵</span>}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}
