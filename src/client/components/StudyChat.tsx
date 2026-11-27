// Chat, the Study tab's way of studying by talking with the assistant. It's the normal agent with every tool: the Worker adds
// the notes and recent results to each turn's context (worker/coach.ts) and shows it only this chat, while the messages still
// land in the one ongoing conversation, so the assistant remembers them. Full screen in the same .study shell as the games.
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Square, TriangleAlert } from "lucide-react";
import { api, ApiError, type AgentEvent } from "../api";
import { useStore, type StudyChatTarget } from "../store";
import { JeffAvatar } from "../icons";
import { IClose } from "../ui-icons";
import { agentName } from "../persona";
import { jeffModel } from "./AiTools";
import { renderMd } from "./AgentPanel";

type Game = NonNullable<Extract<AgentEvent, { type: "tool_result" }>["game"]>;
interface Tool { id: string; label: string; status: "running" | "ok" | "error"; game?: Game }
interface Bubble { key: string; role: "me" | "them" | "note"; text: string; tools: Tool[]; streaming?: boolean; error?: string; runId?: string; changes?: number; undone?: boolean }

const QUICK = ["Quiz me", "Explain that more simply", "I don't get it", "What should I focus on?", "Make me a study plan"];
const uid = () => crypto.randomUUID();
const webOn = () => { try { return localStorage.getItem("sg.agent.web") !== "0"; } catch { return true; } }; // the Web switch in the assistant's menu

