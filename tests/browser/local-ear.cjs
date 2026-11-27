// On-device speech for live voice with the REAL model (downloads about 55 MB the first time, all from this app: copy the model
// into the test server's R2 first with `npm run voice:model -- --local --persist-to <its folder>`).
// In Chromium: transcribes a recording, then a whole live voice turn through a fake microphone playing it, with no request to
// Workers AI. In WebKit (Safari's engine): loads and transcribes. Needs the dev server (it imports the module directly) with
// ANTHROPIC_API_KEY=mock. tests/fixtures/speech.wav says "What should I study tonight for my biology test?"
const fs = require("fs"), path = require("path");
const { chromium, webkit } = require("playwright");
const B = process.env.SEAGLASS_URL || "http://localhost:5173";
const WAV = path.join(__dirname, "..", "fixtures", "speech.wav");
const SAID = /what should i study tonight for my biology test/i;
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };

// Loads the model, then transcribes the recording twice (the first includes warming up) and once as a tap with nothing said.
const transcribe = (page) => once(page).catch(async (e) => {
  if (!/context was destroyed/.test(e.message)) throw e;
  await page.waitForLoadState("networkidle"); // the dev server reloads the page the first time it prepares the package
  return once(page);
});
const once = (page) => page.evaluate(async (b64) => {
  const ear = await import("/src/client/voice/localEar.ts");
  const t0 = performance.now();
  ear.prepareLocalEar();
  const why = await new Promise((res) => ear.watchEar((e) => { if (e.state === "ready") res(""); if (e.state === "failed") res(e.why); }));
  const load = performance.now() - t0;
  if (why) return { why };
  const blob = new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: "audio/wav" });
  const t1 = performance.now(), first = await ear.localHear(blob, 2000), firstMs = performance.now() - t1;
  const t2 = performance.now(), second = await ear.localHear(blob, 2000), secondMs = performance.now() - t2;
  const tapped = await ear.localHear(blob, 0);
  return { load, first, firstMs, second, secondMs, tapped };
}, fs.readFileSync(WAV).toString("base64"));

/** A 16-bit PCM WAV as 16 kHz mono float samples (first channel, linear resampling: fine for a test). */
const pcm16k = (wav) => {
  let at = 12, rate = 0, channels = 1, data = null;
  while (at < wav.length - 8) {
    const id = wav.toString("ascii", at, at + 4), size = wav.readUInt32LE(at + 4);
    if (id === "fmt ") { channels = wav.readUInt16LE(at + 10); rate = wav.readUInt32LE(at + 12); }
    if (id === "data") data = wav.subarray(at + 8, at + 8 + size);
    at += 8 + size + (size & 1);
  }
  const n = Math.floor(data.length / 2 / channels), out = new Float32Array(Math.floor(n * 16000 / rate));
  for (let i = 0; i < out.length; i++) {
    const x = i * rate / 16000, j = Math.floor(x), f = x - j;
    const a = data.readInt16LE(j * channels * 2) / 32768, b = j + 1 < n ? data.readInt16LE((j + 1) * channels * 2) / 32768 : a;
    out[i] = a + (b - a) * f;
  }
  return Buffer.from(out.buffer);
};

const report = (name, r) => {
  check(!r.why, `${name}: the model loads (${r.why || `${(r.load / 1000).toFixed(1)} s`})`);
  if (r.why) return;
  check(SAID.test(r.first ?? ""), `${name}: it hears the sentence (${JSON.stringify(r.first)}, ${(r.firstMs / 1000).toFixed(2)} s)`);
  check(SAID.test(r.second ?? ""), `${name}: and again, warmed up (${(r.secondMs / 1000).toFixed(2)} s)`);
  if (r.tapped !== undefined) check(r.tapped === null, `${name}: a tap with nothing said is left to Workers AI`);
};

