// Hearing the user in live voice. Best case the browser's speech recognition runs on the device (processLocally). Where only the
// browser's own recognizer exists it uses that, and that may be a server, depending on the browser. On iPhones and iPads it
// records what the user says and turns it into text on the phone (localEar.ts), or with Workers AI Whisper until that's ready or when
// it can't. If the level meter reads nothing, the server tells when the user's stopped talking too. Safari's recognizer needs a fresh tap, stops by itself, conflicts with
// playing audio, and doesn't exist at all in a Home Screen app (WebKit bug 225298). Every path reports which it is, so the
// screen can say so honestly.
//
// It keeps listening while the assistant talks, so the user can just talk over it (`overlap`). The recognizer also hears the assistant
// through the speakers, so what it hears is compared with what's being said (`stripEcho`). The recording path can't read words
// until later, so it watches the microphone level against how loud the assistant is, with the browser's echo cancellation on.
import { api } from "../api";
import { stripEcho, wantsIn } from "./text";
import { voiceContext } from "./speaker";
import { trace } from "./trace";
import { earNote, localHear, prepareLocalEar, usedCloud } from "./localEar";

export type ListenKind = "device" | "browser" | "cloud";
export interface ListenEvents {
  onText: (text: string) => void;
  onDone: (text: string) => void;
  onLevel: (v: number) => void;
  /** This way of listening doesn't work here: try the next. */
  onBroken: () => void;
  onDenied: () => void;
  /** Something went wrong with one thing the user said, and it's still listening. */
  onIssue: (message: string) => void;
}
export interface Listener {
  kind: ListenKind;
  /** Whether the user can talk over the assistant, or has to tap. */
  readonly canOverlap: boolean;
  start: () => void;
  /** Keep listening while the assistant talks. spoken: everything it has said this turn. output: how loud it is, 0 to 1. */
  overlap: (spoken: () => string, onInterrupt: (heard: string) => void, output: () => number) => void;
  stop: () => void;
  /** What the microphone is doing right now, for the check in the settings. */
  check?: () => string;
  /** Send what's been recorded now, if this way of listening can. True if that happened. */
  finishNow?: () => boolean;
}

/* The Web Speech API isn't in TypeScript's DOM types. */
interface RecResult { 0: { transcript: string }; isFinal?: boolean }
interface RecEvent { results: ArrayLike<RecResult> }
interface Rec { lang: string; continuous: boolean; interimResults: boolean; processLocally?: boolean; onstart: null | (() => void); onresult: null | ((e: RecEvent) => void); onerror: null | ((e: { error: string }) => void); onend: null | (() => void); start: () => void; abort: () => void }
interface RecCtor { new (): Rec; available?: (o: { langs: string[]; processLocally: boolean }) => Promise<string>; install?: (o: { langs: string[]; processLocally: boolean }) => Promise<boolean> }

// How long a pause means the user's finished. Shorter once the recognizer itself has decided the phrase is over.
const PAUSE_AFTER_FINAL_MS = 400;
const PAUSE_MS = 800;
const ECHO_TAIL_MS = 1500; // the end of the assistant's last words can arrive late
const recCtor = () => { const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor }; return w.SpeechRecognition ?? w.webkitSpeechRecognition; };
const language = () => navigator.language || "en-US";
const isIos = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/** Whether recognition can run on this device, fetching the language pack if it has to. */
async function canRunLocally(C: RecCtor, onDownload?: () => void) {
  if (!C.available) return false;
  const o = { langs: [language()], processLocally: true };
  try {
    const state = await C.available(o);
    if (state === "available") return true;
    if ((state === "downloadable" || state === "downloading") && C.install) {
      onDownload?.();
      return await Promise.race([C.install(o), new Promise<boolean>((r) => setTimeout(() => r(false), 20_000))]);
    }
  } catch { /* not supported after all */ }
  return false;
}

/** Loudness of a microphone signal, 0 to 1, with the room's own hum taken out. */
const loudness = (rms: number, floor: number) => Math.min(1, Math.sqrt(Math.max(0, rms - floor * 1.5) * 7));

