// The small editors the Study tab and the picker share: a subject (name, colour, emoji), a test (name, date, the pages it
// covers) and "add a page". Plus how a subject's mark and a test date are shown.
import { useMemo, useState } from "react";
import { api, type StudyDeck, type StudyExam, type StudySubject } from "../api";
import { useStore } from "../store";
import { PageIcon } from "../icons";
import { EmojiPicker, Popover } from "./ui";

export const COLORS = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];
const QUICK_EMOJI = ["🧬", "🧪", "➗", "📐", "🌍", "🏛️", "📖", "🎨", "💻", "🗣️", "🎵", "🏃"];
export const level = (p: number) => (p >= 80 ? "great" : p >= 50 ? "ok" : "low");

/** "Test today", "Test tomorrow", "Test in 5 days · Fri, Nov 14", or "Test was 2 days ago". */
export function examLabel(day: string, today: string) {
  const d = Math.round((Date.parse(`${day}T12:00:00`) - Date.parse(`${today}T12:00:00`)) / 864e5);
  const when = new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  if (d === 0) return { text: "Test today", soon: true, days: d };
  if (d === 1) return { text: "Test tomorrow", soon: true, days: d };
  if (d > 1) return { text: `Test in ${d} days · ${when}`, soon: d <= 7, days: d };
  return { text: `Test was ${-d === 1 ? "yesterday" : `${-d} days ago`}`, soon: false, past: true, days: d };
}

/** A subject's emoji, or its colour dot if it has none. */
export function SubjectMark({ subject, big }: { subject: Pick<StudySubject, "icon" | "color">; big?: boolean }) {
  return subject.icon ? <span className={`st-emoji ${big ? "big" : ""}`} aria-hidden="true">{subject.icon}</span> : <i className={`st-dot ${big ? "big" : ""} c-${subject.color}`} />;
}

export function SubjectEditor({ subject, hasExams, onClose, onSaved, onDeleted }: { subject?: StudySubject; hasExams?: boolean; onClose: () => void; onSaved: (x: StudySubject) => void; onDeleted?: () => void }) {
  const s = useStore();
  const [name, setName] = useState(subject?.name ?? "");
  const [color, setColor] = useState(subject?.color ?? COLORS[5]);
  const [icon, setIcon] = useState<string | null>(subject?.icon ?? null);
  const [exam, setExam] = useState(subject?.exam_date ?? "");
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const date = hasExams ? {} : { exam_date: exam || null }; // a subject with tests takes its date from them
    try { onSaved(subject ? await api.updateSubject(subject.id, { name: name.trim(), color, icon, ...date }) : await api.createSubject({ name: name.trim(), color, icon, ...date })); }
    catch (e) { s.toast((e as Error).message); setBusy(false); }
  };
  const del = async () => {
    if (!subject || !(await s.confirm(`Delete the subject “${subject.name}” and its tests? Its pages stay in Study, just without a subject.`))) return;
    await api.deleteSubject(subject.id); s.toast(`Deleted ${subject.name}`); onDeleted?.();
  };
  return (
    <Popover onClose={onClose} className="st-editor">
      <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="mp-title">{subject ? "Edit subject" : "New subject"}</div>
        <input autoFocus placeholder="Subject name, e.g. Biology" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        <div className="st-label">Colour</div>
        <div className="st-colors" role="radiogroup" aria-label="Colour">
          {COLORS.map((c) => <button type="button" key={c} role="radio" aria-checked={c === color} aria-label={c} className={`st-swatch c-${c} ${c === color ? "on" : ""}`} onClick={() => setColor(c)} />)}
        </div>
        <div className="st-label">Icon</div>
        <div className="st-emojis" role="radiogroup" aria-label="Icon">
          {QUICK_EMOJI.map((e) => <button type="button" key={e} role="radio" aria-checked={icon === e} className={icon === e ? "on" : ""} onClick={() => setIcon(icon === e ? null : e)}>{e}</button>)}
          {icon && !QUICK_EMOJI.includes(icon) && <button type="button" role="radio" aria-checked="true" className="on" onClick={() => setIcon(null)}>{icon}</button>}
          <span className="rel st-emoji-more">
            <button type="button" className="st-more" onClick={() => setMore((v) => !v)}>More</button>
            {more && <EmojiPicker onPick={setIcon} onRemove={() => setIcon(null)} onClose={() => setMore(false)} />}
          </span>
        </div>
        {!hasExams && <label className="st-date">Test date <input type="date" value={exam} onChange={(e) => setExam(e.target.value)} />{exam && <button type="button" className="ghost" onClick={() => setExam("")}>Clear</button>}</label>}
        <div className="st-editor-actions">
          {subject && <button type="button" className="danger ghost" onClick={() => void del()}>Delete</button>}
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={!name.trim() || busy}>{subject ? "Save" : "Create"}</button>
        </div>
      </form>
    </Popover>
  );
}

