// Text typed into a handwritten page away from the iPad (device.ts): on their iPhone or computer, the user can still add to a
// page with handwriting, as normal text. Each paragraph typed there is marked (data-ink-todo), and on the iPad it shows
// outlined with "Write this by hand": a reminder to write it in with the Apple Pencil. Tapping that opens the drawing
// above it (or a new one in its place) with the words shown at the top; on Done the typed paragraph goes. The ×
// keeps it as typed text and drops the outline. Handled in Editor.tsx (seaglass:ink-todo / seaglass:ink-todo-keep).
import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { ReplaceStep } from "@tiptap/pm/transform";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { isInkDevice } from "../device";

const key = new PluginKey("inkTodo");
/** Set on a transaction that adds text that isn't typing (a note format, text read from handwriting). */
export const SKIP_INK_TODO = "inkTodoSkip";

export const hasDrawing = (doc: PMNode) => { let found = false; doc.descendants((n) => { if (found) return false; if (n.type.name === "image" && n.attrs.drawing) found = true; return !found; }); return found; };

/** The paragraphs a transaction typed text into (insertions with text, not attribute changes or deletions). */
function typedInto(trs: readonly Transaction[], doc: PMNode) {
  const ranges: [number, number][] = [];
  for (const tr of trs) {
    if (!tr.docChanged || tr.getMeta(SKIP_INK_TODO) || tr.getMeta("uniqueID")) continue;
    tr.steps.forEach((step, i) => {
      if (!(step instanceof ReplaceStep)) return;
      const slice = step.slice;
      if (!slice.content.size || !slice.content.textBetween(0, slice.content.size, " ", " ").trim()) return;
      // where it landed in the final document
      const rest = tr.mapping.slice(i + 1);
      const from = rest.map(step.from, -1), to = rest.map((step as unknown as { from: number }).from + slice.size, 1);
      ranges.push([from, to]);
    });
  }
  const out: number[] = [];
  for (const [from, to] of ranges) {
    doc.nodesBetween(Math.max(0, from), Math.min(doc.content.size, to), (n, pos) => {
      if (n.isTextblock && (n.type.name === "paragraph" || n.type.name === "heading")) { if (n.textContent.trim() && !n.attrs.inkTodo) out.push(pos); return false; }
      return true;
    });
  }
  return [...new Set(out)];
}

export const InkTodo = Extension.create({
  name: "inkTodo",
  addGlobalAttributes() {
    return [{ types: ["paragraph", "heading"], attributes: { inkTodo: {
      default: null,
      parseHTML: (el: HTMLElement) => (el.hasAttribute("data-ink-todo") ? "1" : null),
      renderHTML: (a: { inkTodo?: string | null }) => (a.inkTodo ? { "data-ink-todo": "1" } : {}),
    } } }];
  },
  addProseMirrorPlugins() {
    const tablet = isInkDevice();
    return [new Plugin({
      key,
      // away from the iPad: mark what's typed into a page with handwriting
      appendTransaction: (trs, _old, state) => {
        if (tablet || !hasDrawing(state.doc)) return null;
        const at = typedInto(trs, state.doc);
        if (!at.length) return null;
        const tr = state.tr;
        for (const pos of at) { const n = tr.doc.nodeAt(pos); if (n) tr.setNodeMarkup(pos, undefined, { ...n.attrs, inkTodo: "1" }); }
        return tr.setMeta("addToHistory", false);
      },
      // on the iPad: outline them, with "Write this by hand" and keep-as-typed
      props: {
        decorations: (state) => {
          if (!tablet) return null;
          const decos: Decoration[] = [];
          state.doc.descendants((n, pos) => {
            if (!n.isTextblock || !n.attrs.inkTodo) return true;
            decos.push(Decoration.node(pos, pos + n.nodeSize, { class: "ink-todo" }));
            decos.push(Decoration.widget(pos + 1, () => chip(pos), { side: -1, key: `ink-todo-${pos}`, ignoreSelection: true }));
            return false;
          });
          return decos.length ? DecorationSet.create(state.doc, decos) : null;
        },
      },
    })];
  },
});

function chip(pos: number) {
  const box = document.createElement("span");
  box.className = "ink-todo-chip"; box.contentEditable = "false";
  const write = document.createElement("button");
  write.type = "button"; write.className = "ink-todo-write"; write.textContent = "✎ Write this by hand";
  const keep = document.createElement("button");
  keep.type = "button"; keep.className = "ink-todo-keep"; keep.textContent = "×"; keep.title = "Keep it typed"; keep.setAttribute("aria-label", "Keep it typed");
  for (const [b, ev] of [[write, "seaglass:ink-todo"], [keep, "seaglass:ink-todo-keep"]] as const) {
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); dispatchEvent(new CustomEvent(ev, { detail: { pos } })); });
  }
  box.appendChild(write); box.appendChild(keep);
  return box;
}
