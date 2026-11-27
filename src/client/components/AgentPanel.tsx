// The assistant: one ongoing conversation, like Claude Duet. There are no separate chats: everything you say, every
// reply, what the assistant brings up on its own (the hourly check-in) and routine reports are messages in one thread,
// kept on the server (src/worker/thread.ts) so every device shows the same thing. Older messages load as you scroll
// up; "New topic" (or /clear) starts a fresh stretch for the model while the thread stays. The server decides what the
// model sees: the recent stretch plus a rolling summary of everything older, and it can search further back.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { AudioLines,
  BookOpen, CalendarClock, Copy, CornerUpLeft, CornerUpRight, Database, FilePlus, KeyRound, Lightbulb, Loader2,
  PenLine, RotateCcw, Search, Sparkles, Square, Trash2, TriangleAlert, MessageSquarePlus, GraduationCap, FolderTree,
} from "lucide-react";
import { api, ApiError, type AgentEvent, type InboxItem, type RunResult, type ThreadMessage, type GameLink } from "../api";
import { JeffAvatar, PageIcon, Waffle } from "../icons";
import { IArrowUp, IChevron, IClose } from "../ui-icons";
import { unlockVoice } from "../voice/speaker";
import { LiveVoice } from "./LiveVoice";
import { useStore } from "../store";
import { Popover } from "./ui";
import { agentName, usePersona } from "../persona";
import { expandSaved, setUnread, useSavedPrompts } from "../proactive";

interface ToolCard { id: string; name: string; label: string; status: "running" | "ok" | "error"; noteIds: string[]; game?: GameLink }
interface Msg {
  key: string; id?: string; seq?: number; created_at: number;
  role: "user" | "assistant" | "divider" | "system"; kind: "chat" | "proactive" | "routine" | "divider" | "note";
  text: string; tools: ToolCard[];
  /** What a one-tap action shows in the thread (text is the full prompt the assistant gets). */
  label?: string; title?: string; inboxId?: string;
  runId?: string; changes?: number; cost?: number; state?: "streaming" | "done" | "error"; error?: string; undone?: boolean;
}

const CACHE = "sg.agent.thread";
const MODE_KEY = "sg.agent.mode";
const WORK_MIN = 1800; // ms the "on a job" animation shows at the least
const MODEL_KEY = "sg.agent.model";
const WEB_KEY = "sg.agent.web";
const PAGE = 60;
const uid = () => Math.random().toString(36).slice(2, 10);

const fromServer = (m: ThreadMessage): Msg => ({
  key: m.id, id: m.id, seq: m.seq, created_at: m.created_at, role: m.role, kind: m.kind, text: m.text,
  tools: (m.meta.tools ?? []).map((t) => ({ id: t.id, name: t.name, label: t.label, status: t.ok ? "ok" : "error", noteIds: t.note_ids, game: t.game })),
  label: m.meta.label, title: m.meta.title, inboxId: m.meta.inbox_id, runId: m.meta.run_id, changes: m.meta.changes, cost: m.meta.cost,
  error: m.meta.error, undone: m.meta.undone, state: "done",
});
function loadCache(): Msg[] {
  try { return (JSON.parse(localStorage.getItem(CACHE) ?? "[]") as Msg[]).map((m) => (m.state === "streaming" ? { ...m, state: "done" } : m)); } catch { return []; }
}

const TOOL_ICON: Record<string, typeof Search> = {
  search_notes: Search, list_pages: Search, read_note: BookOpen, list_database_rows: Database, create_note: FilePlus, append_to_note: PenLine,
  replace_in_note: PenLine, update_note: PenLine, delete_note: Trash2, add_database_row: Database, update_database_row: Database,
  remember: Lightbulb, forget: Trash2, search_past_chats: Search, search_by_meaning: Sparkles,
  study_overview: GraduationCap, manage_subject: FolderTree, update_study_page: GraduationCap,
};

// Assistant text is rendered as Markdown, then sanitized: the model may echo note content, which is untrusted.
// Links (web sources) open in a new tab so they never replace the app.
export const renderMd = (md: string) => ({ __html: DOMPurify.sanitize(marked.parse(md, { async: false, breaks: true }) as string, { ADD_ATTR: ["target"] }).replace(/<a /g, '<a target="_blank" rel="noopener noreferrer" ') });
const announce = () => window.dispatchEvent(new CustomEvent("seaglass:agent-changed"));
const dayKey = (ms: number) => new Date(ms).toDateString();
function dayLabel(ms: number) {
  const d = new Date(ms), today = new Date(), y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
}
const clockOf = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

