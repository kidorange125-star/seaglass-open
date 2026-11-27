// Comments on text and suggested edits in the editor (#22): the words each open comment is on are highlighted, and a
// suggestion shows its words struck through with the new text after them. Decorations only, so nothing is written to the
// page until an edit is accepted (Editor.tsx does that as an ordinary edit). Clicking a highlight opens it in the panel.
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { findQuote, OBJ, type Block, type Comment } from "../comments";

type St = { list: Comment[]; deco: DecorationSet };
export const commentKey = new PluginKey<St>("commentMarks");

/** The page's text blocks, with each inline thing that isn't text as one character (see comments.ts). */
export function blocksOf(doc: PMNode): Block[] {
  const out: Block[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = "";
    node.forEach((child) => { text += child.isText ? child.text ?? "" : OBJ.repeat(child.nodeSize); });
    out.push({ pos, text });
    return false;
  });
  return out;
}

function build(doc: PMNode, list: Comment[]) {
  const open = list.filter((c) => !c.resolved && c.anchor);
  if (!open.length) return DecorationSet.empty;
  const blocks = blocksOf(doc), decos: Decoration[] = [];
  for (const c of open) {
    const at = findQuote(blocks, c.anchor!);
    if (!at) continue;
    if (c.kind === "suggestion") {
      decos.push(Decoration.inline(at.from, at.to, { class: "sug-del", "data-cid": c.id }));
      if (c.replace_with) decos.push(Decoration.widget(at.to, () => { const s = document.createElement("span"); s.className = "sug-ins"; s.dataset.cid = c.id; s.textContent = c.replace_with; return s; }, { side: 1, key: `sug-${c.id}-${c.replace_with}` }));
    } else decos.push(Decoration.inline(at.from, at.to, { class: "cmt-hl", "data-cid": c.id }));
  }
  return DecorationSet.create(doc, decos);
}

export const CommentMarks = Extension.create({
  name: "commentMarks",
  addProseMirrorPlugins() {
    return [new Plugin<St>({
      key: commentKey,
      state: {
        init: () => ({ list: [], deco: DecorationSet.empty }),
        apply(tr, v, _old, state) {
          const list = tr.getMeta(commentKey) as Comment[] | undefined;
          if (list) return { list, deco: build(state.doc, list) };
          return tr.docChanged ? { list: v.list, deco: build(state.doc, v.list) } : v;
        },
      },
      props: {
        decorations: (state) => commentKey.getState(state)?.deco,
        handleDOMEvents: {
          click: (_view, e) => {
            const id = (e.target as HTMLElement | null)?.closest?.("[data-cid]")?.getAttribute("data-cid");
            if (id) dispatchEvent(new CustomEvent("seaglass:comment-focus", { detail: id }));
            return false;
          },
        },
      },
    })];
  },
});

export function setComments(view: EditorView, list: Comment[]) {
  view.dispatch(view.state.tr.setMeta(commentKey, list).setMeta("addToHistory", false));
}
