import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useEffect, useState } from "react";
import { useStore } from "../store";
import { PageIcon } from "../icons";
import { agentName } from "../persona";
import { LinkedDatabase } from "../db/LinkedDatabase";

// Callout: a tinted box with an emoji. Pure CSS (::before reads data-emoji), so it also works in shared pages.
export const Callout = Node.create({
  name: "callout", group: "block", content: "block+", defining: true,
  addAttributes() {
    return {
      emoji: { default: "💡", parseHTML: (el) => el.getAttribute("data-emoji") || "💡", renderHTML: (a) => ({ "data-emoji": a.emoji }) },
      color: { default: "gray", parseHTML: (el) => el.getAttribute("data-color") || "gray", renderHTML: (a) => ({ "data-color": a.color }) },
    };
  },
  parseHTML() { return [{ tag: 'div[data-type="callout"]' }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes({ "data-type": "callout" }, HTMLAttributes), 0]; },
});

export const Columns = Node.create({
  name: "columns", group: "block", content: "column{2,4}", isolating: true,
  parseHTML() { return [{ tag: 'div[data-type="columns"]' }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes({ "data-type": "columns" }, HTMLAttributes), 0]; },
});
export const Column = Node.create({
  name: "column", content: "block+", isolating: true,
  parseHTML() { return [{ tag: 'div[data-type="column"]' }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes({ "data-type": "column" }, HTMLAttributes), 0]; },
});

// Bookmark: a link card. Stored as plain data-* + an anchor so it degrades gracefully when exported.
const attr = (name: string) => ({
  default: "", parseHTML: (el: HTMLElement) => el.getAttribute(`data-${name}`) ?? "", renderHTML: (a: Record<string, string>) => ({ [`data-${name}`]: a[name] }),
});
export const Bookmark = Node.create({
  name: "bookmark", group: "block", atom: true, selectable: true, draggable: true,
  addAttributes() { return { url: attr("url"), title: attr("title"), description: attr("description"), image: attr("image"), host: attr("host") }; },
  parseHTML() { return [{ tag: 'div[data-type="bookmark"]' }]; },
  renderHTML({ node, HTMLAttributes }) {
    const a = node.attrs as Record<string, string>;
    return ["div", mergeAttributes({ "data-type": "bookmark" }, HTMLAttributes),
      ["a", { href: a.url, target: "_blank", rel: "noopener noreferrer" }, ["strong", {}, a.title || a.url], ["span", {}, a.description], ["em", {}, a.host]]];
  },
});

// Child page block: a live link to a sub-page (title and icon come from the tree).
function ChildPageView({ node }: NodeViewProps) {
  const { byId, go } = useStore();
  const n = byId.get(node.attrs.id);
  return (
    <NodeViewWrapper className="child-page" data-type="child-page" contentEditable={false}>
      <a href={`#/p/${node.attrs.id}`} onClick={(e) => { e.preventDefault(); go(`/p/${node.attrs.id}`); }}>
        <span className="ico"><PageIcon icon={n?.icon} kind={n?.kind} size={18} /></span>
        <span>{n ? n.title || "New page" : node.attrs.title || "Page"}</span>
      </a>
    </NodeViewWrapper>
  );
}
export const ChildPage = Node.create({
  name: "childPage", group: "block", atom: true, selectable: true, draggable: true,
  addAttributes() { return { id: attr("id"), title: attr("title") }; },
  parseHTML() { return [{ tag: 'div[data-type="child-page"]' }]; },
  renderHTML({ node, HTMLAttributes }) { return ["div", mergeAttributes({ "data-type": "child-page" }, HTMLAttributes), String(node.attrs.title || "Page")]; },
  addNodeView() { return ReactNodeViewRenderer(ChildPageView); },
});

// Table of contents: rebuilt from the headings on every edit.
function TocView({ editor }: NodeViewProps) {
  const [items, setItems] = useState<{ level: number; text: string; pos: number }[]>([]);
  useEffect(() => {
    const scan = () => {
      const out: { level: number; text: string; pos: number }[] = [];
      editor.state.doc.descendants((n, pos) => { if (n.type.name === "heading") out.push({ level: n.attrs.level, text: n.textContent, pos }); });
      setItems(out);
    };
    scan(); editor.on("update", scan); return () => { editor.off("update", scan); };
  }, [editor]);
  return (
    <NodeViewWrapper className="toc" data-type="toc" contentEditable={false}>
      {items.length ? items.map((h, i) => (
        <a key={i} style={{ paddingLeft: (h.level - 1) * 14 }} onClick={() => { editor.chain().focus(h.pos + 1).scrollIntoView().run(); }}>{h.text || "New page"}</a>
      )) : <span className="muted">Add headings to build a table of contents</span>}
    </NodeViewWrapper>
  );
}
export const Toc = Node.create({
  name: "toc", group: "block", atom: true, selectable: true, draggable: true,
  parseHTML() { return [{ tag: 'div[data-type="toc"]' }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes({ "data-type": "toc" }, HTMLAttributes)]; },
  addNodeView() { return ReactNodeViewRenderer(TocView); },
});