class SpeechListener implements Listener {
  canOverlap = true;
  // The recognizer doesn't say how loud the user is, so a separate reading of the mic drives the glow. If it's refused, nothing else is affected.
  private meterStream: MediaStream | null = null; private meterSource: MediaStreamAudioSourceNode | null = null; private meterTick: ReturnType<typeof setInterval> | undefined;
  private rec: Rec | null = null;
  private mode: "off" | "hear" | "barge" = "off";
  private opened = false;
  private said = ""; private base = "";
  private spoken: (() => string) | null = null;
  private onInterrupt: ((heard: string) => void) | null = null;
  private sessionHasEcho = false; private echoUntil = 0;
  private pause: ReturnType<typeof setTimeout> | undefined; private watchdog: ReturnType<typeof setTimeout> | undefined;
  constructor(private C: RecCtor, public kind: "device" | "browser", private ev: ListenEvents) {}

  start() {
    const wasOpen = this.mode !== "off" && !!this.rec;
    this.mode = "hear"; this.said = ""; this.base = ""; clearTimeout(this.pause);
    this.echoUntil = Date.now() + ECHO_TAIL_MS;
    if (wasOpen) return; // already listening: no gap
    void this.openMeter();
    this.opened = false;
    this.open();
    this.watchdog = setTimeout(() => { if (this.mode !== "off" && !this.opened) { this.stop(); this.ev.onBroken(); } }, 3500);
  }
  overlap(spoken: () => string, onInterrupt: (heard: string) => void) {
    if (!this.canOverlap) { this.stop(); return; }
    this.spoken = spoken; this.onInterrupt = onInterrupt;
    this.mode = "barge"; this.said = ""; this.base = ""; clearTimeout(this.pause);
    this.sessionHasEcho = true;
    // A fresh session, so what the user just said doesn't count as interrupting.
    if (this.rec) { try { this.rec.abort(); } catch { /* already stopped */ } } else this.open();
  }
  private async openMeter() {
    if (this.meterStream || !navigator.mediaDevices) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const ctx = voiceContext();
      if (this.mode === "off" || !ctx) { stream.getTracks().forEach((t) => t.stop()); return; }
      this.meterStream = stream;
      const analyser = ctx.createAnalyser(); analyser.fftSize = 1024;
      this.meterSource = ctx.createMediaStreamSource(stream); this.meterSource.connect(analyser);
      const sink = ctx.createGain(); sink.gain.value = 0; analyser.connect(sink); sink.connect(ctx.destination); // see RecordingListener.wire
      let floor = 0.004;
      const data = new Uint8Array(analyser.fftSize);
      this.meterTick = setInterval(() => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += ((v - 128) / 128) ** 2;
        const rms = Math.sqrt(sum / data.length);
        if (rms < Math.max(0.012, floor * 2.5)) floor += (rms - floor) * 0.05;
        this.ev.onLevel(loudness(rms, floor));
      }, 60);
    } catch { /* the glow just won't follow their voice */ }
  }
  private closeMeter() {
    clearInterval(this.meterTick);
    this.meterSource?.disconnect(); this.meterSource = null;
    this.meterStream?.getTracks().forEach((t) => t.stop()); this.meterStream = null;
  }
  stop() {
    this.closeMeter();
    this.mode = "off"; clearTimeout(this.pause); clearTimeout(this.watchdog);
    const r = this.rec; this.rec = null;
    if (r) { r.onend = r.onresult = r.onerror = r.onstart = null; try { r.abort(); } catch { /* already stopped */ } }
  }
  private open() {
    const r = new this.C();
    r.lang = language(); r.continuous = true; r.interimResults = true;
    if (this.kind === "device") r.processLocally = true;
    r.onstart = () => { this.opened = true; clearTimeout(this.watchdog); };
    r.onresult = (e) => this.heard(e);
    r.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      this.stop();
      if (e.error === "not-allowed") this.ev.onDenied(); else this.ev.onBroken();
    };
    r.onend = () => { // browsers end a session after a quiet spell
      if (this.rec === r) this.rec = null;
      if (this.mode === "off") return;
      if (this.mode === "hear") { this.base = this.said; if (!this.base) this.sessionHasEcho = false; }
      setTimeout(() => { if (this.mode !== "off" && !this.rec) this.open(); }, 60);
    };
    this.rec = r;
    try { r.start(); } catch { this.stop(); this.ev.onBroken(); }
  }
  private heard(e: RecEvent) {
    const filter = this.spoken && (this.sessionHasEcho || Date.now() < this.echoUntil) ? this.spoken() : "";
    let text = "", final = false;
    for (let i = 0; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      text += ` ${filter ? stripEcho(t, filter) : t}`;
      final = !!e.results[i].isFinal;
    }
    text = text.replace(/\s+/g, " ").trim();
    if (this.mode === "barge") {
      if (!wantsIn(text, filter)) return;
      this.mode = "hear";
      this.onInterrupt?.(text);
    } else if (this.mode !== "hear") return;
    const all = `${this.base} ${text}`.trim();
    if (!all) return;
    this.said = all;
    this.ev.onText(all);
    clearTimeout(this.pause);
    this.pause = setTimeout(() => this.finish(), final ? PAUSE_AFTER_FINAL_MS : PAUSE_MS);
  }
  private finish() { const t = this.said; if (t) this.ev.onDone(t); }
}

