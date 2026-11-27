import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { api } from "./api";
import type { Note, TreeNode } from "./types";
import type { StudyChange, StudySet } from "./study/generated";
import { EDITION } from "./edition";
import type { ChatOpener, ExplainPrompt, TestQuestion } from "./study/coach";

/** What a study session covers: one page, or several (a subject, or everything due) under one title. */
export type StudyTarget = string | { ids: string[]; title: string; dueOnly?: boolean };
export type ToastAction = { label: string; run: () => void };
export type Drill = { ids: string[]; title?: string; mode: "quiz" | "blanks" | "match"; change?: StudyChange; nonce?: number; replay?: StudySet; /** go straight back into the unfinished one (study/resume.ts) */ resume?: boolean };
/** History: everything, or only what was studied on these pages (a page, a subject). */
export type PastTarget = { ids?: string[]; title?: string; open?: string };
/** The screen for choosing how to study: a test, one page, or a whole subject. */
/** Explain it on these pages (ExplainView.tsx); `replay` retakes past prompts from History. */
export type ExplainTarget = { ids: string[]; title?: string; replay?: ExplainPrompt[]; nonce: number };
export type PickTarget = { kind: "exam" | "page" | "subject"; id: string; /** a test just created: offer a study plan straight away */ fresh?: boolean };
export type StudyChatTarget = { ids: string[]; title?: string; opener?: ChatOpener; nonce?: number };
export type Route = { kind: "home" } | { kind: "page"; id: string } | { kind: "trash" } | { kind: "tasks" } | { kind: "review" } | { kind: "study" } | { kind: "calendar" };
type Theme = "system" | "light" | "dark";

interface Dialog { label: string; initial: string; resolve: (v: string | null) => void; confirm?: boolean }

interface Store {
  tree: TreeNode[]; byId: Map<string, TreeNode>; childrenOf: (id: string | null) => TreeNode[];
  refreshTree: () => Promise<void>; patchTreeLocal: (id: string, patch: Partial<TreeNode>) => void;
  route: Route; go: (to: string) => void;
  /** iOS-style Back: the previous screen in this app, else the parent page, else Home. */
  goBack: () => void;
  /** The page shown in the side peek (Notion's side panel for tasks and database rows), or null. */
  peekId: string | null; setPeek: (id: string | null) => void;
  theme: Theme; setTheme: (t: Theme) => void;
  sidebarOpen: boolean; toggleSidebar: () => void;
  /** A short message; with an action (e.g. Undo) it stays a little longer and shows a button. */
  toast: (msg: string, action?: ToastAction) => void; toasts: { id: number; msg: string; action?: ToastAction }[];
  ask: (label: string, initial?: string) => Promise<string | null>;
  confirm: (label: string) => Promise<boolean>;
  dialog: Dialog | null; closeDialog: (v: string | null) => void;
  newPage: (opts?: Partial<Note> & { template_id?: string }) => Promise<Note>;
  paletteOpen: boolean; setPaletteOpen: (v: boolean) => void;
  /** The page whose flashcards are being studied (full-screen study mode), or null. */
  studyId: StudyTarget | null; setStudy: (t: StudyTarget | null) => void;
  /** A study game on a page's flashcards (quiz, fill in the blanks, match), full screen, or null. */
  drill: Drill | null; setDrill: (d: Drill | null) => void;
  studyChat: StudyChatTarget | null; setStudyChat: (t: StudyChatTarget | null) => void;
  /** The Jeff's memory window. */
  memoryOpen: boolean; setMemoryOpen: (v: boolean) => void;
  /** Settings > Routines & saved prompts. */
  proactiveOpen: boolean; setProactiveOpen: (v: boolean) => void;
  /** The Notifications window. */
  notifyOpen: boolean; setNotifyOpen: (v: boolean) => void;
  /** Photo to notes window. */
  photoOpen: boolean; setPhotoOpen: (v: boolean) => void;
  /** Quick capture settings and the voice note recorder. */
  captureOpen: boolean; setCaptureOpen: (v: boolean) => void;
  /** Settings > Backups. */
  backupOpen: boolean; setBackupOpen: (v: boolean) => void;
  voiceOpen: boolean; setVoiceOpen: (v: boolean) => void;
  /** Practice test on these pages (full screen), or null. */
  quiz: string[] | null; setQuiz: (ids: string[] | null, replay?: TestQuestion[], resume?: boolean) => void;
  /** Explain it (full screen), or null. */
  explain: ExplainTarget | null; setExplain: (t: ExplainTarget | null) => void;
  /** The questions of a past practice test being retaken, if that's what the practice test is. */
  quizReplay: TestQuestion[] | null;
  /** Go straight back into the unfinished practice test on these pages (study/resume.ts), without asking. */
  quizResume: boolean;
  /** The History screen of finished quizzes and tests, or null. */
  past: PastTarget | null; setPast: (t: PastTarget | null) => void;
  pick: PickTarget | null; setPick: (t: PickTarget | null) => void;
  /** The full-screen live voice conversation. */
  liveVoice: boolean; setLiveVoice: (v: boolean) => void;
  /** Show a task in the side peek over My tasks (from a notification). */
  openTask: (id: string) => void;
  agentOpen: boolean; setAgentOpen: (v: boolean) => void;
  /** Recently opened page ids, newest first (this device). */
  recents: string[];
  /** The built-in to-do list database, once it exists. */
  tasksDbId: string | null;
  /** The Calendar's events database (made on the first event), or null. */
  eventsDbId: string | null;
}

