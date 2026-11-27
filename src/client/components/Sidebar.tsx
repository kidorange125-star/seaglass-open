import { createPortal } from "react-dom";
import { inFamily, spaceHref, spaceKey } from "../space";
import { homeName, isHousehold } from "../me";
import { useMemo, useRef, useState, type ReactElement } from "react";
import { MovePicker } from "./MovePicker";
import { EDITION } from "../edition";
import { AccountDialog } from "./AccountDialog";
import { UsageDialog } from "./UsageDialog";
import { PermissionsDialog } from "./PermissionsDialog";
import { IBell, IChart, ICalendar, ICheckSquare, IChevron, IChevronsUpDown, IDatabase, ICollapse, ICompose, ICopy, IDownload, IEyeOff, IHome, ILink, ILock, ILogout, IMore, IOpen, IPencil, IPlus, ISearch, ISettings, IShield, IStar, ITrash, IUpload, IStudy } from "../ui-icons";
import { api } from "../api";
import { useStore } from "../store";
import { JeffFace, Logo, PageIcon } from "../icons";
import { Popover } from "./ui";
import { SetupModal } from "./Setup";
import { clearOffline, queuedCount } from "../offline";
import { glassEnabled, glassLevel, setGlassEnabled, setGlassLevel } from "../glass";
import { activeSorted, todayIso, useTasks } from "./Tasks";
import type { TreeNode } from "../types";
import { agentName, choosePersona, PERSONAS, usePersona } from "../persona";
import { BUILD } from "../version";
import { useUnread } from "../proactive";

let dragId: string | null = null;
type Zone = "before" | "inside" | "after";
const S = 20;
export const MOBILE = 860; // keep in sync with the @media breakpoint in notion.css
export const isMobile = () => innerWidth < MOBILE;

const readSet = (key: string): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(key) ?? "[]")); } catch { return new Set(); } };
const writeSet = (key: string, v: Set<string>) => { try { localStorage.setItem(key, JSON.stringify([...v])); } catch { /* ignore */ } };

