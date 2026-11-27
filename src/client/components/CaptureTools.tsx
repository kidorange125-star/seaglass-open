// Quick capture (a revocable key for iPhone Shortcuts and the share sheet) and voice notes (record, transcribe with
// Workers AI Whisper, add to the page). Server side: src/worker/semantic.ts.
import { useEffect, useRef, useState } from "react";
import { Check, Copy, Inbox, Mic, Square } from "lucide-react";
import { api, ApiError } from "../api";
import { useStore } from "../store";
import { JeffAvatar } from "../icons";
import { agentName } from "../persona";
import { IClose } from "../ui-icons";

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : (e as Error)?.message || "Something went wrong");
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** Sends something shared to Seaglass (Web Share Target) into the Inbox, then cleans the address bar. */
export async function takeShared(toast: (m: string) => void) {
  const q = new URLSearchParams(location.search);
  const title = q.get("title") ?? "", text = q.get("text") ?? "", url = q.get("url") ?? "";
  if (!title && !text && !url) return;
  history.replaceState(null, "", location.pathname + location.hash);
  try { const r = await api.capture({ title, text, url, today: todayIso(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone }); toast(r.title && r.title !== "Inbox" ? `Saved to ${r.title}` : "Saved to your Inbox"); } catch (e) { toast(`Couldn't save that: ${errMsg(e)}`); }
}

// ---------------------------------------------------------------- quick capture settings
export function CaptureDialog() {
  const s = useStore();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState("");
  const close = () => s.setCaptureOpen(false);
  const endpoint = `${location.origin}/api/capture`;
  useEffect(() => { api.captureStatus().then((r) => setEnabled(r.enabled)).catch(() => setEnabled(false)); }, []);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") close(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); });
  const make = async () => { try { setToken((await api.captureMakeToken()).token); setEnabled(true); } catch (e) { s.toast(errMsg(e)); } };
  const off = async () => { if (!(await s.confirm("Turn off quick capture? Shortcuts using the key will stop working."))) return; try { await api.captureRevoke(); setToken(null); setEnabled(false); } catch (e) { s.toast(errMsg(e)); } };
  const copy = (what: string, v: string) => { void navigator.clipboard?.writeText(v); setCopied(what); setTimeout(() => setCopied(""), 1500); };
  return (
    <div className="modal-back" onMouseDown={close}>
      <div className="modal capture" role="dialog" aria-label="Quick capture" onMouseDown={(e) => e.stopPropagation()}>
        <div className="memory-head">
          <span className="notify-ico"><Inbox size={20} /></span>
          <div><b>Quick capture</b><small>Send text, links or tasks into Seaglass from an iPhone Shortcut, Siri or the share sheet, without opening the app.</small></div>
          <button className="ghost icon-btn" aria-label="Close" onClick={close}><IClose size={18} /></button>
        </div>
        <section className="notify-sec">
          <h3>Your capture key</h3>
          {token ? (
            <>
              <div className="cap-key"><code>{token}</code><button className="ghost" onClick={() => copy("key", token)}>{copied === "key" ? <Check size={15} /> : <Copy size={15} />} Copy</button></div>
              <p className="notify-note">Copy it now: it won't be shown again. It can only add tasks and Inbox lines, and you can turn it off any time.</p>
            </>
          ) : enabled ? (
            <div className="notify-row"><span className="notify-on">On</span><button className="ghost" onClick={() => void make()}>Make a new key</button><button className="ghost" onClick={() => void off()}>Turn off</button></div>
          ) : (
            <div className="notify-row"><button className="primary" disabled={enabled === null} onClick={() => void make()}>Create a capture key</button></div>
          )}
        </section>
        <section className="notify-sec">
          <h3>iPhone Shortcut</h3>
          <ol className="cap-steps">
            <li>Open <b>Shortcuts</b>, tap <b>+</b>, and add <b>Get Contents of URL</b>.</li>
            <li>URL: <button className="cap-copy" onClick={() => copy("url", endpoint)}>{endpoint} {copied === "url" ? <Check size={13} /> : <Copy size={13} />}</button></li>
            <li>Tap <b>Show More</b>: Method <b>POST</b>; add the header <code>Authorization</code> with the value <code>Bearer</code> followed by your key; Request Body <b>JSON</b> with a text field <code>text</code> set to <b>Shortcut Input</b> (or <b>Ask for Input</b> first).</li>
            <li>Name it "Add to Seaglass". Turn on <b>Show in Share Sheet</b> to use it from Safari and other apps, or say "Hey Siri, Add to Seaglass".</li>
          </ol>
          <p className="notify-note">Text starting with <b>todo</b> or <b>task</b> becomes a task ("task call Sam tomorrow 3pm every mon"). Anything else is added as a line on your <b>Inbox</b> page. On Windows, Chrome and Edge can also send things to Seaglass from their Share menu once Seaglass is installed as an app; iPhone doesn't allow that, so use the Shortcut there.</p>
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- voice notes
const pickMime = () => (["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) ?? "");
const fmt = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

export function VoiceDialog() {
  const s = useStore();
  const [phase, setPhase] = useState<"idle" | "recording" | "working" | "error">("idle");
  const [ms, setMs] = useState(0);
  const [err, setErr] = useState("");
  const rec = useRef<MediaRecorder | null>(null), stream = useRef<MediaStream | null>(null), chunks = useRef<Blob[]>([]), t0 = useRef(0), cancelled = useRef(false);
  const page = s.route.kind === "page" ? s.route.id : null;
  const close = () => { cancelled.current = true; try { rec.current?.state === "recording" && rec.current.stop(); } catch { /* already stopped */ } stream.current?.getTracks().forEach((t) => t.stop()); s.setVoiceOpen(false); };
  useEffect(() => () => { stream.current?.getTracks().forEach((t) => t.stop()); }, []);
  useEffect(() => { if (phase !== "recording") return; const i = setInterval(() => setMs(Date.now() - t0.current), 250); return () => clearInterval(i); }, [phase]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape" && phase !== "working") close(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); });

  const start = async () => {
    setErr("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setErr("This browser can't record audio."); setPhase("error"); return; }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickMime();
      const r = new MediaRecorder(stream.current, mime ? { mimeType: mime } : undefined);
      chunks.current = []; cancelled.current = false;
      r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      r.onstop = () => { stream.current?.getTracks().forEach((t) => t.stop()); if (!cancelled.current) void finish(r.mimeType || mime || "audio/mp4"); };
      rec.current = r; r.start(1000); t0.current = Date.now(); setMs(0); setPhase("recording");
    } catch (e) { setErr((e as Error).name === "NotAllowedError" ? "Seaglass needs microphone permission to record. Allow it in your browser or phone settings." : errMsg(e)); setPhase("error"); }
  };
  const stop = () => { setPhase("working"); rec.current?.stop(); };
  const finish = async (mime: string) => {
    try {
      const type = mime.split(";")[0] || "audio/mp4";
      const blob = new Blob(chunks.current, { type });
      const r = await api.transcribe(blob, type);
      const when = new Date().toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      const body = r.text ? r.text.split(/\n{2,}|(?<=[.!?])\s+(?=[A-Z])(?=(?:[^.!?]*[.!?]){3})/).reduce<string[]>((acc, sentence) => { const last = acc[acc.length - 1]; if (last && last.length < 260) acc[acc.length - 1] = `${last} ${sentence}`; else acc.push(sentence); return acc; }, []).map((p) => `<p>${esc(p.trim())}</p>`).join("") : "<p>(Nothing was said, or it couldn't be made out.)</p>";
      const html = `<div data-type="callout" data-emoji="🎙️"><p><strong>Voice note · ${esc(when)}</strong> (${fmt(Date.now() - t0.current)})</p>${body}<p><a href="${r.url}">Listen to the recording</a></p></div>`;
      let id = page;
      if (id) {
        const n = await api.get(id);
        await api.patch(id, { html: n.html + html, revision: n.revision });
        dispatchEvent(new CustomEvent("seaglass:agent-changed"));
      } else {
        const n = await api.create({ title: `Voice note · ${when}`, html, icon: "🎙️" });
        id = n.id; await s.refreshTree(); s.go(`/p/${n.id}`);
      }
      s.setVoiceOpen(false);
      s.toast(page ? "Added the voice note to this page" : "Saved your voice note as a page");
    } catch (e) { setErr(errMsg(e)); setPhase("error"); }
  };

  return (
    <div className="modal-back" onMouseDown={() => phase !== "working" && close()}>
      <div className="modal voice" role="dialog" aria-label="Voice note" onMouseDown={(e) => e.stopPropagation()}>
        <div className="memory-head">
          <span className="notify-ico"><Mic size={20} /></span>
          <div><b>Voice note</b><small>Record, and {agentName()}'s ears (Whisper) turn it into text {page ? "on this page" : "on a new page"}. Up to about 10 minutes.</small></div>
          <button className="ghost icon-btn" aria-label="Close" onClick={close} disabled={phase === "working"}><IClose size={18} /></button>
        </div>
        {phase === "idle" && <button className="primary voice-go" onClick={() => void start()}><Mic size={20} /> Start recording</button>}
        {phase === "recording" && (
          <div className="voice-rec">
            <span className="voice-dot" /><b className="voice-time">{fmt(ms)}</b>
            <button className="primary voice-stop" onClick={stop}><Square size={16} fill="currentColor" /> Stop and transcribe</button>
          </div>
        )}
        {phase === "working" && <div className="pn-busy"><JeffAvatar size={56} /><b>Listening…</b><small>Turning your recording into text.</small></div>}
        {phase === "error" && <><p className="when-err">{err}</p><button className="primary voice-go" onClick={() => { setPhase("idle"); setErr(""); }}>Try again</button></>}
      </div>
    </div>
  );
}
