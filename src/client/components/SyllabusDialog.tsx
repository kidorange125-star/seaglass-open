// Snap a syllabus (#11), from the Study tab: take or choose a photo, the assistant reads the class, its tests and its
// assignments (worker syllabus.ts), the user unticks anything the user doesn't want, and one tap adds the subject, the tests and the
// assignments as tasks. Undo takes it all back.
import { useRef, useState } from "react";
import { Camera } from "lucide-react";
import { api, type SyllabusRead } from "../api";
import { useStore } from "../store";
import { JeffAvatar } from "../icons";
import { IClose } from "../ui-icons";
import { agentName } from "../persona";
import { jeffModel } from "./AiTools";
import { COLORS } from "./StudyEditors";

const day = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "No date");

export function SyllabusDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (subjectId: string) => void }) {
  const s = useStore();
  const file = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"pick" | "reading" | "review" | "adding">("pick");
  const [read, setRead] = useState<SyllabusRead | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState("blue");
  const [offT, setOffT] = useState<Set<number>>(new Set()), [offA, setOffA] = useState<Set<number>>(new Set());
  const [err, setErr] = useState("");
  const flip = (set: Set<number>, k: number) => { const n = new Set(set); if (!n.delete(k)) n.add(k); return n; };

  const go = async (f?: File) => {
    if (!f) return;
    setStep("reading"); setErr("");
    try { const r = await api.syllabusRead(f, jeffModel()); setRead(r); setName(r.subject.name); setOffT(new Set()); setOffA(new Set()); setStep("review"); }
    catch (e) { setErr((e as Error).message); setStep("pick"); }
  };
  const tests = read?.tests.filter((_, k) => !offT.has(k)) ?? [], tasks = read?.assignments.filter((_, k) => !offA.has(k)) ?? [];
  const add = async () => {
    if (!read) return;
    setStep("adding"); setErr("");
    try {
      const r = await api.syllabusAdd({ subject: { ...read.subject, name: name.trim() || read.subject.name }, tests, assignments: tasks, color });
      dispatchEvent(new CustomEvent("seaglass:agent-changed")); void s.refreshTree();
      s.toast(`Added ${name}: ${tests.length} test${tests.length === 1 ? "" : "s"}, ${r.tasks} task${r.tasks === 1 ? "" : "s"}`, { label: "Undo", run: () => void api.syllabusUndo(r).then(() => { dispatchEvent(new CustomEvent("seaglass:agent-changed")); void s.refreshTree(); }) });
      onAdded(r.subject_id);
    } catch (e) { setErr((e as Error).message); setStep("review"); }
  };

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal syllabus" role="dialog" aria-label="Add from a syllabus" onMouseDown={(e) => e.stopPropagation()}>
        <div className="memory-head">
          <span className="notify-ico"><Camera size={20} /></span>
          <div><b>Add from a syllabus</b><small>A photo of a syllabus or class calendar becomes the subject, its tests and its assignments. You check it before anything is added.</small></div>
          <button className="ghost icon-btn" aria-label="Close" onClick={onClose}><IClose size={18} /></button>
        </div>
        <input ref={file} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void go(e.target.files?.[0]); e.target.value = ""; }} />
        {step === "pick" && <div className="syl-pick"><button className="primary" onClick={() => file.current?.click()}><Camera size={16} /> Take or choose a photo</button>{err && <p className="when-err">{err}</p>}</div>}
        {step === "reading" && <div className="syl-pick"><JeffAvatar size={44} mode="think" /><b>{agentName()} is reading it…</b></div>}
        {(step === "review" || step === "adding") && read && (
          <div className="syl-review">
            <label className="syl-name">Subject <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Subject name" /></label>
            <div className="st-colors" role="radiogroup" aria-label="Colour">{COLORS.map((c) => <button type="button" key={c} role="radio" aria-checked={c === color} aria-label={c} className={`st-swatch c-${c} ${c === color ? "on" : ""}`} onClick={() => setColor(c)} />)}</div>
            <h4>Tests <small>{tests.length} of {read.tests.length}</small></h4>
            {read.tests.length ? <ul>{read.tests.map((t, k) => <li key={k}><label><input type="checkbox" checked={!offT.has(k)} onChange={() => setOffT((x) => flip(x, k))} /> <span className="t">{t.name}</span><small>{day(t.date)}</small></label></li>)}</ul> : <p className="sh-empty">None found.</p>}
            <h4>Assignments, as tasks <small>{tasks.length} of {read.assignments.length}</small></h4>
            {read.assignments.length ? <ul>{read.assignments.map((a, k) => <li key={k}><label><input type="checkbox" checked={!offA.has(k)} onChange={() => setOffA((x) => flip(x, k))} /> <span className="t">{a.title}</span><small>{day(a.due)}</small></label></li>)}</ul> : <p className="sh-empty">None found.</p>}
            {err && <p className="when-err">{err}</p>}
            <div className="syl-actions">
              <button onClick={() => setStep("pick")} disabled={step === "adding"}>Another photo</button>
              <button className="primary" disabled={step === "adding" || !name.trim()} onClick={() => void add()}>{step === "adding" ? "Adding…" : `Add ${name.trim() || "it"}`}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
