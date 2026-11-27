import type { ReactNode } from "react";
import { Extension, mergeAttributes, type Editor, type Range } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { WeakSpots } from "./weakSpots";
import { InkTodo, SKIP_INK_TODO } from "./inkTodo";
import { isInkDevice } from "../device";
import { CommentMarks } from "./commentMarks";
import { FORMATS } from "./formats";
import { AtSign, Bookmark as BookmarkIcon, Link as LinkIcon, CalendarDays, ChevronRight, Code, Columns2, Columns3, FilePlus, FileText, FunctionSquare, Heading1, Heading2, Heading3, Image as ImageIcon, LayoutTemplate, Lightbulb, List, ListOrdered, ListTodo, ListTree, Minus, PenLine, Pilcrow, Play, Plus, Quote, Sigma, Sparkles, Table as TableIcon } from "lucide-react";
import { PageIcon } from "../icons";
import StarterKit from "@tiptap/starter-kit";
import Suggestion from "@tiptap/suggestion";
import Mention from "@tiptap/extension-mention";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import Youtube from "@tiptap/extension-youtube";
import Highlight from "@tiptap/extension-highlight";
import { TextStyle, Color } from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import Typography from "@tiptap/extension-typography";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { Details, DetailsSummary, DetailsContent } from "@tiptap/extension-details";

/** Toggles, plus Notion's toggle headings: a toggle whose title is styled as Heading 1-3 (data-heading="1".."3"). The
 *  stock node view never re-reads attributes, so keep data-heading on its element in sync ourselves. */
const ToggleDetails = Details.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      heading: {
        default: null,
        parseHTML: (el: HTMLElement) => (/^[123]$/.test(el.getAttribute("data-heading") ?? "") ? el.getAttribute("data-heading") : null),
        renderHTML: (a: { heading?: string | null }) => (a.heading ? { "data-heading": a.heading } : {}),
      },
    };
  },
  addNodeView() {
    const parent = this.parent?.();
    if (!parent) return null;
    return (props) => {
      const view = parent(props) as { dom: HTMLElement; update?: (n: typeof props.node, ...rest: unknown[]) => boolean };
      const sync = (n: typeof props.node) => { const h = n.attrs.heading as string | null; if (h) view.dom.setAttribute("data-heading", h); else view.dom.removeAttribute("data-heading"); };
      sync(props.node);
      const update = view.update?.bind(view);
      view.update = (n, ...rest) => { const ok = update ? update(n, ...rest) : false; if (ok) sync(n); return ok; };
      return view as never;
    };
  },
});
import { BlockMath, InlineMath } from "@tiptap/extension-mathematics";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import UniqueID from "@tiptap/extension-unique-id";
import { common, createLowlight } from "lowlight";
import { Bookmark, Callout, ChildPage, Column, Columns, DbView, FileBlock, Toc } from "./nodes";
import { suggestionRender, type SItem } from "./suggest";
import { NotionKeys } from "./notion-keys";
import { api } from "../api";
import type { TreeNode } from "../types";
import { agentName } from "../persona";
import { savedPromptsNow } from "../proactive";

export interface EditorDeps {
  noteId: () => string;
  title: () => string;
  tree: () => TreeNode[];
  ask: (label: string, initial?: string) => Promise<string | null>;
  toast: (msg: string) => void;
  createPage: (title: string, parentId: string | null) => Promise<{ id: string; title: string }>;
}

const lowlight = createLowlight(common);
export const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const fmtDate = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return isoDate(d); };

const chain = (fn: (c: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) => (e: Editor, r: Range) => { fn(e.chain().focus().deleteRange(r)).run(); };
// Math commands read editor.state (not the in-flight transaction), so delete the "/query" first, then insert.
const twoStep = (insert: (e: Editor) => void) => (e: Editor, r: Range) => { e.chain().focus().deleteRange(r).run(); insert(e); };
const dateNode = (iso: string) => ({ type: "mention", attrs: { id: `date:${iso}`, label: fmtDate(iso) } });

/** What can go in a page: images inline, and PDFs, recordings and videos as file blocks (nodes.tsx FileBlock). */
export const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp|avif)$/;
export const FILE_TYPES = /^(application\/pdf|audio\/(mpeg|mp4|wav|ogg)|video\/(mp4|webm))$/;
export const canUpload = (f: File) => IMAGE_TYPES.test(f.type) || FILE_TYPES.test(f.type);

