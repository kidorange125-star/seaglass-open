// Turning speech into text on the phone itself, so it costs nothing and the audio stays there. Used by the recording path in
// listen.ts, one call per thing the user says. It never makes them wait: the model downloads in the background while Workers AI
// keeps working, and anything it can't do well (not ready, too slow, nothing clearly said, a very long clip) goes to Workers
// AI instead, which `localHear` signals by answering null.
import { voiceContext } from "./speaker";
import { cleanHeard } from "./text";
import { trace } from "./trace";

export interface Ear { state: "off" | "loading" | "ready" | "failed"; pct: number; last: "device" | "cloud" | null; ms: number; why: string }

const PREF = "sg.voice.ear", GUARD = "sg.voice.earGuard";
const RATE = 16_000, MAX_SECONDS = 28; // Whisper takes 30 seconds at a time
const TOO_SLOW_MS = 6000, MIN_VOICED_MS = 240;
const CRASH_PAUSE_MS = 7 * 86_400_000;

let ear: Ear = { state: "off", pct: 0, last: null, ms: 0, why: "" };
let worker: Worker | null = null;
let seq = 0, slow = 0;
const pending = new Map<number, { done: (text: string | null) => void; timer: ReturnType<typeof setTimeout>; seconds: number; voiced: number }>();
const watchers = new Set<(e: Ear) => void>();
const update = (change: Partial<Ear>) => { ear = { ...ear, ...change }; watchers.forEach((w) => w(ear)); };

/** Being told about changes starts with the current state. Returns how to stop. */
export function watchEar(w: (e: Ear) => void) { watchers.add(w); w(ear); return () => { watchers.delete(w); }; }

const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, v: string | null) => { try { if (v === null) localStorage.removeItem(key); else localStorage.setItem(key, v); } catch { /* storage unavailable */ } };

// If the phone kills the page while the model starts up or transcribes, nothing here gets to run. So a mark is left before
// each and cleared after: finding it still there means it never finished. Once while starting up, or twice while
// transcribing, and this stays off for a week (the switch in voice settings clears that).
const guard = (): { busy?: boolean | "load"; crashes?: number; until?: number } => { try { return JSON.parse(read(GUARD) ?? "{}"); } catch { return {}; } };
function survivedLastTime() {
  const g = guard();
  if (g.until) { if (g.until > Date.now()) return false; write(GUARD, null); return true; }
  if (!g.busy) return true;
  const crashes = (g.crashes ?? 0) + 1;
  trace("ear-crashed", { crashes, while: g.busy === "load" ? "starting" : "transcribing" });
  if (crashes >= 2 || g.busy === "load") { write(GUARD, JSON.stringify({ until: Date.now() + CRASH_PAUSE_MS })); return false; }
  write(GUARD, JSON.stringify({ crashes }));
  return true;
}

/** Why on-device speech can't run here, or "" if it can. */
const unsupported = () => typeof Worker === "undefined" ? "this browser has no background threads"
  : typeof WebAssembly !== "object" ? "this browser has WebAssembly turned off (Lockdown Mode does this)"
  : !/^en\b/i.test(navigator.language || "en") ? "it only understands English"
  : "";
export const earSupported = () => !unsupported();
export const earEnabled = () => read(PREF) !== "cloud";
export function setEarEnabled(on: boolean) {
  write(PREF, on ? null : "cloud");
  closeLocalEar();
  if (on) { write(GUARD, null); prepareLocalEar(); }
}

/** Stopping the thread on purpose mid-transcription isn't a crash. */
function stopThread() {
  worker?.terminate(); worker = null;
  const g = guard();
  if (g.busy) write(GUARD, g.crashes ? JSON.stringify({ crashes: g.crashes }) : null);
}

function fail(why: string) {
  trace("ear-failed", { why });
  stopThread();
  for (const p of pending.values()) { clearTimeout(p.timer); p.done(null); }
  pending.clear();
  update({ state: "failed", why, last: "cloud" });
}

