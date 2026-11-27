// Quick actions in Ctrl+K (#43, POST /api/quick, Palette.tsx "Do it"): an instruction is done with the assistant's tools,
// nothing goes into the conversation, a notice says what changed, and Undo undoes the whole run. Desktop and 390px.
// Mock model (mock:create / mock:tool stand in for a real instruction), wiped database.
const { chromium } = require("playwright");
const B = process.env.SEAGLASS_URL || "http://localhost:5173";
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const j = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const titles = async () => (await j("GET", "/api/tree")).body.map((n) => n.title);

(async () => {
  // ---- the API
  const before = (await j("GET", "/api/thread")).body;
  const r = (await j("POST", "/api/quick", { text: "mock:create Packing list" })).body;
  check(r.changes === 1 && /Created “Packing list”/.test(r.done.join(" ")) && r.pages.length === 1, `a quick action does the job (${r.done.join(" | ")})`);
  check(JSON.stringify((await j("GET", "/api/thread")).body) === JSON.stringify(before), "nothing is added to the conversation");
  const mem = (await j("POST", "/api/quick", { text: 'mock:tool remember {"text":"likes ducks"}' })).body;
  check(mem.changes === 0 && /Not available in a quick action/.test(mem.failed.join(" ")), "it can't save memories");
  await j("POST", `/api/runs/${r.run_id}/undo`, {});
  check(!(await titles()).includes("Packing list"), "its run undoes as one");
  check((await j("POST", "/api/quick", { text: "" })).status === 400, "empty is refused");

  // ---- Ctrl+K
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(() => { localStorage.setItem("sg.agent", "0"); });
  await p.goto(`${B}/?n=${Date.now()}#/`, { waitUntil: "networkidle" });
  await p.keyboard.press("Control+k"); await p.locator(".spot input").waitFor();
  await p.locator(".spot input").fill("add a task to review chapter 5 tomorrow at 5");
  await p.waitForTimeout(300);
  check(await p.locator(".spot .sp-row").first().evaluate((e) => e.classList.contains("k-do")) && /Do it: add a task/.test(await p.locator(".spot .sp-row").first().innerText()), "an instruction puts “Do it” first");
  // something the user named exactly stays first, even when it starts with a doing word
  await j("POST", "/api/notes", { title: "Plan for finals", html: "<p>x</p>" }); await j("POST", "/api/notes", { title: "Set theory notes", html: "<p>x</p>" });
  await p.goto(`${B}/?n=${Date.now()}#/`, { waitUntil: "networkidle" });
  for (const [typed, want] of [["Record a voice note", "Record a voice note"], ["Plan for finals", "Plan for finals"], ["set theory notes", "Set theory notes"]]) {
    await p.keyboard.press("Control+k"); await p.locator(".spot input").fill(typed); await p.waitForTimeout(350);
    const first = p.locator(".spot .sp-row").first();
    check(!(await first.evaluate((e) => e.classList.contains("k-do"))) && (await first.innerText()).includes(want), `“${typed}” opens what it names first, not Do it`);
    await p.keyboard.press("Escape");
  }
  await p.keyboard.press("Control+k");
  await p.locator(".spot input").fill("photosynthesis");
  await p.waitForTimeout(300);
  check(await p.locator(".spot .sp-row.k-do").count() === 0, "a plain search has no “Do it”");
  await p.locator(".spot input").fill("mock:create Trip ideas page");
  await p.waitForTimeout(300);
  await p.locator(".spot .sp-row.k-do").click();
  check(await p.locator(".spot").count() === 0, "Do it closes the search");
  const note = p.locator(".toasts > div", { hasText: "Trip ideas page" });
  await note.waitFor({ timeout: 15000 });
  check(/Created “Trip ideas page”/.test(await note.innerText()) && await note.locator("button", { hasText: "Undo" }).count() === 1, "a notice says what changed, with Undo");
  check((await titles()).includes("Trip ideas page") && await p.locator(".sidebar", { hasText: "Trip ideas page" }).count() > 0, "the page is there, sidebar included");
  await note.locator("button", { hasText: "Undo" }).click();
  await p.waitForTimeout(1200);
  check(!(await titles()).includes("Trip ideas page"), "Undo takes it back");

  // ---- phone
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(`${B}/?n=${Date.now()}#/`, { waitUntil: "networkidle" });
  await p.evaluate(() => dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true })));
  await p.locator(".spot input").waitFor();
  await p.locator(".spot input").fill("mark the essay task done please");
  await p.waitForTimeout(300);
  const row = p.locator(".spot .sp-row.k-do");
  const box = await row.boundingBox();
  check(!!box && box.x >= 0 && box.x + box.width <= 390 && box.height >= 44, `on a phone “Do it” fits and is easy to tap (${box && Math.round(box.height)}px)`);
  check(!errs.length, `no page errors ${errs.join(" | ")}`);
  await b.close();
  console.log(fails ? `${fails} failed` : "all good");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
