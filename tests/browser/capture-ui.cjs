// Quick capture settings, the share target, and the voice note recorder (fake microphone, mock transcription).
// Needs ANTHROPIC_API_KEY=mock (no API_TOKEN) and an empty database.
const { chromium } = require("playwright");
const out = process.argv[2] || require("os").tmpdir(), B = process.env.SEAGLASS_URL || "http://localhost:5173";
(async () => {
  const b = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] }); const errs = [];
  const c = await b.newContext({ viewport: { width: 1280, height: 860 }, permissions: ["microphone"] });
  const p = await c.newPage(); p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(() => { localStorage.setItem("sg.agent", "0"); localStorage.setItem("sg.sidebar", "1"); });
  await p.goto(B + "/#/", { waitUntil: "networkidle" });

  // quick capture settings
  await p.locator(".sidebar button", { hasText: "Settings" }).first().click(); await p.waitForTimeout(300);
  await p.locator(".settings-pop button", { hasText: "Quick capture" }).click(); await p.waitForTimeout(500);
  await p.locator(".capture button.primary", { hasText: "Create a capture key" }).click(); await p.waitForTimeout(600);
  const key = await p.locator(".cap-key code").innerText();
  console.log("key shown once:", key.startsWith("sgc_"), "| endpoint in steps:", (await p.locator(".cap-steps").innerText()).includes("/api/capture"));
  await p.screenshot({ path: `${out}/c-capture.png` });
  const r = await p.evaluate(async (k) => (await fetch("/api/capture", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + k }, body: JSON.stringify({ text: "From a shortcut" }) })).status, key);
  console.log("the key works for capture:", r);
  await p.keyboard.press("Escape"); await p.waitForTimeout(300);

  // share target: /?title=&text=&url= saves to the Inbox and clears the address bar
  await p.goto(B + "/?title=Cool%20page&url=https%3A%2F%2Fexample.com%2Fx#/", { waitUntil: "networkidle" }); await p.waitForTimeout(1200);
  console.log("share saved toast:", await p.locator(".toasts div").first().innerText().catch(() => "-"), "| address cleaned:", !(await p.evaluate(() => location.search)));
  const inbox = await p.evaluate(async () => { const t = await (await fetch("/api/tree")).json(); const n = t.find((x) => x.title === "Inbox"); return n ? (await (await fetch("/api/notes/" + n.id)).json()).html : ""; });
  console.log("inbox has the link and the line:", inbox.includes("https://example.com/x") && inbox.includes("From a shortcut"));

  // voice note on a page
  const id = await p.evaluate(async () => (await (await fetch("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Biology", html: "<p>Existing text.</p>" }) })).json()).id);
  await p.goto(B + "/#/p/" + id, { waitUntil: "networkidle" }); await p.waitForTimeout(700);
  await p.locator(".topbar .actions button").last().click(); await p.waitForTimeout(300);
  await p.locator(".popover button", { hasText: "Record a voice note" }).click(); await p.waitForTimeout(400);
  await p.locator(".voice button", { hasText: "Start recording" }).click(); await p.waitForTimeout(2600);
  console.log("recording timer:", await p.locator(".voice-time").innerText());
  await p.screenshot({ path: `${out}/c-voice.png` });
  await p.locator(".voice button", { hasText: "Stop and transcribe" }).click();
  await p.waitForFunction(() => !document.querySelector(".voice"), null, { timeout: 20000 }); await p.waitForTimeout(900);
  const html = await p.evaluate(async (id) => (await (await fetch("/api/notes/" + id)).json()).html, id);
  console.log("voice note added:", html.includes("Voice note") && html.includes("mock") && html.includes("Existing text") && /href="\/files\/[^"]+voice-note\.(webm|mp4|ogg|m4a)"/.test(html));
  console.log("callout shown on the page:", await p.locator('.ProseMirror [data-type="callout"]').count());
  console.log("errors:", errs.length ? errs : "none");
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
