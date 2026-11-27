// Live voice: one continuous spoken conversation with the assistant, full screen. It listens, you stop talking, it answers out
// loud, and it goes back to listening, with no turns to send. Talk over it or tap to interrupt. Laid out like Claude's voice
// mode: a quiet page, a small face and one line until you start, then the words; a glow from the bottom follows the voice. It's the normal agent with every tool, and
// the conversation lands in the one ongoing thread. Hearing: voice/listen.ts. Speaking: voice/speaker.ts, worker/voice.ts.
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronsUpDown, Mic, MicOff, Settings2, X } from "lucide-react";
import { api, type AgentEvent } from "../api";
import { useStore } from "../store";
import { JeffAvatar } from "../icons";
import { agentName } from "../persona";
import { Popover } from "./ui";
import { createListener, recordingListener, type ListenEvents, type Listener, type ListenKind } from "../voice/listen";
import { Speaker } from "../voice/speaker";
import { speakable, takeSentences } from "../voice/text";
import { trace } from "../voice/trace";
import { closeLocalEar, earEnabled, earSupported, setEarEnabled, watchEar, type Ear } from "../voice/localEar";

type Phase = "starting" | "listening" | "thinking" | "speaking" | "error";
const KIND_LABEL: Record<ListenKind, string> = { device: "On device", browser: "Browser speech", cloud: "Cloud transcription" };
const KIND_TITLE: Record<ListenKind, string> = {
  device: "Your speech is turned into text on this device.",
  browser: "Your browser turns your speech into text. Some browsers use a server for this.",
  cloud: "This browser can't recognize speech here, so what you say is transcribed by Seaglass's server.",
};
const SETTING_UP = "A one-time download of about 55 MB. Until it's done, what you say is transcribed by Seaglass's server.";
const QUIET_LIMIT_MS = 120_000;
// Two layers: Haiku always does the talking, because a quick answer is what makes it feel like a conversation, and it hands
// anything hard to this stronger model (worker/agent.ts `ask_stronger_model`).
const MODELS = [{ id: "sonnet", label: "Sonnet" }, { id: "opus", label: "Opus" }, { id: "opus-fast", label: "Opus Fast" }];
const SPEEDS = [{ rate: 0.9, label: "Slower" }, { rate: 1, label: "Normal" }, { rate: 1.2, label: "Faster" }];
const saved = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const save = (key: string, v: string) => { try { localStorage.setItem(key, v); } catch { /* storage unavailable */ } };
const FIRST_SENTENCE_MIN = 8; // start talking on the first short sentence
const webOn = () => { try { return localStorage.getItem("sg.agent.web") !== "0"; } catch { return true; } };
const announce = () => dispatchEvent(new CustomEvent("seaglass:agent-changed"));