export async function uploadAndInsert(editor: Editor, file: File, toast: (m: string) => void, pos?: number) {
  if (!canUpload(file)) { toast("Pages take images, PDFs, recordings and videos"); return; }
  if (file.size > 25 * 1024 * 1024) { toast("That file is over 25 MB"); return; }
  try {
    toast("Uploading…");
    const src = await api.upload(file);
    const c = editor.chain().focus();
    const at = pos === undefined ? c : c.setTextSelection(pos);
    if (IMAGE_TYPES.test(file.type)) at.setImage({ src, alt: file.name }).run();
    else at.insertContent({ type: "fileBlock", attrs: { src, name: file.name, size: String(file.size), mime: file.type } }).run();
  } catch (e) { toast(`Upload failed: ${(e as Error).message}`); }
}

function pickFile(editor: Editor, toast: (m: string) => void) {
  const input = document.createElement("input");
  input.type = "file"; input.accept = "application/pdf,.pdf,audio/mpeg,audio/mp4,audio/wav,audio/ogg,video/mp4,video/webm";
  input.onchange = () => { const f = input.files?.[0]; if (f) void uploadAndInsert(editor, f, toast); };
  input.click();
}

function pickImage(editor: Editor, toast: (m: string) => void) {
  const input = document.createElement("input");
  input.type = "file"; input.accept = "image/png,image/jpeg,image/gif,image/webp,image/avif";
  input.onchange = () => { const f = input.files?.[0]; if (f) uploadAndInsert(editor, f, toast); };
  input.click();
}

/** Jeff writes at the cursor: from an instruction ("Write with Jeff") or by carrying on from the text above ("Continue writing"). */
async function jeffWrite(e: Editor, r: Range, deps: EditorDeps, ask: boolean) {
  const instruction = ask ? await deps.ask(`What should ${agentName()} write?`) : "";
  if (ask && !instruction?.trim()) { e.chain().focus().deleteRange(r).run(); return; }
  e.chain().focus().deleteRange(r).run();
  const pos = e.state.selection.from;
  const before = e.state.doc.textBetween(0, pos, "\n", "\n"), after = e.state.doc.textBetween(pos, e.state.doc.content.size, "\n", "\n");
  deps.toast(`${agentName()} is writing…`);
  let model: string | undefined;
  try { model = localStorage.getItem("sg.agent.model") || undefined; } catch { /* storage unavailable */ }
  try {
    const out = await api.aiWrite({ instruction: instruction ?? "", title: deps.title(), before, after, model, page_id: deps.noteId() ?? undefined });
    if (out.html) { e.chain().focus().insertContentAt(Math.min(pos, e.state.doc.content.size), out.html).run(); deps.toast(`${agentName()} wrote it. Ctrl+Z to undo`); }
  } catch (err) { deps.toast((err as Error)?.message || `${agentName()} couldn't write that`); }
}

