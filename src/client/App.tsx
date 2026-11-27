import { useEffect, useState, type CSSProperties } from "react";
import { MemoryDialog } from "./components/MemoryDialog";
import { ProactiveDialog } from "./components/ProactiveDialog";
import { startProactive, useUnread } from "./proactive";
import { closeDrawer, MobileGestures } from "./components/Gestures";
import { NotificationsDialog } from "./components/NotificationsDialog";
import { PhotoNotesDialog, QuizView } from "./components/AiTools";
import { ExplainView } from "./components/ExplainView";
import { StudyHistory } from "./components/StudyHistory";
import { StudyPick } from "./components/StudyPick";
import { StudyChat } from "./components/StudyChat";
import { FocusTimer, ReviewView } from "./components/StudyTools";
import { CaptureDialog, takeShared, VoiceDialog } from "./components/CaptureTools";
import { BackupDialog } from "./components/BackupDialog";
import { OfflineBadge } from "./components/OfflineBadge";
import { isNetworkError, startOfflineSync, warmCache } from "./offline";
import { agentName, syncPersona, usePersona } from "./persona";
import { watchForUpdates } from "./version";
import { syncPush } from "./push";
import { StudyView } from "./components/StudyView";
import { StudyTab } from "./components/StudyTab";
import { DrillView } from "./components/DrillView";
import { IChevronLeft, ICompose, IHome, IMenu, ISearch, IStudy } from "./ui-icons";
import { JeffAvatar, JeffFace, Logo } from "./icons";
import { api, ApiError, setUnauthorizedHandler } from "./api";
import { StoreProvider, useStore } from "./store";
import { Sidebar } from "./components/Sidebar";
import { PageView } from "./components/PageView";
import { Palette } from "./components/Palette";
import { AgentPanel } from "./components/AgentPanel";
import { Home, Trash } from "./components/Views";
import { TasksView } from "./components/Tasks";
import { Dialogs } from "./components/ui";
import { bootDone } from "./boot";
import { SignIn } from "./components/Welcome";
import { Onboarding } from "./components/Onboarding";
import { setMe } from "./me";
import { CalendarView } from "./components/CalendarView";

