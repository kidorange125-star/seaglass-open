import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { EditorContent, useEditor, useEditorState, type Editor as TipEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import type { Node as PMNode } from "@tiptap/pm/model";
import "katex/dist/katex.min.css";
import { IGrip, IPlus } from "../ui-icons";
import { AlignCenter, AlignLeft, Bold, Code, Copy, GripVertical, Italic, Link, Palette, Plus, Quote, RefreshCw, Strikethrough, Subscript, Superscript, Trash2, Underline } from "lucide-react";
import { buildExtensions, canUpload, editorRef, uploadAndInsert, type EditorDeps } from "./extensions";
import { useStore } from "../store";
import { PhoneToolbar } from "./PhoneToolbar";
import { LinkDialog } from "./LinkDialog";
import { hostOf, nav, openLink } from "./links";
import { setWeakSpots } from "./weakSpots";
import { blocksOf, commentKey, setComments } from "./commentMarks";
import { anchorOf, findQuote } from "../comments";
import { IComment } from "../ui-icons";
import { Handwriting, type InkResult } from "../components/Handwriting";
import { parseInk, type Ink, type Paper } from "../handwriting/ink";
import { spotTerms, weakSpotsOn } from "../study/weak";
import { AskJeffMenu } from "../components/AiTools";
import { api } from "../api";
import { isInkDevice } from "../device";
import { SKIP_INK_TODO } from "./inkTodo";
import { createPortal } from "react-dom";

/** What was typed on another device into this handwritten note, to write in by hand (editor/inkTodo.ts). */
function inkTodos(editor: TipEditor | null): string[] {
  const out: string[] = [];
  editor?.state.doc.descendants((n) => { if (n.isTextblock && n.attrs.inkTodo && n.textContent.trim()) { out.push(n.textContent.trim()); return false; } return true; });
  return out;
}
/** Written in by hand: the typed words go. */
function dropTyped(editor: TipEditor | null, text: string) {
  if (!editor) return;
  let hit: { pos: number; size: number } | null = null;
  editor.state.doc.descendants((n, p) => { if (hit) return false; if (n.isTextblock && n.attrs.inkTodo && n.textContent.trim() === text) { hit = { pos: p, size: n.nodeSize }; return false; } return true; });
  const h = hit as { pos: number; size: number } | null;
  if (h) editor.chain().setMeta(SKIP_INK_TODO, true).deleteRange({ from: h.pos, to: h.pos + h.size }).run();
}

// Notion's palette as theme tokens (notion.css / styles.css), so colours adapt to dark mode.
const TEXT_COLORS = [["Default", ""], ["Gray", "var(--c-gray)"], ["Brown", "var(--c-brown)"], ["Orange", "var(--c-orange)"], ["Yellow", "var(--c-yellow)"], ["Green", "var(--c-green)"], ["Blue", "var(--c-blue)"], ["Purple", "var(--c-purple)"], ["Pink", "var(--c-pink)"], ["Red", "var(--c-red)"]];
const HILITES = [["None", ""], ["Gray", "var(--bg-gray)"], ["Brown", "var(--bg-brown)"], ["Orange", "var(--bg-orange)"], ["Yellow", "var(--bg-yellow)"], ["Green", "var(--bg-green)"], ["Blue", "var(--bg-blue)"], ["Purple", "var(--bg-purple)"], ["Pink", "var(--bg-pink)"], ["Red", "var(--bg-red)"]];

interface Props {
  noteId: string; html: string; editable: boolean; onChange: (html: string) => void;
  /** iPad (device.ts): open straight to the paper: the page's handwriting, or new lined paper on an empty page. Once per visit (onAutoInk). */
  autoInk?: boolean; onAutoInk?: () => void;
  /** iPad, a full page (not a peek or database row): handwriting here is the note itself (Handwriting asPage). */
  inkPage?: boolean;
}

export function Editor({ noteId, html, editable, onChange, autoInk, onAutoInk, inkPage }: Props) {
  const store = useStore();
  const live = useRef({ store, noteId });
  live.current = { store, noteId };

  const deps = useMemo<EditorDeps>(() => ({
    noteId: () => live.current.noteId,
    title: () => live.current.store.tree.find((n) => n.id === live.current.noteId)?.title ?? "",
    tree: () => live.current.store.tree,
    ask: (l, i) => live.current.store.ask(l, i),
    toast: (m) => live.current.store.toast(m),
    createPage: async (title, parentId) => {
      const n = await api.create({ title, parent_id: parentId });
      await live.current.store.refreshTree();
      return { id: n.id, title: n.title };
    },
  }), []);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: useMemo(() => buildExtensions(deps), [deps]),
    content: html,
    editable,
    onUpdate: ({ editor }) => onChangeRef.current(editor.getHTML()),
    editorProps: {
      handlePaste: (view, e) => {
        const f = [...(e.clipboardData?.files ?? [])].find(canUpload);
        if (!f) return false;
        void uploadAndInsert(editorRef.current!, f, deps.toast);
        return true;
      },
      handleDrop: (view, e) => {
        const f = [...(e.dataTransfer?.files ?? [])].find(canUpload);
        if (!f) return false;
        const pos = view.posAtCoords({ left: e.clientX, top: e.clientY })?.pos;
        void uploadAndInsert(editorRef.current!, f, deps.toast, pos);
        return true;
      },
      handleDOMEvents: {
        mousedown: (_v, e) => { nav.byMouse = !!(e.target as HTMLElement | null)?.closest?.("a[href]"); return false; },
        keydown: () => { nav.byMouse = false; return false; },
        // A click on a link follows it (a web address in a new tab, a Seaglass address inside the app). Not while the user is
        // selecting words, with Shift held, or on a page mention or file block (they open themselves).
        click: (_v, e) => {
          const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
          if (!a || e.button !== 0 || e.shiftKey || e.defaultPrevented) return false;
          if (a.closest('[data-type="mention"], [data-type="child-page"], [data-type="file"], [data-type="bookmark"]')) return false;
          const sel = window.getSelection();
          if (sel && !sel.isCollapsed) return false;
          const href = a.getAttribute("href") ?? "";
          if (!href || openLink(href, live.current.store.go) === "none") return false;
          e.preventDefault();
          return true;
        },
      },
      handleClickOn: (_v, _p, node, _np, e) => {
        const el = (e.target as HTMLElement).closest('[data-type="mention"]') as HTMLElement | null;
        // a drawing opens to write on only on the iPad; elsewhere it's a picture
        if (node.type.name === "image" && node.attrs.drawing && isInkDevice()) { dispatchEvent(new CustomEvent("seaglass:ink-open", { detail: { pos: _np, drawing: node.attrs.drawing } })); return true; }
        // elsewhere a drawing opens in a viewer made for reading it (zoom, full screen)
        if (node.type.name === "image" && node.attrs.drawing) { dispatchEvent(new CustomEvent("seaglass:ink-view", { detail: { src: node.attrs.src } })); return true; }
        if (node.type.name === "mention" || el) {
          const id = el?.getAttribute("data-id") ?? node.attrs.id;
          if (/^[0-9a-f-]{36}$/.test(id)) { live.current.store.go(`/p/${id}`); return true; }
        }
        return false;
      },
    },
  });

  useEffect(() => { editorRef.current = editor; return () => { if (editorRef.current === editor) editorRef.current = null; }; }, [editor]);
  useEffect(() => { editor?.setEditable(editable); }, [editor, editable]);
  // handwriting (#45, #46): a new drawing at the cursor, or a drawing in the page opened again (tap it)
  // From the page's top bar (detail.end) a new drawing goes at the end of the page; from / or the keyboard bar, at the cursor.
  // detail.paper "cornell" starts on a Cornell sheet (a note format, editor/formats.ts).
  // todo: a paragraph typed away from the iPad (editor/inkTodo.ts) being written in by hand; it goes on Done.
  // asPage: a handwritten note on the iPad is the paper itself (no Done; saved as the user writes; Back leaves).
  const [ink, setInk] = useState<{ pos: number | null; initial: Ink | null; end?: boolean; paper?: Paper; todo?: { text: string; at?: number }; asPage?: boolean } | null>(null);
  const inkRef = useRef(ink); inkRef.current = ink;
  // Writing by hand on an empty page makes it a handwritten note: the paper becomes the page.
  useEffect(() => { const on = (e: Event) => { const d = (e as CustomEvent<{ end?: boolean; paper?: Paper } | null>).detail; if (editable && isInkDevice()) setInk({ pos: null, initial: null, end: !!d?.end, paper: d?.paper, asPage: !!inkPage && !!editor?.isEmpty }); }; addEventListener("seaglass:ink", on); return () => removeEventListener("seaglass:ink", on); }, [editable, inkPage, editor]);
  // a drawing to read, on the iPhone or the computer
  const [view, setView] = useState<string | null>(null);
  const [zoom, setZoom] = useState(false);
  useEffect(() => { const on = (e: Event) => { const src = (e as CustomEvent<{ src: string }>).detail?.src; if (src && /^\/files\//.test(src)) { setZoom(false); setView(src); } }; addEventListener("seaglass:ink-view", on); return () => removeEventListener("seaglass:ink-view", on); }, []);
  // On the iPad a page that's already handwritten (it has a drawing, e.g. from "Cornell notes, handwritten") opens
  // straight to its writing; X goes back to the page, "Type instead" to the keyboard. A new or typed page opens as a
  // normal page: writing by hand starts only when the user picks it (the pencil, a handwritten format, / Handwriting).
  useEffect(() => {
    let off = false; try { off = localStorage.getItem("sg.ink.auto") === "0"; } catch { /* on */ } // tests turn it off
    if (!editor || !autoInk || !editable || !isInkDevice() || off) return;
    onAutoInk?.();
    // the page's first drawing (a handwritten page starts with its sheet)
    let first: { pos: number; drawing: string } | null = null;
    editor.state.doc.descendants((n, p) => { if (first) return false; if (n.type.name === "image" && n.attrs.drawing) { first = { pos: p, drawing: n.attrs.drawing }; return false; } return true; });
    const m = first as { pos: number; drawing: string } | null;
    if (m && /^\/files\/[\w-]+\/[\w.-]+$/.test(m.drawing)) {
      const img = editor.state.doc.nodeAt(m.pos);
      if (img) lastDrawing.current = { src: img.attrs.src, drawing: m.drawing };
      void fetch(m.drawing).then((r) => r.json()).then((j) => { const initial = parseInk(j); if (initial) setInk({ pos: m.pos, initial, asPage: !!inkPage }); }).catch(() => {});
    }
  }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps
  // "Write this by hand" on an outlined paragraph: the drawing above it opens (or a new one in its place), with the words to copy
  useEffect(() => {
    const write = async (e: Event) => {
      const pos = (e as CustomEvent<{ pos: number }>).detail?.pos;
      if (!editor || !editable || typeof pos !== "number") return;
      const node = editor.state.doc.nodeAt(pos);
      if (!node?.attrs.inkTodo) return;
      const todo = { text: node.textContent.trim() };
      let above: { pos: number; drawing: string } | null = null;
      editor.state.doc.descendants((n, p) => { if (p >= pos) return false; if (n.type.name === "image" && n.attrs.drawing) above = { pos: p, drawing: n.attrs.drawing }; return true; });
      const a = above as { pos: number; drawing: string } | null;
      if (a && /^\/files\/[\w-]+\/[\w.-]+$/.test(a.drawing)) {
        try { setInk({ pos: a.pos, initial: parseInk(await (await fetch(a.drawing)).json()), todo }); return; } catch { /* a new drawing instead */ }
      }
      setInk({ pos: null, initial: null, todo: { ...todo, at: pos } });
    };
    const keep = (e: Event) => {
      const pos = (e as CustomEvent<{ pos: number }>).detail?.pos;
      const node = editor && typeof pos === "number" ? editor.state.doc.nodeAt(pos) : null;
      if (!editor || !node?.attrs.inkTodo) return;
      editor.chain().command(({ tr }) => { tr.setNodeMarkup(pos, undefined, { ...node.attrs, inkTodo: null }); return true; }).run();
    };
    addEventListener("seaglass:ink-todo", write); addEventListener("seaglass:ink-todo-keep", keep);
    return () => { removeEventListener("seaglass:ink-todo", write); removeEventListener("seaglass:ink-todo-keep", keep); };
  }, [editor, editable]);
  // A note format from the page's ⋯ menu (editor/formats.ts), added at the end of the page.
  useEffect(() => {
    const on = (e: Event) => {
      const html = (e as CustomEvent<{ html: string }>).detail?.html;
      if (!editor || !editable || !html) return;
      if (editor.isEmpty) editor.chain().setMeta(SKIP_INK_TODO, true).setContent(html, { emitUpdate: true }).focus("start").run();
      else editor.chain().setMeta(SKIP_INK_TODO, true).insertContentAt(editor.state.doc.content.size, html).focus("end").run();
      setTimeout(() => editor.view.dom.querySelector(":scope > :last-child")?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 50);
    };
    addEventListener("seaglass:insert-format", on); return () => removeEventListener("seaglass:insert-format", on);
  }, [editor, editable]);
  useEffect(() => {
    const on = async (e: Event) => {
      const d = (e as CustomEvent<{ pos: number; drawing: string }>).detail;
      if (!editable || !/^\/files\/[\w-]+\/[\w.-]+$/.test(d.drawing)) return;
      try { setInk({ pos: d.pos, initial: parseInk(await (await fetch(d.drawing)).json()) }); } catch { store.toast("Couldn't open that drawing"); }
    };
    addEventListener("seaglass:ink-open", on); return () => removeEventListener("seaglass:ink-open", on);
  }, [editable]); // eslint-disable-line react-hooks/exhaustive-deps
  // As a page it's saved again and again while it stays open: one save at a time, and a new drawing's place is kept.
  const saving = useRef<Promise<void>>(Promise.resolve());
  const lastDrawing = useRef<{ src: string; drawing: string } | null>(null);
  const keepSaving = (r: InkResult) => (saving.current = saving.current.then(() => saveInk(r, true)).catch(() => {}));
  const lastSave = useRef<Promise<void>>(Promise.resolve());
  /** What the writing says (Handwriting onTranscript) goes in the drawing's alt: "Handwriting: …", which is what the
   *  assistant, search, embeddings and MCP read. If the user has left the page, it's put in the stored page directly. */
  const setAlt = async (text: string) => {
    await saving.current; await lastSave.current;
    const d = lastDrawing.current;
    if (!d) return;
    const alt = `Handwriting: ${text}`.slice(0, 6000);
    if (editor && !editor.isDestroyed) {
      let pos: number | null = null;
      editor.state.doc.descendants((n, p) => { if (pos !== null) return false; if (n.type.name === "image" && n.attrs.drawing === d.drawing) { pos = p; return false; } return true; });
      const at = pos as number | null, node = at !== null ? editor.state.doc.nodeAt(at) : null;
      if (at !== null && node && node.attrs.alt !== alt) editor.chain().setMeta(SKIP_INK_TODO, true).setMeta("addToHistory", false).command(({ tr }) => { tr.setNodeMarkup(at, undefined, { ...node.attrs, alt }); return true; }).run();
      return;
    }
    try {
      const n = await api.get(noteId);
      const attr = alt.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const html = n.html.replace(/<img\b[^>]*>/g, (tag) => (tag.includes(`data-drawing="${d.drawing}"`) ? (/\balt="[^"]*"/.test(tag) ? tag.replace(/\balt="[^"]*"/, `alt="${attr}"`) : tag.replace(/^<img/, `<img alt="${attr}"`)) : tag));
      if (html !== n.html) await api.patch(noteId, { html });
    } catch { /* read again next time */ }
  };
  const saveInk = async (r: InkResult, keep = false) => {
    const at = keep ? inkRef.current : ink;
    if (!keep) setInk(null);
    if (!at) return;
    if (!editor || editor.isDestroyed) {
      // The user left the note while it was saving: put the new drawing in the stored page directly
      const was = lastDrawing.current;
      if (!keep || !was) return;
      const [src, drawing] = await Promise.all([api.upload(r.png, "handwriting.png"), api.upload(new Blob([JSON.stringify(r.ink)], { type: "application/json" }), "handwriting.json")]);
      const n = await api.get(noteId);
      if (n.html.includes(was.drawing)) {
        await api.patch(noteId, { html: n.html.split(was.src).join(src).split(was.drawing).join(drawing) }).catch(() => {});
        lastDrawing.current = { src, drawing }; // the transcript (setAlt) goes on this one
      }
      return;
    }
    try {
      const textOnly = r.text?.replace;
      let image: { type: "image"; attrs: { src: string; alt: string; drawing: string } } | null = null;
      if (!textOnly) {
        const [src, drawing] = await Promise.all([api.upload(r.png, "handwriting.png"), api.upload(new Blob([JSON.stringify(r.ink)], { type: "application/json" }), "handwriting.json")]);
        image = { type: "image", attrs: { src, alt: "Handwriting", drawing } };
      }
      const html = r.text?.html ?? "";
      // the typed paragraph written in by hand goes (found again by its words: the drawing may have moved things)
      const dropTodo = () => {
        if (!at.todo) return;
        let hit: { pos: number; size: number } | null = null;
        editor.state.doc.descendants((n, p) => { if (hit) return false; if (n.isTextblock && n.attrs.inkTodo && n.textContent.trim() === at.todo!.text) { hit = { pos: p, size: n.nodeSize }; return false; } return true; });
        const h = hit as { pos: number; size: number } | null;
        if (h) editor.chain().setMeta(SKIP_INK_TODO, true).deleteRange({ from: h.pos, to: h.pos + h.size }).run();
      };
      if (at.pos === null && at.todo?.at !== undefined && image) {
        // no drawing above it: the new one goes where the typed words were
        const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
        const node = editor.state.doc.nodeAt(at.todo.at);
        const where = node?.attrs.inkTodo ? at.todo.at : editor.state.doc.content.size;
        editor.chain().setMeta(SKIP_INK_TODO, true).insertContentAt(where, `<img src="${esc(image.attrs.src)}" alt="Handwriting" data-drawing="${esc(image.attrs.drawing)}">`).run();
        lastDrawing.current = { src: image.attrs.src, drawing: image.attrs.drawing };
        dropTodo();
        return;
      }
      if (at.pos === null) {
        // one insert: after an image the editor selects it, so a second insert would replace it
        const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
        const img = image ? `<img src="${esc(image.attrs.src)}" alt="Handwriting" data-drawing="${esc(image.attrs.drawing)}">` : "";
        if (image) lastDrawing.current = { src: image.attrs.src, drawing: image.attrs.drawing };
        if (keep && image) {
          // the first save of a new handwritten note: the drawing goes in, and later saves update it where it is
          if (editor.isEmpty) editor.chain().setMeta(SKIP_INK_TODO, true).setContent(img, { emitUpdate: true }).run();
          else editor.chain().setMeta(SKIP_INK_TODO, true).insertContentAt(editor.state.doc.content.size, img).run();
          let pos: number | null = null;
          editor.state.doc.descendants((n, p) => { if (pos !== null) return false; if (n.type.name === "image" && n.attrs.drawing === image!.attrs.drawing) { pos = p; return false; } return true; });
          setInk((cur) => (cur ? { ...cur, pos, end: false } : cur));
          lastDrawing.current = { src: image.attrs.src, drawing: image.attrs.drawing };
          if (inkRef.current) inkRef.current = { ...inkRef.current, pos, end: false };
          return;
        }
        if (at.end && editor.isEmpty) editor.chain().setContent(`${img}${html}`, { emitUpdate: true }).focus("end").run();
        else if (at.end) editor.chain().insertContentAt(editor.state.doc.content.size, `${img}${html}`).focus("end").run();
        else editor.chain().focus().insertContent(`${img}${html}`).run();
      } else {
        // A handwritten note saved as the user writes finds its drawing by its address, not by where it was when the paper
        // opened: the page can change around it meanwhile (Written ✓ removing typed words, a sync), and a stale
        // position silently dropped every save until the user left the note.
        let pos = at.pos;
        const want = keep ? lastDrawing.current?.drawing : undefined;
        if (want) editor.state.doc.descendants((n, p) => { if (n.type.name === "image" && n.attrs.drawing === want) { pos = p; return false; } return true; });
        const node = editor.state.doc.nodeAt(pos);
        if (!node || node.type.name !== "image") return;
        if (pos !== at.pos) { const fix = (cur: typeof ink) => (cur ? { ...cur, pos } : cur); setInk(fix); inkRef.current = fix(inkRef.current); }
        const c = keep ? editor.chain().setMeta(SKIP_INK_TODO, true) : editor.chain().focus(); // no keyboard while writing
        if (image) {
          // its alt (the transcript) stays until a new one is read
          c.command(({ tr }) => { tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: image!.attrs.src, drawing: image!.attrs.drawing }); return true; });
          lastDrawing.current = { src: image.attrs.src, drawing: image.attrs.drawing };
        } else c.deleteRange({ from: pos, to: pos + node.nodeSize });
        if (html) c.insertContentAt(image ? pos + node.nodeSize : pos, html);
        c.setMeta(SKIP_INK_TODO, true).run();
        dropTodo();
      }
    } catch (e) { store.toast(`Couldn't save the drawing: ${(e as Error).message}`); }
  };
  // weak spots (#14): what the user keeps missing on this page, highlighted; again after a study session, on focus, or when toggled
  useEffect(() => {
    if (!editor) return;
    let on = true;
    const load = () => {
      if (!weakSpotsOn()) { if (!editor.isDestroyed) setWeakSpots(editor.view, []); return; }
      api.weakSpots(noteId).then((r) => { if (on && !editor.isDestroyed) setWeakSpots(editor.view, spotTerms(r.spots)); }).catch(() => { /* a shared page, or offline */ });
    };
    load();
    addEventListener("seaglass:weak", load); addEventListener("focus", load);
    return () => { on = false; removeEventListener("seaglass:weak", load); removeEventListener("focus", load); };
  }, [editor, noteId, store.drill, store.quiz, store.explain]);

  // comments on text and suggested edits (#22): highlighted from the page's comments, reloaded whenever they change
  useEffect(() => {
    if (!editor) return;
    let on = true;
    const load = () => { api.comments(noteId).then((list) => { if (on && !editor.isDestroyed) setComments(editor.view, list); }).catch(() => { /* a shared page, or offline */ }); };
    load();
    const where = (id: string) => {
      const c = commentKey.getState(editor.state)?.list.find((x) => x.id === id);
      return c?.anchor ? { c, at: findQuote(blocksOf(editor.state.doc), c.anchor) } : null;
    };
    const show = (e: Event) => {
      const w = where((e as CustomEvent<string>).detail);
      if (!w) return;
      if (!w.at) { store.toast("Those words aren't on the page any more"); return; }
      editor.chain().focus().setTextSelection(w.at).scrollIntoView().run();
    };
    const accept = async (e: Event) => {
      const id = (e as CustomEvent<string>).detail, w = where(id);
      if (!w || w.c.kind !== "suggestion") return;
      if (!w.at || !editable) { store.toast(editable ? "Those words have changed since, so it can't be applied. Reject it, or edit by hand." : "This page is locked"); return; }
      const text = w.c.replace_with ?? "";
      editor.chain().focus().command(({ tr }) => { if (text) tr.insertText(text, w.at!.from, w.at!.to); else tr.delete(w.at!.from, w.at!.to); return true; }).run();
      try { await api.resolveComment(id, true, "accepted"); } catch { /* the edit stands; it shows as open until the next load */ }
      dispatchEvent(new CustomEvent("seaglass:comments"));
    };
    addEventListener("seaglass:comments", load); addEventListener("seaglass:comment-show", show); addEventListener("seaglass:suggestion-accept", accept);
    return () => { on = false; removeEventListener("seaglass:comments", load); removeEventListener("seaglass:comment-show", show); removeEventListener("seaglass:suggestion-accept", accept); };
  }, [editor, noteId, editable]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!editor) return null;
  return (
    <div className={`editor-wrap ${ink?.asPage ? "ink-note" : ""}`}>
      {ink?.asPage && <Handwriting asPage initial={ink.initial} paper={ink.paper} onTranscript={(t) => void setAlt(t)}
        todos={inkTodos(editor)} onTodoDone={(t) => dropTyped(editor, t)}
        onSave={keepSaving} onDone={(r) => void saveInk(r)} onCancel={() => setInk(null)}
        onTitle={(title) => dispatchEvent(new CustomEvent("seaglass:ink-title", { detail: { id: noteId, title } }))} />}
      {editable && !ink?.asPage && <BlockHandle editor={editor} />}
      <EditorContent editor={editor} className="editor" />
      {editable && <SelectionMenu editor={editor} ask={store.ask} noteId={noteId} />}
      {editable && <LinkDialog editor={editor} />}
      {editable && <PhoneToolbar editor={editor} noteId={noteId} />}
      {ink && !ink.asPage && <Handwriting initial={ink.initial} paper={ink.paper} hint={ink.todo?.text} onCancel={() => setInk(null)} onDone={(r) => { lastSave.current = saveInk(r); }}
        onTranscript={(t) => void setAlt(t)}
        onTitle={(title) => dispatchEvent(new CustomEvent("seaglass:ink-title", { detail: { id: noteId, title } }))}
        onType={() => { setInk(null); setTimeout(() => { if (editor && !editor.isDestroyed) editor.chain().focus("end").run(); }, 80); }} />}

      {view && createPortal(
        <div className={`ink-view ${zoom ? "zoomed" : ""}`} role="dialog" aria-label="Handwritten note">
          <div className="ink-view-bar">
            <button className="ghost" onClick={() => setZoom((z) => !z)}>{zoom ? "Fit to screen" : "Zoom in"}</button>
            <button className="ghost" aria-label="Close" onClick={() => setView(null)}>Close</button>
          </div>
          <div className="ink-view-scroll"><img src={view} alt="Handwritten note" onClick={() => setZoom((z) => !z)} /></div>
        </div>, document.body)}
    </div>
  );
}

// ---------------------------------------------------------------- selection toolbar + table controls

function SelectionMenu({ editor, ask, noteId }: { editor: TipEditor; ask: (l: string, i?: string) => Promise<string | null>; noteId: string }) {
  const store = useStore();
  const [pop, setPop] = useState<"color" | null>(null);
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"), italic: e.isActive("italic"), underline: e.isActive("underline"), strike: e.isActive("strike"),
      code: e.isActive("code"), link: e.isActive("link"), href: String(e.getAttributes("link").href ?? ""), sub: e.isActive("subscript"), sup: e.isActive("superscript"),
      inTable: e.isActive("table"), empty: e.state.selection.empty,
    }),
  });
  const B = (on: boolean, label: ReactNode, title: string, fn: () => void, cls = "") => (
    <button className={`${on ? "on " : ""}${cls}`} title={title} onMouseDown={(e) => e.preventDefault()} onClick={fn}>{label}</button>
  );
  const c = () => editor.chain().focus();

  const setLink = () => dispatchEvent(new CustomEvent("seaglass:link")); // the Link dialog (LinkDialog.tsx)

  // a comment on the selected words (#22)
  const comment = async () => {
    const { from, to } = editor.state.selection;
    const anchor = anchorOf(blocksOf(editor.state.doc), from, to);
    if (!anchor) { store.toast("Select some words inside one paragraph to comment on them"); return; }
    const body = await ask(`Comment on “${anchor.quote.length > 40 ? `${anchor.quote.slice(0, 40)}…` : anchor.quote}”`);
    if (!body?.trim()) return;
    try { await api.addComment(noteId, body.trim(), anchor); } catch (e) { store.toast(`Couldn't add the comment: ${(e as Error).message}`); return; }
    dispatchEvent(new CustomEvent("seaglass:comments"));
    dispatchEvent(new CustomEvent("seaglass:comments-open"));
  };

  return (
    <>
      <BubbleMenu editor={editor} shouldShow={({ editor: e, state }) => !state.selection.empty && e.isEditable && !e.isActive("image") && !e.isActive("blockMath")} options={{ placement: "top" }}>
        <div className="bubble" onMouseLeave={() => setPop(null)}>
          <AskJeffMenu editor={editor} noteId={noteId} />
          <span className="sep" />
          {B(false, <IComment size={16} />, "Comment", () => void comment(), "bubble-comment")}
          <span className="sep" />
          {B(s.bold, <Bold size={16} />, "Bold", () => c().toggleBold().run())}
          {B(s.italic, <Italic size={16} />, "Italic", () => c().toggleItalic().run())}
          {B(s.underline, <Underline size={16} />, "Underline", () => c().toggleUnderline().run())}
          {B(s.strike, <Strikethrough size={16} />, "Strikethrough", () => c().toggleStrike().run())}
          {B(s.code, <Code size={16} />, "Code", () => c().toggleCode().run())}
          {B(s.link, <Link size={16} />, "Link", setLink)}
          {B(s.sub, <Subscript size={16} />, "Subscript", () => c().toggleSubscript().run())}
          {B(s.sup, <Superscript size={16} />, "Superscript", () => c().toggleSuperscript().run())}
          <span className="sep" />
          {B(false, <AlignLeft size={16} />, "Align left", () => c().setTextAlign("left").run())}
          {B(false, <AlignCenter size={16} />, "Align center", () => c().setTextAlign("center").run())}
          <span className="sep" />
          {B(pop === "color", <Palette size={16} />, "Color", () => setPop(pop ? null : "color"))}
          {pop === "color" && (
            <div className="color-pop">
              <div className="cp-title">Text color</div>
              <div className="cp-row">{TEXT_COLORS.map(([n, v]) => (
                <button key={n} title={n} style={{ color: v || "inherit" }} onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { v ? c().setColor(v).run() : c().unsetColor().run(); setPop(null); }}>A</button>
              ))}</div>
              <div className="cp-title">Highlight</div>
              <div className="cp-row">{HILITES.map(([n, v]) => (
                <button key={n} title={n} style={{ background: v || "transparent" }} onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { v ? c().setHighlight({ color: v }).run() : c().unsetHighlight().run(); setPop(null); }}>{v ? "" : "∅"}</button>
              ))}</div>
            </div>
          )}
        </div>
      </BubbleMenu>

      {/* the cursor is in a link (the arrow keys, or a click that opened it): where it goes, and the ways to change it */}
      <BubbleMenu editor={editor} shouldShow={({ editor: e, state }) => e.isActive("link") && state.selection.empty && e.isEditable && !nav.byMouse} options={{ placement: "bottom-start" }}>
        <div className="bubble link-card">
          <span className="link-url" title={s.href}>{hostOf(s.href)}</span>
          {B(false, "Open", "Open the link", () => openLink(s.href, store.go))}
          {B(false, "Edit", "Change the words or the address", setLink)}
          {B(false, "Remove", "Take the link off, keep the words", () => c().extendMarkRange("link").unsetLink().run())}
        </div>
      </BubbleMenu>

      <BubbleMenu editor={editor} shouldShow={({ editor: e, state }) => e.isActive("table") && state.selection.empty && e.isEditable} options={{ placement: "top" }}>
        <div className="bubble">
          {B(false, "+ Row", "Add row below", () => c().addRowAfter().run())}
          {B(false, "+ Col", "Add column right", () => c().addColumnAfter().run())}
          {B(false, "− Row", "Delete row", () => c().deleteRow().run())}
          {B(false, "− Col", "Delete column", () => c().deleteColumn().run())}
          {B(false, "Header", "Toggle header row", () => c().toggleHeaderRow().run())}
          {B(false, <Trash2 size={15} />, "Delete table", () => c().deleteTable().run())}
        </div>
      </BubbleMenu>
    </>
  );
}