/** Starts getting the model ready, in the background. Safe to call any number of times. */
export function prepareLocalEar() {
  if (worker || ear.state === "failed") return;
  if (!earEnabled()) { trace("ear-skip", { why: "switched off" }); return; }
  const why = unsupported();
  if (why) { trace("ear-skip", { why }); update({ state: "failed", why, last: "cloud" }); return; }
  if (!survivedLastTime()) { trace("ear-skip", { why: "paused after a crash" }); update({ state: "failed", why: "paused for a week, because the page stopped while it was working (switch it off and on to try again)", last: "cloud" }); return; }
  slow = 0;
  trace("ear-start", { cached: ear.ms > 0 });
  update({ state: "loading", pct: 0, last: null, why: "" });
  try { worker = new Worker(new URL("./localEar.worker.ts", import.meta.url), { type: "module" }); }
  catch (e) { fail(`couldn't start the background thread: ${(e as Error).message}`); return; }
  let told = 0, running = false;
  const thread = worker;
  setTimeout(() => { if (!running && worker === thread) fail("the background thread didn't start"); }, 15_000);
  worker.onerror = (e) => fail(e.message || "the background thread stopped");
  worker.onmessage = ({ data }) => {
    running = true;
    if (data.type === "progress") {
      update({ pct: data.pct });
      if (data.pct >= told + 25) { told = data.pct - (data.pct % 25); trace("ear-progress", { pct: data.pct }); }
      if (data.pct >= 100 && !guard().busy) write(GUARD, JSON.stringify({ ...guard(), busy: "load" })); // downloaded: now it starts up
    }
    else if (data.type === "stage") trace("ear-stage", { stage: data.stage });
    else if (data.type === "ready") { write(GUARD, null); trace("ear-ready", { ms: data.ms }); update({ state: "ready", pct: 100 }); }
    else if (data.type === "failed") fail(data.message);
    else if (data.type === "heard") heard(data);
  };
  worker.postMessage({ type: "load" });
}

/** When the voice screen closes, the memory goes back. Next time it loads from the cache. */
export function closeLocalEar() {
  stopThread();
  for (const p of pending.values()) { clearTimeout(p.timer); p.done(null); }
  pending.clear();
  update({ state: "off", pct: 0, last: null, why: "" });
}

function heard(data: { id: number; text?: string; error?: string; ms?: number }) {
  write(GUARD, null); // it finished, so it didn't crash
  const p = pending.get(data.id);
  if (!p) return; // too late: Workers AI already answered this one
  pending.delete(data.id); clearTimeout(p.timer);
  if (data.error) { trace("ear-fallback", { why: data.error }); p.done(null); return; }
  const text = cleanHeard(data.text ?? "", p.voiced);
  trace("ear-heard", { ms: data.ms, seconds: +p.seconds.toFixed(1), chars: text.length });
  if (text) update({ ms: data.ms ?? 0 });
  else trace("ear-fallback", { why: "no words" });
  p.done(text || null); // it found nothing in something that sounded like speech: let the better model have a look
}

/** The recording as 16 kHz mono, which is what Whisper takes. Worker threads have no audio system, so this happens here. */
async function toPcm(blob: Blob) {
  const ctx = voiceContext();
  if (!ctx) return null;
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * RATE), RATE);
  const source = off.createBufferSource();
  source.buffer = decoded; source.connect(off.destination); source.start();
  return (await off.startRendering()).getChannelData(0).slice(); // a copy, so it can be handed to the thread
}

/** What the user said, or null if Workers AI should do this one. */
export async function localHear(blob: Blob, voiced: number): Promise<string | null> {
  const use = (text: string | null) => { update({ last: text === null ? "cloud" : "device" }); return text; };
  if (ear.state !== "ready" || !worker || voiced < MIN_VOICED_MS) return use(null); // a tap with nothing said: the bigger model handles silence better
  let pcm: Float32Array | null = null;
  try { pcm = await toPcm(blob); }
  catch (e) { trace("ear-fallback", { why: `decode: ${(e as Error).name}` }); }
  if (!pcm || !worker) return use(null);
  const seconds = pcm.length / RATE;
  if (seconds > MAX_SECONDS) return use(null);
  const id = ++seq, thread = worker, audio = pcm;
  return use(await new Promise<string | null>((done) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      trace("ear-fallback", { why: "too slow", seconds: +seconds.toFixed(1) });
      if (++slow >= 2) fail("too slow on this device"); // later answers would only fall further behind
      done(null);
    }, TOO_SLOW_MS);
    pending.set(id, { done, timer, seconds, voiced });
    write(GUARD, JSON.stringify({ ...guard(), busy: true }));
    thread.postMessage({ type: "hear", id, pcm: audio }, [audio.buffer]);
  }));
}

/** Workers AI heard this one some other way (the server's ear). */
export const usedCloud = () => { if (ear.last !== "cloud") update({ last: "cloud" }); };

/** One line for the mic check in the settings. */
export function earNote() {
  if (ear.state === "loading") return `On-device speech downloading, ${ear.pct}%`;
  if (ear.state === "failed") return `On-device speech unavailable: ${ear.why}`;
  if (ear.state !== "ready") return "";
  return ear.ms ? `On-device speech ready, last took ${(ear.ms / 1000).toFixed(1)} s` : "On-device speech ready";
}