export function ExamEditor({ subject, exam, decks, defaultDate, firstTest, onClose, onSaved, onDeleted }: { subject: StudySubject; exam?: StudyExam; decks: StudyDeck[]; defaultDate?: string; firstTest?: boolean; onClose: () => void; onSaved: (x: StudyExam) => void; onDeleted?: () => void }) {
  const s = useStore();
  const own = useMemo(() => decks.filter((d) => d.subject_id === subject.id && !d.excluded), [decks, subject.id]);
  const [name, setName] = useState(exam?.name ?? "");
  const [date, setDate] = useState(exam?.exam_date ?? defaultDate ?? "");
  const [pages, setPages] = useState<Set<string>>(() => new Set(exam?.page_ids ?? (firstTest ? own.map((d) => d.id) : [])));
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) => setPages((p) => { const n = new Set(p); if (!n.delete(id)) n.add(id); return n; });
  const found = useMemo(() => {
    const t = q.trim().toLowerCase(), have = new Set(own.map((d) => d.id));
    return t ? s.tree.filter((n) => n.kind === "page" && !have.has(n.id) && (n.title || "").toLowerCase().includes(t)).slice(0, 6) : [];
  }, [q, s.tree, own]);
  // a page picked from outside the subject keeps its row while the search changes
  const outside = [...pages].filter((id) => !own.some((d) => d.id === id)).map((id) => s.tree.find((n) => n.id === id)).filter((n) => n && !found.some((f) => f.id === n.id));
  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const b = { name: name.trim(), exam_date: date || null, pages: [...pages] };
    try { onSaved(exam ? await api.updateExam(exam.id, b) : await api.createExam({ ...b, subject: subject.id })); }
    catch (e) { s.toast((e as Error).message); setBusy(false); }
  };
  const del = async () => {
    if (!exam || !(await s.confirm(`Delete the test “${exam.name}”? Its pages stay in ${subject.name}.`))) return;
    await api.deleteExam(exam.id); s.toast(`Deleted ${exam.name}`); onDeleted?.();
  };
  const row = (id: string, title: string, icon: string | null | undefined) => (
    <label key={id} className="st-check"><input type="checkbox" checked={pages.has(id)} onChange={() => toggle(id)} /><PageIcon icon={icon ?? null} kind="page" size={16} /><span>{title || "New page"}</span></label>
  );
  return (
    <Popover onClose={onClose} className="st-editor st-exam-editor">
      <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="mp-title">{exam ? "Edit test" : `New test in ${subject.name}`}</div>
        <input autoFocus placeholder="Test name, e.g. Unit 3 test" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        <label className="st-date">Date <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />{date && <button type="button" className="ghost" onClick={() => setDate("")}>Clear</button>}</label>
        <div className="st-label">What it covers</div>
        <div className="st-checks">
          {own.map((d) => row(d.id, d.title, d.icon))}
          {outside.map((n) => row(n!.id, n!.title, n!.icon))}
          {found.map((n) => row(n.id, n.title, n.icon))}
          {!own.length && !outside.length && !found.length && <span className="st-menu-note">Find a page below to add it</span>}
        </div>
        <input placeholder="Find another page…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find another page" />
        <div className="st-editor-actions">
          {exam && <button type="button" className="danger ghost" onClick={() => void del()}>Delete</button>}
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={!name.trim() || busy}>{exam ? "Save" : "Create"}</button>
        </div>
      </form>
    </Popover>
  );
}

export function PagePicker({ exclude, onPick, onClose }: { exclude: Set<string>; onPick: (id: string) => void; onClose: () => void }) {
  const s = useStore();
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return s.tree.filter((n) => n.kind === "page" && !exclude.has(n.id) && (!t || (n.title || "").toLowerCase().includes(t))).slice(0, 8);
  }, [s.tree, q, exclude]);
  return (
    <Popover onClose={onClose} className="st-picker">
      <input autoFocus placeholder="Find a page…" value={q} onChange={(e) => setQ(e.target.value)} />
      {list.map((n) => <button key={n.id} onClick={() => onPick(n.id)}><PageIcon icon={n.icon} kind="page" size={16} /><span className="t">{n.title || "New page"}</span></button>)}
      {!list.length && <span className="st-menu-note">No matching pages</span>}
    </Popover>
  );
}
