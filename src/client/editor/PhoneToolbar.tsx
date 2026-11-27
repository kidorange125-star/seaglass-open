// The formatting bar that sits on top of the on-screen keyboard while you write on a phone or tablet, like
// Notion's app: insert a block, heading, checklist, lists, bold/italic, indent, mention, undo/redo, done.
// Buttons never take focus (pointerdown is cancelled), so the keyboard stays open.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useEditorState, type Editor as TipEditor } from "@tiptap/react";
import { AskJeffMenu } from "../components/AiTools";
import { AtSign, Bold, ChevronDown, Heading2, IndentDecrease, IndentIncrease, Italic, List, ListChecks, ListOrdered, PenLine, Plus, Redo2, Undo2 } from "lucide-react";
import { isInkDevice } from "../device";

const BAR = 46;

export function PhoneToolbar({ editor, noteId }: { editor: TipEditor; noteId?: string }) {
  const touch = useMemo(() => typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches, []);
  const [focused, setFocused] = useState(false);
  const [top, setTop] = useState<number | null>(null);

  useEffect(() => {
    const on = () => setFocused(true);
    const off = () => setTimeout(() => setFocused(editor.isFocused), 120);
    editor.on("focus", on); editor.on("blur", off);
    return () => { editor.off("focus", on); editor.off("blur", off); };
  }, [editor]);

  // Sit right above the keyboard: the visual viewport is what's left of the screen once it's open.
  useEffect(() => {
    if (!focused) return;
    const vv = window.visualViewport;
    const place = () => setTop(vv ? vv.offsetTop + vv.height - BAR : innerHeight - BAR);
    place();
    vv?.addEventListener("resize", place); vv?.addEventListener("scroll", place);
    return () => { vv?.removeEventListener("resize", place); vv?.removeEventListener("scroll", place); };
  }, [focused]);

  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"), italic: e.isActive("italic"), h: e.isActive("heading"), task: e.isActive("taskList"),
      bullet: e.isActive("bulletList"), ordered: e.isActive("orderedList"), inList: e.isActive("listItem") || e.isActive("taskItem"),
      undo: e.can().undo(), redo: e.can().redo(), selected: !e.state.selection.empty,
    }),
  });

  if (!touch || !focused || !editor.isEditable) return null;
  const item = () => (editor.isActive("taskItem") ? "taskItem" : "listItem");
  const B = ({ label, on, off, run, children }: { label: string; on?: boolean; off?: boolean; run: () => void; children: ReactNode }) => (
    <button type="button" aria-label={label} title={label} className={on ? "on" : ""} disabled={off}
      onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={run}>{children}</button>
  );

  return (
    <div className="phone-tb" role="toolbar" aria-label="Formatting" style={{ top: top ?? undefined }}>
      <div className="phone-tb-scroll">
        {st.selected && <AskJeffMenu editor={editor} noteId={noteId} compact />}
        <B label="Insert a block" run={() => editor.chain().focus().insertContent("/").run()}><Plus size={21} /></B>
        <B label="Heading" on={st.h} run={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={21} /></B>
        <B label="To-do list" on={st.task} run={() => editor.chain().focus().toggleTaskList().run()}><ListChecks size={21} /></B>
        <B label="Bulleted list" on={st.bullet} run={() => editor.chain().focus().toggleBulletList().run()}><List size={21} /></B>
        <B label="Numbered list" on={st.ordered} run={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={21} /></B>
        <B label="Bold" on={st.bold} run={() => editor.chain().focus().toggleBold().run()}><Bold size={20} /></B>
        <B label="Italic" on={st.italic} run={() => editor.chain().focus().toggleItalic().run()}><Italic size={20} /></B>
        <B label="Indent" off={!st.inList} run={() => editor.chain().focus().sinkListItem(item()).run()}><IndentIncrease size={21} /></B>
        <B label="Outdent" off={!st.inList} run={() => editor.chain().focus().liftListItem(item()).run()}><IndentDecrease size={21} /></B>
        {isInkDevice() && <B label="Handwriting" run={() => dispatchEvent(new CustomEvent("seaglass:ink"))}><PenLine size={20} /></B>}
        <B label="Mention a page" run={() => editor.chain().focus().insertContent("@").run()}><AtSign size={20} /></B>
        <B label="Undo" off={!st.undo} run={() => editor.chain().focus().undo().run()}><Undo2 size={20} /></B>
        <B label="Redo" off={!st.redo} run={() => editor.chain().focus().redo().run()}><Redo2 size={20} /></B>
      </div>
      <B label="Done: hide the keyboard" run={() => { editor.commands.blur(); (document.activeElement as HTMLElement | null)?.blur(); }}><ChevronDown size={22} /></B>
    </div>
  );
}