export function slashItems(deps: EditorDeps): SItem[] {
  const I = (group: string, key: string, icon: ReactNode, title: string, subtitle: string, keywords: string, run: SItem["run"]): SItem => ({ group, key, icon, title, subtitle, keywords, run });
  const cell = (n: number) => ({ type: "column", content: [{ type: "paragraph" }] });
  return [
    I("Basic blocks", "text", <Pilcrow size={17} />, "Text", "", "paragraph p", chain((c) => c.setParagraph())),
    I("Basic blocks", "h1", <Heading1 size={17} />, "Heading 1", "#", "h1 title", chain((c) => c.setHeading({ level: 1 }))),
    I("Basic blocks", "h2", <Heading2 size={17} />, "Heading 2", "##", "h2 subtitle", chain((c) => c.setHeading({ level: 2 }))),
    I("Basic blocks", "h3", <Heading3 size={17} />, "Heading 3", "###", "h3", chain((c) => c.setHeading({ level: 3 }))),
    I("Basic blocks", "todo", <ListTodo size={17} />, "To-do list", "[]", "checklist task checkbox", chain((c) => c.toggleTaskList())),
    I("Basic blocks", "bullet", <List size={17} />, "Bulleted list", "-", "ul unordered", chain((c) => c.toggleBulletList())),
    I("Basic blocks", "number", <ListOrdered size={17} />, "Numbered list", "1.", "ol ordered", chain((c) => c.toggleOrderedList())),
    I("Basic blocks", "toggle", <ChevronRight size={17} />, "Toggle list", ">", "collapse details accordion", chain((c) => c.setDetails())),
    I("Basic blocks", "toggle-h1", <Heading1 size={17} />, "Toggle heading 1", "", "collapsible section fold h1", chain((c) => c.setDetails().updateAttributes("details", { heading: "1" }))),
    I("Basic blocks", "toggle-h2", <Heading2 size={17} />, "Toggle heading 2", "", "collapsible section fold h2", chain((c) => c.setDetails().updateAttributes("details", { heading: "2" }))),
    I("Basic blocks", "toggle-h3", <Heading3 size={17} />, "Toggle heading 3", "", "collapsible section fold h3", chain((c) => c.setDetails().updateAttributes("details", { heading: "3" }))),
    I("Basic blocks", "quote", <Quote size={17} />, "Quote", "\"", "blockquote", chain((c) => c.setBlockquote())),
    I("Basic blocks", "callout", <Lightbulb size={17} />, "Callout", "Make writing stand out", "note info tip", chain((c) => c.insertContent({ type: "callout", attrs: { emoji: "💡" }, content: [{ type: "paragraph" }] }))),
    I("Basic blocks", "divider", <Minus size={17} />, "Divider", "---", "hr line separator", chain((c) => c.setHorizontalRule())),
    I("Basic blocks", "code", <Code size={17} />, "Code", "```", "snippet pre", chain((c) => c.setCodeBlock())),
    I(`${agentName()}`, "jeff-write", <Sparkles size={17} />, `Write with ${agentName()}`, `Tell ${agentName()} what to write here`, "ai jeff write draft generate", (e, r) => void jeffWrite(e, r, deps, true)),
    I(`${agentName()}`, "jeff-continue", <PenLine size={17} />, "Continue writing", `${agentName()} carries on from the text above`, "ai jeff continue more next", (e, r) => void jeffWrite(e, r, deps, false)),
    I("Layout", "table", <TableIcon size={17} />, "Table", "Simple table", "grid rows", chain((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))),
    I("Layout", "col2", <Columns2 size={17} />, "2 columns", "Side by side", "columns split", chain((c) => c.insertContent({ type: "columns", content: [cell(0), cell(1)] }))),
    I("Layout", "col3", <Columns3 size={17} />, "3 columns", "Three across", "columns split", chain((c) => c.insertContent({ type: "columns", content: [cell(0), cell(1), cell(2)] }))),
    I("Layout", "dbview", <TableIcon size={17} />, "Linked view of a database", "Show a database here, in the view you pick", "database linked view embed table board chart grades tasks", chain((c) => c.insertContent({ type: "dbView", attrs: { db: "", view: "" } }))),
    I("Layout", "toc", <ListTree size={17} />, "Table of contents", "Links to your headings", "toc outline", chain((c) => c.insertContent({ type: "toc" }))),
    ...FORMATS.map((f) => I("Note formats", `fmt-${f.key}`, <LayoutTemplate size={17} />, f.title, f.subtitle, `format layout template note ${f.key} ${f.title.toLowerCase()}`, f.ink ? (e, r) => { e.chain().focus().deleteRange(r).run(); dispatchEvent(new CustomEvent("seaglass:ink", { detail: { paper: f.ink } })); } : chain((c) => c.setMeta(SKIP_INK_TODO, true).insertContent(f.html(isoDate(new Date())))))),
    I("Media", "image", <ImageIcon size={17} />, "Image", "Upload an image", "picture photo upload", (e, r) => { e.chain().focus().deleteRange(r).run(); pickImage(e, deps.toast); }),
    I("Media", "file", <FileText size={17} />, "PDF or file", "A handout, worksheet or recording", "pdf file upload attach handout worksheet slides document audio video", (e, r) => { e.chain().focus().deleteRange(r).run(); pickFile(e, deps.toast); }),
    I("Media", "handwriting", <PenLine size={17} />, "Handwriting", "Write or draw with Apple Pencil", "draw pencil pen ink sketch write handwriting", (e, r) => { e.chain().focus().deleteRange(r).run(); dispatchEvent(new CustomEvent("seaglass:ink")); }),
    I("Media", "youtube", <Play size={17} />, "YouTube video", "Embed a video", "video embed", async (e, r) => {
      e.chain().focus().deleteRange(r).run();
      const src = await deps.ask("YouTube link");
      if (src) e.chain().focus().setYoutubeVideo({ src }).run();
    }),
    I("Media", "bookmark", <BookmarkIcon size={17} />, "Web bookmark", "Link preview card", "link url card", async (e, r) => {
      e.chain().focus().deleteRange(r).run();
      const url = await deps.ask("Paste a link");
      if (!url) return;
      try { const m = await api.unfurl(/^https?:/i.test(url) ? url : `https://${url}`); e.chain().focus().insertContent({ type: "bookmark", attrs: m }).run(); }
      catch { deps.toast("Couldn't load that link"); }
    }),
    I("Advanced", "math", <Sigma size={17} />, "Block equation", "LaTeX math on its own line", "latex katex formula", twoStep((e) => e.chain().focus().insertBlockMath({ latex: "E = mc^2" }).run())),
    I("Advanced", "imath", <FunctionSquare size={17} />, "Inline equation", "LaTeX inside a sentence", "latex katex formula", twoStep((e) => e.chain().focus().insertInlineMath({ latex: "x^2" }).run())),
    I("Links", "link", <LinkIcon size={17} />, "Link", "Words that open a web address", "hyperlink url web address website href", (e, r) => { e.chain().focus().deleteRange(r).run(); dispatchEvent(new CustomEvent("seaglass:link")); }),
    I("Links", "mention", <AtSign size={17} />, "Link to page", "[[", "mention backlink", chain((c) => c.insertContent("@"))),
    I("Links", "child", <FilePlus size={17} />, "Sub-page", "Create a page inside this one", "new page nested", async (e, r) => {
      e.chain().focus().deleteRange(r).run();
      const p = await deps.createPage("Untitled", deps.noteId());
      e.chain().focus().insertContent({ type: "childPage", attrs: { id: p.id, title: p.title } }).run();
    }),
    I("Links", "today", <CalendarDays size={17} />, "Today's date", fmtDate(isoDate(new Date())), "date now", chain((c) => c.insertContent([dateNode(isoDate(new Date())), { type: "text", text: " " }]))),
  ];
}

