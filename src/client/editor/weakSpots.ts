// The weak-spot highlight in the editor (#14): a decoration on each block that holds an answer the user keeps missing, with a small
// "missed 3 times" label (CSS ::after from data-weak). Decorations only: nothing is written to the page, no history entry.
// Editor.tsx fetches the spots and sends them in with setWeakSpots; study/weak.ts finds the blocks.
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { findSpots, type Block, type Term } from "../study/weak";

type St = { terms: Term[]; deco: DecorationSet };
export const weakKey = new PluginKey<St>("weakSpots");

function build(doc: PMNode, terms: Term[]) {
  if (!terms.length) return DecorationSet.empty;
  const blocks: Block[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) { blocks.push({ pos, size: node.nodeSize, text: node.textContent }); return false; }
    return true;
  });
  return DecorationSet.create(doc, findSpots(blocks, terms).map((f) => Decoration.node(f.pos, f.pos + f.size, { class: "weak-spot", "data-weak": f.label, title: f.title })));
}

export const WeakSpots = Extension.create({
  name: "weakSpots",
  addProseMirrorPlugins() {
    return [new Plugin<St>({
      key: weakKey,
      state: {
        init: () => ({ terms: [], deco: DecorationSet.empty }),
        apply(tr, v, _old, state: EditorState) {
          const terms = tr.getMeta(weakKey) as Term[] | undefined;
          if (terms) return { terms, deco: build(state.doc, terms) };
          return tr.docChanged ? { terms: v.terms, deco: build(state.doc, v.terms) } : v;
        },
      },
      props: { decorations: (state) => weakKey.getState(state)?.deco },
    })];
  },
});

export function setWeakSpots(view: EditorView, terms: Term[]) {
  view.dispatch(view.state.tr.setMeta(weakKey, terms).setMeta("addToHistory", false));
}
