import { forwardRef, useEffect, useImperativeHandle, useState, type ReactNode } from "react";
import { ReactRenderer, type Editor } from "@tiptap/react";
import type { Range } from "@tiptap/core";
import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";

export interface SItem {
  key: string; title: string; subtitle?: string; icon?: ReactNode; group?: string; keywords?: string;
  run: (editor: Editor, range: Range) => void | Promise<void>;
}
interface Handle { onKeyDown: (p: SuggestionKeyDownProps) => boolean }

export const SuggestionList = forwardRef<Handle, SuggestionProps<SItem, SItem>>(function SuggestionList({ items, command }, ref) {
  const [sel, setSel] = useState(0);
  useEffect(() => setSel(0), [items]);
  useEffect(() => { document.querySelector(".suggest-pop .on")?.scrollIntoView({ block: "nearest" }); }, [sel]);
  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (!items.length) return false;
      if (event.key === "ArrowDown") { setSel((s) => (s + 1) % items.length); return true; }
      if (event.key === "ArrowUp") { setSel((s) => (s - 1 + items.length) % items.length); return true; }
      if (event.key === "Enter" || event.key === "Tab") { command(items[sel]); return true; }
      return false;
    },
  }));
  if (!items.length) return <div className="suggest-empty">No results</div>;
  let lastGroup = "";
  return (
    <div className="suggest-list">
      {items.map((it, i) => {
        const head = it.group && it.group !== lastGroup ? <div className="suggest-group">{it.group}</div> : null;
        lastGroup = it.group ?? lastGroup;
        return (
          <div key={it.key}>
            {head}
            <button className={i === sel ? "on" : ""} onMouseEnter={() => setSel(i)} onMouseDown={(e) => { e.preventDefault(); command(it); }}>
              <span className="si">{it.icon}</span>
              <span className="st"><b>{it.title}</b>{it.subtitle && <small>{it.subtitle}</small>}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
});

// Floating popup shared by the "/" and "@" menus. Positioned at the caret; flips above when near the bottom.
export function suggestionRender() {
  let comp: ReactRenderer<Handle, SuggestionProps<SItem, SItem>> | null = null;
  const place = (p: SuggestionProps<SItem, SItem>) => {
    const r = p.clientRect?.();
    if (!r || !comp) return;
    const el = comp.element as HTMLElement;
    el.className = "suggest-pop";
    el.style.left = `${Math.max(8, Math.min(r.left, innerWidth - 328))}px`;
    const h = Math.min(340, el.offsetHeight || 340);
    el.style.top = `${r.bottom + 8 + h > innerHeight ? Math.max(8, r.top - h - 8) : r.bottom + 8}px`;
  };
  const close = () => { comp?.element.remove(); comp?.destroy(); comp = null; };
  return {
    onStart: (p: SuggestionProps<SItem, SItem>) => {
      comp = new ReactRenderer(SuggestionList, { props: p, editor: p.editor });
      document.body.appendChild(comp.element);
      place(p);
    },
    onUpdate: (p: SuggestionProps<SItem, SItem>) => { comp?.updateProps(p); place(p); },
    onKeyDown: (p: SuggestionKeyDownProps) => {
      if (p.event.key === "Escape") { close(); return true; }
      return comp?.ref?.onKeyDown(p) ?? false;
    },
    onExit: close,
  };
}