export function Sidebar() {
  const personaId = usePersona();
  const unread = useUnread();
  const s = useStore();
  const [open, setOpen] = useState<Set<string>>(() => readSet(spaceKey("sg.open")));
  const [closedSections, setClosedSections] = useState<Set<string>>(() => readSet("sg.sections"));
  const [drop, setDrop] = useState<{ id: string; zone: Zone } | null>(null);
  const [settings, setSettings] = useState<null | "top" | "foot">(null);
  const [glassOn, setGlassOn] = useState(glassEnabled);
  const [glassLvl, setGlassLvl] = useState(glassLevel);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [permsOpen, setPermsOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const toggle = (id: string, force?: boolean) => setOpen((o) => {
    const n = new Set(o); (force ?? !n.has(id)) ? n.add(id) : n.delete(id);
    writeSet(spaceKey("sg.open"), n); return n;
  });
  const toggleSection = (k: string) => setClosedSections((o) => { const n = new Set(o); n.has(k) ? n.delete(k) : n.add(k); writeSet("sg.sections", n); return n; });
  const afterNav = () => { if (isMobile()) s.toggleSidebar(); };

  // The built-in to-do list has its own "My tasks" row, so it isn't repeated in the page tree.
  const visibleKids = (id: string | null) => s.childrenOf(id).filter((c) => !c.is_template && !c.system && s.byId.get(c.parent_id ?? "")?.kind !== "database").sort((a, b) => a.position - b.position);
  const tasks = useTasks();
  const due = useMemo(() => { const t = todayIso(); return activeSorted(tasks.rows ?? []).filter((x) => x.deadline && x.deadline <= t).length; }, [tasks.rows]);
  const recents = useMemo(() => s.recents.map((id) => s.byId.get(id)).filter((n): n is TreeNode => !!n && !n.is_template && !n.system).slice(0, 5), [s.recents, s.byId]);
  const [showAll, setShowAll] = useState(() => { try { return localStorage.getItem("sg.private.all") === "1"; } catch { return false; } });
  const PRIVATE_LIMIT = 8;
  const favorites = useMemo(() => s.tree.filter((n) => n.favorite && !n.is_template), [s.tree]);
  const templates = useMemo(() => s.tree.filter((n) => n.is_template && s.byId.get(n.parent_id ?? "")?.kind !== "database"), [s.tree, s.byId]);

  const isDescendant = (id: string, ancestor: string) => { for (let p = s.byId.get(id); p; p = p.parent_id ? s.byId.get(p.parent_id) : undefined) if (p.id === ancestor) return true; return false; };

  const move = async (target: TreeNode, zone: Zone) => {
    const id = dragId; dragId = null; setDrop(null);
    if (!id || id === target.id || isDescendant(target.id, id)) return;
    let parent_id: string | null, position: number;
    if (zone === "inside") {
      parent_id = target.id;
      position = Math.max(0, ...s.childrenOf(target.id).map((c) => c.position)) + 1;
      toggle(target.id, true);
    } else {
      parent_id = target.parent_id;
      const sibs = visibleKids(parent_id).filter((x) => x.id !== id);
      const i = sibs.findIndex((x) => x.id === target.id);
      const prev = zone === "before" ? sibs[i - 1] : sibs[i];
      const next = zone === "before" ? sibs[i] : sibs[i + 1];
      position = prev && next ? (prev.position + next.position) / 2 : prev ? prev.position + 1 : next ? next.position - 1 : 1;
    }
    try { await api.patch(id, { parent_id, position }); await s.refreshTree(); } catch (e) { s.toast((e as Error).message); }
  };

  // A plain render function (not a nested component) so rows keep their identity while dragging.
  const renderRow = (n: TreeNode, depth: number, keyPrefix = ""): ReactElement => {
    const kids = n.kind === "page" ? visibleKids(n.id) : [];
    const isOpen = open.has(keyPrefix + n.id);
    const active = s.route.kind === "page" && s.route.id === n.id;
    const menu = menuId === keyPrefix + n.id;
    const setMenu = (v: boolean) => setMenuId(v ? keyPrefix + n.id : null);
    return (
      <div key={keyPrefix + n.id}>
        <div
          className={`row ${active ? "active" : ""} ${drop?.id === n.id ? `drop-${drop.zone}` : ""} ${menu ? "menu-open" : ""}`} style={{ paddingLeft: 4 + depth * 12 }}
          draggable={!keyPrefix} onDragStart={(e) => { dragId = n.id; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", n.id); }}
          onDragEnd={() => { dragId = null; setDrop(null); }}
          onDragOver={(e) => { if (!dragId || keyPrefix) return; /* Favorites mirror pages; dropping there would move pages in Private */ e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); const y = (e.clientY - r.top) / r.height; setDrop({ id: n.id, zone: y < 0.25 ? "before" : y > 0.75 ? "after" : "inside" }); }}
          onDrop={(e) => { e.preventDefault(); void move(n, drop?.id === n.id ? drop.zone : "inside"); }}
          onClick={(e) => { if (e.ctrlKey || e.metaKey) { open_(`#/p/${n.id}`); return; } s.go(`/p/${n.id}`); afterNav(); }}
        >
          {/* Notion shows the page icon and swaps it for the expand caret on hover. */}
          <span className="ico-swap">
            <span className="ico"><PageIcon icon={n.icon} kind={n.kind} /></span>
            <button className={`chev ${isOpen ? "open" : ""}`} title={isOpen ? "Collapse" : "Expand"} onClick={(e) => { e.stopPropagation(); toggle(keyPrefix + n.id); }}><IChevron size={16} /></button>
          </span>
          <span className="name">{n.title || "New page"}</span>
          {!!n.ai_hidden && <span className="ai-hidden-mark" title="Hidden from AI"><IEyeOff size={13} /></span>}
          <span className="hover-actions">
            <button title="More" onClick={(e) => { e.stopPropagation(); setMenu(true); }}><IMore size={18} /></button>
            {n.kind === "page" && <button title="Add a page inside" onClick={async (e) => { e.stopPropagation(); toggle(keyPrefix + n.id, true); await s.newPage({ parent_id: n.id }); afterNav(); }}><IPlus size={17} /></button>}
          </span>
          {menu && (
            <Popover onClose={() => setMenu(false)} className="row-menu">
              <button onClick={async (e) => { e.stopPropagation(); setMenu(false); await api.patch(n.id, { favorite: n.favorite ? 0 : 1 }); void s.refreshTree(); }}>{n.favorite ? <><IStar filled size={S} /> Remove from Favorites</> : <><IStar size={S} /> Add to Favorites</>}</button>
              <div className="mp-sep" />
              <button onClick={(e) => { e.stopPropagation(); setMenu(false); void navigator.clipboard?.writeText(`${location.origin}/#/p/${n.id}`); s.toast("Copied link to page"); }}><ILink size={S} /> Copy link</button>
              <button onClick={async (e) => { e.stopPropagation(); setMenu(false); const d = await api.duplicate(n.id); await s.refreshTree(); s.go(`/p/${d.id}`); }}><ICopy size={S} /> Duplicate <kbd>Ctrl+D</kbd></button>
              <button onClick={async (e) => { e.stopPropagation(); setMenu(false); const t = await s.ask("Rename", n.title); if (t !== null) { await api.patch(n.id, { title: t }); void s.refreshTree(); } }}><IPencil size={S} /> Rename</button>
              {!keyPrefix.startsWith("fav") && <button onClick={(e) => { e.stopPropagation(); setMenu(false); setMovingId(keyPrefix + n.id); }}><IOpen size={S} /> Move to…</button>}
              <button className="danger" onClick={async (e) => { e.stopPropagation(); setMenu(false); if (!(await s.confirm(`Move "${n.title || "New page"}" to the trash?`))) return; await api.trash(n.id); await s.refreshTree(); if (active) s.go("/"); s.toast("Moved to trash"); }}><ITrash size={S} /> Move to Trash</button>
            </Popover>
          )}
          {movingId === keyPrefix + n.id && <span onClick={(e) => e.stopPropagation()}><MovePicker id={n.id} onClose={() => setMovingId(null)} /></span>}
        </div>
        {isOpen && kids.map((k) => renderRow(k, depth + 1, keyPrefix))}
        {isOpen && !kids.length && n.kind === "page" && <div className="row empty" style={{ paddingLeft: 30 + depth * 12 }}>No pages inside</div>}
      </div>
    );
  };

  const roots = visibleKids(null);
  const restoreInput = async (f?: File) => {
    if (!f) return;
    try { const r = await api.importAll(JSON.parse(await f.text())); await s.refreshTree(); s.toast(`Imported ${r.notes} pages`); } catch { s.toast("That file isn't a Seaglass backup"); }
  };
  const settingsMenu = (where: "top" | "foot") => settings === where && (
    <Popover onClose={() => setSettings(null)} className={`settings-pop ${where}`}>
      {isHousehold() && <>
        <div className="mp-title">Space</div>
        <div className="seg spaces" role="radiogroup" aria-label="Space">
          <button role="radio" aria-checked={!inFamily} className={!inFamily ? "on" : ""} onClick={() => { if (inFamily) location.href = spaceHref(false); }}>Mine</button>
          <button role="radio" aria-checked={inFamily} className={inFamily ? "on" : ""} onClick={() => { if (!inFamily) location.href = spaceHref(true); }}>{homeName()}</button>
        </div>
        <small className="mp-note">{inFamily ? "Shared with everyone in the household: pages, tasks and the calendar." : "Only you can see your space."}</small>
        <div className="mp-sep" />
      </>}
      <div className="mp-title">Theme</div>
      <div className="seg">{(["system", "light", "dark"] as const).map((t) => <button key={t} className={s.theme === t ? "on" : ""} onClick={() => s.setTheme(t)}>{t}</button>)}</div>
      <div className="mp-title">Liquid Glass</div>
      <div className="seg">{([["on", true], ["off", false]] as const).map(([l, v]) => <button key={l} className={glassOn === v ? "on" : ""} onClick={() => { setGlassEnabled(v); setGlassOn(v); }}>{l}</button>)}</div>
      {glassOn && (
        <label className="glass-level">
          <input type="range" min={0} max={100} step={1} value={glassLvl} aria-label="Liquid Glass: clear to tinted" onChange={(e) => { const v = Number(e.target.value); setGlassLvl(v); setGlassLevel(v); }} />
          <span><small>Clear</small><small>Tinted</small></span>
        </label>
      )}
      <div className="mp-sep" />
      <button onClick={() => { setSettings(null); setAccountOpen(true); }}><ISettings size={S} /> Account & household</button>
      <button onClick={() => { setSettings(null); setPermsOpen(true); }}><IShield size={S} /> Assistant permissions</button>
      <button onClick={() => { setSettings(null); setUsageOpen(true); }}><IChart size={S} /> AI usage</button>
      <button onClick={() => { setSettings(null); setSetupOpen(true); }}><IShield size={S} /> Setup & status</button>
      <button onClick={() => { setSettings(null); s.setMemoryOpen(true); }}><ICompose size={S} /> {agentName()}'s memory</button>
      <button onClick={() => { setSettings(null); s.setProactiveOpen(true); }}><IBell size={S} /> Routines & saved prompts</button>
      <button onClick={() => { setSettings(null); s.setNotifyOpen(true); }}><IBell size={S} /> Notifications</button>
      <button onClick={() => { setSettings(null); s.setCaptureOpen(true); }}><IPlus size={S} /> Quick capture</button>
      <button onClick={() => { setSettings(null); s.setBackupOpen(true); }}><IShield size={S} /> Backups</button>
      <button onClick={async () => { setSettings(null); const d = await api.exportAll(); const url = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: "application/json" })); const a = document.createElement("a"); a.href = url; a.download = `seaglass-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); }}><IDownload size={S} /> Export full backup</button>
      <button onClick={() => fileRef.current?.click()}><IUpload size={S} /> Import backup</button>
      <div className="mp-sep" />
      <button onClick={async () => {
        const waiting = queuedCount();
        if (waiting && !(await s.confirm(`${waiting} change${waiting === 1 ? " hasn't" : "s haven't"} synced yet. Log out anyway and lose ${waiting === 1 ? "it" : "them"}?`))) return;
        await clearOffline(); await api.logout(); location.reload();
      }}><ILogout size={S} /> Log out</button>
      <div className="build-stamp" title="Which version of Seaglass this device is running">Version {BUILD}</div>
    </Popover>
  );
  const section = (key: string, label: string, body: ReactElement, actions?: ReactElement) => (
    <div className={`sb-section sb-${key}`}>
      <div className="sb-head">
        <button className="sb-label" onClick={() => toggleSection(key)}>{label}</button>
        {actions && <span>{actions}</span>}
      </div>
      {!closedSections.has(key) && body}
    </div>
  );

  return (
    <aside className="sidebar">
      <div className="sb-top">
        <span className="rel ws-wrap">
          <button className="ws" onClick={() => setSettings(settings === "top" ? null : "top")}><Logo size={22} /> <span className="ws-name">{inFamily ? homeName() : "Seaglass"}</span> <span className="ws-chev"><IChevronsUpDown size={16} /></span></button>
          {settingsMenu("top")}
        </span>
        <button className="ghost icon-btn sb-collapse" title="Close sidebar (Ctrl+\)" onClick={s.toggleSidebar}><ICollapse size={20} /></button>
      </div>
      <div className="sb-nav">
        <button className="sb-btn" title="Search (Ctrl+K)" onClick={() => { s.setPaletteOpen(true); }}><ISearch size={S} /> Search <kbd>Ctrl K</kbd></button>
        <a className={`sb-btn ${s.route.kind === "home" ? "active" : ""}`} href="#/" onClick={afterNav}><IHome size={S} /> Home</a>
        <a className={`sb-btn ${s.route.kind === "tasks" ? "active" : ""}`} href="#/tasks" onClick={afterNav}><ICheckSquare size={S} /> {inFamily ? "Family tasks" : "My tasks"} {due > 0 && <span className="sb-count" title={`${due} due today or earlier`}>{due}</span>}</a>
          {EDITION.calendar && <a className={`sb-btn ${s.route.kind === "calendar" ? "active" : ""}`} href="#/calendar" onClick={afterNav}><ICalendar size={S} /> Calendar</a>}
        {!inFamily && <a className={`sb-btn ${s.route.kind === "study" ? "active" : ""}`} href="#/study" onClick={afterNav}><IStudy size={S} /> Study</a>}
        {!inFamily && <button className={`sb-btn ${s.agentOpen ? "active" : ""}`} title={`Ask ${agentName()} (Ctrl+J)`} onClick={() => { s.setAgentOpen(!s.agentOpen); afterNav(); }}><span className="sb-jeff"><JeffFace size={19} /></span> {agentName()}{unread > 0 && <span className="sb-badge" title={`${unread} new from ${agentName()}`}>{unread}</span>}</button>}
      </div>
      <div className="sb-scroll">
        {favorites.length > 0 && section("fav", "Favorites", <>{favorites.map((n) => renderRow(n, 0, "fav:"))}</>)}
        {recents.length > 0 && section("recent", "Recents", <>{recents.map((n) => renderRow(n, 0, "rec:"))}</>)}
        {section("private", inFamily ? "Shared pages" : "Private", <>
          {(showAll ? roots : roots.slice(0, PRIVATE_LIMIT)).map((n) => renderRow(n, 0))}
          {roots.length > PRIVATE_LIMIT && (
            <div className="row more-row" style={{ paddingLeft: 4 }} onClick={() => setShowAll((v) => { try { localStorage.setItem("sg.private.all", v ? "0" : "1"); } catch { /* ignore */ } return !v; })}>
              <span className="ico-swap"><span className="ico"><IMore size={17} /></span></span><span className="name">{showAll ? "Show less" : `${roots.length - PRIVATE_LIMIT} more`}</span>
            </div>
          )}
          <div className="row add-page" style={{ paddingLeft: 4 }} onClick={async () => { await s.newPage(); afterNav(); }}><span className="ico-swap"><span className="ico"><IPlus size={17} /></span></span><span className="name">Add a page</span></div>
          <div className="row drop-root" onDragOver={(e) => { if (dragId) e.preventDefault(); }} onDrop={async () => { const id = dragId; dragId = null; if (id) { await api.patch(id, { parent_id: null, position: Math.max(0, ...roots.map((r) => r.position)) + 1 }); void s.refreshTree(); } }}>Drop here to move to top level</div>
        </>, <>
          <button title="New database" onClick={() => void s.newPage({ kind: "database", title: "Untitled database" })}><IDatabase size={17} /></button>
          <button title="New page" onClick={async () => { await s.newPage(); afterNav(); }}><IPlus size={17} /></button>
        </>)}
        {templates.length > 0 && section("tpl", "Templates", <>{templates.map((n) => (
          <div key={n.id} className="row" style={{ paddingLeft: 4 }} onClick={() => { s.go(`/p/${n.id}`); afterNav(); }}>
            <span className="ico-swap"><span className="ico"><PageIcon icon={n.icon} /></span></span><span className="name">{n.title || "New page"}</span>
            <span className="hover-actions"><button title="New page from template" onClick={async (e) => { e.stopPropagation(); await s.newPage({ template_id: n.id, title: n.title }); afterNav(); }}><IPlus size={17} /></button></span>
          </div>
        ))}</>)}
      </div>
      <div className="sb-foot">
        <span className="rel" style={{ display: "block" }}>
          <button className="sb-btn" onClick={() => setSettings(settings === "foot" ? null : "foot")}><ISettings size={S} /> Settings</button>
          {settingsMenu("foot")}
        </span>
        <a className={`sb-btn ${s.route.kind === "trash" ? "active" : ""}`} href="#/trash" onClick={afterNav}><ITrash size={S} /> Trash</a>
      </div>
      <div className="sb-chat">
        {!inFamily && <button className="sb-newchat" title={`Talk to ${agentName()} (Ctrl+J)`} onClick={() => { s.setAgentOpen(true); afterNav(); }}><JeffFace size={18} /> Ask {agentName()} <kbd>Ctrl J</kbd></button>}
        <button className="sb-compose" title="New page (Ctrl+Alt+N)" onClick={async () => { await s.newPage(); afterNav(); }}><ICompose size={20} /></button>
      </div>
      <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { setSettings(null); void restoreInput(e.target.files?.[0]); }} />
      <SidebarResizer />
      {/* On the page itself, not inside the sidebar: on phones the sidebar is a drawer that slides away (and takes its
          children with it) when it closes. */}
      {setupOpen && createPortal(<SetupModal onClose={() => setSetupOpen(false)} />, document.body)}
      {accountOpen && createPortal(<AccountDialog onClose={() => setAccountOpen(false)} />, document.body)}
      {permsOpen && createPortal(<PermissionsDialog onClose={() => setPermsOpen(false)} />, document.body)}
      {usageOpen && createPortal(<UsageDialog onClose={() => setUsageOpen(false)} />, document.body)}
    </aside>
  );
}

const open_ = (href: string) => window.open(href, "_blank", "noopener");

/** Drag the sidebar's right edge to resize it (Notion: 240px default, roughly 220 to 480). Double-click resets. */
function SidebarResizer() {
  const set = (w: number) => { document.documentElement.style.setProperty("--sidebar-w", `${w}px`); try { localStorage.setItem("sg.sbw", String(w)); } catch { /* ignore */ } };
  return (
    <div className="sb-resize" title="Drag to resize"
      onDoubleClick={() => set(240)}
      onPointerDown={(e) => {
        e.preventDefault();
        const move = (ev: PointerEvent) => set(Math.round(Math.min(480, Math.max(220, ev.clientX))));
        const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); document.body.classList.remove("resizing"); };
        document.body.classList.add("resizing");
        addEventListener("pointermove", move); addEventListener("pointerup", up);
      }} />
  );
}
// Restore the saved width before first paint.
try { const w = Number(localStorage.getItem("sg.sbw")); if (w >= 220 && w <= 480) document.documentElement.style.setProperty("--sidebar-w", `${w}px`); } catch { /* ignore */ }
