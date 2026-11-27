// Quizzes offline (#8, study/offline.ts): a question set and a practice test fetched online play again with no connection,
// and a session finished offline is kept and sent when the connection returns. Mock model, wiped database.
const { chromium } = require("playwright");
const B = process.env.SEAGLASS_URL || "http://localhost:5173";
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const j = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const RIGHT = { "photosynthesis happen": "Chloroplasts", "gas do plants": "Carbon dioxide", "Calvin cycle": "Sugar" };
const NOTES = "<p>Photosynthesis happens in chloroplasts. Plants take in carbon dioxide and water and make sugar in the Calvin cycle.</p>";

(async () => {
  const page = (await j("POST", "/api/notes", { title: "Plant notes", html: NOTES })).body;
  await j("PUT", `/api/study-pages/${page.id}`, { pinned: true });
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { localStorage.setItem("sg.agent", "0"); localStorage.removeItem("sg.study.subject"); });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  const openPick = async () => { await p.goto(`${B}/?n=${Date.now()}#/study`, { waitUntil: "networkidle" }); await p.locator(".st-deck", { hasText: "Plant notes" }).locator(".st-deck-head").click(); await p.locator(".study-pick .st-mode").first().waitFor(); };
  const mode = (name) => p.locator(".st-mode b", { hasText: new RegExp(`^${name}$`) });

  // ---- online: fetch a quiz and a practice test (kept on the device)
  await openPick();
  await mode("Quiz").click(); await p.waitForSelector(".qz-q"); await p.keyboard.press("Escape"); await p.waitForTimeout(300);
  await mode("Practice test").click(); await p.locator(".quiz .study-done-actions button", { hasText: "Start" }).click(); await p.waitForSelector(".qz-q");
  await p.locator(".quiz .study-top button[aria-label=Close]").click(); await p.waitForTimeout(300);
  const kept = await p.evaluate(() => [Object.keys(JSON.parse(localStorage.getItem("sg.study.sets") || "{}")).length, Object.keys(JSON.parse(localStorage.getItem("sg.study.tests") || "{}")).length]);
  check(kept[0] === 1 && kept[1] === 1, `a quiz and a test fetched online are kept on the device (${kept})`);
  const before = (await j("GET", "/api/study-history")).body.sessions.length;

  // ---- offline: the same quiz plays, and the session waits
  await ctx.setOffline(true);
  await mode("Quiz").click();
  await p.waitForSelector(".qz-q", { timeout: 15000 });
  check(/offline/i.test(await p.locator("body").innerText()), "offline, the quiz plays with the questions the user had, and says so");
  for (let n = 0; n < 3; n++) {
    await p.waitForSelector(".qz-opt");
    const prompt = await p.locator(".qz-q").innerText(), want = RIGHT[Object.keys(RIGHT).find((k) => prompt.includes(k))];
    const texts = await p.locator(".qz-opt .qz-text").allInnerTexts();
    await p.keyboard.press(String(texts.indexOf(want) + 1)); await p.waitForSelector(".qz-why"); await p.keyboard.press("Enter"); await p.waitForTimeout(150);
  }
  await p.locator(".coach-offline").waitFor({ timeout: 10000 });
  check(/syncs when you're back online/.test(await p.locator(".coach-offline").innerText()), "finishing offline says the session is saved on the device");
  check(await p.evaluate(() => JSON.parse(localStorage.getItem("sg.study.outbox") || "[]").length) === 1, "and it waits in the outbox");
  await p.locator(".study-done-actions button", { hasText: "Done" }).click().catch(() => {});
  // a practice test offline
  await mode("Practice test").click();
  await p.locator(".quiz .study-done-actions button", { hasText: "Start" }).click();
  await p.waitForSelector(".quiz .qz-q", { timeout: 10000 }).catch(() => {});
  check(await p.locator(".quiz .qz-q").count() === 1, "a practice test the user had also starts offline");
  await p.locator(".quiz .study-top button[aria-label=Close]").click().catch(() => {});

  // ---- back online: it syncs
  await ctx.setOffline(false);
  let after = before;
  for (let i = 0; i < 40 && after === before; i++) { await p.waitForTimeout(500); after = (await j("GET", "/api/study-history")).body.sessions.length; }
  check(after === before + 1, `back online, the session is sent (${before} -> ${after})`);
  check(await p.evaluate(() => JSON.parse(localStorage.getItem("sg.study.outbox") || "[]").length).catch(() => 0) === 0, "and the outbox is empty");
  check(!errs.filter((e) => !/fetch|network|Failed to fetch/i.test(e)).length, `no page errors ${errs.join(" | ")}`);
  await b.close();
  console.log(fails ? `${fails} failed` : "all good");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