export function AgentPanel() {
  const s = useStore();
  const [msgs, setMsgs] = useState<Msg[]>(loadCache);
  const [loaded, setLoaded] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [multi, setMulti] = useState(false); // the message wraps: text gets the full width, buttons go underneath
  // Size the message field to its text. Whether it needs the two-row layout is always decided at the ONE-row width
  // (the full-width row would fit text that wraps in one row, so measuring there flipped layouts on every keystroke).
  // Runs for typing, sending, prefills and picks alike, and again when the panel changes width.
  const fitBox = useCallback(() => {
    const t = box.current, bx = t?.parentElement;
    if (!t || !bx) return;
    bx.classList.remove("multi");
    t.style.height = "auto";
    const cs = getComputedStyle(t);
    const oneLine = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.lineHeight) * 1.5;
    const wraps = t.value.includes("\n") || t.scrollHeight > oneLine;
    if (wraps) { bx.classList.add("multi"); t.style.height = "auto"; }
    const h = Math.min(180, t.scrollHeight);
    t.style.height = `${h}px`;
    t.style.overflowY = t.scrollHeight > 180 ? "auto" : "hidden";
    setMulti(wraps);
  }, []);
  // "On a job": from the moment a tool call starts (the model writing it, a web search running) until the reply
  // text begins. Held for at least WORK_MIN, since most tools finish in milliseconds and the animation needs a moment.
  const [working, setWorking] = useState(false);
  const work = useRef<{ on: boolean; since: number; off: ReturnType<typeof setTimeout> | null }>({ on: false, since: 0, off: null });
  const startWork = () => {
    const w = work.current;
    if (w.off) { clearTimeout(w.off); w.off = null; }
    if (!w.on) { w.on = true; w.since = Date.now(); setWorking(true); }
  };
  const stopWork = () => {
    const w = work.current;
    if (!w.on || w.off) return;
    w.off = setTimeout(() => { w.on = false; w.off = null; setWorking(false); }, Math.max(0, WORK_MIN - (Date.now() - w.since)));
  };
  const [status, setStatus] = useState<{ configured: boolean; model: string; mock: boolean; models?: { id: string; label: string; blurb: string }[] } | null>(null);
  // Which Claude model the assistant uses. Empty means the server's default (Sonnet 5.5). Saved on the server so every
  // device starts from the last pick (the status call brings it back); localStorage only shows it before that arrives.
  const [model, setModelState] = useState(() => { try { return localStorage.getItem(MODEL_KEY) ?? ""; } catch { return ""; } });
  const keepModel = (m: string) => { setModelState(m); try { localStorage.setItem(MODEL_KEY, m); } catch { /* storage unavailable */ } };
  const setModel = (m: string) => { keepModel(m); api.agentChoice({ model: m }).catch(() => {}); };
  // Whether the assistant may search the web. On by default; saved the same way.
  const [web, setWebState] = useState(() => { try { return localStorage.getItem(WEB_KEY) !== "0"; } catch { return true; } });
  const keepWeb = (on: boolean) => { setWebState(on); try { localStorage.setItem(WEB_KEY, on ? "1" : "0"); } catch { /* storage unavailable */ } };
  const setWeb = (on: boolean) => { keepWeb(on); api.agentChoice({ web: on }).catch(() => {}); };
  const [mode, setMode] = useState<"floating" | "docked">(() => { try { return (localStorage.getItem(MODE_KEY) as "docked") || "floating"; } catch { return "floating"; } });
  const [ctxId, setCtxId] = useState<string | null | undefined>(undefined); // undefined: follow the page you're on
  const [menu, setMenu] = useState<null | "main" | "at" | "model">(null);
  const [pendingAsk, setPendingAsk] = useState<string | null>(null);
  const [inbox, setInbox] = useState<Map<string, InboxItem>>(new Map());
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(fitBox, [input, fitBox]);
  useEffect(() => {
    const bx = box.current?.parentElement;
    if (!bx || typeof ResizeObserver === "undefined") return;
    let w = bx.clientWidth;
    const ro = new ResizeObserver(() => { if (bx.clientWidth !== w) { w = bx.clientWidth; fitBox(); } });
    ro.observe(bx);
    return () => ro.disconnect();
  }, [fitBox, s.agentOpen]);
  const stick = useRef(true); // keep the view pinned to the newest message unless you scrolled up
  const saved = useSavedPrompts();

  useEffect(() => {
    api.agentStatus().then((st) => {
      setStatus(st);
      if (st.choice) { keepModel(st.choice.model); keepWeb(st.choice.web); }
    }).catch(() => setStatus({ configured: false, model: "", mock: false }));
  }, [s.agentOpen]); // re-read on every open, so a pick made on another device shows up
  useEffect(() => { try { localStorage.setItem(CACHE, JSON.stringify(msgs.filter((m) => m.role !== "system").slice(-80))); } catch { /* storage unavailable */ } }, [msgs]);
  useEffect(() => { try { localStorage.setItem(MODE_KEY, mode); } catch { /* ignore */ } document.documentElement.dataset.agentMode = mode; }, [mode]);

  // ---- the thread from the server
  const lastSeq = () => msgs.reduce((x, m) => Math.max(x, m.seq ?? 0), 0);
  const loadInbox = useCallback(() => api.inbox().then((r) => setInbox(new Map(r.items.map((i) => [i.id, i])))).catch(() => {}), []);
  const loadLatest = useCallback(async () => {
    try {
      const r = await api.thread({ limit: PAGE });
      setMsgs((cur) => [...r.messages.map(fromServer), ...cur.filter((m) => !m.seq && m.state === "streaming")]);
      setHasOlder(r.messages.length === PAGE && (r.messages[0]?.seq ?? 1) > 1);
      setLoaded(true); setUnread(r.unread);
      if (r.messages.some((m) => m.meta.inbox_id)) void loadInbox();
    } catch { setLoaded(true); }
  }, [loadInbox]);
  const syncNew = useCallback(async () => {
    if (busy) return;
    const after = msgs.reduce((x, m) => Math.max(x, m.seq ?? 0), 0);
    try {
      const r = await api.thread({ after, limit: 100 });
      setUnread(r.unread);
      if (!r.messages.length) return;
      setMsgs((cur) => { const have = new Set(cur.map((m) => m.id)); return [...cur, ...r.messages.filter((m) => !have.has(m.id)).map(fromServer)]; });
      if (r.messages.some((m) => m.meta.inbox_id)) void loadInbox();
    } catch { /* offline */ }
  }, [busy, msgs, loadInbox]);
  useEffect(() => { if (s.agentOpen) void loadLatest(); }, [s.agentOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!s.agentOpen) return;
    const t = setInterval(() => void syncNew(), 30_000);
    const vis = () => { if (document.visibilityState === "visible") void syncNew(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [s.agentOpen, syncNew]);
  const loadOlder = async () => {
    const first = msgs.find((m) => m.seq)?.seq;
    if (!first) return;
    const el = scroller.current, before = el ? el.scrollHeight - el.scrollTop : 0;
    try {
      const r = await api.thread({ before: first, limit: PAGE });
      setMsgs((cur) => [...r.messages.map(fromServer), ...cur]);
      setHasOlder(r.messages.length === PAGE);
      requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - before; }); // keep your place
    } catch { /* offline */ }
  };

  // ---- scrolling and "read"
  useLayoutEffect(() => { if (stick.current) scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [msgs, s.agentOpen]);
  // Stay at the newest message when sizes change after render: fonts and Markdown settling, the message field
  // growing as you type, the phone keyboard opening.
  useEffect(() => {
    const el = scroller.current;
    if (!s.agentOpen || !el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { if (stick.current) el.scrollTop = el.scrollHeight; });
    ro.observe(el);
    Array.from(el.children).forEach((c) => ro.observe(c));
    const mo = new MutationObserver(() => Array.from(el.children).forEach((c) => ro.observe(c)));
    mo.observe(el, { childList: true });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, [s.agentOpen, loaded]);
  const onScroll = () => {
    const el = scroller.current; if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  useEffect(() => {
    if (!s.agentOpen || !loaded || !stick.current) return;
    const seq = lastSeq();
    if (seq) void api.threadRead(seq).then((r) => setUnread(r.unread)).catch(() => {});
  }, [s.agentOpen, loaded, msgs.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (s.agentOpen) setTimeout(() => box.current?.focus(), 50); }, [s.agentOpen]);

  // Other parts of the app talk to the assistant through events: prefill ("Ask Jeff to draft it"), ask (Home's bar).
  useEffect(() => {
    const prefill = (e: Event) => {
      const text = String((e as CustomEvent<string>).detail ?? "");
      setInput(text);
      setTimeout(() => { const b = box.current; if (b) { b.focus(); b.setSelectionRange(text.length, text.length); } }, 80);
    };
    const ask = (e: Event) => setPendingAsk(String((e as CustomEvent<string>).detail ?? ""));
    const focus = () => setTimeout(() => box.current?.focus(), 60);
    addEventListener("seaglass:agent-prefill", prefill); addEventListener("seaglass:agent-ask", ask); addEventListener("seaglass:new-chat", focus);
    return () => { removeEventListener("seaglass:agent-prefill", prefill); removeEventListener("seaglass:agent-ask", ask); removeEventListener("seaglass:new-chat", focus); };
  }, []);

  const routePage = s.route.kind === "page" ? s.route.id : null;
  const pageId = ctxId === undefined ? routePage : ctxId;
  const ctxNode = pageId ? s.byId.get(pageId) : undefined;

  const note = (text: string) => setMsgs((ms) => [...ms, { key: uid(), role: "system", kind: "note", text, tools: [], created_at: Date.now() }]);
  const patch = useCallback((key: string, fn: (m: Msg) => Msg) => setMsgs((ms) => ms.map((m) => (m.key === key ? fn(m) : m))), []);
  const refresh = useCallback(async () => { await s.refreshTree(); announce(); }, [s]);

  const handleRun = useCallback(async (res: RunResult, redo: boolean, retry: (force: boolean) => Promise<RunResult>) => {
    if (res.ok) { note(redo ? `Redid ${res.changed} change${res.changed === 1 ? "" : "s"}.` : `Undid ${res.changed} change${res.changed === 1 ? "" : "s"}.`); await refresh(); return true; }
    if (res.conflicts?.length) {
      const names = res.conflicts.map((c) => `“${c.title}”`).join(", ");
      if (await s.confirm(`${names} ${res.conflicts.length === 1 ? "was" : "were"} edited after ${agentName()}'s change. ${redo ? "Redo" : "Undo"} anyway? Your later edits on ${res.conflicts.length === 1 ? "that page" : "those pages"} would be overwritten.`)) {
        const forced = await retry(true);
        if (forced.ok) { note(`${redo ? "Redid" : "Undid"} ${forced.changed} change${forced.changed === 1 ? "" : "s"}, overwriting later edits.`); await refresh(); return true; }
      } else note("Left everything as it is.");
      return false;
    }
    note(res.error);
    return false;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, s]);

  const setUndone = (m: Msg, undone: boolean) => { patch(m.key, (x) => ({ ...x, undone })); if (m.id) void api.threadPatch(m.id, { undone }).catch(() => {}); };
  const undoRun = async (m: Msg) => {
    if (!m.runId) return;
    const redo = !!m.undone;
    const call = (force: boolean) => (redo ? api.redoRun(m.runId!, force) : api.undoRun(m.runId!, force));
    if (await handleRun(await call(false), redo, call)) setUndone(m, !redo);
  };

  const act = async (it: InboxItem, what: "accept" | "dismiss") => {
    const d = new Date(), today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    try {
      const r = await api.inboxAct(it.id, what, today);
      setInbox((cur) => new Map(cur).set(it.id, { ...it, status: what === "accept" ? "accepted" : "dismissed", action: { ...it.action, run_id: r.run_id ?? it.action?.run_id, note_ids: r.note_ids ?? it.action?.note_ids } }));
      if (what === "accept") await refresh();
    } catch (e) { s.toast((e as Error).message); }
  };
  const undoInbox = async (it: InboxItem) => {
    if (!it.action?.run_id) return;
    const call = (force: boolean) => api.undoRun(it.action!.run_id!, force);
    await handleRun(await call(false), false, call);
  };

  const newTopic = async () => {
    setMenu(null);
    try { const d = await api.threadDivider(); setMsgs((ms) => [...ms, { key: d.id, id: d.id, seq: d.seq, role: "divider", kind: "divider", text: "New topic", tools: [], created_at: Date.now() }]); stick.current = true; }
    catch (e) { s.toast((e as Error).message); }
    setTimeout(() => box.current?.focus(), 50);
  };

  const command = async (text: string): Promise<boolean> => {
    const c = text.trim().toLowerCase();
    if (c === "/undo") {
      const res = await api.undoLatest();
      const target = [...msgs].reverse().find((m) => m.runId && !m.undone && m.role === "assistant" && m.changes);
      if (await handleRun(res, false, api.undoLatest) && target) setUndone(target, true);
      return true;
    }
    if (c === "/redo") {
      const res = await api.redoLatest();
      const target = [...msgs].reverse().find((m) => m.runId && m.undone);
      if (await handleRun(res, true, api.redoLatest) && target) setUndone(target, false);
      return true;
    }
    if (c === "/clear" || c === "/new") { await newTopic(); return true; }
    return false;
  };

  const send = async (raw: string, label?: string) => {
    const text = raw.trim();
    if (!text || busy) return;
    setInput("");
    if (text.startsWith("/")) {
      const mine = expandSaved(text); // your saved prompts run as /name
      if (mine) return send(mine.text, label ?? mine.label);
      if (await command(text)) return;
      note(`Unknown command. Try /undo, /redo or /new${saved.length ? `, or one of yours: ${saved.map((x) => `/${x.name}`).join(", ")}` : ""}.`); return;
    }
    const uKey = uid(), aKey = uid(), now = Date.now();
    stick.current = true;
    setMsgs((ms) => [...ms, { key: uKey, role: "user", kind: "chat", text, ...(label ? { label } : {}), tools: [], created_at: now }, { key: aKey, role: "assistant", kind: "chat", text: "", tools: [], state: "streaming", created_at: now }]);
    setBusy(true);
    const ctl = new AbortController(); abort.current = ctl;
    const onEvent = (e: AgentEvent) => {
      if (e.type === "text") { stopWork(); patch(aKey, (m) => ({ ...m, text: m.text + e.delta })); }
      else if (e.type === "working") startWork();
      else if (e.type === "tool_start") startWork(), patch(aKey, (m) => ({ ...m, tools: [...m.tools, { id: e.id, name: e.name, label: e.label, status: "running", noteIds: [] }] }));
      else if (e.type === "tool_result") { patch(aKey, (m) => ({ ...m, tools: m.tools.map((t) => (t.id === e.id ? { ...t, status: e.ok ? "ok" : "error", label: e.label, noteIds: e.note_ids, game: e.game } : t)) })); if (e.ok && ((e.note_ids.length && !/^(search|list|read)/.test(e.name)) || /^(manage_subject|update_study_page|plan_study_sessions)$/.test(e.name))) announce(); }
      else if (e.type === "done") stopWork(), patch(aKey, (m) => ({ ...m, state: "done", runId: e.run_id, changes: e.changes, cost: e.usage.cost_usd }));
      else if (e.type === "error") stopWork(), patch(aKey, (m) => ({ ...m, state: "error", error: e.message }));
      else if (e.type === "saved") patch(e.reply ? aKey : uKey, (m) => ({ ...m, id: e.id, seq: e.seq }));
    };
    try {
      await api.agentStream({ message: text, ...(label ? { label } : {}), page_id: pageId ?? null, ...(model ? { model } : {}), ...(web ? {} : { web: false }) }, onEvent, ctl.signal);
    } catch (e) {
      if ((e as Error).name === "AbortError") patch(aKey, (m) => ({ ...m, state: "done" }));
      else if (e instanceof ApiError && e.message === "no_key") { patch(aKey, (m) => ({ ...m, state: "error", error: `${agentName()} isn't connected to Claude yet. See Settings, then Setup & status.` })); setStatus((st) => (st ? { ...st, configured: false } : st)); }
      else patch(aKey, (m) => ({ ...m, state: "error", error: (e as Error).message || "Something went wrong." }));
    } finally {
      setBusy(false); abort.current = null; stopWork();
      patch(aKey, (m) => (m.state === "streaming" ? { ...m, state: "done" } : m));
      await refresh();
    }
  };

  // Home's "Ask" bar and a page's saved prompts: send once the panel knows the assistant is available.
  useEffect(() => { if (pendingAsk && status?.configured && !busy) { const q = pendingAsk; setPendingAsk(null); void send(q); } }); // eslint-disable-line react-hooks/exhaustive-deps

  const retry = (m: Msg) => {
    const i = msgs.findIndex((x) => x.key === m.key);
    const prev = [...msgs.slice(0, i)].reverse().find((x) => x.role === "user");
    if (prev) void send(prev.text, prev.label);
  };
  const copy = (m: Msg) => { void navigator.clipboard?.writeText(m.text); s.toast("Copied"); };

  const models = status?.models ?? [];
  const current = models.find((m) => m.id === (model || status?.model)) ?? models.find((m) => m.id === status?.model);
  const pickable = useMemo(() => {
    const seen = new Set<string>(); const out = [];
    for (const id of [routePage, ...s.recents]) { const n = id ? s.byId.get(id) : undefined; if (n && !seen.has(n.id) && !n.is_template) { seen.add(n.id); out.push(n); } }
    return out.slice(0, 8);
  }, [routePage, s.recents, s.byId]);

  // Waffle animates in the header: shrinks between dots while it thinks, comets while it's on a job. Jeff stays still.
  const isWaffle = usePersona() === "waffle";
  const live = msgs.length ? msgs[msgs.length - 1] : null;
  const liveMode = ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV && (localStorage.getItem("sg.waffle.force") as "idle" | "think" | "tool" | null)) // dev only: hold a mood to look at it
    || (working ? "tool" : !busy || !live ? "idle" : "think");

  if (!s.agentOpen) return null;
  const shown = msgs;
  const empty = loaded && !shown.some((m) => m.role !== "system");
  return (
    <aside className={`agent ${mode}`} aria-label={`${agentName()}, your assistant`}>
      <div className={`ag-head ${!empty ? "has-jeff" : ""}`}>
        {/* The assistant sits in the middle of the header (an empty thread shows it large instead). */}
        {!empty && <span className="ag-head-jeff" aria-hidden><JeffAvatar size={30} mode={liveMode} /></span>}
        <span className="rel ag-title-wrap">
          <button className="ag-chat-title" onClick={() => setMenu(menu === "main" ? null : "main")} title={`${agentName()}'s settings`}>
            {agentName()} <span className="ag-caret"><IChevron size={14} /></span>
          </button>
          {menu === "main" && (
            <Popover onClose={() => setMenu(null)} className="ag-history">
              <button onClick={() => void newTopic()}><MessageSquarePlus size={18} /> New topic</button>
              <button onClick={() => { setMenu(null); s.setMemoryOpen(true); }}><Lightbulb size={18} /> {agentName()}'s memory</button>
              <button onClick={() => { setMenu(null); s.setProactiveOpen(true); }}><CalendarClock size={18} /> Routines & saved prompts</button>
            </Popover>
          )}
        </span>
        <span className="grow" />
        <button className="ghost icon-btn" title="New topic: a fresh start for the conversation (the history stays)" onClick={() => void newTopic()}><MessageSquarePlus size={18} /></button>
        <button className="ghost icon-btn ag-dock" title={mode === "floating" ? "Dock as sidebar" : "Float as window"} onClick={() => setMode(mode === "floating" ? "docked" : "floating")}>
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round"><rect x="3.4" y="4.2" width="13.2" height="11.6" rx="2" />{mode === "floating" ? <path d="M12 4.2v11.6" /> : <rect x="10.2" y="9.6" width="4.4" height="3.8" rx=".8" fill="currentColor" />}</svg>
        </button>
        <button className="ghost icon-btn" title="Close (Ctrl+J)" onClick={() => s.setAgentOpen(false)}><IClose size={18} /></button>
      </div>

      <div className="ag-scroll" ref={scroller} onScroll={onScroll}>
        {status && !status.configured && (
          <div className="ag-setup">
            <KeyRound size={18} />
            <b>Connect {agentName()} to Claude</b>
            <p>{agentName()} runs on Claude Sonnet 5.5. Set up workload identity federation (Settings, then Setup & status), or store an API key as a secret on the Worker:</p>
            <pre>npx wrangler secret put ANTHROPIC_API_KEY</pre>
            <p>For local development, put <code>ANTHROPIC_API_KEY=sk-ant-…</code> (or <code>mock</code>) in <code>.dev.vars</code> and restart.</p>
          </div>
        )}
        {hasOlder && <button className="ghost ag-older" onClick={() => void loadOlder()}>Show earlier messages</button>}
        {empty && status?.configured && (
          <div className="ag-empty">
            <JeffAvatar size={56} />
            <b>How can I help you today?</b>
            <p className="ag-empty-note">This is one ongoing conversation. {agentName()} remembers it, and will bring things up here on its own when they matter.</p>
          </div>
        )}
        {shown.map((m, i) => {
          const prev = shown[i - 1], next = shown[i + 1];
          const side = (x?: Msg) => (!x ? "" : x.role === "user" ? "me" : x.role === "assistant" ? "them" : x.role);
          const gap = (x?: Msg, y?: Msg) => !x || !y || Math.abs(y.created_at - x.created_at) > 15 * 60_000;
          // A time label when the day changes or after a quiet spell, like Messages.
          const stampAbove = m.role !== "system" && (!prev || dayKey(prev.created_at) !== dayKey(m.created_at) || gap(prev, m));
          const lastOfGroup = !next || side(next) !== side(m) || gap(m, next) || next.role === "divider";
          const firstOfGroup = stampAbove || !prev || side(prev) !== side(m);
          const item = m.inboxId ? inbox.get(m.inboxId) : undefined;
          const p = item?.action?.proposal;
          return (
            <div key={m.key} className={`tx-row ${side(m)} ${firstOfGroup ? "first" : ""} ${lastOfGroup ? "last" : ""}`}>
              {stampAbove && m.role !== "divider" && <div className="tx-time">{dayLabel(m.created_at)} {clockOf(m.created_at)}</div>}
              {m.role === "divider" && <div className="tx-divider"><span>{m.text === "New topic" ? `New topic · ${dayLabel(m.created_at)} ${clockOf(m.created_at)}` : `Earlier chat: ${m.text}`}</span></div>}
              {m.role === "system" && <div className="tx-sys">{m.text}</div>}
              {m.role === "user" && <div className="tx-line"><div className="tx-bubble me" title={clockOf(m.created_at)}>{m.label ?? m.text}</div></div>}
              {m.role === "assistant" && (
                <div className="tx-line">
                  <div className="tx-col">
                    {m.tools.length > 0 && (
                      <div className="tx-tools">
                        {m.tools.map((t) => {
                          const I = TOOL_ICON[t.name] ?? Sparkles;
                          const link = t.noteIds[0];
                          return (
                            <button key={t.id} className={`tx-tool ${t.status}`} disabled={!link} onClick={() => link && s.go(`/p/${link}`)} title={link ? "Open page" : undefined}>
                              {t.status === "running" ? (isWaffle ? <Waffle size={13} mode="tool" /> : <Loader2 size={12} className="spin" />) : t.status === "error" ? <TriangleAlert size={12} /> : <I size={12} />}
                              <span>{t.status === "running" ? `${t.label}…` : t.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {m.text && <div className="tx-bubble them ag-md" title={clockOf(m.created_at)} dangerouslySetInnerHTML={renderMd(m.text)} />}
                    {m.tools.filter((t) => t.game).map((t) => <div key={t.id} className="tx-chips"><button className="primary" onClick={() => { s.setAgentOpen(false); s.setDrill({ ...t.game!, nonce: Date.now() }); }}>Play it now</button></div>)}
                    {m.state === "streaming" && !m.text && <div className="tx-bubble them tx-typing" aria-label={m.tools.length ? "Working" : "Typing"}><i /><i /><i /></div>}
                    {m.error && <div className="tx-error"><TriangleAlert size={13} /> {m.error}</div>}
                    {/* What it suggested on its own: quick replies, like a text you can answer with one tap. */}
                    {p && item?.status === "new" && (
                      <div className="tx-chips">
                        <button className="primary" onClick={() => void act(item, "accept")}>{p.type === "add_task" ? `Add “${p.title}”` : p.type === "study_plan" ? `Add ${p.sessions.length} study sessions` : p.type === "tidy" ? `Tidy up (${p.trash.length + p.moves.length} change${p.trash.length + p.moves.length === 1 ? "" : "s"})` : `Add ${p.cards.length} flashcards`}</button>
                        <button onClick={() => void act(item, "dismiss")}>No thanks</button>
                      </div>
                    )}
                    {item && item.status === "accepted" && <div className="tx-meta">{p?.type === "add_task" || p?.type === "study_plan" ? "Added to My tasks" : p?.type === "tidy" ? "Tidied up" : "Flashcards added"}{item.action?.run_id && <> · <button className="tx-link" onClick={() => void undoInbox(item)}>Undo</button></>}</div>}
                    {item && item.status === "dismissed" && p && <div className="tx-meta">Skipped</div>}
                    {m.kind === "routine" && m.runId && (item?.action?.note_ids?.length ?? 0) > 0 && (
                      <div className="tx-meta"><button className="tx-link" onClick={() => s.go(`/p/${item!.action!.note_ids![0]}`)}>Open page</button> · <button className="tx-link" onClick={() => void undoInbox(item!)}>Undo its changes</button></div>
                    )}
                    {m.kind === "chat" && m.runId && !!m.changes && (
                      <div className="tx-meta">{m.changes} change{m.changes === 1 ? "" : "s"}{m.cost ? ` · ${m.cost < 0.01 ? "<$0.01" : `~$${m.cost.toFixed(2)}`}` : ""} · <button className="tx-link" onClick={() => void undoRun(m)}>{m.undone ? <><CornerUpRight size={12} /> Redo</> : <><CornerUpLeft size={12} /> Undo</>}</button></div>
                    )}
                    {m.kind === "chat" && m.state !== "streaming" && m.text && (
                      <div className="tx-actions">
                        <button className="ghost icon-btn" title="Copy" onClick={() => copy(m)}><Copy size={13} /></button>
                        <button className="ghost icon-btn" title="Try again" onClick={() => retry(m)} disabled={busy}><RotateCcw size={13} /></button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="ag-compose">
        {input.startsWith("/") && <div className="ag-cmds">{["/undo", "/redo", "/new", ...saved.map((x) => `/${x.name}`)].filter((c) => c.startsWith(input.toLowerCase().split(/\s/)[0])).map((c) => <button key={c} title={saved.find((x) => `/${x.name}` === c)?.text ?? (c === "/new" ? "Start a new topic" : undefined)} onClick={() => setInput(saved.some((x) => `/${x.name}` === c) ? `${c} ` : c)}>{c}</button>)}</div>}
        <div className={`ag-box ${multi ? "multi" : ""}`}>
          <div className="ag-ctxrow">
            <span className="rel">
              <button className="ag-at" title={`Point ${agentName()} at a page`} onClick={() => setMenu(menu === "at" ? null : "at")}>@</button>
              {menu === "at" && (
                <Popover onClose={() => setMenu(null)} className="ag-at-pop">
                  <div className="mp-title">Use a page as context</div>
                  {pickable.map((n) => <button key={n.id} onClick={() => { setCtxId(n.id); setMenu(null); box.current?.focus(); }}><PageIcon icon={n.icon} kind={n.kind} size={16} /> <span className="t">{n.title || "New page"}</span></button>)}
                  {!pickable.length && <div className="mp-foot">Open a page first, then it shows up here.</div>}
                  {pageId && <><div className="mp-sep" /><button onClick={() => { setCtxId(null); setMenu(null); }}>No page context</button></>}
                </Popover>
              )}
            </span>
            {ctxNode && (
              <span className="ag-ctx-chip" title={`${agentName()} can read this page`}>
                <PageIcon icon={ctxNode.icon} kind={ctxNode.kind} size={14} /> <span className="t">{ctxNode.title || "New page"}</span>
                <button title="Don't use this page" onClick={() => setCtxId(null)}><IClose size={12} /></button>
              </span>
            )}
          </div>
          <textarea ref={box} rows={1} value={input} placeholder={`Message ${agentName()}…`} disabled={status?.configured === false}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(input); } }} />
          <div className="ag-boxfoot">
            <span className="rel">
              <button className="ag-modelbtn" title={`Choose ${agentName()}'s model`} disabled={status?.mock || !models.length} onClick={() => setMenu(menu === "model" ? null : "model")}>
                {status?.mock ? "Mock model" : current?.label ?? "Sonnet 5.5"} {!status?.mock && <IChevron size={12} />}
              </button>
              {menu === "model" && (
                <Popover onClose={() => setMenu(null)} className="ag-model-pop">
                  <div className="mp-title">Model</div>
                  {models.map((m) => (
                    <button key={m.id} className={m.id === current?.id ? "on" : ""} onClick={() => { setModel(m.id === status?.model ? "" : m.id); setMenu(null); }}>
                      <span className="t">{m.label}<small>{m.blurb}</small></span>{m.id === current?.id && <span className="ag-check">✓</span>}
                    </button>
                  ))}
                  <div className="mp-title">Tools</div>
                  <button className={web ? "on" : ""} onClick={() => setWeb(!web)} role="switch" aria-checked={web}>
                    <span className="t">Search the web<small>{web ? `${agentName()} can look things up and read links` : `Off: ${agentName()} only uses your notes`}</small></span>{web && <span className="ag-check">✓</span>}
                  </button>
                </Popover>
              )}
            </span>
            <span className="ag-hint">Enter to send · / for commands</span>
            {busy
              ? <button className="send stop" title="Stop" onClick={() => abort.current?.abort()}><Square size={11} fill="currentColor" /></button>
              : input.trim()
                ? <button className="send" title="Send" disabled={status?.configured === false} onClick={() => void send(input)}><IArrowUp size={16} /></button>
                : <button className="send live" title={`Talk with ${agentName()}`} aria-label={`Talk with ${agentName()}`} disabled={status?.configured === false} onClick={() => { unlockVoice(); s.setLiveVoice(true); }}><AudioLines size={17} /></button>}
          </div>
        </div>
      </div>
      {s.liveVoice && <LiveVoice />}
    </aside>
  );
}