// A file in a page (#17): a PDF handout, worksheet or slides, or a recording. Stored as data-* on a div with a link inside,
// so it degrades to a plain link anywhere else. PDFs can be previewed in place (not on phones, whose browsers show only the
// first page in a frame), and the assistant can read them (worker files.ts, read_file).
const fileSize = (n: number) => !n ? "" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
const fileKind = (mime: string, name: string) => mime === "application/pdf" || /\.pdf$/i.test(name) ? "PDF" : mime.startsWith("audio/") ? "Audio" : mime.startsWith("video/") ? "Video" : "File";
/** Only our own uploads (/files/<id>/<name>): the block's address comes from stored HTML, which agents and imports write too. */
export const isFileSrc = (s: unknown): s is string => typeof s === "string" && /^\/files\/[\w-]+\/[\w.-]+$/.test(s);
function FileView({ node, selected }: NodeViewProps) {
  const raw = node.attrs as { src: string; name: string; size: string; mime: string };
  const a = { ...raw, src: isFileSrc(raw.src) ? raw.src : "" };
  const kind = fileKind(a.mime, a.name);
  const [open, setOpen] = useState(false);
  const wide = typeof matchMedia === "function" && matchMedia("(min-width: 860px)").matches;
  const ask = () => {
    dispatchEvent(new CustomEvent("seaglass:agent-open"));
    setTimeout(() => dispatchEvent(new CustomEvent("seaglass:agent-ask", { detail: `Read the ${kind === "PDF" ? "PDF" : "file"} “${a.name}” on this page and give me a short summary of what's in it.` })), 150);
  };
  return (
    <NodeViewWrapper className={`file-block${selected ? " sel" : ""}`} data-type="file" contentEditable={false}>
      <div className="fb-row">
        <span className="fb-ico" aria-hidden>{kind === "PDF" ? "PDF" : kind === "Audio" ? "♪" : kind === "Video" ? "▶" : "📄"}</span>
        <a className="fb-name" href={a.src || undefined} target="_blank" rel="noopener noreferrer"><b>{a.name || "File"}</b><small>{a.src ? [kind, fileSize(Number(a.size))].filter(Boolean).join(", ") : "This file's address isn't one of yours, so it's not opened"}</small></a>
        {a.src && <span className="fb-actions">
          {kind === "PDF" && wide && <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Hide" : "Preview"}</button>}
          {kind === "PDF" && <button type="button" onClick={ask}>Ask {agentName()}</button>}
        </span>}
      </div>
      {open && a.src && <iframe className="fb-preview" src={a.src} title={a.name} />}
      {kind === "Audio" && a.src && <audio controls preload="none" src={a.src} />}
      {kind === "Video" && a.src && <video controls preload="metadata" src={a.src} />}
    </NodeViewWrapper>
  );
}
export const FileBlock = Node.create({
  name: "fileBlock", group: "block", atom: true, selectable: true, draggable: true,
  addAttributes() { return { src: attr("src"), name: attr("name"), size: attr("size"), mime: attr("mime") }; },
  parseHTML() { return [{ tag: 'div[data-type="file"]' }]; },
  renderHTML({ node, HTMLAttributes }) {
    return ["div", mergeAttributes({ "data-type": "file" }, HTMLAttributes), ["a", { href: node.attrs.src, target: "_blank", rel: "noopener noreferrer" }, String(node.attrs.name || "File")]];
  },
  addNodeView() { return ReactNodeViewRenderer(FileView); },
});

// A linked view of a database (#24): the database's rows in a view picked for this page (db/LinkedDatabase.tsx). Stored as
// data-db and data-view on a div; elsewhere it's just a link. Events inside it stay with it (it has its own inputs).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function DbViewView({ node, updateAttributes, editor }: NodeViewProps) {
  return (
    <NodeViewWrapper className="linked-db" data-type="db-view" contentEditable={false}>
      <LinkedDatabase dbId={UUID_RE.test(String(node.attrs.db)) ? String(node.attrs.db) : ""} viewId={/^[\w-]{1,40}$/.test(String(node.attrs.view)) ? String(node.attrs.view) : ""} editable={editor.isEditable}
        onPick={(id) => updateAttributes({ db: id, view: "" })} onView={(id) => { if (editor.isEditable) updateAttributes({ view: id }); }} />
    </NodeViewWrapper>
  );
}
export const DbView = Node.create({
  name: "dbView", group: "block", atom: true, selectable: true, draggable: true,
  addAttributes() { return { db: attr("db"), view: attr("view") }; },
  parseHTML() { return [{ tag: 'div[data-type="db-view"]' }]; },
  renderHTML({ node, HTMLAttributes }) { return ["div", mergeAttributes({ "data-type": "db-view" }, HTMLAttributes), ["a", { href: `#/p/${node.attrs.db}` }, "Linked database"]]; },
  addNodeView() { return ReactNodeViewRenderer(DbViewView, { stopEvent: ({ event }) => !event.type.startsWith("drag"), ignoreMutation: () => true }); },
});