export function StudyChat({ target }: { target: StudyChatTarget }) {
  const s = useStore();
  const title = target.title ?? (s.byId.get(target.ids[0])?.title || "your notes");
  const [msgs, setMsgs] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState(false);
  const after = useRef<number | undefined>(undefined); // where this chat starts in the ongoing conversation
  const abort = useRef<AbortController | null>(null);
  const replies = useRef(0);
  const started = useRef(false);
  const began = useRef(Date.now());
  const list = useRef<HTMLDivElement>(null), field = useRef<HTMLTextAreaElement>(null), root = useRef<HTMLDivElement>(null);

  const patch = (key: string, f: (m: Bubble) => Bubble) => setMsgs((ms) => ms.map((m) => (m.key === key ? f(m) : m)));
  const changed = useCallback(() => dispatchEvent(new CustomEvent("seaglass:agent-changed")), []);

  const send = async (text: string, label?: string) => {
    const message = text.trim();
    if (!message || busy) return;
    const aKey = uid();
    if (!label) { replies.current++; setInput(""); }
    setMsgs((ms) => [...ms, { key: uid(), role: label ? "note" : "me", text: label ?? message, tools: [] }, { key: aKey, role: "them", text: "", tools: [], streaming: true }]);
    setBusy(true);
    const ctl = new AbortController(); abort.current = ctl;
    const onEvent = (e: AgentEvent) => {
      if (e.type === "text") { setWorking(false); patch(aKey, (m) => ({ ...m, text: m.text + e.delta })); }
      else if (e.type === "working") setWorking(true);
      else if (e.type === "tool_start") { setWorking(true); patch(aKey, (m) => ({ ...m, tools: [...m.tools, { id: e.id, label: e.label, status: "running" }] })); }
      else if (e.type === "tool_result") { patch(aKey, (m) => ({ ...m, tools: m.tools.map((t) => (t.id === e.id ? { ...t, status: e.ok ? "ok" : "error", label: e.label, game: e.game } : t)) })); if (e.ok && e.note_ids.length) changed(); }
      else if (e.type === "done") patch(aKey, (m) => ({ ...m, runId: e.run_id, changes: e.changes }));
      else if (e.type === "error") patch(aKey, (m) => ({ ...m, error: e.message }));
    };
    try {
      await api.agentStream({ message, ...(label ? { label } : {}), page_id: null, model: jeffModel(), web: webOn(), study: { ids: target.ids, title, after: after.current } }, onEvent, ctl.signal);
    } catch (e) {
      if ((e as Error).name !== "AbortError") patch(aKey, (m) => ({ ...m, error: e instanceof ApiError && e.message === "no_key" ? `${agentName()} isn't connected to Claude yet. See Settings, then Setup & status.` : (e as Error).message || "Something went wrong." }));
    } finally {
      setBusy(false); setWorking(false); abort.current = null;
      patch(aKey, (m) => ({ ...m, streaming: false }));
      if (matchMedia("(hover: hover)").matches) field.current?.focus();
    }
  };

  // Opens by itself, so the assistant speaks first. Only this chat counts as history, so note where the conversation is now.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const o = target.opener ?? { message: `Let's study "${title}" together. Start now: work out what I need most and ask me your first question.`, label: `Studying ${title}` };
    api.thread({ limit: 1 }).then((r) => { after.current = r.last; }).catch(() => {}).finally(() => void send(o.message, o.label));
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const close = useCallback(() => {
    abort.current?.abort();
    if (replies.current) void api.studySession({ mode: "chat", ids: target.ids, title, right: 0, total: 0, missed: [], seconds: Math.round((Date.now() - began.current) / 1000) }, false).catch(() => {});
    s.setStudyChat(null);
  }, [s, target.ids, title]);
  const closeRef = useRef(close); closeRef.current = close;
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); closeRef.current(); } };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  }, []);

  useEffect(() => { const el = list.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs]);
  useEffect(() => { const el = field.current; if (el) { el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 130)}px`; } }, [input]);

  // On a phone the keyboard covers the bottom of the screen: lift the input above it.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const place = () => root.current?.style.setProperty("--sc-kb", `${Math.max(0, innerHeight - vv.height - vv.offsetTop)}px`);
    place();
    vv.addEventListener("resize", place); vv.addEventListener("scroll", place);
    return () => { vv.removeEventListener("resize", place); vv.removeEventListener("scroll", place); };
  }, []);

  const play = (g: Game) => { closeRef.current(); s.setDrill({ ...g, nonce: Date.now() }); };
  const undo = async (m: Bubble) => { await api.undoRun(m.runId!, true); patch(m.key, (x) => ({ ...x, undone: true })); changed(); void s.refreshTree(); };

  return (
    <div ref={root} className="study study-chat" role="dialog" aria-label={`Chat: ${title}`}>
      <div className="study-top">
        <button className="ghost icon-btn" aria-label="Close (Esc)" title="Close (Esc)" onClick={close}><IClose size={20} /></button>
        <div className="study-title"><b>{title}</b><span className="study-practice">Chat with {agentName()}</span></div>
        <span className="study-count sc-face"><JeffAvatar size={30} mode={working ? "tool" : busy ? "think" : "idle"} /></span>
      </div>
      <div className="sc-scroll" ref={list}>
        <div className="sc-list">
          {msgs.map((m) => (
            <div key={m.key} className={`tx-row first last ${m.role === "me" ? "me" : "them"}`}>
              {m.role === "note" ? <div className="tx-sys">{m.text}</div>
                : m.role === "me" ? <div className="tx-line"><div className="tx-bubble me">{m.text}</div></div>
                : (
                  <div className="tx-line"><div className="tx-col">
                    {m.tools.length > 0 && <div className="tx-tools">{m.tools.map((t) => <span key={t.id} className={`tx-tool ${t.status}`}><span>{t.status === "running" ? `${t.label}…` : t.label}</span></span>)}</div>}
                    {m.text && <div className="tx-bubble them ag-md" dangerouslySetInnerHTML={renderMd(m.text)} />}
                    {m.streaming && !m.text && <div className="tx-bubble them tx-typing" aria-label="Typing"><i /><i /><i /></div>}
                    {m.error && <div className="tx-error"><TriangleAlert size={13} /> {m.error}</div>}
                    {m.tools.filter((t) => t.game).map((t) => <div key={t.id} className="tx-chips"><button className="primary" onClick={() => play(t.game!)}>Play it now</button></div>)}
                    {!m.streaming && !!m.changes && m.runId && <div className="tx-meta">{m.undone ? "Undone" : <button className="tx-link" onClick={() => void undo(m)}>Undo {m.changes === 1 ? "this change" : `these ${m.changes} changes`}</button>}</div>}
                  </div></div>
                )}
            </div>
          ))}
        </div>
      </div>
      <div className="sc-foot">
        <div className="sc-inner">
          <div className="sc-quick">{QUICK.map((q) => <button key={q} disabled={busy} onClick={() => void send(q)}>{q}</button>)}</div>
          <form className="sc-form" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
            <textarea ref={field} rows={1} value={input} aria-label={`Message ${agentName()}`} placeholder="Answer, or ask anything…" onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && matchMedia("(hover: hover)").matches) { e.preventDefault(); void send(input); } }} />
            {busy ? <button type="button" className="sc-send" aria-label="Stop" title="Stop" onClick={() => abort.current?.abort()}><Square size={14} fill="currentColor" /></button>
              : <button type="submit" className="sc-send primary" aria-label="Send" title="Send" disabled={!input.trim()}><ArrowUp size={18} /></button>}
          </form>
        </div>
      </div>
    </div>
  );
}
