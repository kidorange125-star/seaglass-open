// Notion's keyboard shortcuts and markdown triggers, layered over TipTap's defaults.
// Priority is above StarterKit so these win where the two disagree (`>` is a toggle in Notion,
// Ctrl+Shift+7/8 are toggle/code, not ordered/bullet list).
import { Extension, InputRule, markInputRule, type Editor } from "@tiptap/core";
import { PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import Suggestion from "@tiptap/suggestion";
import { allowHere, suggestionRender, type SItem } from "./suggest";
import { mentionItems, type EditorDeps } from "./extensions";
import { EMOJI } from "../emoji";

// Containers whose children count as separate blocks (for duplicate / move).
const CONTAINERS = new Set(["doc", "column", "callout", "blockquote", "detailsContent"]);
const ITEMS = new Set(["listItem", "taskItem"]);

/** The block the cursor is in, the way Notion thinks of it: a list item, or a child of a container. */
export function currentBlock(state: EditorState): { node: PMNode; pos: number; depth: number } | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) if (ITEMS.has($from.node(d).type.name)) return { node: $from.node(d), pos: $from.before(d), depth: d };
  for (let d = $from.depth; d > 0; d--) if (CONTAINERS.has($from.node(d - 1).type.name)) return { node: $from.node(d), pos: $from.before(d), depth: d };
  return null;
}

function duplicateBlock(editor: Editor) {
  const b = currentBlock(editor.state);
  if (!b) return false;
  const { tr } = editor.state;
  const at = b.pos + b.node.nodeSize;
  tr.insert(at, b.node.copy(b.node.content)); // UniqueID gives the copy fresh block ids
  const offset = editor.state.selection.from - b.pos;
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(at + offset, tr.doc.content.size))));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

function moveBlock(editor: Editor, dir: -1 | 1) {
  const b = currentBlock(editor.state);
  if (!b) return false;
  const { $from } = editor.state.selection;
  const parent = $from.node(b.depth - 1);
  const i = $from.index(b.depth - 1);
  const sib = dir < 0 ? (i > 0 ? parent.child(i - 1) : null) : (i < parent.childCount - 1 ? parent.child(i + 1) : null);
  if (!sib) return true; // at the edge: swallow the key so the browser doesn't select text
  const offset = editor.state.selection.from - b.pos;
  const { tr } = editor.state;
  tr.delete(b.pos, b.pos + b.node.nodeSize);
  const start = dir < 0 ? b.pos - sib.nodeSize : b.pos + sib.nodeSize;
  tr.insert(start, b.node);
  tr.setSelection(TextSelection.near(tr.doc.resolve(start + offset)));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

function toggleAllToggles(editor: Editor) {
  const found: { pos: number; open: boolean }[] = [];
  editor.state.doc.descendants((n, pos) => { if (n.type.name === "details") found.push({ pos, open: !!n.attrs.open }); });
  if (!found.length) return false;
  const open = !found.some((f) => f.open);
  const { tr } = editor.state;
  for (const f of found) tr.setNodeAttribute(f.pos, "open", open);
  editor.view.dispatch(tr);
  return true;
}

function toggleTodo(editor: Editor) {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name === "taskItem") { editor.view.dispatch(editor.state.tr.setNodeAttribute($from.before(d), "checked", !n.attrs.checked)); return true; }
  }
  return false;
}

export const NotionKeys = Extension.create<{ deps: EditorDeps }>({
  name: "notionKeys",
  priority: 1000,
  addOptions() { return { deps: null as unknown as EditorDeps }; },

  addKeyboardShortcuts() {
    const e = this.editor;
    const turn = (fn: () => boolean) => () => fn();
    return {
      // Turn into (Ctrl+Shift+0..8), as in Notion.
      "Mod-Shift-0": turn(() => e.chain().focus().clearNodes().setParagraph().run()),
      "Mod-Shift-1": turn(() => e.chain().focus().clearNodes().setHeading({ level: 1 }).run()),
      "Mod-Shift-2": turn(() => e.chain().focus().clearNodes().setHeading({ level: 2 }).run()),
      "Mod-Shift-3": turn(() => e.chain().focus().clearNodes().setHeading({ level: 3 }).run()),
      "Mod-Shift-4": turn(() => e.chain().focus().clearNodes().toggleTaskList().run()),
      "Mod-Shift-5": turn(() => e.chain().focus().clearNodes().toggleBulletList().run()),
      "Mod-Shift-6": turn(() => e.chain().focus().clearNodes().toggleOrderedList().run()),
      "Mod-Shift-7": turn(() => e.chain().focus().clearNodes().setDetails().run()),
      "Mod-Shift-8": turn(() => e.chain().focus().clearNodes().setCodeBlock().run()),
      "Mod-d": () => duplicateBlock(e),
      "Mod-Shift-ArrowUp": () => moveBlock(e, -1),
      "Mod-Shift-ArrowDown": () => moveBlock(e, 1),
      "Mod-Enter": () => toggleTodo(e),
      "Mod-Alt-t": () => toggleAllToggles(e),
      // Ctrl+K with text selected, or the cursor in a link, opens the Link dialog (words and address); with nothing
      // selected it falls through to search.
      "Mod-k": () => {
        if (e.state.selection.empty && !e.isActive("link")) return false;
        dispatchEvent(new CustomEvent("seaglass:link"));
        return true;
      },
    };
  },

  addInputRules() {
    const { schema } = this.editor;
    const rules: InputRule[] = [];
    // `> ` makes a toggle (Notion), not a quote.
    rules.push(new InputRule({ find: /^\s*>\s$/, handler: ({ range, chain }) => { chain().deleteRange(range).setDetails().run(); } }));
    // `" ` makes a quote. Typography may already have curled the quote mark.
    rules.push(new InputRule({ find: /^\s*["“”]\s$/, handler: ({ range, chain }) => { chain().deleteRange(range).setBlockquote().run(); } }));
    // ~text~ strikethrough (Notion uses one tilde).
    if (schema.marks.strike) rules.push(markInputRule({ find: /(?:^|\s)(~(?!\s)([^~]+)(?<!\s)~)$/, type: schema.marks.strike }));
    return rules;
  },

  addProseMirrorPlugins() {
    const deps = this.options.deps;
    return [
      // [[ links a page, same menu as @.
      Suggestion<SItem, SItem>({
        editor: this.editor, char: "[[", pluginKey: new PluginKey("pagelink"), allowedPrefixes: null, allowSpaces: true, allow: allowHere(),
        items: ({ query }) => mentionItems(deps, query.replace(/\]+$/, "")).filter((i) => i.group !== "Dates"),
        command: ({ editor, range, props }) => { void props.run(editor, range); },
        render: suggestionRender,
      }),
      // :name inserts an emoji (two letters at least, so "10:30" and "note:" stay plain text).
      Suggestion<SItem, SItem>({
        editor: this.editor, char: ":", pluginKey: new PluginKey("emoji"), allowSpaces: false,
        items: ({ query }) => {
          const q = query.toLowerCase();
          if (q.length < 2 || !/^[a-z]/.test(q)) return [];
          return EMOJI.filter(([, k]) => k.split(" ").some((w) => w.startsWith(q))).slice(0, 8)
            .map(([em, k]) => ({ key: em, title: k.split(" ")[0], icon: <span className="emo">{em}</span>, run: (ed, r) => { ed.chain().focus().insertContentAt(r, em).run(); } }));
        },
        command: ({ editor, range, props }) => { void props.run(editor, range); },
        render: suggestionRender,
      }),
    ];
  },
});