const pickMime = () => ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) ?? "";

const QUIET_S = 0.7; // when the server is listening: this much silence after their last word means the user's finished
/** Whisper bills every second of audio, silence too, and the server's ear sends the same audio repeatedly: don't do that for a mic that sends nothing. */
const GIVE_UP_MS = 30_000;
/** Stops a recorder and waits for its last piece of audio. */
const stopped = (r: MediaRecorder) => new Promise<void>((done) => {
  if (r.state === "inactive") { setTimeout(done, 150); return; } // someone else stopped it: give its last piece time to arrive
  r.addEventListener("stop", () => done(), { once: true });
  try { r.stop(); } catch { done(); }
});

class RecordingListener implements Listener {
  kind = "cloud" as const;
  private mode: "off" | "hear" | "sending" | "barge" = "off";
  private stream: MediaStream | null = null; private ctx: AudioContext | null = null; private analyser: AnalyserNode | null = null; private source: MediaStreamAudioSourceNode | null = null; private sink: GainNode | null = null;
  private opening: Promise<boolean> | null = null;
  private rec: MediaRecorder | null = null; private chunks: Blob[] = [];
  private tick: ReturnType<typeof setInterval> | undefined;
  private floor = 0.004; private peak = 0; private problem = "";
  private voiced = 0; private lastVoice = 0; private began = 0;
  private output: () => number = () => 0;
  private onInterrupt: ((heard: string) => void) | null = null;
  private bargeFrom = 0; private rising = 0; private lastLoud = 0;
  // Where the level meter reads nothing at all, the server listens instead: see poll().
  private wiredAt = 0; private signal = false; private remote = false;
  private turn = 0; private flying = 0; private seq = 0; private applied = 0; private nextPoll = 0; private pieces = false; private carry = ""; private said = "";
  private checked = false; private reopened = false; private lastWords = 0; private deaf = false;
  private lastTrace = 0; private tracePeak = 0;
  constructor(private ev: ListenEvents) {}

  /** Talking over the assistant needs the level meter. Without it, tap. */
  get canOverlap() { return !this.remote; }

