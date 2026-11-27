// Explain it (ExplainView.tsx, worker ai.ts explainPrompts / checkExplain): The user explains ideas from their notes in their own words
// and the assistant says what the user got, what's missing and what's off; Try again shows new feedback but the first try is what's
// scored; the session is saved with every answer, the misses come back, and History retakes the same prompts with no model
// call. Mock model, wiped database.
const { chromium } = require("playwright");
const B = process.env.SEAGLASS_URL || "http://localhost:5173";
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const j = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const now = new Date(), today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

(async () => {
  const page = (await j("POST", "/api/notes", { title: "Cell notes", html: "<p>Osmosis moves water across a membrane toward more solute. Plant cell walls resist the pressure.</p>" })).body;
  await j("PUT", `/api/study-pages/${page.id}`, { pinned: true });

  // ---- the API
  check((await j("POST", "/api/ai/explain/check", { ids: [page.id], q: "Explain osmosis", points: ["water"], answer: "  " })).status === 400, "an empty explanation isn't sent to the model");
  check((await j("POST", "/api/ai/explain", { ids: [] })).status === 400, "no page, no prompts");

  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { localStorage.setItem("sg.agent", "0"); localStorage.removeItem("sg.study.subject"); });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  let asks = 0; p.on("request", (r) => { if (/\/api\/ai\/explain$/.test(r.url())) asks++; });

  await p.goto(`${B}/?n=${Date.now()}#/study`, { waitUntil: "networkidle" });
  await p.locator(".st-deck", { hasText: "Cell notes" }).locator(".st-deck-head").click();
  await p.locator(".st-mode b", { hasText: /^Explain it$/ }).click();
  await p.locator(".explain .seg button", { hasText: "3 ideas" }).click();
  await p.locator(".explain .study-done-actions button", { hasText: "Start" }).click();
  await p.locator(".explain .qz-q").waitFor();
  check(/Explain how osmosis works/.test(await p.locator(".qz-q").innerText()) && asks === 1, "it asks for the big ideas once and starts on the first");
  check(await p.locator(".explain .study-foot .primary").isDisabled(), "Check waits for an explanation");

  // 1: partly, then right on a second try (the first counts)
  await p.locator(".qz-write").fill("Salt moves around");
  await p.keyboard.press("Control+Enter");
  await p.locator(".ex-check").waitFor();
  let fb = await p.locator(".ex-check").innerText();
  check(/Partly there/.test(fb) && /Missing/.test(fb) && /across a membrane/.test(fb) && /You got/.test(fb) && /Salt moves around/.test(fb), "a partly right answer shows what you got and what's missing, under what you wrote");
  await p.locator(".ex-actions button", { hasText: "Try again" }).click();
  check((await p.locator(".qz-write").inputValue()) === "Salt moves around", "Try again keeps what you wrote to fix it");
  await p.locator(".qz-write").fill("Water moves across a membrane toward more solute");
  await p.locator(".ex-actions .primary").click();
  await p.locator(".ex-check.right").waitFor();
  fb = await p.locator(".ex-check").innerText();
  check(/Spot on/.test(fb) && /try 2/.test(fb) && /first try is what counts/.test(fb), "the second try shows the new verdict, and says the first one is scored");
  await p.locator(".ex-actions .primary", { hasText: "Next idea" }).click();

  // 2: off
  await p.locator(".qz-write").fill("mock-wrong: osmosis moves salt");
  await p.locator(".ex-actions .primary").click();
  await p.locator(".ex-check.off").waitFor();
  check(/Not quite right/.test(await p.locator(".ex-check").innerText()) && /Osmosis moves water, not salt/.test(await p.locator(".ex-check").innerText()), "something wrong is called out with what's actually true");
  await p.locator(".ex-actions .primary").click();

  // 3: right first time, then the results
  await p.locator(".qz-write").fill("Water crosses the membrane");
  await p.locator(".ex-actions .primary").click();
  await p.locator(".ex-check.right").waitFor();
  const sent = p.waitForRequest((r) => r.url().endsWith("/api/study/session"), { timeout: 20000 });
  await p.locator(".ex-actions .primary", { hasText: "See results" }).click();
  const body = (await sent).postDataJSON().session;
  check(body.mode === "explain" && body.right === 1 && body.total === 3, `scored on first tries: 1 of 3 (${body.right}/${body.total})`);
  check(body.played?.length === 3 && body.played[0].yours === "Salt moves around" && body.played[0].right === false && /\|/.test(body.played[0].answer), "every answer is saved as first written, with the key points");
  await p.locator(".coach-text").waitFor();
  check(/Missing: across a membrane/.test(await p.locator(".drill-results").innerText()), "the results list what was off");
  const over = (await j("GET", `/api/study-overview?today=${today}`)).body;
  check(over.misses?.open === 2, `the two not right come back as missed questions (${JSON.stringify(over.misses)})`);
  check(over.progress.pages[page.id]?.score === 33 && over.progress.pages[page.id]?.last_mode === "explain", `it counts toward the page's score (${over.progress.pages[page.id]?.score})`);

  // ---- History retakes the same prompts, no model call
  await p.locator(".explain .study-done-actions button", { hasText: "Done" }).click();
  await p.goto(`${B}/?n=${Date.now()}#/study`, { waitUntil: "networkidle" });
  const recent = p.locator(".st-recent .st-past").first();
  check(/Explain it/.test(await recent.innerText()), "it's in Recent as Explain it");
  await recent.click();
  await p.locator(".study-history button", { hasText: /^Retake$/ }).click();
  await p.locator(".explain .qz-q").waitFor();
  check(asks === 1 && /Explain how osmosis works/.test(await p.locator(".qz-q").innerText()), "History retakes the same prompts without asking the model again");
  check(!errs.length, `no page errors ${errs.join(" | ")}`);
  await ctx.close();

  // ---- a phone
  const pc = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await pc.addInitScript(() => { localStorage.setItem("sg.agent", "0"); localStorage.removeItem("sg.study.subject"); });
  const m = await pc.newPage();
  const merrs = []; m.on("pageerror", (e) => merrs.push(e.message));
  await m.goto(`${B}/?n=${Date.now()}#/study`, { waitUntil: "networkidle" });
  await m.locator(".st-deck", { hasText: "Cell notes" }).locator(".st-deck-head").click();
  await m.locator(".st-mode b", { hasText: /^Explain it$/ }).click();
  await m.locator(".explain .study-done-actions button", { hasText: "Start" }).click();
  await m.locator(".qz-write").waitFor();
  const font = await m.locator(".qz-write").evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  await m.locator(".qz-write").fill("Salt moves around");
  await m.locator(".ex-actions .primary").click();
  await m.locator(".ex-check").waitFor();
  const fits = await m.locator(".ex-check, .ex-actions button").evaluateAll((els) => els.every((e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= 390; }));
  check(font >= 16 && fits, `on a phone: 16px writing box (${font}px), and the feedback and buttons fit`);
  check(!merrs.length, `no page errors on the phone ${merrs.join(" | ")}`);
  await b.close();

  console.log(fails ? `${fails} failed` : "all good");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