(async () => {
  // ---- Chromium: the module, then a whole conversation turn
  const b = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${WAV}%noloop`] });
  const c = await b.newContext({ permissions: ["microphone"] });
  const p = await c.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  let hears = 0, asked = null;
  await c.route("**/api/voice/hear*", (r) => { hears++; r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: "(cloud)", duration: 3, quiet: 1 }) }); });
  await c.route("**/api/voice/speak", (r) => r.fulfill({ status: 501, contentType: "application/json", body: "{}" }));
  await c.route("**/api/agent", (r) => { asked = r.request().postDataJSON().message; r.fulfill({ status: 200, contentType: "application/x-ndjson", body: ['{"type":"text","delta":"Start with cell transport."}', '{"type":"done","run_id":"r","changes":0,"usage":{"input":1,"output":1,"cache_read":0,"cache_write":0,"cost_usd":0},"stop":"end_turn"}'].join("\n") + "\n" }); });
  await c.addInitScript(() => {
    Object.defineProperty(window, "SpeechRecognition", { value: undefined }); Object.defineProperty(window, "webkitSpeechRecognition", { value: undefined });
    Object.defineProperty(window, "speechSynthesis", { value: { getVoices: () => [], cancel() {}, speak(u) { setTimeout(() => u.onend && u.onend(), 50); } } });
    localStorage.setItem("sg.agent", "1");
  });
  await p.goto(B + "/", { waitUntil: "networkidle" });
  let outside = 0;
  c.on("request", (r) => { if (/huggingface\.co|hf\.co/.test(new URL(r.url()).hostname)) outside++; });
  report("Chromium", await transcribe(p));
  check(outside === 0, `the model comes from Seaglass, not Hugging Face (${outside} requests outside)`);

  // the model is cached and loaded now, so the turn below shows the on-device path end to end
  await p.locator(".send.live").click();
  for (let i = 0; i < 120 && !asked; i++) await p.waitForTimeout(250);
  check(SAID.test(asked ?? ""), `a live voice turn sends what was said (${JSON.stringify(asked)})`);
  check(hears === 0, `without sending any audio to Workers AI (${hears} requests)`);
  check(/On device/.test(await p.locator(".lv-engine").innerText().catch(() => "")), "and the screen says it's on the device");
  await p.locator("[aria-label='Voice settings']").click();
  check(/On-device speech ready, last took/.test(await p.locator(".lv-check").innerText().catch(() => "")), "the mic check says how long it took");
  check(await p.locator(".lv-ear input").isChecked(), "and there's a switch for it, on");
  check(!errs.length, `no page errors ${errs.join(" | ")}`);

  // coming back: the model comes from the browser's cache, not the network
  let big = 0;
  c.on("requestfinished", async (r) => { if (/\/api\/voice\/model\/|^https:\/\/([^/]+\.)?(huggingface\.co|hf\.co)\//.test(r.url())) { const z = await r.sizes().catch(() => null); if (z && z.responseBodySize > 1e6) { big++; console.log("  large:", z.responseBodySize, r.url().slice(0, 170)); } } });
  await p.reload({ waitUntil: "networkidle" });
  const back = Date.now();
  await p.locator(".send.live").click();
  await p.locator(".lv-engine", { hasText: "On device" }).waitFor({ timeout: 60000 }).catch(() => {});
  check(/On device/.test(await p.locator(".lv-engine").innerText().catch(() => "")), `coming back, it's ready again in ${((Date.now() - back) / 1000).toFixed(1)} s`);
  check(big === 0, `without downloading the model again (${big} large downloads)`);
  await p.close();

  // a mic whose level can't be read: the server listens, and the screen must not claim it's on the device
  const d = await c.newPage();
  await d.addInitScript(() => { AudioContext.prototype.createMediaStreamSource = function () { return this.createGain(); }; });
  hears = 0; asked = null;
  await d.goto(B + "/", { waitUntil: "networkidle" });
  await d.locator(".send.live").click();
  for (let i = 0; i < 80 && !asked; i++) await d.waitForTimeout(250);
  check(asked === "(cloud)" && hears > 0, `with a dead meter Workers AI does the listening (${hears} requests)`);
  await d.locator(".lv-engine", { hasText: "Cloud transcription" }).waitFor({ timeout: 30000 }).catch(() => {});
  await d.waitForTimeout(1500); // and stays that way once the model is ready
  check(/Cloud transcription/.test(await d.locator(".lv-engine").innerText().catch(() => "")), `and the screen says so (${await d.locator(".lv-engine").innerText().catch(() => "")})`);
  await b.close();

  // ---- WebKit, Safari's engine. Playwright's WebKit on Windows has no Web Audio (real Safari does, and the app already decodes
  // recordings with it on iPhone), so here the model thread gets 16 kHz audio decoded by this script.
  const w = await webkit.launch();
  const wp = await (await w.newContext()).newPage();
  await wp.goto(B + "/", { waitUntil: "networkidle" });
  const r = await wp.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const thread = new Worker("/src/client/voice/localEar.worker.ts", { type: "module" });
    const next = (type) => new Promise((res) => { thread.onmessage = ({ data }) => { if (data.type === type || data.type === "failed") res(data); }; });
    const t0 = performance.now();
    const loaded = next("ready"); thread.postMessage({ type: "load" });
    const l = await loaded;
    if (l.type === "failed") return { why: l.message };
    const out = [];
    for (let i = 0; i < 2; i++) {
      const pcm = new Float32Array(bytes.buffer.slice(0)), t = performance.now(), heard = next("heard");
      thread.postMessage({ type: "hear", id: i, pcm }, [pcm.buffer]);
      const h = await heard;
      out.push({ text: h.text ?? h.error, ms: performance.now() - t });
    }
    thread.terminate();
    return { load: performance.now() - t0, first: out[0].text, firstMs: out[0].ms, second: out[1].text, secondMs: out[1].ms };
  }, pcm16k(fs.readFileSync(WAV)).toString("base64")).catch((e) => ({ why: e.message.split("\n")[0] }));
  report("WebKit", r);
  await w.close();

  console.log(fails ? `${fails} failed` : "all good");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