function Shell() {
  const s = useStore();
  usePersona(); // switching assistant (Jeff or Waffle) re-renders every name and picture
  useEffect(() => { void syncPersona(); const a = watchForUpdates(), b = startProactive(); return () => { a(); b(); }; }, []);
  // The boot screen goes once the sidebar has pages to show (or after 2.5 s, e.g. offline with nothing cached).
  useEffect(() => { if (s.tree.length) bootDone(); }, [s.tree.length]);
  useEffect(() => { const t = setTimeout(bootDone, 2500); return () => clearTimeout(t); }, []);
  const unread = useUnread();
  useEffect(() => { const open = () => s.setAgentOpen(true); addEventListener("seaglass:agent-open", open); return () => removeEventListener("seaglass:agent-open", open); }); // e.g. a saved prompt from a page's / menu
  useEffect(() => {
    // Notion's app-wide shortcuts. The editor handles its own first (e.g. Ctrl+K on selected text
    // adds a link) and marks the event handled, so skip anything it already took.
    const k = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      const pageId = s.route.kind === "page" ? s.route.id : null;
      const act = (fn: () => void) => { e.preventDefault(); fn(); };
      if ((key === "k" || key === "p") && !e.shiftKey && !e.altKey) act(() => s.setPaletteOpen(!s.paletteOpen));
      else if (e.key === "\\") act(s.toggleSidebar);
      else if (key === "j" && !e.shiftKey) act(() => s.setAgentOpen(!s.agentOpen));
      else if (e.altKey && key === "n") act(() => void s.newPage());
      else if (e.key === "[" && !e.shiftKey) act(() => history.back());
      else if (e.key === "]" && !e.shiftKey) act(() => history.forward());
      else if (e.shiftKey && key === "l") act(() => s.setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
      else if (e.shiftKey && key === "u" && pageId) act(() => { const p = s.byId.get(pageId)?.parent_id; s.go(p ? `/p/${p}` : "/"); });
      else if (key === "l" && !e.shiftKey && !e.altKey && pageId) act(() => { void navigator.clipboard?.writeText(`${location.origin}/#/p/${pageId}`); s.toast("Copied link to page"); });
    };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  });
  // Offline: send edits made without a connection when it comes back, and keep recent pages ready to read.
  useEffect(() => startOfflineSync((m) => s.toast(m)), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setTimeout(() => { void warmCache([...s.recents, ...s.tree.filter((n) => n.favorite).map((n) => n.id), ...[...s.tree].sort((a, b) => b.updated_at - a.updated_at).slice(0, 15).map((n) => n.id)], s.tasksDbId); }, 4000);
    return () => clearTimeout(t);
  }, [s.tree.length, s.tasksDbId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Notifications: keep this device's subscription current, and open the task a notification was about
  // (?peek=<id> when the app was closed, a message from the service worker when it was open).
  useEffect(() => {
    void syncPush();
    void takeShared(s.toast);
    if (new URLSearchParams(location.search).has("assistant")) { history.replaceState(null, "", location.pathname + location.hash); s.setAgentOpen(true); } // a tapped assistant notification
    const q = new URLSearchParams(location.search).get("peek");
    if (q) {
      history.replaceState(null, "", location.pathname + location.hash);
      if (/^[0-9a-f-]{36}$/.test(q)) setTimeout(() => s.openTask(q), 0);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const sw = navigator.serviceWorker;
    if (!sw) return;
    const m = (e: MessageEvent) => {
      const d = e.data as { type?: string; id?: string | null; url?: string } | null;
      if (d?.type !== "seaglass:open") return;
      if (d.url?.includes("assistant=1")) s.setAgentOpen(true);
      else if (d.id && /^[0-9a-f-]{36}$/.test(d.id)) s.openTask(d.id); else s.go("/tasks");
    };
    sw.addEventListener("message", m); return () => sw.removeEventListener("message", m);
  });
  useEffect(() => {
    if (!s.peekId) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) { el.blur(); return; }
      if (document.querySelector(".popover, .fixed-pop, .modal-back, .spot-back, .study")) return;
      s.setPeek(null);
    };
    addEventListener("keydown", esc); return () => removeEventListener("keydown", esc);
  }, [s.peekId]); // eslint-disable-line react-hooks/exhaustive-deps
  const tabSel = s.agentOpen ? 2 : s.route.kind === "home" ? 0 : s.route.kind === "study" ? 1 : -1;
  return (
    <div className={`app route-${s.route.kind} ${s.sidebarOpen ? "" : "collapsed"} ${s.agentOpen ? "has-agent" : ""}`}>
      {s.sidebarOpen && <Sidebar />}
      {s.sidebarOpen && <div className="scrim" onClick={() => closeDrawer(s.toggleSidebar)} />}
      <MobileGestures />
      <FocusTimer />
      <OfflineBadge />
      <main className="main">
        {!s.sidebarOpen && <button className="open-sb ghost icon-btn" title="Open sidebar (Ctrl+\)" aria-label="Open sidebar" onClick={s.toggleSidebar}><IMenu /></button>}
        {/* Phones: pushed screens get a back chevron instead of the menu button (Apple HIG navigation bars). */}
        {s.route.kind !== "home" && <button className="nav-back ghost icon-btn" aria-label="Back" onClick={s.goBack}><IChevronLeft size={26} /></button>}
        {s.route.kind === "page" ? <PageView key={s.route.id} id={s.route.id} /> : s.route.kind === "trash" ? <Trash /> : s.route.kind === "tasks" ? <TasksView /> : s.route.kind === "review" ? <ReviewView /> : s.route.kind === "study" ? <StudyTab /> : s.route.kind === "calendar" ? <CalendarView /> : <Home />}
      </main>
      {s.peekId && <aside className="peek" aria-label="Side peek"><PageView key={s.peekId} id={s.peekId} peek /></aside>}
      {/* Phones: with Liquid Glass it's a floating capsule (Home, Jeff, New) plus Search in its own circle, like iOS 26. */}
      <nav className="tabbar" aria-label="Main">
        <div className="tb-pill">
          <span className="tb-sel" aria-hidden hidden={tabSel < 0} style={{ "--i": Math.max(0, tabSel) } as CSSProperties} />
          <a href="#/" className={tabSel === 0 ? "on" : ""}><IHome size={24} /><span>Home</span></a>
          <a href="#/study" className={tabSel === 1 ? "on" : ""}><IStudy size={24} /><span>Study</span></a>
          <button className={tabSel === 2 ? "on" : ""} onClick={() => s.setAgentOpen(!s.agentOpen)}><span className="tab-jeff"><JeffFace size={22} /></span><span>{agentName()}</span></button>
          <button onClick={() => void s.newPage()}><ICompose size={24} /><span>New</span></button>
        </div>
        <button className="tb-search" aria-label="Search" onClick={() => s.setPaletteOpen(true)}><ISearch size={24} /><span>Search</span></button>
      </nav>
      {!s.agentOpen && <button className="jeff-fab" title={`Ask ${agentName()} (Ctrl+J)`} onClick={() => s.setAgentOpen(true)}><JeffAvatar size={40} />{unread > 0 && <span className="fab-badge">{unread}</span>}</button>}
      {s.pick && <StudyPick key={`${s.pick.kind}-${s.pick.id}`} target={s.pick} />}
      {s.studyId && <StudyView key={JSON.stringify(s.studyId)} target={s.studyId} />}
      {s.drill && <DrillView key={`${s.drill.ids.join()}-${s.drill.mode}-${s.drill.nonce ?? 0}`} drill={s.drill} />}
      {s.studyChat && <StudyChat key={`${s.studyChat.ids.join()}-${s.studyChat.nonce ?? 0}`} target={s.studyChat} />}
      {s.memoryOpen && <MemoryDialog />}
      {s.proactiveOpen && <ProactiveDialog />}
      {s.notifyOpen && <NotificationsDialog />}
      {s.photoOpen && <PhotoNotesDialog />}
      {s.captureOpen && <CaptureDialog />}
      {s.backupOpen && <BackupDialog />}
      {s.voiceOpen && <VoiceDialog />}
      {s.explain && <ExplainView key={s.explain.nonce} target={s.explain} />}
      {s.quiz && <QuizView key={`${s.quiz.join()}-${s.quizResume}`} ids={s.quiz} replay={s.quizReplay ?? undefined} resume={s.quizResume} />}
      {s.past && <StudyHistory target={s.past} />}
      <AgentPanel />
      <Palette />
      <Dialogs />
    </div>
  );
}

export function App() {
  // What to show first: the setup screen (a new copy), sign-in, or the app.
  const [view, setView] = useState<"loading" | "setup" | "signin" | "app">("loading");
  const [codeRequired, setCodeRequired] = useState(true);
  const [noTables, setNoTables] = useState(false);
  const check = () => api.session().then((r) => {
    if (r.setup) { setCodeRequired(!!r.code_required); setNoTables(!!r.no_tables); setView("setup"); }
    else { setMe(r.user); setView(r.authed ? "app" : "signin"); }
  }).catch((e) => setView(isNetworkError(e) ? "app" : "signin")); // offline: carry on with what's cached (an API 401 later still shows sign-in)
  useEffect(() => { setUnauthorizedHandler(() => setView("signin")); void check(); }, []);
  useEffect(() => { if (view === "setup" || view === "signin") bootDone(); }, [view]);
  if (view === "loading") return null;
  if (view === "setup") return <Onboarding codeRequired={codeRequired} noTables={noTables} onDone={() => void check()} />;
  if (view === "signin") return <SignIn onDone={() => void check()} />;
  return <StoreProvider><Shell /></StoreProvider>;
}
