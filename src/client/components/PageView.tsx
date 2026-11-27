import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { extractCards } from "../study/cards";
import { setWeakSpotsOn, weakSpotsOn } from "../study/weak";
import { TaskSteps } from "./TaskSteps";
import { FORMATS } from "../editor/formats";
import { isInkDevice, isPhone } from "../device";
import { PaperLocked } from "../paper/PaperLocked";
import { cancelRelock, dropGrant, grantOf, keepOpen, relockNow, relockSoon } from "../paper/grants";
import { DailyPanel } from "./DailyPanel";
import { RelatedNotes } from "./RelatedNotes";
import { FileQuestion, LayoutTemplate, Table2, X } from "lucide-react";
import { IArrowDown, ICheckSquare, IChevronLeft, IChevronsRight, IClock, IComment, ICopy, IExpand, IEyeOff, IGlobe, IImage, ILink, ILock, IMore, IOpen, IPage, IPencil, IPlus, ISmile, IStar, ITemplate, ITrash, IUpload } from "../ui-icons";
import { JeffFace, PageIcon } from "../icons";
import { api } from "../api";
import { useStore } from "../store";
import { useNote } from "../useNote";
import { Editor } from "../editor/Editor";
import { editorRef } from "../editor/extensions";
import { coverCss, randomCover } from "../covers";
import { MovePicker } from "./MovePicker";
import { CoverPicker, EmojiPicker, Popover, download, timeAgo } from "./ui";
import { htmlToMarkdown, markdownToHtml } from "../markdown";
import { DatabaseView, RowProperties } from "../db/DatabaseView";
import type { Note, TreeNode } from "../types";
import { agentName } from "../persona";
import { openSuggestions, ordered, type Comment } from "../comments";

type Panel = null | "comments" | "history";

/** Fit a textarea to its content (titles). */
const growTitle = (el: HTMLTextAreaElement | null) => { if (!el) return; el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; };

/** The page menu's switch for weak spots (#14): what the user keeps missing, highlighted in the page. Remembered on this device. */
function WeakToggle() {
  const [on, setOn] = useState(weakSpotsOn);
  return <label className="switch"><input type="checkbox" checked={on} onChange={(e) => { setOn(e.target.checked); setWeakSpotsOn(e.target.checked); }} /> Show weak spots <small className="muted">what you keep missing</small></label>;
}

