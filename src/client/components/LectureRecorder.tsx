// Record a class (#12). Records in 5-minute pieces (a fresh recorder each time, so every piece is a whole file), and each
// piece is turned into text as soon as it's done (the voice-note path, which takes about 10 minutes at most per piece), so a
// whole class works and nothing waits until the end. The screen stays on while recording. Stop: the assistant turns it all
// into notes with flashcards, filed under the subject (worker lecture.ts), and the page opens.
import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";
import { JeffAvatar } from "../icons";
import { IClose } from "../ui-icons";
import { agentName } from "../persona";
import { jeffModel } from "./AiTools";

const PIECE_MS = (() => { try { const v = Number(localStorage.getItem("sg.lecture.piece")); return v >= 1000 ? v : 5 * 60_000; } catch { return 5 * 60_000; } })(); // tests shorten it
const MAX_MS = 3 * 3600_000;
const pickMime = () => (["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) ?? "");
const clock = (ms: number) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 3600) ? `${Math.floor(s / 3600)}:` : ""}${String(Math.floor((s % 3600) / 60)).padStart(Math.floor(s / 3600) ? 2 : 1, "0")}:${String(s % 60).padStart(2, "0")}`; };

export function LectureRecorder({ subjects, subjectId, onClose }: { subjects: { id: string; name: string }[]; subjectId: string | null; onClose: () => void }) {
  const s = useStore();
  const [phase, setPhase] = useState<"ready" | "recording" | "finishing" | "writing">("ready");
  const [subject, setSubject] = useState(subjectId ?? "");
  const [title, setTitle] = useState("");
  const [now, setNow] = useState(0);
  const [pieces, setPieces] = useState({ done: 0, total: 0, failed: 0 });
  const [last, setLast] = useState("");
  const [err, setErr] = useState("");
  const stream = useRef<MediaStream | null>(null), rec = useRef<MediaRecorder | null>(null), started = useRef(0), going = useRef(false);
  const texts = useRef<string[]>([]), queue = useRef<Promise<void>>(Promise.resolve()), lock = useRef<{ release: () => Promise<void> } | null>(null);

  useEffect(() => () => { going.current = false; try { rec.current?.stop(); } catch { /* done */ } stream.current?.getTracks().forEach((t) => t.stop()); void lock.current?.release().catch(() => {}); }, []);
  useEffect(() => { if (phase !== "recording") return; const t = setInterval(() => { const ms = Date.now() - started.current; setNow(ms); if (ms >= MAX_MS) void stop(); }, 500); return () => clearInterval(t); }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps
  // the screen stays on while recording (and again after coming back to the app)
  const keepAwake = async () => { try { lock.current = await (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen") ?? null; } catch { /* not allowed here */ } };
  useEffect(() => { const v = () => { if (document.visibilityState === "visible" && going.current) void keepAwake(); }; document.addEventListener("visibilitychange", v); return () => document.removeEventListener("visibilitychange", v); }, []);

  const transcribe = (blob: Blob, k: number) => {
    setPieces((p) => ({ ...p, total: Math.max(p.total, k + 1) }));
    queue.current = queue.current.then(async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try { const r = await api.transcribe(blob, blob.type || "audio/webm"); texts.current[k] = r.text; setLast(r.text.slice(-160)); setPieces((p) => ({ ...p, done: p.done + 1 })); return; }
        catch { if (attempt) { texts.current[k] = "[a few minutes here couldn't be turned into text]"; setPieces((p) => ({ ...p, done: p.done + 1, failed: p.failed + 1 })); } }
      }
    });
  };
  const piece = (k: number) => {
    const mime = pickMime(), chunks: Blob[] = [];
    const r = new MediaRecorder(stream.current!, mime ? { mimeType: mime } : undefined);
    r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    r.onstop = () => { const blob = new Blob(chunks, { type: (mime || "audio/webm").split(";")[0] }); if (blob.size > 800) transcribe(blob, k); if (going.current) piece(k + 1); };
    r.start(1000);
    rec.current = r;
    setTimeout(() => { if (rec.current === r && r.state === "recording") r.stop(); }, PIECE_MS);
  };
  const start = async () => {
    setErr("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setErr("This browser can't record audio."); return; }
    try { stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true } }); }
    catch { setErr("Seaglass can't use the microphone. Allow it in your browser's settings, then try again."); return; }
    texts.current = []; going.current = true; started.current = Date.now(); setPieces({ done: 0, total: 0, failed: 0 });
    void keepAwake(); piece(0); setPhase("recording");
  };
  const stop = async () => {
    if (!going.current) return;
    going.current = false; setPhase("finishing");
    const minutes = Math.max(1, Math.round((Date.now() - started.current) / 60_000));
    await new Promise<void>((ok) => { const r = rec.current; if (!r || r.state !== "recording") return ok(); const done = r.onstop; r.onstop = (e) => { done?.call(r, e); ok(); }; r.stop(); });
    stream.current?.getTracks().forEach((t) => t.stop()); void lock.current?.release().catch(() => {});
    await queue.current;
    const transcript = texts.current.filter(Boolean).join(" ");
    setPhase("writing");
    try {
      const n = await api.lecture({ transcript, title, subject_id: subject || null, minutes, model: jeffModel() });
      await s.refreshTree(); dispatchEvent(new CustomEvent("seaglass:agent-changed"));
      s.toast(`Notes from the class are ready${subject ? ", in the Study tab too" : ""}`, { label: "Undo", run: () => void api.undoRun(n.run_id, true).then(() => s.refreshTree()) });
      onClose(); s.go(`/p/${n.id}`);
    } catch (e) { setErr((e as Error).message); setPhase("ready"); }
  };
  const cancel = async () => { if (phase === "recording" && !(await s.confirm("Stop recording and throw it away?"))) return; going.current = false; onClose(); };

  return (
    <div className="lecture" role="dialog" aria-label="Record a class">
      <div className="lecture-top"><button className="ghost icon-btn" aria-label="Close" onClick={() => void cancel()}><IClose size={20} /></button><b>Record a class</b><span /></div>
      <div className="lecture-body">
        {phase === "ready" && <>
          <Mic size={40} className="lecture-mic" />
          <p>Put your phone or laptop where it can hear the teacher. Keep Seaglass open: the screen stays on while it records. When the class ends, {agentName()} turns it into notes with flashcards.</p>
          <label className="lecture-field">Subject
            <select value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject"><option value="">No subject</option>{subjects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          </label>
          <label className="lecture-field">Title <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Cell transport" aria-label="Title" /></label>
          {err && <p className="when-err">{err}</p>}
          <button className="primary lecture-go" onClick={() => void start()}><Mic size={18} /> Start recording</button>
        </>}
        {phase === "recording" && <>
          <span className="lecture-dot" aria-hidden />
          <b className="lecture-clock" aria-live="off">{clock(now)}</b>
          <small>Recording{pieces.total ? ` · ${pieces.done} of ${pieces.total} part${pieces.total === 1 ? "" : "s"} turned into text` : ""}</small>
          {last && <p className="lecture-last">…{last}</p>}
          <button className="primary lecture-go" onClick={() => void stop()}><Square size={16} fill="currentColor" /> Stop and make notes</button>
        </>}
        {(phase === "finishing" || phase === "writing") && <>
          <JeffAvatar size={56} mode="think" />
          <b>{phase === "finishing" ? `Turning the last part into text… (${pieces.done} of ${pieces.total})` : `${agentName()} is writing your notes…`}</b>
          {pieces.failed > 0 && <small>{pieces.failed} part{pieces.failed === 1 ? "" : "s"} couldn't be turned into text; the notes skip {pieces.failed === 1 ? "it" : "them"}.</small>}
        </>}
      </div>
    </div>
  );
}
