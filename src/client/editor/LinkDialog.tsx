// The Link dialog: the words that show, and the address they open. From the selection toolbar's Link button, Ctrl+K, the
// / menu's "Link" and the link card. It works on a link already there (change its words or address, or remove it), on
// selected words (make them a link), or with nothing selected (insert a new link). Fired with `seaglass:link`.
import { useEffect, useRef, useState } from "react";
import { getMarkRange } from "@tiptap/core";
import type { Editor } from "@tiptap/react";
import { normalizeHref } from "./links";

type MarkJson = { type: string; attrs?: Record<string, unknown> };
interface Target { from: number; to: number; text: string; href: string; existing: boolean; marks: { toJSON(): MarkJson; type: { name: string } }[] }

/** What the dialog is about: the link under the cursor, else the selected words, else a spot to insert at. */
function targetOf(editor: Editor): Target {
  const { state } = editor, { selection, doc } = state, linkType = state.schema.marks.link;
  const existing = editor.isActive("link");
  let from = selection.from, to = selection.to;
  if (existing) { const r = getMarkRange(selection.$from, linkType); if (r) { from = r.from; to = r.to; } }
  const text = from === to ? "" : doc.textBetween(from, to, " ");
  let marks: Target["marks"] = [];
  if (from !== to) doc.nodesBetween(from, to, (n) => { if (n.isText && !marks.length) { marks = [...n.marks]; return false; } return true; });
  const href = existing ? String(editor.getAttributes("link").href ?? "") : /^https?:\/\/\S+$/i.test(text) ? text : "";
  return { from, to, text, href, existing, marks };
}

export function LinkDialog({ editor }: { editor: Editor }) {
  const [t, setT] = useState<Target | null>(null);
  const [words, setWords] = useState(""), [href, setHref] = useState(""), [err, setErr] = useState("");
  const wordsRef = useRef<HTMLInputElement>(null), hrefRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const open = () => {
      if (!editor.isEditable) return;
      const x = targetOf(editor);
      setT(x); setWords(x.text); setHref(x.href); setErr("");
      // with words already chosen the address is what's missing; with nothing, start with the words
      setTimeout(() => { const el = x.text ? hrefRef.current : wordsRef.current; el?.focus(); el?.select(); }, 30);
    };
    addEventListener("seaglass:link", open);
    return () => removeEventListener("seaglass:link", open);
  }, [editor]);

  if (!t) return null;
  const close = () => { setT(null); editor.chain().focus().run(); };
  const remove = () => { editor.chain().focus().setTextSelection({ from: t.from, to: t.to }).unsetLink().run(); setT(null); };
  const save = () => {
    const addr = normalizeHref(href);
    if (addr === null) { setErr("That doesn't look like a web address. Try https://example.com"); hrefRef.current?.focus(); return; }
    if (!addr) { if (t.existing) { remove(); return; } setErr("Paste or type the address the link should open"); hrefRef.current?.focus(); return; }
    const shown = words.trim() || (t.text ? t.text : href.trim());
    const link = { type: "link", attrs: { href: addr } };
    if (t.from !== t.to && shown === t.text) {
      // same words: only the address changes (everything else about them, like bold, stays)
      editor.chain().focus().setTextSelection({ from: t.from, to: t.to }).setLink({ href: addr }).run();
    } else {
      // new words: they replace the old ones, keeping the old ones' bold, italic and so on
      const keep = t.marks.filter((m) => m.type.name !== "link").map((m) => m.toJSON());
      editor.chain().focus().insertContentAt({ from: t.from, to: t.to }, { type: "text", text: shown, marks: [...keep, link] }).run();
    }
    setT(null);
  };

  return (
    <div className="modal-back" onMouseDown={close}>
      <form className="modal link-dialog" role="dialog" aria-label={t.existing ? "Edit link" : "Link"} onMouseDown={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); save(); }}
        onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } }}>
        <label htmlFor="link-words">Words to show</label>
        <input id="link-words" ref={wordsRef} value={words} placeholder="My lab report" onChange={(e) => setWords(e.target.value)} autoComplete="off" />
        <label htmlFor="link-href">Link</label>
        <input id="link-href" ref={hrefRef} value={href} placeholder="https://example.com" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(e) => { setHref(e.target.value); setErr(""); }} autoComplete="off" />
        {err && <p className="when-err" role="alert">{err}</p>}
        <div className="row end">
          {t.existing && <button type="button" className="link-remove" onClick={remove}>Remove link</button>}
          <span className="link-gap" />
          <button type="button" onClick={close}>Cancel</button>
          <button className="primary">{t.existing ? "Save" : "Add link"}</button>
        </div>
      </form>
    </div>
  );
}