const Ctx = createContext<Store>(null as unknown as Store);
export const useStore = () => useContext(Ctx);

const read = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };

function parseRoute(): Route {
  const h = location.hash.replace(/^#/, "");
  if (h === "/trash") return { kind: "trash" };
  if (h === "/tasks") return { kind: "tasks" };
  if (h === "/review") return { kind: "review" };
  if (h === "/study") return { kind: "study" };
  if (h === "/calendar" && EDITION.calendar) return { kind: "calendar" };
  const m = /^\/p\/([0-9a-f-]{36})/.exec(h);
  return m ? { kind: "page", id: m[1] } : { kind: "home" };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [route, setRoute] = useState<Route>(parseRoute);
  const [theme, setThemeState] = useState<Theme>(read("sg.theme", "system") as Theme);
  const [sidebarOpen, setSidebarOpen] = useState(read("sg.sidebar", "1") === "1" && window.innerWidth >= 860);
  const [toasts, setToasts] = useState<{ id: number; msg: string; action?: ToastAction }[]>([]);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [studyId, setStudy] = useState<StudyTarget | null>(null);
  const [drill, setDrill] = useState<Drill | null>(null);
  const [studyChat, setStudyChat] = useState<StudyChatTarget | null>(null);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [proactiveOpen, setProactiveOpen] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [quiz, setQuizIds] = useState<string[] | null>(null);
  const [quizReplay, setQuizReplay] = useState<TestQuestion[] | null>(null);
  const [quizResume, setQuizResume] = useState(false);
  const [explain, setExplain] = useState<ExplainTarget | null>(null);
  const setQuiz = useCallback((ids: string[] | null, replay?: TestQuestion[], resume?: boolean) => { setQuizIds(ids); setQuizReplay(replay ?? null); setQuizResume(!!resume); }, []);
  const [past, setPast] = useState<PastTarget | null>(null);
  const [pick, setPick] = useState<PickTarget | null>(null);
  const [liveVoice, setLiveVoice] = useState(false);
  const pendingPeek = useRef<string | null>(null);
  const [peekId, setPeek] = useState<string | null>(null);
  // Going anywhere closes the side peek, and on a phone the drawer too (it covers the page you went to).
  // (openTask can ask for a peek to open on the page it's going to.)
  useEffect(() => { setPeek(pendingPeek.current); pendingPeek.current = null; if (window.innerWidth < 860) setSidebarOpen(false); }, [route]);
  const [agentOpen, setAgentOpenState] = useState(read("sg.agent", "0") === "1" && window.innerWidth > 900);
  const toastId = useRef(0);

  const [treeLoaded, setTreeLoaded] = useState(false);
  const [recents, setRecents] = useState<string[]>(() => { try { return JSON.parse(read("sg.recents", "[]")); } catch { return []; } });
  const refreshTree = useCallback(async () => { try { setTree(await api.tree()); setTreeLoaded(true); } catch { /* shown elsewhere */ } }, []);
  useEffect(() => { refreshTree(); }, [refreshTree]);

  // The built-in to-do list: ask the server for it once. It's created on first run and never re-created
  // after you delete it (the server finds it in the trash and says so).
  const tasksDbId = useMemo(() => tree.find((n) => n.system === "tasks")?.id ?? null, [tree]);
  const eventsDbId = useMemo(() => tree.find((n) => n.system === "events")?.id ?? null, [tree]);
  const ensured = useRef(false);
  useEffect(() => {
    if (!treeLoaded || tasksDbId || ensured.current) return;
    ensured.current = true;
    api.ensureTasks().then((r) => { if (r.created) void refreshTree(); }).catch(() => { ensured.current = false; });
  }, [treeLoaded, tasksDbId, refreshTree]);

  // Recents for the sidebar (Notion keeps the same list).
  useEffect(() => {
    if (route.kind !== "page") return;
    setRecents((r) => { const next = [route.id, ...r.filter((x) => x !== route.id)].slice(0, 20); write("sg.recents", JSON.stringify(next)); return next; });
  }, [route]);

  // Multi-device sync: while the app is visible, ask the server what changed since the last check.
  // Changes from other devices, Jeff or Claude (MCP) refresh the sidebar, the open page and database rows.
  useEffect(() => {
    let since = 0;
    let stopped = false;
    let timer: number | undefined;
    const tick = async () => {
      if (stopped) return;
      if (!document.hidden) {
        try {
          const r = await api.changes(since);
          if (since && r.changes.length) { await refreshTree(); window.dispatchEvent(new CustomEvent("seaglass:agent-changed")); }
          since = r.now;
        } catch { /* offline or signed out: try again next tick */ }
      }
      timer = window.setTimeout(tick, 6000);
    };
    void tick();
    const onVisible = () => { if (!document.hidden) { window.clearTimeout(timer); void tick(); } };
    document.addEventListener("visibilitychange", onVisible);
    return () => { stopped = true; window.clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [refreshTree]);
  const navDepth = useRef(0), backing = useRef(false);
  useEffect(() => {
    const f = () => {
      const back = backing.current;
      if (back) { backing.current = false; navDepth.current = Math.max(0, navDepth.current - 1); } else navDepth.current++;
      // Phones: pages slide in like a navigation stack (View Transitions). Skipped when a swipe already animated it.
      const w = window as { __sgSkipVT?: boolean };
      const skip = w.__sgSkipVT; w.__sgSkipVT = false;
      const vt = (document as Document & { startViewTransition?: (cb: () => void) => unknown }).startViewTransition;
      if (!skip && vt && innerWidth < 600 && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
        document.documentElement.dataset.nav = back ? "back" : "forward";
        vt.call(document, () => flushSync(() => setRoute(parseRoute())));
      } else setRoute(parseRoute());
    };
    addEventListener("hashchange", f); return () => removeEventListener("hashchange", f);
  }, []);

  useEffect(() => {
    const dark = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.dataset.theme = theme === "system" ? (dark.matches ? "dark" : "light") : theme;
    apply(); dark.addEventListener("change", apply); return () => dark.removeEventListener("change", apply);
  }, [theme]);

  const byId = useMemo(() => new Map(tree.map((n) => [n.id, n])), [tree]);
  const childMap = useMemo(() => {
    const m = new Map<string | null, TreeNode[]>();
    for (const n of tree) { const k = n.parent_id; (m.get(k) ?? m.set(k, []).get(k)!).push(n); }
    return m;
  }, [tree]);

  const toast = useCallback((msg: string, action?: ToastAction) => {
    const id = ++toastId.current;
    // using the button (e.g. Undo) also closes the toast, so it can't be pressed twice
    const act = action && { label: action.label, run: () => { setToasts((t) => t.filter((x) => x.id !== id)); action.run(); } };
    setToasts((t) => [...t, { id, msg, action: act }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 6000 : 3500);
  }, []);

  const value: Store = {
    tree, byId, childrenOf: (id) => childMap.get(id) ?? [], refreshTree,
    patchTreeLocal: (id, patch) => setTree((t) => t.map((n) => (n.id === id ? { ...n, ...patch } : n))),
    route, go: (to) => { location.hash = to; },
    goBack: () => {
      if (navDepth.current > 0) { backing.current = true; history.back(); return; }
      const parent = route.kind === "page" ? tree.find((n) => n.id === route.id)?.parent_id : null;
      location.hash = parent ? `/p/${parent}` : "/";
    },
    peekId, setPeek,
    theme, setTheme: (t) => { setThemeState(t); write("sg.theme", t); },
    sidebarOpen, toggleSidebar: () => setSidebarOpen((v) => { if (window.innerWidth >= 860) write("sg.sidebar", v ? "0" : "1"); return !v; }), // the phone drawer doesn't change the desktop setting
    toast, toasts,
    ask: (label, initial = "") => new Promise((resolve) => setDialog({ label, initial, resolve })),
    confirm: (label) => new Promise((resolve) => setDialog({ label, initial: "", confirm: true, resolve: (v) => resolve(v !== null) })),
    dialog, closeDialog: (v) => { dialog?.resolve(v); setDialog(null); },
    newPage: async (opts = {}) => {
      const n = await api.create(opts);
      await refreshTree();
      if (n.kind === "page" || n.kind === "database") location.hash = `/p/${n.id}`;
      return n;
    },
    paletteOpen, setPaletteOpen,
    studyId, setStudy, drill, setDrill, studyChat, setStudyChat,
    memoryOpen, setMemoryOpen, proactiveOpen, setProactiveOpen,
    notifyOpen, setNotifyOpen,
    photoOpen, setPhotoOpen, quiz, setQuiz, quizReplay, quizResume, explain, setExplain, past, setPast, pick, setPick, liveVoice, setLiveVoice, captureOpen, setCaptureOpen, backupOpen, setBackupOpen, voiceOpen, setVoiceOpen,
    openTask: (id) => { if (route.kind === "tasks") setPeek(id); else { pendingPeek.current = id; location.hash = "/tasks"; } },
    recents, tasksDbId, eventsDbId,
    agentOpen, setAgentOpen: (v) => { setAgentOpenState(v); write("sg.agent", v ? "1" : "0"); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