  start() {
    this.turn++; this.mode = "hear"; this.carry = ""; this.said = ""; this.lastWords = Date.now(); this.deaf = false;
    prepareLocalEar();
    void this.ready().then((ok) => { if (ok && this.mode === "hear") this.record(); });
  }
  overlap(_spoken: () => string, onInterrupt: (heard: string) => void, output: () => number) {
    this.turn++; this.discard();
    this.onInterrupt = onInterrupt; this.output = output;
    this.mode = "barge"; this.bargeFrom = Date.now(); this.rising = 0;
  }
  stop() {
    this.turn++; this.mode = "off"; clearInterval(this.tick); this.tick = undefined;
    this.discard();
    this.stream?.getTracks().forEach((t) => t.stop()); this.stream = null;
    this.source?.disconnect(); this.source = null; this.sink?.disconnect(); this.sink = null;
    this.ctx = null; this.analyser = null; this.opening = null; this.remote = false; // the shared audio system stays open
  }
  /** The microphone stays open for the whole conversation, so there's no delay between turns. */
  private ready() {
    this.opening ??= (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        trace("mic-open", { tracks: stream.getAudioTracks().length, muted: stream.getAudioTracks()[0]?.muted, state: stream.getAudioTracks()[0]?.readyState });
        if (this.mode === "off") { stream.getTracks().forEach((t) => t.stop()); return false; }
        this.stream = stream;
        for (const t of stream.getAudioTracks()) { t.onmute = () => trace("track-muted"); t.onunmute = () => trace("track-unmuted"); t.onended = () => trace("track-ended"); }
        this.tick = setInterval(() => this.listen(), 60);
        void this.wire();
        return true;
      } catch (e) {
        const denied = (e as Error).name === "NotAllowedError";
        trace("mic-error", { name: (e as Error).name });
        this.stop();
        if (denied) this.ev.onDenied(); else this.ev.onBroken();
        return false;
      }
    })();
    return this.opening;
  }
  /**
   * Connects the mic to the level meter, once audio is running (opening the mic interrupts it for a moment on a phone). The
   * meter leads to the speakers at zero volume because Safari doesn't run audio nodes that lead nowhere.
   */
  private async wire() {
    this.wiredAt = Date.now(); this.signal = false;
    const ctx = voiceContext();
    if (!ctx) return;
    this.ctx = ctx;
    await ctx.resume().catch(() => {});
    for (let i = 0; i < 20 && ctx.state !== "running"; i++) { await new Promise((r) => setTimeout(r, 50)); void ctx.resume().catch(() => {}); }
    if (this.mode === "off" || !this.stream) return;
    try {
      this.source?.disconnect(); this.sink?.disconnect();
      const analyser = ctx.createAnalyser(); analyser.fftSize = 1024;
      this.source = ctx.createMediaStreamSource(this.stream);
      this.source.connect(analyser);
      this.sink = ctx.createGain(); this.sink.gain.value = 0;
      analyser.connect(this.sink); this.sink.connect(ctx.destination);
      this.analyser = analyser;
    } catch (e) { trace("wire-error", { name: (e as Error).name }); }
    this.wiredAt = Date.now();
    trace("mic-wired", { ctx: ctx.state, rate: ctx.sampleRate });
  }
  private record() {
    if (!this.stream) return;
    this.discard();
    const mime = pickMime(), chunks: Blob[] = []; // its own list: a recorder's last piece can arrive after the next one has started
    this.chunks = chunks; this.voiced = 0; this.lastVoice = 0; this.began = Date.now();
    const r = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    r.start(250);
    trace("record-start", { mime: r.mimeType, state: r.state });
    this.rec = r;
  }
  private discard() {
    const r = this.rec; this.rec = null;
    if (r && r.state !== "inactive") { try { r.stop(); } catch { /* stopped */ } }
  }
  private listen() {
    const now = Date.now();
    let rms = 0;
    if (this.analyser) {
      const data = new Float32Array(this.analyser.fftSize); // whole bytes would round a quiet room to exactly nothing
      this.analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += v * v;
      rms = Math.sqrt(sum / data.length);
    }
    if (this.ctx && this.ctx.state !== "running") void this.ctx.resume(); // opening the mic can interrupt it on a phone
    // A real microphone is never perfectly silent. If the meter is, it isn't working here, and the server listens instead.
    if (rms > 0) this.signal = true;
    else if (!this.signal && !this.remote && now - this.wiredAt > 1200) { this.remote = true; trace("remote-ear", { ctx: this.ctx?.state }); }
    this.peak = Math.max(this.peak, rms); this.tracePeak = Math.max(this.tracePeak, rms);
    if (now - this.lastTrace > 4000) { this.lastTrace = now; trace("level", { mode: this.mode, remote: this.remote, ctx: this.ctx?.state, peak: +this.tracePeak.toFixed(5), muted: this.stream?.getAudioTracks()[0]?.muted }); this.tracePeak = 0; }
    if (this.remote) { if (this.mode === "hear") void this.poll(now); return; }
    if (this.mode === "barge") { this.watch(rms, now); return; }
    if (this.mode !== "hear") return;
    this.ev.onLevel(loudness(rms, this.floor));
    // Phones pick up speech more quietly than computers, so "loud" is measured against this room's own background noise.
    const loud = rms > Math.max(0.004, this.floor * 3);
    if (!loud) this.floor += (rms - this.floor) * 0.05;
    if (loud) { this.voiced += 60; this.lastVoice = now; }
    if (this.voiced >= 240 && now - this.lastVoice > PAUSE_MS) void this.send();
    else if (!this.voiced && now - this.began > 25_000) this.record(); // keep a long silence from piling up
  }
  /** While the assistant talks: a voice that's clearly louder than what's left of its echo means the user's talking over it. */
  private watch(rms: number, now: number) {
    if (now - this.bargeFrom < 350) return; // echo cancellation needs a moment to settle
    if (rms > Math.max(0.02, this.floor * 4) + this.output() * 0.1) {
      this.lastLoud = now;
      if (!this.rising) { this.rising = now; this.record(); } // recording from the first sound keeps their first word
      if (now - this.rising >= 240) {
        const voiced = now - this.rising;
        this.mode = "hear"; this.rising = 0; this.voiced = voiced; this.lastVoice = now;
        this.onInterrupt?.("");
      }
    } else if (this.rising && now - this.lastLoud > 150) { this.rising = 0; this.discard(); }
  }
  /**
   * The server's ear, for when the meter can't tell when the user stops. The recording so far goes up about once a second and comes
   * back as words plus how long it's been quiet since the last one: quiet for long enough means the user's finished. A long
   * recording is closed and a new one started in the same instant, keeping the words so far (`carry`), so uploads stay small
   * and nothing is lost. Browsers that only hand over a recording when it stops work the same way, a piece at a time.
   */
  private async poll(now: number) {
    const rec = this.rec, chunks = this.chunks;
    if (!rec || now < this.nextPoll || now - this.began < (this.pieces ? 2000 : 700)) return;
    // While the user's talking a second check may start before the first is back, so the end of their sentence is caught sooner.
    if (this.flying >= (this.said && !this.pieces ? 2 : 1)) return;
    if (!chunks.length && !this.pieces) {
      if (now - this.began < 2500) return;
      this.pieces = true; trace("pieces");
    }
    const turn = this.turn, seq = ++this.seq, type = rec.mimeType || "audio/webm";
    const fresh = this.flying === 0 && (this.pieces || now - this.began > (this.said ? 20_000 : 12_000));
    this.flying++; this.nextPoll = now + 700;
    if (fresh) {
      await stopped(rec);
      if (turn === this.turn && this.mode === "hear") { this.rec = null; this.record(); }
    }
    const blob = new Blob(chunks, { type });
    let r: { text: string; duration: number; quiet: number } | null = null;
    try { r = blob.size ? await api.hear(blob, type) : { text: "", duration: 0, quiet: 0 }; if (blob.size) usedCloud(); }
    catch (e) {
      trace("hear-error", { message: (e as Error).message.slice(0, 120), bytes: blob.size, type });
      if (turn === this.turn && this.problem !== (e as Error).message) { this.problem = (e as Error).message; this.ev.onIssue(`Having trouble hearing you: ${this.problem}`); }
    }
    this.flying--;
    if (turn !== this.turn || this.mode !== "hear" || seq < this.applied) return; // the user tapped, muted, the conversation moved on, or a later check already answered
    this.applied = seq;
    if (!r) { this.nextPoll = Date.now() + 2000; return; }
    trace("heard-so-far", { bytes: blob.size, pieces: chunks.length, chars: r.text.length, quiet: +r.quiet.toFixed(2), seconds: +r.duration.toFixed(1), fresh });
    const before = this.carry, all = `${before} ${r.text}`.trim();
    if (fresh) this.carry = all;
    if (!all) {
      if (Date.now() - this.lastWords > GIVE_UP_MS) {
        this.discard(); this.deaf = true;
        this.ev.onIssue("I can't hear anything. Check your mic or earbuds, then tap to keep listening.");
        return;
      }
      this.nextPoll = Date.now() + (this.pieces ? 0 : 1200); // nothing yet: no need to hurry
      if (!this.checked && r.duration >= 2) void this.checkRecording(blob);
      return;
    }
    this.said = all; this.lastWords = Date.now();
    this.ev.onText(all); this.ev.onLevel(0.5);
    // Finished if it's been quiet since their last word, or a whole new recording after their words has nothing in it.
    if (r.text ? r.quiet >= QUIET_S : r.duration >= QUIET_S) { this.finish(all); return; }
    if (this.pieces) this.nextPoll = 0;
  }
  private finish(text: string) {
    this.turn++; this.mode = "sending"; this.discard();
    trace("finished", { chars: text.length });
    this.ev.onDone(text);
  }
  /** Once, when the server hears nothing: is the recording itself pure silence? Then the mic is being silenced, so open it again plainly. */
  private async checkRecording(blob: Blob) {
    this.checked = true;
    try {
      const audio = await voiceContext()!.decodeAudioData(await blob.arrayBuffer());
      let peak = 0;
      const data = audio.getChannelData(0);
      for (let i = 0; i < data.length; i += 4) peak = Math.max(peak, Math.abs(data[i]));
      trace("recording-check", { seconds: +audio.duration.toFixed(1), peak: +peak.toFixed(5) });
      if (peak === 0 && !this.reopened && this.mode !== "off") {
        this.reopened = true;
        this.discard();
        this.stream?.getTracks().forEach((t) => t.stop());
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        trace("mic-reopened", { muted: this.stream.getAudioTracks()[0]?.muted });
        if ((this.mode as string) === "off") { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; return; }
        void this.wire();
        if (this.mode === "hear") this.record();
      }
    } catch (e) { trace("recording-check-failed", { name: (e as Error).name }); }
  }
  /** Tapping the screen sends what's been recorded, whatever anything else thinks. */
  finishNow() {
    if (this.deaf && this.mode === "hear") { this.deaf = false; this.lastWords = Date.now(); this.ev.onIssue(""); this.record(); return true; }
    if (this.mode !== "hear" || !this.rec || Date.now() - this.began < 500) return false;
    trace("tapped-send", { voiced: this.voiced, remote: this.remote });
    void this.send();
    return true;
  }
  check() {
    const level = Math.round(Math.min(1, this.peak * 12) * 100);
    this.peak = 0;
    return `Microphone ${this.stream ? "on" : "off"}, audio ${this.ctx?.state ?? "not started"}, ${this.remote ? "the server is listening for when you stop" : `loudest sound ${level}%`}${this.problem ? `, last problem: ${this.problem}` : ""}${earNote() ? `. ${earNote()}` : ""}`;
  }
  private async send() {
    const r = this.rec, chunks = this.chunks;
    if (!r) return;
    const turn = ++this.turn;
    this.mode = "sending"; this.rec = null;
    await stopped(r);
    if (turn !== this.turn) return;
    const type = r.mimeType || "audio/webm", blob = new Blob(chunks, { type });
    trace("send", { bytes: blob.size, pieces: chunks.length, type, voiced: this.voiced });
    if (!this.said) this.ev.onText("…");
    let text = this.carry;
    try { text = `${text} ${await localHear(blob, this.voiced) ?? (await api.hear(blob, type)).text}`.trim(); trace("transcribed", { chars: text.length }); }
    catch (e) { trace("transcribe-error", { message: (e as Error).message.slice(0, 120) }); this.problem = (e as Error).message; if (turn === this.turn) this.ev.onIssue(`Couldn't make out what you said: ${this.problem}`); }
    if (turn !== this.turn) return;
    if (text) { this.ev.onDone(text); return; }
    this.ev.onText("");
    this.mode = "hear"; this.carry = ""; this.said = "";
    this.record();
  }
}

export const recordingListener = (ev: ListenEvents): Listener => new RecordingListener(ev);

/** The most private way of listening this device can do. */
export async function createListener(ev: ListenEvents, onDownload?: () => void): Promise<Listener | null> {
  const C = recCtor();
  trace("listener", { hasRecognizer: !!C, ios: isIos(), recorder: typeof MediaRecorder !== "undefined", media: !!navigator.mediaDevices, ctx: voiceContext()?.state });
  if (C && !isIos()) return new SpeechListener(C, (await canRunLocally(C, onDownload)) ? "device" : "browser", ev);
  if (navigator.mediaDevices && typeof MediaRecorder !== "undefined") return new RecordingListener(ev);
  return null;
}