export const Slash = Extension.create<{ deps: EditorDeps }>({
  name: "slash",
  addOptions() { return { deps: null as unknown as EditorDeps }; },
  addProseMirrorPlugins() {
    const items = slashItems(this.options.deps);
    return [Suggestion<SItem, SItem>({
      editor: this.editor, char: "/", pluginKey: new PluginKey("slash"), allowedPrefixes: null, allowSpaces: true,
      items: ({ query }) => {
        const q = query.toLowerCase().trim();
        // Your saved prompts (Settings > Routines & saved prompts) run on this page in the assistant's chat.
        const mine = savedPromptsNow().map((p) => ({ group: "Saved prompts", key: `sp-${p.id}`, icon: <Sparkles size={17} />, title: `/${p.name}`, subtitle: p.text.slice(0, 60), keywords: `${p.name} saved prompt ${agentName()}`,
          run: (e: Editor, r: Range) => { e.chain().focus().deleteRange(r).run(); window.dispatchEvent(new CustomEvent("seaglass:agent-open")); setTimeout(() => window.dispatchEvent(new CustomEvent("seaglass:agent-ask", { detail: `/${p.name}` })), 150); } }) as SItem);
        // writing by hand is for the iPad (device.ts); the iPhone and the computer type
        const ink = isInkDevice();
        const found = [...items, ...mine].filter((i) => (ink || !(i.key === "handwriting" || i.key === "fmt-cornell-ink")) && (!q || `${i.title} ${i.keywords}`.toLowerCase().includes(q)));
        // an exact name comes first, then what starts with what the user typed, then the rest in the menu's own order ("/link" gives
        // Link, then Linked view and Link to page, and Web bookmark, which only mentions links, last)
        const rank = (i: { title: string }) => { const t = i.title.toLowerCase(); return t === q ? 0 : t.startsWith(q) ? 1 : 2; };
        return (q ? [...found].sort((x, y) => rank(x) - rank(y)) : found).slice(0, 40); // (sort is stable)
      },
      command: ({ editor, range, props }) => { void props.run(editor, range); },
      render: suggestionRender,
    })];
  },
});

export function mentionItems(deps: EditorDeps, query: string): SItem[] {
  const q = query.toLowerCase().trim();
  const insert = (attrs: { id: string; label: string }): SItem["run"] => (e, r) => {
    e.chain().focus().insertContentAt(r, [{ type: "mention", attrs }, { type: "text", text: " " }]).run();
  };
  const dates: SItem[] = [["today", 0], ["tomorrow", 1], ["yesterday", -1], ["next week", 7]]
    .filter(([n]) => !q || String(n).includes(q))
    .map(([n, d]) => { const iso = addDays(d as number); return { key: `d-${n}`, group: "Dates", icon: <CalendarDays size={17} />, title: String(n)[0].toUpperCase() + String(n).slice(1), subtitle: fmtDate(iso), run: insert({ id: `date:${iso}`, label: fmtDate(iso) }) }; });
  const typed = /^\d{4}-\d{2}-\d{2}$/.test(q) ? [{ key: "d-typed", group: "Dates", icon: <CalendarDays size={17} />, title: fmtDate(q), run: insert({ id: `date:${q}`, label: fmtDate(q) }) } as SItem] : [];
  const pages: SItem[] = deps.tree()
    .filter((n) => !n.is_template && n.id !== deps.noteId() && (!q || (n.title || "untitled").toLowerCase().includes(q)))
    .slice(0, 8)
    .map((n) => ({ key: n.id, group: "Pages", icon: <PageIcon icon={n.icon} kind={n.kind} size={17} />, title: n.title || "New page", run: insert({ id: n.id, label: n.title || "New page" }) }));
  const create: SItem[] = query.trim() ? [{
    key: "create", group: "New", icon: <Plus size={17} />, title: `New page "${query.trim()}"`, subtitle: "Create and link",
    run: async (e, r) => { const p = await deps.createPage(query.trim(), null); insert({ id: p.id, label: p.title })(e, r); },
  }] : [];
  return [...typed, ...pages, ...dates, ...create];
}

