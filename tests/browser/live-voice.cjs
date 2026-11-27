// Live voice with a fake microphone and speaker: it listens, sends when you stop talking, speaks the reply sentence by sentence,
// goes back to listening; interrupt, mute, end, the fallbacks, and a phone. Needs ANTHROPIC_API_KEY=mock and no voice keys.
const fs = require("fs"), os = require("os"), path = require("path");
const { chromium } = require("playwright");
const B = process.env.SEAGLASS_URL || "http://localhost:5173";
const OUT = process.env.SHOTS || "";
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };

// A pretend recognizer and device voice. __say() is the person talking; __hold keeps the device voice "speaking".
const FAKE = (opts) => {
  class Fake {
    start() { window.__recs.push(this); window.__active = this; setTimeout(() => this.onstart?.(), 10); }
    abort() { if (window.__active === this) window.__active = null; window.__aborted++; setTimeout(() => this.onend?.(), 5); }
  }
  window.__recs = []; window.__aborted = 0; window.__said = []; window.__hold = false; window.__speaking = null;
  if (opts.available) Fake.available = async () => opts.available;
  if (opts.silentBroken) Fake.prototype.start = function () { window.__recs.push(this); };
  if (opts.denied) Fake.prototype.start = function () { setTimeout(() => this.onerror?.({ error: "not-allowed" }), 10); };
  if (!opts.noRecognizer) { window.webkitSpeechRecognition = Fake; Object.defineProperty(window, "SpeechRecognition", { value: Fake, configurable: true }); }
  else { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; Object.defineProperty(window, "SpeechRecognition", { value: undefined }); Object.defineProperty(window, "webkitSpeechRecognition", { value: undefined }); }
  window.__say = (t) => window.__active?.onresult?.({ results: [{ 0: { transcript: t } }] });
  const real = window.speechSynthesis;
  Object.defineProperty(window, "speechSynthesis", { value: {
    getVoices: () => [], cancel() { window.__cancelled = (window.__cancelled || 0) + 1; window.__speaking = null; },
    speak(u) { if (u.text === " ") return; window.__said.push(u.text); window.__speaking = u; if (!window.__hold) setTimeout(() => { if (window.__speaking === u) { window.__speaking = null; u.onend?.(); } }, 40); },
  } });
  void real;
  localStorage.setItem("sg.agent", "1");
  localStorage.setItem("sg.voice.ear", "cloud"); // never downloads the real model here: tests/browser/local-ear.cjs does that
};
const wav = () => { // half a second of a quiet tone, as mono 16-bit
  const rate = 8000, n = rate / 2, b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 3) * 8000), 44 + i * 2);
  return b;
};