// ---------------------------------------------------------------- drag handle + block menu

function BlockHandle({ editor }: { editor: TipEditor }) {
  const hovered = useRef<{ node: PMNode | null; pos: number }>({ node: null, pos: -1 });
  const [menu, setMenu] = useState<{ x: number; y: number; node: PMNode; pos: number } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    addEventListener("mousedown", close);
    return () => removeEventListener("mousedown", close);
  }, [menu]);

  const addBelow = () => {
    const { node, pos } = hovered.current;
    if (!node || pos < 0) return;
    editor.chain().focus().insertContentAt(pos + node.nodeSize, { type: "paragraph" }).focus(pos + node.nodeSize + 1).insertContent("/").run();
  };

  const act = (fn: (c: ReturnType<TipEditor["chain"]>, node: PMNode, pos: number) => void) => {
    if (!menu) return;
    fn(editor.chain().focus(), menu.node, menu.pos);
    setMenu(null);
  };
  const turn = (apply: (c: ReturnType<TipEditor["chain"]>) => ReturnType<TipEditor["chain"]>) => act((c, _n, pos) => { apply(c.setTextSelection(pos + 1)).run(); });
  const textual = menu?.node.isTextblock;

  return (
    <>
      <DragHandle editor={editor} onNodeChange={({ node, pos }) => { hovered.current = { node, pos }; }}>
        <div className="dh">
          <button title="Click to add below, Alt-click to add above" onClick={addBelow}><IPlus size={18} /></button>
          <button className="grip" title="Drag to move, click for options"
            onClick={(e) => { const { node, pos } = hovered.current; if (node) setMenu({ x: e.clientX, y: e.clientY, node, pos }); }}><IGrip size={18} /></button>
        </div>
      </DragHandle>
      {menu && (
        <div className="block-menu" style={{ left: Math.min(menu.x, innerWidth - 220), top: Math.min(menu.y, innerHeight - 380) }} onMouseDown={(e) => e.stopPropagation()}>
          {textual && (
            <>
              <div className="bm-title">Turn into</div>
              <button onClick={() => turn((c) => c.setParagraph())}>Text</button>
              <button onClick={() => turn((c) => c.setHeading({ level: 1 }))}>Heading 1</button>
              <button onClick={() => turn((c) => c.setHeading({ level: 2 }))}>Heading 2</button>
              <button onClick={() => turn((c) => c.setHeading({ level: 3 }))}>Heading 3</button>
              <button onClick={() => turn((c) => c.toggleBulletList())}>Bulleted list</button>
              <button onClick={() => turn((c) => c.toggleOrderedList())}>Numbered list</button>
              <button onClick={() => turn((c) => c.toggleTaskList())}>To-do list</button>
              <button onClick={() => turn((c) => c.setBlockquote())}><Quote size={15} /> Quote</button>
              <button onClick={() => turn((c) => c.setCodeBlock())}><Code size={15} /> Code</button>
              <div className="bm-sep" />
            </>
          )}
          {menu.node.type.name === "callout" && (
            <button onClick={() => act((c, n, pos) => {
              const list = ["💡", "⚠️", "✅", "❗", "📌", "🔥", "ℹ️"];
              c.command(({ tr }) => { tr.setNodeMarkup(pos, undefined, { ...n.attrs, emoji: list[(list.indexOf(n.attrs.emoji) + 1) % list.length] }); return true; }).run();
            })}><RefreshCw size={15} /> Change icon</button>
          )}
          <button onClick={() => act((c, n, pos) => { c.insertContentAt(pos + n.nodeSize, n.toJSON()).run(); })}><Copy size={15} /> Duplicate</button>
          <button className="danger" onClick={() => act((c, _n, pos) => { c.setNodeSelection(pos).deleteSelection().run(); })}><Trash2 size={15} /> Delete</button>
        </div>
      )}
    </>
  );
}