export function PageView({ id, peek = false }: { id: string; peek?: boolean }) {
  const store = useStore();
  const { note, missing, status, edit, flush, version, conflict, reloadLatest, keepMine, reload } = useNote(id);
  const [panel, setPanel] = useState<Panel>(null);
  const [pop, setPop] = useState<null | "menu" | "share" | "emoji" | "cover" | "move" | "formats">(null);
  const [backlinks, setBacklinks] = useState<TreeNode[]>([]);
  const cards = useMemo(() => (note ? extractCards(note.html) : []), [note?.html]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (note) api.backlinks(id).then(setBacklinks).catch(() => {}); }, [id, version]); // eslint-disable-line react-hooks/exhaustive-deps
  // Paper Lock: while this device shows a paper-locked page's words it keeps the lock open (a ping every few seconds), notices
  // when the phone's Relock (or the lock running out) closed it, and relocks as soon as the page is left or closed (paper/grants.ts).
  const paperOpen = !!note?.paper_unlocked;
  const reloadRef = useRef(reload); reloadRef.current = reload;
  useEffect(() => {
    if (!paperOpen) return;
    cancelRelock(id);
    let on = true;
    const t = setInterval(async () => { if (!(await keepOpen(id)) && on) { store.toast("The paper lock closed"); reloadRef.current(); } }, 4000);
    return () => { on = false; clearInterval(t); relockSoon(id); };
  }, [paperOpen, id]); // eslint-disable-line react-hooks/exhaustive-deps
  // The title is written by hand (above a Cornell sheet's top line, or the first line on lined paper; Handwriting.tsx):
  // it names the page, and keeps naming it as it's rewritten, unless the name was typed (then it's their and stays).
  // the title box fits its text however the title changes (typed, or read from handwriting) and when the width does
  const titleEl = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => { growTitle(titleEl.current); }, [note?.title]);
  useEffect(() => { const fit = () => growTitle(titleEl.current); addEventListener("resize", fit); return () => removeEventListener("resize", fit); }, []);
  // the iPad opens a page straight to its paper once per visit (Editor autoInk), not again after closing it
  const autoInk = useRef<string | null>(null);
  // a handwritten note (Handwriting asPage): its paper's settings, shown and changed in the ⋯ menu
  const [ink, setInk] = useState<{ paper: "lined" | "cornell"; snap: boolean; canRead: boolean } | null>(null);
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent<{ on: boolean; paper?: "lined" | "cornell"; snap?: boolean; canRead?: boolean }>).detail; setInk(d?.on ? { paper: d.paper ?? "cornell", snap: !!d.snap, canRead: !!d.canRead } : null); };
    addEventListener("seaglass:ink-state", on); return () => removeEventListener("seaglass:ink-state", on);
  }, []);
  useEffect(() => setInk(null), [id]);
  const inkCmd = (detail: Record<string, unknown>) => dispatchEvent(new CustomEvent("seaglass:ink-cmd", { detail }));
  const latest = useRef({ title: note?.title ?? "", edit }); latest.current = { title: note?.title ?? "", edit };
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ id: string; title: string }>).detail;
      if (d?.id !== id || !d.title) return;
      const k = `sg.ink.title.${id}`;
      let auto = ""; try { auto = localStorage.getItem(k) ?? ""; } catch { /* none */ }
      const cur = latest.current.title.trim();
      if (cur && cur !== auto) return;
      if (cur === d.title) return;
      latest.current.edit({ title: d.title }, true);
      try { localStorage.setItem(k, d.title); } catch { /* not kept */ }
      store.toast(`Named the page "${d.title}" from your handwriting`);
    };
    addEventListener("seaglass:ink-title", on); return () => removeEventListener("seaglass:ink-title", on);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  // comments on text and suggested edits (#22): the panel opens on a comment clicked in the page; a pill counts open suggestions
  const [focusCid, setFocusCid] = useState<string | null>(null);
  const [suggested, setSuggested] = useState(0);
  useEffect(() => {
    let on = true;
    const count = () => { api.comments(id).then((l) => { if (on) setSuggested(openSuggestions(l)); }).catch(() => {}); };
    count();
    const open = () => setPanel("comments");
    const focus = (e: Event) => { setFocusCid((e as CustomEvent<string>).detail); setPanel("comments"); };
    addEventListener("seaglass:comments", count); addEventListener("seaglass:comments-open", open); addEventListener("seaglass:comment-focus", focus);
    return () => { on = false; removeEventListener("seaglass:comments", count); removeEventListener("seaglass:comments-open", open); removeEventListener("seaglass:comment-focus", focus); };
  }, [id, version]);

  if (missing) return <div className="blank"><FileQuestion size={40} strokeWidth={1.4} /><b>This page doesn't exist</b><span>It may have been deleted. <a className="lnk" href="#/">Go home</a></span></div>;
  if (!note) return <div className="page"><div className="topbar"><div className="skeleton" style={{ width: 180, height: 20 }} /></div><div className="body"><div className="skeleton" style={{ width: "55%", height: 44, marginBottom: 28 }} /><div className="skeleton" style={{ height: 16, marginBottom: 12 }} /><div className="skeleton" style={{ height: 16, width: "88%", marginBottom: 12 }} /><div className="skeleton" style={{ height: 16, width: "70%" }} /></div></div>;

  if (note.paper_lock && !note.paper_unlocked) return <PaperLocked note={note} peek={peek} onOpened={reload} />;
  const paper = !!note.paper_lock; // opened on this device: its words are shown, and it can't be shared, copied or commented on
  const parent = note.parent_id ? store.byId.get(note.parent_id) : undefined;
  const isRow = parent?.kind === "database";
  const locked = !!note.locked;
  const aiHidden = !!note.ai_hidden || !!note.ai_hidden_inherited;
  const crumbs: TreeNode[] = [];
  for (let p = parent; p && crumbs.length < 6; p = p.parent_id ? store.byId.get(p.parent_id) : undefined) crumbs.unshift(p);

  const toggleFav = () => { edit({ favorite: note.favorite ? 0 : 1 }, true); };
  const trash = async () => {
    if (!(await store.confirm("Move this page (and its sub-pages) to the trash?"))) return;
    await flush(); await api.trash(id); await store.refreshTree(); if (peek) store.setPeek(null); else store.go(parent ? `/p/${parent.id}` : "/"); store.toast("Moved to trash");
  };
  const duplicate = async () => { await flush(); const n = await api.duplicate(id); await store.refreshTree(); if (peek) store.setPeek(n.id); else store.go(`/p/${n.id}`); };
  const exportMd = () => download(`${note.title || "New page"}.md`, `# ${note.title || "New page"}\n\n${htmlToMarkdown(note.html)}\n`, "text/markdown");
  const exportHtml = () => download(`${note.title || "New page"}.html`, `<!doctype html><meta charset="utf-8"><title>${note.title}</title><h1>${note.title}</h1>${note.html}`, "text/html");
  const importMd = () => {
    const i = document.createElement("input"); i.type = "file"; i.accept = ".md,.markdown,.txt";
    i.onchange = async () => { const f = i.files?.[0]; if (!f) return; edit({ html: note.html + markdownToHtml(await f.text()) }, true); await flush(); reload(); };
    i.click();
  };
  const shareUrl = note.share_slug ? `${location.origin}/p/${note.share_slug}` : "";

  return (
    // a handwritten note (iPad) is just its paper, full screen beside the sidebar, with ⋯ in the corner (notion.css .ink-mode)
    <div className={`page ${peek ? "in-peek" : ""} ${ink && !peek ? "ink-mode" : ""}`}>
      <div className="topbar">
        {peek && (
          <div className="peek-nav">
            <button className="ghost icon-btn" title="Close (Esc)" aria-label="Close side peek" onClick={() => store.setPeek(null)}><span className="peek-x-desk"><IChevronsRight size={18} /></span><span className="peek-x-phone"><IChevronLeft size={26} /></span></button>
            <button className="ghost icon-btn" title="Open as full page" aria-label="Open as full page" onClick={async () => { await flush(); store.go(`/p/${id}`); }}><IExpand size={16} /></button>
          </div>
        )}
        <div className="crumbs">
          {crumbs.map((c) => <a key={c.id} href={`#/p/${c.id}`}><PageIcon icon={c.icon} kind={c.kind} size={14} /> {c.title || "New page"}</a>)}
          <span className="cur"><PageIcon icon={note.icon} kind={note.kind} size={14} /> {note.title || "New page"}</span>
        </div>
        <span className={`status ${status}`} title={new Date(note.updated_at).toLocaleString()}>
          {paper && <><ILock size={14} /> Paper-locked · </>}
          {locked && <><ILock size={14} /> Locked · </>}
          {aiHidden && <><IEyeOff size={14} /> Hidden from AI · </>}
          {status === "saving" ? "Saving…" : status === "offline" ? "Saved on this device, will sync" : status === "error" ? "Couldn't save, will retry" : status === "conflict" ? "Changed elsewhere" : `Edited ${timeAgo(note.updated_at)}`}
        </span>
        <div className="actions">
          <div className="rel" style={paper ? { display: "none" } : undefined}>
            <button className={`ghost share-btn ${note.share_slug ? "on" : ""}`} onClick={() => setPop(pop === "share" ? null : "share")}>{note.share_slug ? <><IGlobe size={16} /> Shared</> : "Share"}</button>
            {pop === "share" && (
              <Popover onClose={() => setPop(null)} className="share-pop">
                <label className="switch"><input type="checkbox" checked={!!note.share_slug} onChange={async (e) => { const enabled = e.target.checked; await flush(); const r = await api.share(id, enabled); edit({ share_slug: r.share_slug }); }} /> Publish to the web</label>
                {shareUrl ? <><input readOnly value={shareUrl} onFocus={(e) => e.target.select()} /><button onClick={() => { void navigator.clipboard?.writeText(shareUrl); store.toast("Link copied"); }}>Copy link</button><p className="muted">Anyone with the link can read this page. Turn it off to unpublish.</p></> : <p className="muted">Create a public, read-only link to this page.</p>}
              </Popover>
            )}
          </div>
          {note.kind !== "database" && !locked && isInkDevice() && !ink && <button className="ghost icon-btn tb-pen" title="Write by hand (Apple Pencil or finger)" aria-label="Write by hand" onClick={() => dispatchEvent(new CustomEvent("seaglass:ink", { detail: { end: true } }))}><IPencil /></button>}
          <button style={paper ? { display: "none" } : undefined} className={`ghost icon-btn tb-wide ${panel === "comments" ? "on" : ""}`} title="Comments" onClick={() => setPanel(panel === "comments" ? null : "comments")}><IComment /></button>
          <button style={paper ? { display: "none" } : undefined} className={`ghost icon-btn tb-wide ${panel === "history" ? "on" : ""}`} title="Version history" onClick={() => setPanel(panel === "history" ? null : "history")}><IClock /></button>
          <button className="ghost icon-btn tb-wide" title={note.favorite ? "Remove from Favorites" : "Add to Favorites"} onClick={toggleFav}><span style={{ color: note.favorite ? "#f6c050" : undefined, display: "inline-flex" }}><IStar filled={!!note.favorite} /></span></button>
          <div className="rel">
            <button className="ghost icon-btn" title="Page options" onClick={() => setPop(pop === "menu" ? null : "menu")}><IMore /></button>
            {pop === "move" && <MovePicker id={id} onClose={() => setPop(null)} />}
            {pop === "formats" && (
              <Popover onClose={() => setPop(null)} className="menu-pop formats-pop">
                <div className="mp-title">Add a note format to the end of this page</div>
                {FORMATS.filter((f) => !f.ink || isInkDevice()).map((f) => <button key={f.key} className="fmt-item" onClick={() => { setPop(null); if (f.ink) { dispatchEvent(new CustomEvent("seaglass:ink", { detail: { end: true, paper: f.ink } })); return; } const d = new Date(); dispatchEvent(new CustomEvent("seaglass:insert-format", { detail: { html: f.html(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`) } })); }}><ITemplate size={18} /><span><b>{f.title}</b><small>{f.subtitle}</small></span></button>)}
              </Popover>
            )}
            {pop === "menu" && (
              <Popover onClose={() => setPop(null)} className="menu-pop">
                <div className="font-cards">{(["sans", "serif", "mono"] as const).map((f) => <button key={f} className={`font-${f} ${note.font === f ? "on" : ""}`} onClick={() => edit({ font: f }, true)}><b>Ag</b><small>{f === "sans" ? "Default" : f === "serif" ? "Serif" : "Mono"}</small></button>)}</div>
                <label className="switch"><input type="checkbox" checked={!!note.small_text} onChange={(e) => edit({ small_text: e.target.checked }, true)} /> Small text</label>
                <label className="switch"><input type="checkbox" checked={!!note.full_width} onChange={(e) => edit({ full_width: e.target.checked }, true)} /> Full width</label>
                <label className="switch"><input type="checkbox" checked={locked} onChange={(e) => edit({ locked: e.target.checked }, true)} /> Lock page <small className="muted">blocks all edits</small></label>
                <label className="switch" title={note.ai_hidden_inherited ? "A page above this one is hidden from AI, so this one is too. Turn it off there." : undefined}>
                  <input type="checkbox" checked={aiHidden} disabled={!!note.ai_hidden_inherited || paper} onChange={async (e) => {
                    const hidden = e.target.checked, show = (v: number) => { edit({ ai_hidden: v }); store.patchTreeLocal(id, { ai_hidden: v }); };
                    show(hidden ? 1 : 0); // flip it now; put it back if the server says no
                    try {
                      await flush();
                      show((await api.aiHidden(id, hidden)).ai_hidden);
                      store.toast(hidden ? `Hidden from ${agentName()}, Claude and AI features` : "AI can see this page again");
                    } catch { show(hidden ? 0 : 1); store.toast("Couldn't change that. Try again."); }
                  }} /> Hide from AI <small className="muted">{note.ai_hidden_inherited ? "a page above is hidden" : `${agentName()} and Claude can't see it or its sub-pages`}</small>
                </label>
                {!paper && note.kind === "page" && <button onClick={async () => {
                  setPop(null);
                  if (!isPhone()) { store.toast("Paper Lock cards are drawn and scanned on your phone"); return; }
                  await flush(); dispatchEvent(new CustomEvent("seaglass:paper-lock", { detail: { id } }));
                }}><ILock size={18} /> Lock with a paper card…</button>}
                {paper && <>
                  <button onClick={() => { setPop(null); relockNow(id); reload(); }}><ILock size={18} /> Lock now</button>
                  <button onClick={async () => {
                    setPop(null);
                    if (!(await store.confirm("Remove the paper lock? This page goes back to being an ordinary page. It stays hidden from AI until you turn that off."))) return;
                    try { await flush(); await api.paperRemoveLock(id, grantOf(id) ?? ""); dropGrant(id); await store.refreshTree(); reload(); store.toast("Paper lock removed"); }
                    catch (e) { store.toast((e as Error).message); }
                  }}><ILock size={18} /> Remove Paper Lock…</button>
                </>}
                <label className="switch"><input type="checkbox" checked={!!note.is_template} onChange={(e) => edit({ is_template: e.target.checked }, true)} /> Use as template</label>
                {note.kind !== "database" && <WeakToggle />}
                <div className="mp-sep" />
                <button onClick={() => { setPop(null); toggleFav(); }}><IStar size={18} /> {note.favorite ? "Remove from Favorites" : "Add to Favorites"}</button>
                <button onClick={() => { setPop(null); void navigator.clipboard?.writeText(`${location.origin}/#/p/${id}`); store.toast("Copied link to page"); }}><ILink size={18} /> Copy link <kbd>Ctrl+L</kbd></button>
                {!paper && <button onClick={() => { setPop(null); void duplicate(); }}><ICopy size={18} /> Duplicate</button>}
                {!locked && !isRow && <button onClick={() => setPop("move")}><IOpen size={18} /> Move to…</button>}
                <button onClick={async () => { setPop(null); await flush(); store.setStudy(id); }}><ICheckSquare size={18} /> Study flashcards{cards.length ? ` (${cards.length})` : ""}</button>
                {note.kind !== "database" && <button onClick={async () => { setPop(null); await flush(); store.setQuiz([id]); }}><ICheckSquare size={18} /> Practice test</button>}
                {ink && <>
                  <div className="mp-title">Handwritten note</div>
                  <button className={ink.paper === "cornell" ? "on" : ""} onClick={() => { setPop(null); inkCmd({ paper: "cornell" }); }}><ITemplate size={18} /> Cornell sheet{ink.paper === "cornell" ? " ✓" : ""}</button>
                  <button className={ink.paper === "lined" ? "on" : ""} onClick={() => { setPop(null); inkCmd({ paper: "lined" }); }}><IPage size={18} /> Lined paper{ink.paper === "lined" ? " ✓" : ""}</button>
                  <label className="switch"><input type="checkbox" checked={ink.snap} onChange={(e) => inkCmd({ snap: e.target.checked })} /> Snap to lines <small className="muted">straightens and sizes each word</small></label>
                  <button onClick={() => { setPop(null); inkCmd({ lines: 6 }); }}><IPlus size={18} /> Add lines</button>
                  <button disabled={!ink.canRead} onClick={() => { setPop(null); inkCmd({ read: true }); }}><IPencil size={18} /> Turn into text</button>
                  <div className="mp-sep" />
                </>}
                {!locked && note.kind !== "database" && isInkDevice() && !ink && <button onClick={() => { setPop(null); dispatchEvent(new CustomEvent("seaglass:ink", { detail: { end: true } })); }}><IPencil size={18} /> Write by hand</button>}
                {!locked && note.kind !== "database" && <button onClick={() => setPop("formats")}><ITemplate size={18} /> Add a note format…</button>}
                {!locked && <button onClick={async () => { setPop(null); await flush(); store.setPhotoOpen(true); }}><IImage size={18} /> Photo to notes here</button>}
                {!locked && note.kind !== "database" && <button onClick={async () => { setPop(null); await flush(); store.setVoiceOpen(true); }}><IClock size={18} /> Record a voice note</button>}
                {!paper && <button onClick={() => { setPop(null); setPanel("comments"); }}><IComment size={18} /> Comments</button>}
                {!paper && <button onClick={() => { setPop(null); setPanel("history"); }}><IClock size={18} /> Version history</button>}
                <button onClick={() => { setPop(null); exportMd(); }}><IArrowDown size={18} /> Export Markdown</button>
                <button onClick={() => { setPop(null); exportHtml(); }}><IArrowDown size={18} /> Export HTML</button>
                {note.kind === "page" && !locked && <button onClick={() => { setPop(null); importMd(); }}><IUpload size={18} /> Import Markdown</button>}
                <div className="mp-sep" />
                <button className="danger" onClick={() => { setPop(null); void trash(); }}><ITrash size={18} /> Move to Trash</button>
                <div className="mp-foot">Edited {timeAgo(note.updated_at)}</div>
              </Popover>
            )}
          </div>
        </div>
      </div>

      {status === "conflict" && conflict && (
        <div className="banner">This page was changed somewhere else (another device, the agent or Claude).
          <button onClick={reloadLatest}>Load latest</button><button onClick={keepMine}>Keep my version</button></div>
      )}

      <div className="scroll">
        {note.cover && (
          <div className="cover" style={{ background: coverCss(note.cover) }}>
            <div className="cover-actions rel">
              <button onClick={() => setPop("cover")}>Change cover</button>
              {pop === "cover" && <CoverPicker current={note.cover} onPick={(c) => edit({ cover: c }, true)} onRemove={() => edit({ cover: null }, true)} onClose={() => setPop(null)} />}
            </div>
          </div>
        )}
        <div className={`body ${note.cover ? "has-cover" : ""} font-${note.font} ${note.small_text ? "small" : ""} ${note.full_width || note.kind === "database" ? "wide" : ""}`}>
          {/* Icon first, so with a cover it can overlap the cover's bottom edge like Notion. */}
          {note.icon && (
            <div className="rel icon-row">
              <button className="big-icon" onClick={() => setPop(pop === "emoji" ? null : "emoji")}>{note.icon}</button>
              {pop === "emoji" && <EmojiPicker onPick={(e) => edit({ icon: e }, true)} onRemove={() => edit({ icon: null }, true)} onClose={() => setPop(null)} />}
            </div>
          )}
          {!locked && (
            <div className="head-actions">
              {!note.icon && <span className="rel"><button className="ghost" onClick={() => setPop("emoji")}><ISmile size={18} /> Add icon</button>{pop === "emoji" && <EmojiPicker onPick={(e) => edit({ icon: e }, true)} onClose={() => setPop(null)} />}</span>}
              {!note.cover && <button className="ghost" onClick={() => edit({ cover: randomCover() }, true)}><IImage size={18} /> Add cover</button>}
              <button className="ghost" onClick={() => setPanel("comments")}><IComment size={18} /> Add comment</button>
            </div>
          )}
          {suggested > 0 && panel !== "comments" && (
            <button className="sug-pill" onClick={() => setPanel("comments")}><IComment size={16} /> Review {suggested} suggested edit{suggested === 1 ? "" : "s"}</button>
          )}
          {/* A title wraps onto more lines like Notion's (long titles were cut off on phones); it can't hold line breaks. */}
          <textarea className="title" rows={1} ref={(el) => { titleEl.current = el; growTitle(el); }} value={note.title} placeholder="New page" readOnly={locked} autoFocus={!note.title && !note.html}
            onChange={(e) => { edit({ title: e.target.value.replace(/[\r\n]+/g, " ") }); growTitle(e.target); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const ed = editorRef.current; if (ed) { ed.view.focus(); ed.commands.focus("start"); } } }} />

          {cards.length > 0 && (
            <button className="study-pill" onClick={async () => { await flush(); store.setStudy(id); }} title="Flashcards from this page's toggles and 'term :: definition' lines">
              <span className="study-pill-ico" aria-hidden>⧉</span> Study {cards.length} flashcard{cards.length === 1 ? "" : "s"}
            </button>
          )}
          {isRow && <RowProperties note={note} edit={edit} />}
          {(() => { const d = (() => { try { return JSON.parse((note as Note & { meta?: string }).meta || "{}").daily; } catch { return null; } })(); return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? <DailyPanel id={id} date={d} /> : null; })()}
          {isRow && parent?.system === "tasks" && !locked && <TaskSteps id={id} done={(() => { try { return JSON.parse(note.props || "{}").status === "done"; } catch { return false; } })()} />}
          {note.kind === "database"
            ? <DatabaseView note={note} edit={edit} />
            : <Editor key={`${id}:${version}`} noteId={id} html={note.html} editable={!locked} onChange={(html) => edit({ html })}
                autoInk={autoInk.current !== id && note.kind === "page" && !peek && !isRow && !locked && isInkDevice()} onAutoInk={() => { autoInk.current = id; }}
                inkPage={note.kind === "page" && !peek && !isRow && !locked && isInkDevice()} />}

          {note.kind === "page" && !locked && !ink && !note.html.replace(/<p[^>]*>\s*<\/p>/g, "").trim() && (
            <Starter
              title={note.title}
              onWrite={() => { const ed = editorRef.current; if (ed) { ed.view.focus(); ed.commands.focus("start"); } }}
              onJeff={() => { store.setAgentOpen(true); window.dispatchEvent(new CustomEvent("seaglass:agent-prefill", { detail: note.title ? `Draft the page "${note.title}" for me: ` : "Draft this page for me: " })); }}
              onDatabase={async () => { edit({ kind: "database" }, true); await flush(); reload(); void store.refreshTree(); }}
              onTemplate={async (tid) => { const t = await api.get(tid); edit({ html: t.html, ...(note.icon ? {} : { icon: t.icon }) }, true); await flush(); reload(); }}
              onFormat={async (html) => { edit({ html }, true); await flush(); reload(); }}
            />
          )}

          {note.kind === "page" && !isRow && !ink && (() => {
            // its sub-pages that the page doesn't already link to (made from the sidebar's +, by the assistant or MCP):
            // without this, a page used as a folder looks empty
            const kids = store.tree.filter((n) => n.parent_id === id && !n.is_template && !note.html.includes(n.id)).sort((a, b) => a.position - b.position);
            return kids.length > 0 && (
              <div className="backlinks subpages"><h4>Pages inside</h4>
                {kids.map((k) => <a key={k.id} href={`#/p/${k.id}`}><PageIcon icon={k.icon} kind={k.kind} size={16} /> {k.title || "New page"}</a>)}
              </div>
            );
          })()}
          {note.kind === "page" && !isRow && !peek && <RelatedNotes id={id} title={note.title} html={note.html} />}

          {backlinks.length > 0 && (
            <div className="backlinks"><h4><ILink size={14} /> Linked from</h4>
              {backlinks.map((b) => <a key={b.id} href={`#/p/${b.id}`}><PageIcon icon={b.icon} kind={b.kind} size={15} /> {b.title || "New page"}</a>)}
            </div>
          )}
        </div>
      </div>

      {panel && <SidePanel kind={panel} id={id} focus={panel === "comments" ? focusCid : null} onClose={() => { setPanel(null); setFocusCid(null); }} onRestored={() => { reload(); void store.refreshTree(); }} />}
    </div>
  );
}

function SidePanel({ kind, id, onClose, onRestored, focus }: { kind: "comments" | "history"; id: string; onClose: () => void; onRestored: () => void; focus?: string | null }) {
  const store = useStore();
  const [items, setItems] = useState<any[]>([]); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [text, setText] = useState("");
  const load = () => (kind === "comments" ? api.comments(id).then(ordered) : api.history(id)).then(setItems).catch(() => {});
  useEffect(() => { void load(); }, [kind, id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (kind !== "comments") return; const on = () => void load(); addEventListener("seaglass:comments", on); return () => removeEventListener("seaglass:comments", on); }, [kind, id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (focus) setTimeout(() => document.querySelector(`.comment[data-cid="${focus}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 80); }, [focus, items.length]);
  const changed = () => { void load(); dispatchEvent(new CustomEvent("seaglass:comments")); };

  return (
    <aside className="side-panel">
      <div className="sp-head"><b>{kind === "comments" ? "Comments" : "Version history"}</b><button className="ghost icon-btn" onClick={onClose}><X size={16} /></button></div>
      {kind === "comments" ? (
        <>
          <div className="sp-list">
            {(items as Comment[]).map((c) => c.kind === "suggestion" ? (
              <div key={c.id} data-cid={c.id} className={`comment suggestion ${c.resolved ? "resolved" : ""} ${focus === c.id ? "focus" : ""}`}>
                <small className="cmt-by">{c.author === "mcp" ? "Claude" : agentName()} suggests</small>
                <button className="cmt-change" title="Show it on the page" onClick={() => dispatchEvent(new CustomEvent("seaglass:comment-show", { detail: c.id }))}>
                  <del>{c.anchor?.quote}</del>{c.replace_with ? <> <ins>{c.replace_with}</ins></> : <em> (delete)</em>}
                </button>
                {c.body && <p>{c.body}</p>}
                <small>{c.outcome === "accepted" ? "Accepted" : c.outcome === "rejected" ? "Rejected" : timeAgo(c.created_at)}</small>
                {!c.resolved ? (
                  <span className="cmt-acts"><button className="primary" onClick={() => dispatchEvent(new CustomEvent("seaglass:suggestion-accept", { detail: c.id }))}>Accept</button>
                    <button className="ghost" onClick={async () => { await api.resolveComment(c.id, true, "rejected"); changed(); }}>Reject</button></span>
                ) : <span><button className="ghost" onClick={async () => { await api.deleteComment(c.id); changed(); }}>Delete</button></span>}
              </div>
            ) : (
              <div key={c.id} data-cid={c.id} className={`comment ${c.resolved ? "resolved" : ""} ${focus === c.id ? "focus" : ""}`}>
                {c.anchor && <button className="cmt-quote" title="Show it on the page" onClick={() => dispatchEvent(new CustomEvent("seaglass:comment-show", { detail: c.id }))}>{c.anchor.quote}</button>}
                <p>{c.body}</p>
                <small>{timeAgo(c.created_at)}</small>
                <span><button className="ghost" onClick={async () => { await api.resolveComment(c.id, !c.resolved); changed(); }}>{c.resolved ? "Reopen" : "Resolve"}</button>
                  <button className="ghost" onClick={async () => { await api.deleteComment(c.id); changed(); }}>Delete</button></span>
              </div>
            ))}
            {!items.length && <p className="muted">No comments yet. Leave a note for later.</p>}
          </div>
          <form className="sp-form" onSubmit={async (e) => { e.preventDefault(); if (!text.trim()) return; await api.addComment(id, text); setText(""); changed(); }}>
            <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a comment…" rows={2} />
            <button className="primary">Comment</button>
          </form>
        </>
      ) : (
        <div className="sp-list">
          {items.map((h, i) => (
            <div key={h.id} className="version">
              <div><b>{timeAgo(h.created_at)}</b><span className={`badge ${h.agent && h.source === "user" ? "mcp" : h.source}`} title={h.agent ? `Made by ${h.agent}` : undefined}>{whoMade(h)}</span></div>
              <small>{new Date(h.created_at).toLocaleString()} · {h.tool}</small>
              {i > 0 && h.tool !== "delete" && <button className="ghost" onClick={async () => {
                if (!(await store.confirm("Restore this version? The current version stays in history."))) return;
                await api.restoreVersion(id, h.id); store.toast("Version restored"); onRestored(); void load();
              }}>Restore</button>}
              {i === 0 && <small className="muted"> · current</small>}
            </div>
          ))}
          {!items.length && <p className="muted">No history yet.</p>}
        </div>
      )}
    </aside>
  );
}

/** Who made a version: the agent's own label ("Jeff (Sonnet 5.5)", "Claude (MCP)"), else (older changes) the kind of source. */
function whoMade(h: { source: string; agent?: string | null }) {
  if (h.agent) return h.agent;
  return h.source === "agent" ? agentName() : h.source === "mcp" ? "MCP" : "You";
}

// Shown on an empty page: quick ways to get started, like Notion's empty-page menu.
function Starter({ title, onWrite, onJeff, onDatabase, onTemplate, onFormat }: { title: string; onWrite: () => void; onJeff: () => void; onDatabase: () => void; onTemplate: (id: string) => void; onFormat: (html: string) => void }) {
  const store = useStore();
  const templates = store.tree.filter((n) => n.is_template && store.byId.get(n.parent_id ?? "")?.kind !== "database").slice(0, 6);
  const today = new Date(), iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return (
    <div className="starter">
      <div className="st-head">Press Enter to start writing, or pick one</div>
      <div className="st-grid">
        <button onClick={onWrite}><IPage size={18} /> Empty page<small>Just start typing</small></button>
        <button onClick={onJeff}><JeffFace size={18} /> Ask {agentName()} to draft it<small>{title ? `About "${title}"` : "Say what you need"}</small></button>
        <button onClick={onDatabase}><Table2 size={16} /> Database<small>Table, board, calendar…</small></button>
        {templates.map((t) => <button key={t.id} onClick={() => onTemplate(t.id)}><PageIcon icon={t.icon} size={16} /> {t.title || "New page"}<small>Template</small></button>)}
      </div>
      <div className="st-head st-formats-head">Note formats</div>
      <div className="st-grid st-formats">
        {FORMATS.filter((f) => !f.ink || isInkDevice()).map((f) => <button key={f.key} onClick={() => f.ink ? dispatchEvent(new CustomEvent("seaglass:ink", { detail: { end: true, paper: f.ink } })) : onFormat(f.html(iso))} title={f.subtitle}><LayoutTemplate size={16} /> {f.title}<small>{f.subtitle}</small></button>)}
      </div>
    </div>
  );
}