(async () => {
  const b = await chromium.launch();
  const open = async (opts = {}, ctx = {}) => {
    const c = await b.newContext({ viewport: { width: 1280, height: 860 }, ...ctx });
    const p = await c.newPage();
    p.errs = []; p.on("pageerror", (e) => p.errs.push(e.message));
    p.agent = []; p.on("request", (r) => { if (r.url().endsWith("/api/agent")) p.agent.push(r.postDataJSON()); });
    await p.addInitScript(FAKE, opts);
    await p.goto(B + "/", { waitUntil: "networkidle" });
    return p;
  };
  const openOnPhone = async (p) => { await p.locator(".tabbar .tb-pill > a, .tabbar .tb-pill > button").nth(2).click(); await p.locator(".send.live").click(); await p.waitForSelector(".lv"); };
  const start = async (p) => { await p.locator(".send.live").click(); await p.waitForSelector(".lv"); };
  const status = (p, t) => p.locator(".lv-status", { hasText: t }).waitFor({ timeout: 8000 });

  // ---- the conversation
  const p = await open({ available: "available" });
  await p.locator(".send.live").waitFor();
  check(await p.locator(".send.live").count() === 1, "the assistant's composer has a live voice button");
  await p.locator(".ag-box textarea").fill("hello");
  check(await p.locator(".send.live").count() === 0 && await p.locator(".ag-box .send").count() === 1, "typing swaps it for Send");
  await p.locator(".ag-box textarea").fill("");
  await start(p);
  await status(p, "Listening");
  const inWindow = await p.evaluate(() => { const v = document.querySelector(".lv"), a = document.querySelector(".agent"), r = v.getBoundingClientRect(), w = a.getBoundingClientRect(); return { inside: a.contains(v), same: Math.abs(r.width - w.width) < 2 && Math.abs(r.height - w.height) < 2, small: r.width < innerWidth * 0.5, sidebar: !!document.elementFromPoint(100, 100)?.closest(".sidebar") }; });
  check(inWindow.inside && inWindow.same && inWindow.small && inWindow.sidebar, `on desktop it stays in the assistant's window (${JSON.stringify(inWindow)})`);
  check(await p.evaluate(() => !/serif/i.test(getComputedStyle(document.querySelector(".lv-hello h2")).fontFamily) || /sans-serif/i.test(getComputedStyle(document.querySelector(".lv-hello h2")).fontFamily)), "it uses the app's normal font");
  check(await p.locator(".lv-engine").innerText() === "On device", "it says speech stays on the device");
  check(await p.locator(".lv-hello h2").innerText() === "Start talking anytime", "it starts as a quiet page with one line");
  check(await p.evaluate(() => window.__recs[0].processLocally === true && window.__recs[0].continuous === true), "it asks the browser to recognize speech locally");
  if (OUT) await p.screenshot({ path: `${OUT}/lv-listen.png` });
  await p.evaluate(() => window.__say("What is"));
  await p.locator(".lv-you", { hasText: "What is" }).waitFor();
  check(p.agent.length === 0, "it waits while you're still talking");
  await p.evaluate(() => window.__say("What is osmosis"));
  await p.waitForFunction(() => window.__said.length >= 1, null, { timeout: 8000 });
  check(p.agent.length === 1 && p.agent[0].message === "What is osmosis" && p.agent[0].voice === true, "when you stop, it sends what you said, marked as voice");
  check(/Happy to help/.test(await p.evaluate(() => window.__said.join(" "))), "it says the reply out loud");
  await status(p, "Listening");
  check(await p.evaluate(() => !!window.__active), "it's listening again as soon as it finishes");
  check(/second sentence/i.test(await p.locator(".lv-reply").innerText()), "the words appear as it speaks");
  check(/device's voice/.test(await p.locator(".lv-notice").innerText()), "with no voice key, it says it's using the device's voice");

  // talking over it
  const SAID = "Happy to help with that. Here is a second sentence for you.";
  const replying = async (what) => { await p.evaluate(() => { window.__hold = true; window.__said = []; }); await p.waitForTimeout(100); await p.evaluate((t) => window.__say(t), what); await p.waitForFunction(() => window.__said.length >= 1, null, { timeout: 8000 }); await status(p, "interrupt"); await p.waitForTimeout(150); };
  const asked = () => p.agent.length;
  await replying("Tell me more");
  if (OUT) await p.screenshot({ path: `${OUT}/lv-speak.png` });
  check(await p.evaluate(() => !!window.__active), "it keeps listening while it talks");
  check(/talk or tap/i.test(await p.locator(".lv-status").innerText()), "and says you can talk over it");
  const cancels = () => p.evaluate(() => window.__cancelled || 0);
  let before = await cancels();
  await p.evaluate((t) => window.__say(t), SAID.slice(0, 24));
  await p.waitForTimeout(350);
  check(await cancels() === before && /interrupt/i.test(await p.locator(".lv-status").innerText()), "hearing its own voice doesn't interrupt it");
  await p.evaluate(() => window.__say("purple"));
  await p.waitForTimeout(250);
  check(await cancels() === before, "one stray word doesn't either");
  const n0 = asked();
  await p.evaluate((t) => window.__say(t), `${SAID.slice(0, 24)} wait what about ions`);
  await status(p, "Listening");
  check(await cancels() > before, "talking over it stops it at once");
  check(await p.locator(".lv-you").innerText() === "wait what about ions", "and it keeps what you said, without its own words");
  await p.evaluate(() => { window.__hold = false; });
  await p.waitForFunction((n) => window.__said.length > n, await p.evaluate(() => window.__said.length), { timeout: 8000 });
  check(p.agent[n0]?.message === "wait what about ions", `then it answers that (${p.agent[n0]?.message})`);
  await status(p, "Listening");

  await replying("Next one please");
  before = await cancels();
  await p.evaluate(() => window.__say("stop"));
  await status(p, "Listening");
  check(await cancels() > before, "a single word like stop is enough");
  await p.evaluate(() => { window.__hold = false; }); await p.waitForTimeout(1100); await status(p, "Listening");

  await replying("Another one please");
  before = await cancels();
  await p.locator(".lv-stage").click();
  await status(p, "Listening");
  check(await cancels() > before, "tapping interrupts too");
  await p.evaluate(() => { window.__hold = false; });

  // The user wasn't finished: the two halves are joined
  await p.route("**/api/agent", async (r) => { await new Promise((d) => setTimeout(d, 2500)); await r.continue().catch(() => {}); });
  const n1 = asked();
  await p.evaluate(() => window.__say("What is the difference between"));
  await status(p, "Thinking");
  await p.waitForFunction(() => !!window.__active);
  await p.evaluate(() => window.__say("osmosis and diffusion"));
  await status(p, "Listening");
  await p.waitForFunction((n) => true, n1);
  await p.waitForTimeout(1100);
  await p.unroute("**/api/agent");
  check(p.agent[p.agent.length - 1]?.message === "What is the difference between osmosis and diffusion", `pausing mid-thought doesn't lose the first half (${p.agent[p.agent.length - 1]?.message})`);
  await status(p, "Listening");

  // fast
  await p.evaluate(() => { window.__said = []; window.__say("Quick question"); });
  await p.waitForFunction(() => window.__said.length > 0 && !!window.__active, null, { timeout: 8000 });
  check(p.agent[p.agent.length - 1]?.voice === true && p.agent[p.agent.length - 1]?.deep === "sonnet", "the voice layer hands hard work to Sonnet by default");
  check(await p.locator(".lv-me").count() >= 2 && await p.locator(".lv-them").count() >= 2, "earlier exchanges stay on the page");
  await status(p, "Listening");
  await p.locator(".lv-model select").selectOption("opus-fast");
  await p.evaluate(() => { window.__said = []; window.__say("Use the other model"); });
  await p.waitForFunction(() => window.__said.length > 0, null, { timeout: 8000 });
  check(p.agent[p.agent.length - 1]?.deep === "opus-fast" && /Haiku \+ Opus Fast/.test(await p.locator(".lv-model").innerText()), "the pill picks the model for hard questions");
  await status(p, "Listening");
  await p.locator(".lv-model select").selectOption("sonnet");
  // the two layers: it says a few words, hands the job over, then says the result
  const before2 = await p.evaluate(() => { window.__said = []; return 0; });
  await p.evaluate(() => window.__say("mock:handoff mock:create Deep plan"));
  await p.waitForFunction(() => window.__said.some((t) => /The answer is/.test(t)), null, { timeout: 12000 });
  const said2 = await p.evaluate(() => window.__said);
  check(said2[0] === "Let me work that out.", `it says something before handing off (${said2[0]})`);
  const tree = await p.evaluate(() => fetch("/api/tree").then((r) => r.json()).catch(() => null));
  const made = await p.evaluate(() => fetch("/api/search?q=Deep%20plan").then((r) => r.json()).catch(() => null));
  check(JSON.stringify(tree ?? "").includes("Deep plan") || JSON.stringify(made ?? "").includes("Deep plan"), "the stronger model really did the job, with the tools");
  await p.locator(".lv-undo").waitFor({ timeout: 5000 }).catch(() => {});
  check(await p.locator(".lv-undo").count() === 1, "and what it changed can be undone");
  await status(p, "Listening");
  void before2;
  await p.locator("[aria-label='Voice settings']").click();
  await p.locator(".lv-speeds button", { hasText: "Faster" }).click();
  check(await p.evaluate(() => localStorage.getItem("sg.voice.speed")) === "1.2", "speaking speed can be changed");
  await p.keyboard.press("Escape"); await p.waitForTimeout(200);
  check(await p.locator(".lv").count() === 1 && await p.locator(".lv-settings").count() === 0, "Esc closes the settings before it ends the conversation");
  await p.evaluate(() => { window.__said = []; window.__rate = null; const s = window.speechSynthesis.speak; window.speechSynthesis.speak = function (u) { window.__rate = u.rate; return s.call(this, u); }; window.__say("Say something quickly"); });
  await p.waitForFunction(() => window.__said.length > 0, null, { timeout: 8000 });
  check(Math.abs(await p.evaluate(() => window.__rate) - 1.2) < 0.01, "and the voice really speaks at that speed");
  await status(p, "Listening");
  await p.evaluate(() => localStorage.removeItem("sg.voice.speed"));

  // mute
  await p.locator("[aria-label=Mute]").click();
  await status(p, "Muted");
  check(await p.evaluate(() => !window.__active), "mute really turns the mic off");
  if (OUT) await p.screenshot({ path: `${OUT}/lv-muted.png` });
  await p.locator("[aria-label=Unmute]").click();
  await status(p, "Listening");
  check(await p.evaluate(() => !!window.__active), "unmute turns it back on");

  // end
  await p.locator("[aria-label='End live voice']").click();
  await p.waitForTimeout(250);
  check(await p.locator(".lv").count() === 0 && await p.evaluate(() => !window.__active), "End closes it and stops listening");
  const thread = await p.evaluate(() => fetch("/api/thread?limit=100").then((r) => r.json()));
  check(thread.messages.some((m) => m.text === "What is osmosis") && thread.messages.some((m) => /Happy to help/.test(m.text)), "the conversation is in the one ongoing thread");
  await start(p); await status(p, "Listening");
  await p.keyboard.press("Escape"); await p.waitForTimeout(200);
  check(await p.locator(".lv").count() === 0, "Esc ends it too");
  check(!p.errs.length, `no page errors ${p.errs.join(" | ")}`);

  // ---- a real voice: audio from the Worker is played
  const v = await open({ available: "available" });
  let spoke = [];
  await v.route("**/api/voice/speak", (r) => { spoke.push(r.request().postDataJSON().text); r.fulfill({ status: 200, contentType: "audio/mpeg", body: wav() }); });
  await start(v); await status(v, "Listening");
  await v.evaluate(() => { window.__lvs = []; setInterval(() => { const e = document.querySelector(".lv"); if (e) window.__lvs.push({ p: e.className, v: Number(e.style.getPropertyValue("--lv")) }); }, 30); });
  await v.waitForTimeout(1200);
  const idle = await v.evaluate(() => window.__lvs.filter((x) => /lv-listening/.test(x.p)).map((x) => x.v));
  check(Math.max(...idle) > 0.05 && Math.max(...idle) < 0.25 && Math.max(...idle) - Math.min(...idle) > 0.005, `the glow breathes gently while it listens (${Math.min(...idle).toFixed(2)} to ${Math.max(...idle).toFixed(2)})`);
  await v.evaluate(() => window.__say("Hello there"));
  await status(v, "interrupt");
  await status(v, "Listening");
  check(spoke.length >= 1 && /Happy to help/.test(spoke.join(" ")), "reply sentences are sent to the voice service");
  const talking = await v.evaluate(() => window.__lvs.filter((x) => /lv-speaking/.test(x.p)).map((x) => x.v));
  check(Math.max(...talking) > 0.45, `the glow jumps with the real voice (peak ${Math.max(...talking).toFixed(2)})`);
  check(await v.evaluate(() => window.__said.length) === 0 && await v.locator(".lv-notice").count() === 0, "and the device voice stays quiet");
  check(!v.errs.length, `no page errors with real audio ${v.errs.join(" | ")}`);

  // a voice service failing part way
  const f = await open({ available: "available" });
  await f.route("**/api/voice/speak", (r) => r.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "The voice service is out of credits." }) }));
  await start(f); await status(f, "Listening");
  await f.evaluate(() => window.__say("Hello there"));
  await f.waitForFunction(() => window.__said.length >= 1, null, { timeout: 8000 });
  check(/out of credits/.test(await f.locator(".lv-notice").innerText()), "if the voice service fails, it says why and keeps talking");

  // ---- which way of listening
  const n = await open({ available: "unavailable" });
  await start(n); await status(n, "Listening");
  check(await n.locator(".lv-engine").innerText() === "Browser speech" && await n.evaluate(() => window.__recs[0].processLocally === undefined), "without on-device speech it says so plainly");

  const d = await open({ denied: true, available: "available" });
  await start(d);
  await d.locator(".lv-problem").waitFor();
  check(/permission/.test(await d.locator(".lv-problem").innerText()), "a blocked microphone gets a clear message");

  // recording fallback, with a fake microphone that plays speech then silence
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lv-")), file = path.join(dir, "speech.wav");
  const rate = 16000, seconds = 15, count = rate * seconds, a = Buffer.alloc(44 + count * 2);
  a.write("RIFF", 0); a.writeUInt32LE(36 + count * 2, 4); a.write("WAVEfmt ", 8); a.writeUInt32LE(16, 16); a.writeUInt16LE(1, 20); a.writeUInt16LE(1, 22); a.writeUInt32LE(rate, 24); a.writeUInt32LE(rate * 2, 28); a.writeUInt16LE(2, 32); a.writeUInt16LE(16, 34); a.write("data", 36); a.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) { const t = i / rate; a.writeInt16LE((t > 2 && t < 3.5) || (t > 8 && t < 9.5) ? Math.round(Math.sin(i / 4) * 12000) : Math.round((Math.random() - 0.5) * 40), 44 + i * 2); }
  fs.writeFileSync(file, a);
  const b2 = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${file}%noloop`] });
  const c2 = await b2.newContext({ viewport: { width: 1280, height: 860 }, permissions: ["microphone"] });
  const r = await c2.newPage();
  const rerrs = []; r.on("pageerror", (e) => rerrs.push(e.message));
  const sent = []; r.on("request", (q) => { if (q.url().endsWith("/api/agent")) sent.push(q.postDataJSON()); });
  await r.addInitScript(FAKE, { noRecognizer: true });
  await r.addInitScript(() => { window.__hold = true; const C = window.AudioContext; window.__contexts = 0; window.AudioContext = class extends C { constructor(...a) { super(...a); window.__contexts++; } }; const conn = AnalyserNode.prototype.connect; window.__meterOut = 0; AnalyserNode.prototype.connect = function (...x) { window.__meterOut++; return conn.apply(this, x); }; });
  await r.goto(B + "/", { waitUntil: "networkidle" });
  await r.locator(".send.live").click(); await r.waitForSelector(".lv");
  await r.locator(".lv-engine", { hasText: "Cloud transcription" }).waitFor({ timeout: 8000 });
  check(true, "with no speech recognition at all, it records instead and says so");
  await r.evaluate(() => { window.__mic = 0; setInterval(() => { const e = document.querySelector(".lv"); if (e && /lv-listening/.test(e.className)) window.__mic = Math.max(window.__mic, Number(e.style.getPropertyValue("--lv"))); }, 30); });
  await r.waitForTimeout(400);
  check(await r.evaluate(() => window.__meterOut) >= 1, "the mic meter leads to the speakers, which Safari needs to run it");
  check(await r.evaluate(() => window.__contexts) === 1, "the microphone shares the audio system unlocked by the tap, which is what an iPhone needs");
  await r.locator("[aria-label='Voice settings']").click();
  await r.locator(".lv-check").waitFor();
  check(/Microphone on, audio running/.test(await r.locator(".lv-check").innerText()), `the settings show a live mic check (${await r.locator(".lv-check").innerText()})`);
  await r.locator("[aria-label='Voice settings']").click({ force: true }).catch(() => {});
  await r.keyboard.press("Escape").catch(() => {});
  await r.waitForFunction(() => window.__said.length >= 1, null, { timeout: 20000 }).catch(() => {});
  check(await r.evaluate(() => window.__mic) > 0.4, `the glow follows the microphone (peak ${await r.evaluate(() => window.__mic.toFixed(2))})`);
  check(sent.length === 1 && /This is what you said/.test(sent[0]?.message ?? ""), `it hears the end of speech and sends the transcript (${sent[0]?.message ?? "nothing sent"})`);
  await r.waitForFunction(() => window.__cancelled > 0, null, { timeout: 9000 }).catch(() => {});
  check(await r.evaluate(() => window.__cancelled > 0), "talking over it works when recording too");
  check(!rerrs.length, `no page errors when recording ${rerrs.join(" | ")}`);
  // ---- an iPhone's dead level meter: the server tells when the user's stopped talking
  const deadMeter = async (script, extra) => {
    const c = await b2.newContext({ viewport: { width: 1280, height: 860 }, permissions: ["microphone"] });
    const d = await c.newPage();
    d.errs = []; d.on("pageerror", (e) => d.errs.push(e.message));
    d.sent = []; d.on("request", (q) => { if (q.url().endsWith("/api/agent")) d.sent.push(q.postDataJSON()); });
    d.hears = 0;
    if (script) await d.route("**/api/voice/hear*", (q) => { const x = script[Math.min(d.hears++, script.length - 1)]; q.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(x) }); });
    await d.addInitScript(FAKE, { noRecognizer: true });
    await d.addInitScript(() => { window.__hold = true; AudioContext.prototype.createMediaStreamSource = function () { return this.createGain(); }; });
    if (extra) await d.addInitScript(extra);
    await d.goto(B + "/", { waitUntil: "networkidle" });
    await d.locator(".send.live").click(); await d.waitForSelector(".lv");
    return d;
  };
  const dead = await deadMeter([{ text: "", duration: 1, quiet: 1 }, { text: "What is", duration: 2, quiet: 0.1 }, { text: "What is osmosis", duration: 3, quiet: 0.3 }, { text: "What is osmosis", duration: 4, quiet: 0.9 }]);
  await dead.locator(".lv-you", { hasText: "What is" }).waitFor({ timeout: 9000 }).catch(() => {});
  check(/What is/.test(await dead.locator(".lv-you").innerText().catch(() => "")), "with a dead level meter the server listens, and the words show while the user's still talking");
  await dead.waitForFunction(() => window.__said.length >= 1, null, { timeout: 9000 }).catch(() => {});
  check(dead.sent.length === 1 && dead.sent[0].message === "What is osmosis", `once it's been quiet since their last word, it sends by itself (${dead.sent[0]?.message})`);
  await dead.locator(".lv-status", { hasText: "Tap to interrupt" }).waitFor({ timeout: 4000 }).catch(() => {});
  check(/^Tap to interrupt/.test(await dead.locator(".lv-status").innerText()), "there it says to tap to interrupt, since it can't hear them over itself");
  const heardWhileTalking = dead.hears;
  await dead.waitForTimeout(1500);
  check(dead.hears === heardWhileTalking, "and it doesn't listen to its own voice");
  await dead.locator(".lv-stage").click();
  await dead.locator(".lv-status", { hasText: "Listening" }).waitFor({ timeout: 4000 });
  await dead.locator("[aria-label='Voice settings']").click();
  await dead.locator(".lv-check").waitFor({ timeout: 3000 }).catch(() => {});
  check(/server is listening/.test(await dead.locator(".lv-check").innerText().catch(() => "")), "the mic check says the server is listening");
  check(!dead.errs.length, `no page errors with a dead meter ${dead.errs.join(" | ")}`);

  // tapping sends at once, without waiting for the pause
  const tap = await deadMeter([{ text: "Still talking", duration: 2, quiet: 0.1 }]);
  await tap.locator(".lv-you", { hasText: "Still talking" }).waitFor({ timeout: 9000 });
  await tap.locator(".lv-stage").click();
  await tap.waitForFunction(() => window.__said.length >= 1, null, { timeout: 9000 }).catch(() => {});
  check(tap.sent.length === 1 && tap.sent[0].message === "Still talking", `a tap sends what the user's said so far (${tap.sent[0]?.message})`);

  // a browser that only hands over a recording when it stops: a piece at a time
  const bits = await deadMeter([{ text: "Hello there", duration: 2, quiet: 0.1 }, { text: "", duration: 2, quiet: 2 }], () => { const start = MediaRecorder.prototype.start; MediaRecorder.prototype.start = function () { return start.call(this); }; });
  await bits.waitForFunction(() => window.__said.length >= 1, null, { timeout: 15000 }).catch(() => {});
  check(bits.sent.length === 1 && bits.sent[0].message === "Hello there", `it works a piece at a time where recordings only arrive when stopped (${bits.sent[0]?.message})`);

  // and with the real endpoint (mock model)
  const whole = await deadMeter(null);
  await whole.waitForFunction(() => window.__said.length >= 1, null, { timeout: 9000 }).catch(() => {});
  check(whole.sent.length === 1 && /This is what you said/.test(whole.sent[0]?.message ?? ""), "the app and the Worker agree on the listening endpoint");

  // a mic that sends nothing: it stops paying to listen to silence, until the user taps
  const silent = await deadMeter([{ text: "", duration: 1, quiet: 1 }]);
  await silent.locator(".lv-notice", { hasText: "can't hear" }).waitFor({ timeout: 45000 }).catch(() => {});
  check(/Check your mic/.test(await silent.locator(".lv-notice").innerText().catch(() => "")), "after 30 seconds of nothing it says to check the mic");
  const polled = silent.hears;
  await silent.waitForTimeout(3500);
  check(silent.hears === polled, `and stops sending audio (${polled} then ${silent.hears})`);
  await silent.locator(".lv-stage").click();
  await silent.waitForTimeout(4000);
  check(silent.hears > polled && !(await silent.locator(".lv-notice").count()), "a tap starts listening again and clears the message");
  await b2.close();

  // an iPhone goes straight to recording
  const i = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
  const ph = await i.newPage();
  await ph.addInitScript(FAKE, { available: "available" });
  await ph.goto(B + "/", { waitUntil: "networkidle" });
  await openOnPhone(ph);
  await ph.waitForTimeout(600);
  check(await ph.evaluate(() => window.__recs.length) === 0, "an iPhone doesn't try the recognizer that's unreliable there");

  // ---- a phone
  const m = await b.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
  const q = await m.newPage();
  await q.addInitScript(FAKE, { available: "available" });
  await q.goto(B + "/", { waitUntil: "networkidle" });
  await openOnPhone(q); await q.locator(".lv-status", { hasText: "Listening" }).waitFor();
  await q.evaluate(() => window.__say("Can you explain the entire electoral college system to me in as much detail as you possibly can please"));
  await q.waitForFunction(() => window.__said.length >= 1, null, { timeout: 8000 });
  const fit = await q.evaluate(() => { const l = document.querySelector(".lv"), end = document.querySelector(".lv-end").getBoundingClientRect(), box = l.getBoundingClientRect(); return { x: l.scrollWidth <= innerWidth, y: end.bottom <= innerHeight, tap: end.width >= 44, full: box.width >= innerWidth - 1, top: !!document.elementFromPoint(end.left + 10, end.top + 10)?.closest(".lv-end") }; });
  check(fit.x && fit.y && fit.tap && fit.full && fit.top, `it fits a phone, and the buttons are easy to tap (${JSON.stringify(fit)})`);
  if (OUT) await q.screenshot({ path: `${OUT}/lv-phone.png` });

  await b.close();
  console.log(fails ? `${fails} FAILED` : "all good");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