/** Keeps a note format's mark (data-format, editor/formats.ts) on table cells and lists, so notion.css can draw the
 *  Cornell sheet, the I. / A. / 1. outline and the comparison chart. */
const FormatAttr = Extension.create({
  name: "formatAttr",
  addGlobalAttributes() {
    return [{ types: ["tableHeader", "tableCell", "orderedList"], attributes: { format: {
      default: null,
      parseHTML: (el: HTMLElement) => el.getAttribute("data-format"),
      renderHTML: (a: { format?: string | null }) => (a.format ? { "data-format": a.format } : {}),
    } } }];
  },
});

export function buildExtensions(deps: EditorDeps) {
  return [
    WeakSpots, CommentMarks, InkTodo,
    StarterKit.configure({ codeBlock: false, link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" } } }),
    CodeBlockLowlight.configure({ lowlight }),
    TaskList, TaskItem.configure({ nested: true }),
    Table.configure({ resizable: true }), TableRow, TableHeader, TableCell, FormatAttr,
    // a handwritten drawing is an image with its strokes file in data-drawing (handwriting/ink.ts); tapping it opens it again
    Image.extend({ addAttributes() { return { ...this.parent?.(), drawing: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute("data-drawing"), renderHTML: (a: { drawing?: string | null }) => (a.drawing ? { "data-drawing": a.drawing } : {}) } }; } }).configure({ allowBase64: false }),
    Youtube.configure({ nocookie: true, controls: true }),
    Highlight.configure({ multicolor: true }), TextStyle, Color,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Typography, Subscript, Superscript,
    ToggleDetails.configure({ persist: true }), DetailsSummary, DetailsContent,
    BlockMath.configure({ katexOptions: { throwOnError: false }, onClick: (node, pos) => {
      void deps.ask("LaTeX", node.attrs.latex).then((latex) => { if (latex !== null) editorRef.current?.chain().focus().updateBlockMath({ latex, pos }).run(); });
    } }),
    InlineMath.configure({ katexOptions: { throwOnError: false }, onClick: (node, pos) => {
      void deps.ask("LaTeX", node.attrs.latex).then((latex) => { if (latex !== null) editorRef.current?.chain().focus().updateInlineMath({ latex, pos }).run(); });
    } }),
    Callout, Columns, Column, Bookmark, ChildPage, Toc, FileBlock, DbView,
    UniqueID.configure({ types: ["paragraph", "heading", "blockquote", "codeBlock", "callout", "details", "table", "bulletList", "orderedList", "taskList", "image", "bookmark", "columns", "toc", "fileBlock"] }),
    Mention.configure({
      HTMLAttributes: { class: "mention" },
      // Notion shows page links as just the title; dates keep their "@".
      renderText: ({ node }) => (String(node.attrs.id ?? "").startsWith("date:") ? `@${node.attrs.label}` : String(node.attrs.label ?? "")),
      renderHTML: ({ options, node }) => ["span", mergeAttributes({ "data-type": "mention" }, options.HTMLAttributes), String(node.attrs.id ?? "").startsWith("date:") ? `@${node.attrs.label}` : String(node.attrs.label ?? "")],
      suggestion: {
        char: "@", pluginKey: new PluginKey("mention"), allowedPrefixes: null, allowSpaces: true,
        items: ({ query }: { query: string }) => mentionItems(deps, query),
        command: ({ editor, range, props }: { editor: Editor; range: Range; props: SItem }) => { void props.run(editor, range); },
        render: suggestionRender,
      } as never,
    }),
    Placeholder.configure({
      placeholder: ({ node }) => (node.type.name === "heading" ? `Heading ${node.attrs.level}` : "Write something, or press '/' for commands…"),
    }),
    Slash.configure({ deps }),
    NotionKeys.configure({ deps }),
  ];
}

// The math click handlers need the live editor; Editor.tsx fills this in.
export const editorRef: { current: Editor | null } = { current: null };
