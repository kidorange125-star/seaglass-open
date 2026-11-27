// Saying the assistant's reply out loud, one sentence after another. Each sentence's audio is fetched as soon as it's ready, so
// the next is waiting when the last one ends. If no voice service is set up, or it fails, it uses the device's own voice.
const PCM_RATE = 24_000; // Gemini's raw audio
import { trace } from "./trace";

let shared: AudioContext | null = null;
type Ctor = typeof AudioContext;
const context = () => {
  const C: Ctor | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
  if (C && !shared) shared = new C();
  return shared;
};

/** The one audio system for the whole conversation. iPhones leave any audio system made after the tap frozen, so the mic has to share this one. */
export const voiceContext = context;

/** Phones only allow sound that starts from a tap, so the button that opens live voice calls this straight away. */
export function unlockVoice() {
  const ctx = context();
  if (ctx) {
    void ctx.resume();
    const s = ctx.createBufferSource(); s.buffer = ctx.createBuffer(1, 1, 22_050); s.connect(ctx.destination); s.start();
  }
  // iPhones: the device voice grabs the audio session and can silence the mic, so don't wake it up just in case.
  if (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return;
  try { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; speechSynthesis.speak(u); } catch { /* no device voice */ }
}

const MALE = /\b(daniel|alex|aaron|evan|fred|tom|rishi|nathan|arthur|oliver|reed|david|mark|guy|ryan|male)\b/i;
/** The most natural male voice this device has. */
function deviceVoice() {
  const lang = (navigator.language || "en").slice(0, 2), voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith(lang));
  const men = voices.filter((v) => MALE.test(v.name));
  return men.find((v) => /premium|enhanced|natural|neural/i.test(v.name)) ?? men[0] ?? voices.find((v) => /premium|enhanced|natural|neural/i.test(v.name)) ?? voices[0];
}

export interface SpeakerEvents { onSpeaking: (text: string) => void; onIdle: () => void; onNotice: (message: string) => void }
interface Item { text: string; audio: Promise<AudioBuffer | null> }

export class Speaker {
  private queue: Item[] = [];
  private playing = false; private finished = false; private useDevice = false;
  private generation = 0;
  private fetches = new AbortController();
  private source: AudioBufferSourceNode | null = null;
  private release: (() => void) | null = null;
  private analyser: AnalyserNode | null = null;
  private deviceTalking = false;
  /** Speaking speed, 1 is normal. */
  rate = 1;
  constructor(private ev: SpeakerEvents) {}

  begin() { this.finished = false; }
  say(text: string) {
    this.queue.push({ text, audio: this.useDevice ? Promise.resolve(null) : this.fetchAudio(text) });
    void this.pump();
  }
  /** No more sentences are coming in this reply. */
  finish() { this.finished = true; void this.pump(); }
  stop() {
    this.generation++; this.queue = []; this.playing = false; this.finished = false;
    this.fetches.abort(); this.fetches = new AbortController();
    try { this.source?.stop(); } catch { /* already ended */ }
    this.source = null;
    try { speechSynthesis.cancel(); } catch { /* no device voice */ }
    this.release?.(); this.release = null;
  }
  /** How loud the voice is right now, 0 to 1. */
  level() {
    if (this.deviceTalking) { const t = performance.now() / 1000; return 0.42 + 0.3 * Math.sin(t * 9) * Math.sin(t * 2.3); } // the device's voice can't be measured, so give it the rhythm of speech
    if (!this.analyser || !this.source) return 0;
    const data = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += ((v - 128) / 128) ** 2;
    return Math.min(1, Math.sqrt(Math.sqrt(sum / data.length)) * 1.5); // loudness is closer to the square root of level
  }

  private async fetchAudio(text: string): Promise<AudioBuffer | null> {
    const ctx = context();
    if (!ctx) return null;
    try {
      const res = await fetch("/api/voice/speak", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: this.fetches.signal });
      trace("speak-response", { status: res.status, type: res.headers.get("Content-Type"), ctx: ctx.state });
      if (!res.ok) {
        const message = res.status === 501 ? "Using your device's voice until a voice service is set up." : `Using your device's voice. ${((await res.json().catch(() => ({}))) as { error?: string }).error ?? ""}`.trim();
        if (!this.useDevice) this.ev.onNotice(message);
        this.useDevice = true;
        return null;
      }
      const data = await res.arrayBuffer();
      trace("speak-audio", { bytes: data.byteLength });
      if (!(res.headers.get("Content-Type") ?? "").includes("audio/pcm")) return await ctx.decodeAudioData(data);
      const samples = new Int16Array(data), buffer = ctx.createBuffer(1, Math.max(1, samples.length), PCM_RATE), out = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) out[i] = samples[i] / 32768;
      return buffer;
    } catch (e) {
      trace("speak-error", { name: (e as Error).name, message: (e as Error).message.slice(0, 120) });
      if ((e as Error).name !== "AbortError" && !this.useDevice) { this.useDevice = true; this.ev.onNotice("Using your device's voice. The voice service can't be reached."); }
      return null;
    }
  }

  private async pump() {
    if (this.playing) return;
    const item = this.queue.shift();
    if (!item) {
      if (this.finished) { this.finished = false; this.ev.onIdle(); }
      return;
    }
    this.playing = true;
    const generation = this.generation, buffer = await item.audio;
    if (generation !== this.generation) return;
    this.ev.onSpeaking(item.text);
    await (buffer ? this.playBuffer(buffer) : this.playDevice(item.text));
    if (generation !== this.generation) return;
    this.playing = false;
    void this.pump();
  }

  private async playBuffer(buffer: AudioBuffer) {
    const ctx = context()!;
    await ctx.resume().catch(() => {});
    trace("play", { ctx: ctx.state, at: +ctx.currentTime.toFixed(2), seconds: +buffer.duration.toFixed(2), rate: buffer.sampleRate });
    if (!this.analyser) { this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 512; this.analyser.connect(ctx.destination); }
    await new Promise<void>((done) => {
      const s = ctx.createBufferSource();
      s.buffer = buffer; s.playbackRate.value = this.rate; s.connect(this.analyser!);
      const end = () => { clearTimeout(limit); if (this.source === s) this.source = null; this.release = null; done(); };
      // If the audio system has frozen (it can after a phone opens the mic), the end never comes: carry on, with the device's voice.
      const limit = setTimeout(() => { trace("play-timeout", { ctx: ctx.state }); this.useDevice = true; s.onended = null; try { s.stop(); } catch { /* never started */ } end(); }, (buffer.duration / this.rate) * 1000 + 2500);
      s.onended = end;
      this.source = s; this.release = end;
      s.start();
    });
  }

  private playDevice(text: string) {
    return new Promise<void>((done) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      this.deviceTalking = true;
      const end = () => { clearTimeout(timer); this.deviceTalking = false; this.release = null; done(); };
      this.release = end;
      try {
        const u = new SpeechSynthesisUtterance(text), voice = deviceVoice();
        if (voice) u.voice = voice;
        u.rate = this.rate;
        u.onend = end; u.onerror = end;
        timer = setTimeout(end, 4000 + text.length * 120); // some browsers never report the end
        speechSynthesis.speak(u);
      } catch { end(); }
    });
  }
}