export function LiveVoice() {
  const s = useStore();
  const store = useRef(s); store.current = s;
  const [phase, setPhaseState] = useState<Phase>("starting");
  const [muted, setMutedState] = useState(false);
  const [you, setYou] = useState("");
  const [reply, setReply] = useState("");
  const [tool, setTool] = useState("");
  const [kind, setKind] = useState<ListenKind | null>(null);
  const [ear, setEar] = useState<Ear | null>(null);
  const [earOn, setEarOn] = useState(earEnabled);
  const [notice, setNotice] = useState("");
  const [problem, setProblem] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [lastRun, setLastRun] = useState<{ id: string; changes: number } | null>(null);
  const [past, setPast] = useState<{ you: string; reply: string }[]>([]);
  const [model, setModelState] = useState(() => { const m = saved("sg.voice.deep"); return MODELS.some((x) => x.id === m) ? m! : MODELS[0].id; });
  const [speed, setSpeedState] = useState(() => { const r = Number(saved("sg.voice.speed")); return SPEEDS.some((x) => x.rate === r) ? r : 1; });
  const [settings, setSettings] = useState(false);
  const [micCheck, setMicCheck] = useState("");
  const modelRef = useRef(model); modelRef.current = model;

  const phaseRef = useRef<Phase>("starting"), mutedRef = useRef(false), alive = useRef(false);
  const setPhase = (p: Phase) => { phaseRef.current = p; setPhaseState(p); };
  const listener = useRef<Listener | null>(null), speaker = useRef<Speaker | null>(null), abort = useRef<AbortController | null>(null);
  const spoken = useRef(""), lastAsked = useRef(""), carry = useRef("");
  const round = useRef(0), quiet = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), hearing = useRef(0);
  const root = useRef<HTMLDivElement>(null), words = useRef<HTMLDivElement>(null);
  const turn = useRef({ you: "", reply: "" });
  /** The exchange that just finished moves up the page, and the next one starts. */
  const archive = useCallback(() => {
    const t = turn.current;
    if (t.you || t.reply) setPast((p) => [...p.slice(-29), t]);
    turn.current = { you: "", reply: "" };
    setYou(""); setReply(""); setLastRun(null);
  }, []);

  const end = useCallback(() => {
    alive.current = false;
    abort.current?.abort();
    listener.current?.stop(); speaker.current?.stop();
    clearTimeout(quiet.current);
    announce();
    store.current.setLiveVoice(false);
  }, []);

  const listen = useCallback(() => {
    if (!alive.current) return;
    setPhase("listening"); setTool("");
    clearTimeout(quiet.current);
    if (mutedRef.current) return;
    listener.current?.start();
    quiet.current = setTimeout(() => { store.current.toast("Ended live voice after two quiet minutes"); end(); }, QUIET_LIMIT_MS);
  }, [end]);

  const ask = useCallback(async (text: string) => {
    const mine = ++round.current;
    lastAsked.current = text;
    setPhase("thinking"); setTool("");
    const ctl = new AbortController(); abort.current = ctl;
    const voice = speaker.current!;
    voice.begin();
    let buffer = "", first = true, gotText = false;
    trace("ask", { chars: text.length });
    const say = (piece: string) => { const t = speakable(piece); if (t) { spoken.current += ` ${t}`; voice.say(t); first = false; } };
    const onEvent = (e: AgentEvent) => {
      if (mine !== round.current) return;
      if (e.type === "error") trace("agent-error", { message: e.message.slice(0, 160) });
      if (e.type === "done") trace("agent-done", { changes: e.changes, stop: e.stop });
      if (e.type === "text" && !gotText) { gotText = true; trace("agent-first-text"); }
      if (e.type === "text") { buffer += e.delta; const { done, rest } = takeSentences(buffer, first ? FIRST_SENTENCE_MIN : undefined); buffer = rest; done.forEach(say); }
      else if (e.type === "tool_start") { say(buffer); buffer = ""; setTool(e.label); } // anything it said first ("let me check") is spoken now, not after
      else if (e.type === "tool_result") { setTool(""); if (e.ok && e.note_ids.length) announce(); }
      else if (e.type === "done") { if (e.changes) setLastRun({ id: e.run_id, changes: e.changes }); }
      else if (e.type === "error") setNotice(e.message);
    };
    const route = store.current.route;
    try {
      await api.agentStream({ message: text, page_id: route.kind === "page" ? route.id : null, deep: modelRef.current, web: webOn(), voice: true }, onEvent, ctl.signal);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      trace("agent-failed", { message: (e as Error).message.slice(0, 160) });
      if (mine === round.current) setNotice((e as Error).message || "Something went wrong.");
    }
    if (mine !== round.current) return;
    say(buffer);
    voice.finish();
  }, []);

  const hush = () => { round.current++; abort.current?.abort(); speaker.current?.stop(); };
  /** The user tapped. */
  const interrupt = useCallback(() => {
    if (phaseRef.current === "listening" && listener.current?.finishNow?.()) return;
    if (phaseRef.current !== "thinking" && phaseRef.current !== "speaking") return;
    hush();
    listen();
  }, [listen]);
  /** The user started talking over it. The listener is already hearing them, so there's nothing to restart. */
  const talkedOver = useCallback((heard: string) => {
    const was = phaseRef.current;
    if (was !== "thinking" && was !== "speaking") return;
    if (was === "thinking") { carry.current = lastAsked.current; turn.current = { you: "", reply: "" }; } // the user hadn't finished: join it up with what the user says next
    else archive();
    hush();
    setPhase("listening"); setTool(""); setYou(heard); turn.current.you = heard;
    clearTimeout(quiet.current);
  }, [archive]);
  const followAlong = useCallback(() => {
    spoken.current = "";
    listener.current?.overlap(() => spoken.current, talkedOver, () => speaker.current?.level() ?? 0);
  }, [talkedOver]);

  const toggleMute = () => {
    const next = !mutedRef.current;
    mutedRef.current = next; setMutedState(next);
    if (next) { listener.current?.stop(); clearTimeout(quiet.current); }
    else if (phaseRef.current === "listening") listen();
    else if (phaseRef.current === "thinking" || phaseRef.current === "speaking") listener.current?.overlap(() => spoken.current, talkedOver, () => speaker.current?.level() ?? 0);
  };

  // Set up once, when the screen opens.
  useEffect(() => {
    alive.current = true;
    speaker.current = new Speaker({
      onSpeaking: (text) => { if (alive.current) { setPhase("speaking"); turn.current.reply = `${turn.current.reply} ${text}`.trim(); setReply(turn.current.reply); } },
      onIdle: () => listen(),
      onNotice: setNotice,
    });
    const events: ListenEvents = {
      onText: (t) => {
        clearTimeout(quiet.current);
        if (turn.current.reply) archive();
        const shown = t === "…" ? "Working out what you said…" : t;
        setYou(shown); turn.current.you = shown;
      },
      onDone: (t) => {
        trace("heard", { chars: t.length });
        clearTimeout(quiet.current);
        const text = `${carry.current} ${t}`.trim();
        carry.current = "";
        if (turn.current.reply) archive();
        setYou(text); turn.current.you = text;
        followAlong(); void ask(text);
      },
      onLevel: (v) => { hearing.current = Math.max(hearing.current, v); },
      onBroken: () => {
        trace("broken", { kind: listener.current?.kind });
        if (!alive.current) return;
        if (listener.current?.kind === "cloud" || typeof MediaRecorder === "undefined") { setProblem("Live voice can't hear you in this browser."); setPhase("error"); return; }
        listener.current = recordingListener(events);
        setKind("cloud");
        listen();
      },
      onIssue: setNotice,
      onDenied: () => { trace("denied"); if (alive.current) { setProblem("Seaglass needs permission to use your microphone. Turn it on in your browser's settings, then try again."); setPhase("error"); } },
    };
    trace("open", { ua: navigator.userAgent.slice(0, 120), standalone: (navigator as unknown as { standalone?: boolean }).standalone === true });
    void createListener(events, () => setDownloading(true)).then((l) => {
      if (!alive.current) return;
      if (!l) { setProblem("Live voice can't hear you in this browser."); setPhase("error"); return; }
      listener.current = l; setKind(l.kind); listen();
    });
    // keep a phone awake while talking
    let lock: { release: () => Promise<void> } | null = null;
    void (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen").then((w) => { lock = w; }).catch(() => {});
    return () => {
      alive.current = false; abort.current?.abort(); listener.current?.stop(); speaker.current?.stop(); clearTimeout(quiet.current);
      void lock?.release().catch(() => {});
    };
  }, [ask, listen, followAlong, archive]);
  useEffect(() => { const stop = watchEar(setEar); return () => { stop(); closeLocalEar(); }; }, []);

  useEffect(() => { if (speaker.current) speaker.current.rate = speed; }, [speed]);
  useEffect(() => { // the mic check updates while the settings are open
    if (!settings) return;
    const show = () => setMicCheck(listener.current?.check?.() ?? "");
    show();
    const t = setInterval(show, 700);
    return () => clearInterval(t);
  }, [settings]);
  useEffect(() => { const el = words.current?.parentElement; if (el) el.scrollTop = el.scrollHeight; }, [past, you, reply, lastRun]);

  // The face's rings follow the voice. Written straight to the element so this doesn't re-render 60 times a second.
  useEffect(() => {
    let frame = 0, shown = 0;
    const draw = () => {
      const now = performance.now() / 1000, still = matchMedia("(prefers-reduced-motion: reduce)").matches, p = phaseRef.current;
      // Always a little alive: a slow breath while it listens, a quicker one while it thinks, the real voice otherwise.
      const target = p === "speaking" ? speaker.current?.level() ?? 0
        : p === "thinking" ? (still ? 0.25 : 0.3 + 0.16 * Math.sin(now * 3.4))
        : p === "listening" && !mutedRef.current ? Math.max(hearing.current, still ? 0 : 0.1 + 0.05 * Math.sin(now * 1.5))
        : 0;
      hearing.current *= 0.86;
      shown += (target - shown) * (target > shown ? 0.55 : 0.13); // jumps up with the voice, settles slowly
      root.current?.style.setProperty("--lv", shown.toFixed(3));
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") { if (document.querySelector(".popover")) return; e.preventDefault(); end(); }
      else if (e.key === " " && (e.target as HTMLElement).tagName !== "BUTTON") { e.preventDefault(); interrupt(); }
    };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  }, [end, interrupt]);

  const undo = async () => { if (!lastRun) return; await api.undoRun(lastRun.id, true); setLastRun(null); announce(); void s.refreshTree(); };
  const setModel = (m: string) => { setModelState(m); save("sg.voice.deep", m); };
  const setSpeed = (r: number) => { setSpeedState(r); save("sg.voice.speed", String(r)); };
  const status = phase === "starting" ? (downloading ? "Setting up on-device speech. This only happens once…" : "Getting ready…")
    : phase === "error" ? ""
    : muted && phase === "listening" ? "Muted"
    : phase === "listening" ? "Listening…"
    : phase === "thinking" ? (tool ? `${tool}…` : "Thinking…")
    : listener.current?.canOverlap ? "Talk or tap to interrupt" : "Tap to interrupt";
  const mode = phase === "thinking" ? (tool ? "tool" : "think") : "idle";
  // The recording path says which actually did the work last.
  const heardOn = kind === "cloud" && ear?.state === "ready" && ear.last !== "cloud" ? "device" : kind;
  const settingUp = kind === "cloud" && ear?.state === "loading";
  const started = past.length > 0 || !!you || !!reply;

  return (
    <div ref={root} className={`lv lv-${phase} ${muted ? "lv-muted" : ""}`} role="dialog" aria-label={`Live voice with ${agentName()}`}>
      <div className="lv-glow" aria-hidden="true" />
      <div className="lv-top">{heardOn && <span className="lv-engine" title={settingUp ? SETTING_UP : KIND_TITLE[heardOn]}>{settingUp ? `Setting up on-device speech ${ear.pct}%` : KIND_LABEL[heardOn]}</span>}</div>
      <div className="lv-stage" onClick={interrupt}>
        {problem ? <p className="lv-problem" role="alert">{problem}</p>
          : !started ? <div className="lv-hello"><JeffAvatar size={44} mode={mode} /><h2>Start talking anytime</h2></div>
          : (
            <div className="lv-words" ref={words}>
              {past.map((t, i) => <div key={i} className="lv-words-turn">{t.you && <p className="lv-me">{t.you}</p>}{t.reply && <p className="lv-them">{t.reply}</p>}</div>)}
              {you && <p className="lv-you">{you}</p>}
              {reply && <p className="lv-reply" aria-live="polite">{reply}</p>}
              {lastRun && <button className="lv-undo" onClick={(e) => { e.stopPropagation(); void undo(); }}>Undo {lastRun.changes === 1 ? "this change" : `these ${lastRun.changes} changes`}</button>}
            </div>
          )}
      </div>
      <div className="lv-dock">
        {!problem && <p className="lv-status" aria-live="polite">{started && <JeffAvatar size={22} mode={mode} />}{status}</p>}
        {notice && <p className="lv-notice">{notice}</p>}
        <button className={`lv-btn lv-mic ${muted ? "on" : ""}`} aria-label={muted ? "Unmute" : "Mute"} aria-pressed={muted} title={muted ? "Unmute" : "Mute"} disabled={phase === "error"} onClick={toggleMute}>{muted ? <MicOff size={22} /> : <Mic size={22} />}</button>
        <div className="lv-row">
          <span className="rel">
            <button className="lv-btn lv-small" aria-label="Voice settings" title="Voice settings" onClick={() => setSettings((v) => !v)}><Settings2 size={20} /></button>
            {settings && (
              <Popover onClose={() => setSettings(false)} className="lv-settings">
                <div className="mp-title">Speaking speed</div>
                <div className="lv-speeds" role="radiogroup" aria-label="Speaking speed">{SPEEDS.map((x) => <button key={x.rate} role="radio" aria-checked={speed === x.rate} className={speed === x.rate ? "on" : ""} onClick={() => setSpeed(x.rate)}>{x.label}</button>)}</div>
                {heardOn && <p>{settingUp ? SETTING_UP : KIND_TITLE[heardOn]}</p>}
                {kind === "cloud" && earSupported() && <label className="lv-ear"><input type="checkbox" checked={earOn} onChange={(e) => { setEarOn(e.target.checked); setEarEnabled(e.target.checked); }} />Turn speech into text on this device</label>}
                {micCheck && <p className="lv-check">{micCheck}</p>}
              </Popover>
            )}
          </span>
          <label className="lv-model" title="Haiku talks. This model takes the hard questions.">Haiku + {MODELS.find((m) => m.id === model)?.label}<ChevronsUpDown size={13} /><select aria-label="Model for hard questions" value={model} onChange={(e) => setModel(e.target.value)}>{MODELS.map((m) => <option key={m.id} value={m.id}>Haiku + {m.label}</option>)}</select></label>
          <button className="lv-btn lv-small lv-end" aria-label="End live voice" title="End (Esc)" onClick={end}><X size={21} /></button>
        </div>
      </div>
    </div>
  );
}
