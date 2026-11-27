// Unfinished sessions (client study/resume.ts): a quiz, fill in the blanks or practice test closed halfway is kept on the
// device, survives a reload, is offered again when reopened and listed in the Study tab, resumes with no model call, and the
// finished session carries the answers from before the close. Needs ANTHROPIC_API_KEY=mock and a wiped database.
const { chromium } = require("playwright");
const B = process.env.SEAGLASS_URL || "http://localhost:5173";
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const j = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const RIGHT = { "photosynthesis happen": "Chloroplasts", "gas do plants": "Carbon dioxide", "Calvin cycle": "Sugar" };
const NOTES = "<p>Photosynthesis happens in chloroplasts. Plants take in carbon dioxide and water and make sugar in the Calvin cycle.</p>";
const KEY = "sg.study.unfinished";

(async () => {
  const note = (await j("POST", "/api/notes", { title: "Plant notes", html: NOTES })).body;
  await j("PUT", `/api/study-pages/${note.id}`, { pinned: true });
  const b = await chromium.launch();

  const setup = async (width) => {
    const ctx = await b.newContext({ viewport: { width, height: 860 }, ...(width < 600 ? { isMobile: true, hasTouch: true } : {}) });
    await ctx.addInitScript(() => { localStorage.setItem("sg.agent", "0"); localStorage.removeItem("sg.study.subject"); });
    const p = await ctx.newPage();
    const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    const writes = { set: 0, test: 0 };
    p.on("request", (r) => { if (/\/api\/ai\/study-set$/.test(r.url())) writes.set++; if (/\/api\/ai\/quiz$/.test(r.url())) writes.test++; });
    return { p, errs, writes };
  };
  const studyTab = async (p) => { await p.goto(`${B}/?n=${Date.now()}#/study`, { waitUntil: "networkidle" }); await p.locator(".st-today").waitFor(); };
  const openMode = async (p, name) => {
    await studyTab(p);
    await p.locator(".st-deck", { hasText: "Plant notes" }).locator(".st-deck-head").click();
    await p.locator(".st-mode b", { hasText: new RegExp(`^${name}$`) }).click();
  };
  const saved = (p) => p.evaluate((k) => JSON.parse(localStorage.getItem(k) || "[]"), KEY);
  const answer = async (p, right) => {
    await p.waitForSelector(".qz-opt");
    const prompt = await p.locator(".qz-q").innerText();
    const want = RIGHT[Object.keys(RIGHT).find((k) => prompt.includes(k))];
    const texts = await p.locator(".qz-opt .qz-text").allInnerTexts();
    await p.keyboard.press(String((right ? texts.indexOf(want) : texts.findIndex((t) => t !== want)) + 1));
    await p.waitForSelector(".qz-why");
    return prompt;
  };
  const next = async (p) => { await p.keyboard.press("Enter"); await p.waitForTimeout(150); };

  // ---- a quiz closed halfway, a real reload, back from the Study tab
  {
    const { p, errs, writes } = await setup(1280);
    await openMode(p, "Quiz");
    const first = await answer(p, false); await next(p);
    await p.waitForTimeout(2200); // time spent before closing counts
    await p.keyboard.press("Escape");
    await p.waitForTimeout(300);
    check(/Saved where you left off/.test(await p.locator("body").innerText()), "closing halfway says it's saved");
    let list = await saved(p);
    check(list.length === 1 && list[0].kind === "quiz" && list[0].done === 1 && list[0].total === 3 && list[0].set?.mode === "quiz", `it's kept on the device with its questions (${JSON.stringify(list.map((x) => [x.kind, x.done, x.total]))})`);
    check(writes.set === 1, "one set of questions was written");

    await studyTab(p); // a fresh load, like the phone reopening the app
    const row = p.locator(".st-unfinished .st-later");
    check(await row.count() === 1 && /Plant notes/.test(await row.innerText()) && /Quiz · question 2 of 3/.test(await row.innerText()), `the Study tab lists it under Unfinished (${await row.innerText().catch(() => "none")})`);

    // reopening the same quiz offers it
    await p.locator(".st-deck", { hasText: "Plant notes" }).locator(".st-deck-head").click();
    await p.locator(".st-mode b", { hasText: /^Quiz$/ }).click();
    await p.locator(".drill-resume").waitFor();
    check(/question 2 of 3/.test(await p.locator(".drill-resume").innerText()), "reopening it asks whether to pick up where you left off");
    check(writes.set === 1, "and asks the model for nothing while asking");
    await p.keyboard.press("Escape"); await p.waitForTimeout(250);
    check(!/Saved where you left off/.test(await p.locator(".toast, [role=status]").allInnerTexts().then((x) => x.join(" ")).catch(() => "")), "closing the question itself doesn't claim to have saved anything");

    // resume from the row
    await studyTab(p);
    await row.locator(".st-past").click();
    await p.waitForSelector(".qz-q");
    check(/Question 2/.test(await p.locator(".qz-kicker").innerText()) && (await p.locator(".qz-q").innerText()) !== first, "the row goes straight back to question 2");
    check(await p.locator(".qz-track .wrong, .qz-track [class*=wrong]").count() >= 1, "the first answer is still marked wrong on the track");
    check(writes.set === 1, "resuming writes no new questions");
    const sent = p.waitForRequest((r) => r.url().endsWith("/api/study/session"), { timeout: 20000 });
    await answer(p, true); await next(p);
    await answer(p, true); await next(p);
    const body = (await sent).postDataJSON().session;
    check(body.played?.length === 3 && body.right === 2 && body.played.filter((x) => !x.right).length === 1 && body.played.find((x) => !x.right).q === first, "the finished quiz reports all 3, with the miss from before the close");
    check(body.seconds >= 2, `its time includes the time spent before closing (${body.seconds}s)`);
    check((await saved(p)).length === 0, "finishing it forgets it");

    // try the missed: starting again doesn't bring the old one back
    await p.locator(".study-done-actions button", { hasText: /Try the 1 missed/ }).click();
    await p.waitForSelector(".qz-q");
    check((await saved(p)).length === 0, "starting again with nothing answered keeps nothing");
    await p.keyboard.press("Escape"); await p.waitForTimeout(250);

    // start over: one new set, and the old progress is gone
    await openMode(p, "Quiz");
    await answer(p, true); await next(p); await p.keyboard.press("Escape"); await p.waitForTimeout(200);
    const before = writes.set;
    await openMode(p, "Quiz");
    await p.locator(".drill-resume button", { hasText: "Start over" }).click();
    await p.waitForSelector(".qz-q");
    check(writes.set === before + 1 && /Question 1/.test(await p.locator(".qz-kicker").innerText()), "Start over asks for the questions once and begins at question 1");
    check((await saved(p)).length === 0, "and forgets the old progress");
    await p.keyboard.press("Escape"); await p.waitForTimeout(200);

    // discard, then undo
    await openMode(p, "Quiz");
    await answer(p, false); await next(p); await p.keyboard.press("Escape"); await p.waitForTimeout(200);
    await studyTab(p);
    await row.locator(".st-act").click();
    await p.waitForTimeout(150);
    check(await row.count() === 0 && (await saved(p)).length === 0, "Discard removes it");
    await p.locator("button", { hasText: /^Undo$/ }).first().click();
    await p.waitForTimeout(150);
    check(await row.count() === 1 && (await saved(p)).length === 1, "and Undo brings it back");

    // a History retake of the earlier quiz is its own thing: no offer to resume this one
    await p.locator(".st-recent .st-past").first().click();
    await p.locator(".study-history button", { hasText: /^Retake$/ }).click();
    await p.waitForSelector(".qz-q");
    check(await p.locator(".drill-resume").count() === 0, "retaking a past quiz from History doesn't offer a different unfinished one");
    await answer(p, true); await next(p); await p.keyboard.press("Escape"); await p.waitForTimeout(200);
    check((await saved(p)).length === 2, "the retake halfway is kept separately");

    // fill in the blanks
    await openMode(p, "Fill in the blanks");
    await p.locator(".drill-q input").waitFor();
    await p.locator(".drill-q input").fill("wrongword"); await p.keyboard.press("Enter");
    await p.waitForSelector(".drill-verdict");
    await p.keyboard.press("Escape"); await p.waitForTimeout(200);
    await openMode(p, "Fill in the blanks");
    await p.locator(".drill-resume button", { hasText: "Resume" }).click();
    await p.waitForSelector(".drill-verdict");
    check(/Not quite/.test(await p.locator(".drill-verdict").innerText()) && /wrongword/.test(await p.locator(".drill-blank").innerText()), "blanks resume on the checked answer, still marked wrong");
    await p.keyboard.press("Escape"); await p.waitForTimeout(200);
    check(!errs.length, `no page errors ${errs.join(" | ")}`);
    await p.context().close();
  }

  // ---- a practice test on a phone: a written answer survives
  {
    const { p, errs, writes } = await setup(390);
    await openMode(p, "Practice test");
    await p.locator(".quiz .study-done-actions button", { hasText: "Start" }).click();
    await p.waitForSelector(".qz-q");
    const TEST = { "photosynthesis happen": "Chloroplasts", "Calvin cycle": "Glucose" }; // the mock practice test's answers
    const pick = async () => { const q = await p.locator(".qz-q").innerText(); const want = TEST[Object.keys(TEST).find((k) => q.includes(k))]; await p.locator(".qz-opt", { hasText: want }).click(); };
    await pick(); await p.locator(".study-show").click();
    await p.locator(".qz-write").fill("Carbon dioxide gas");
    await p.waitForTimeout(150);
    await p.locator(".quiz .study-top button[aria-label=Close]").click();
    await p.waitForTimeout(200);
    const tests = (await saved(p)).filter((x) => x.kind === "test");
    check(tests.length === 1 && tests[0].done === 1 && tests[0].state.answers[1].text === "Carbon dioxide gas", "the test is kept with the written answer");
    await studyTab(p);
    const row = p.locator(".st-unfinished .st-later", { hasText: "Practice test" });
    const box = await row.boundingBox(), x = await row.locator(".st-act").boundingBox();
    check(box && box.x >= 0 && box.x + box.width <= 390 && x && x.x + x.width <= 390, "the Unfinished row and its Discard button fit on a phone");
    await row.locator(".st-past").click();
    await p.waitForSelector(".qz-write");
    check((await p.locator(".qz-write").inputValue()) === "Carbon dioxide gas" && writes.test === 1, "the row goes back to the written answer, with no new test written");
    const sent = p.waitForRequest((r) => r.url().endsWith("/api/study/session"), { timeout: 20000 });
    await p.locator(".study-show").click();
    await pick(); await p.locator(".study-show").click();
    const body = (await sent).postDataJSON().session;
    check(body.mode === "test" && body.played.length === 3 && body.played[1].yours === "Carbon dioxide gas", "the finished test has the answer written before the close");
    check(!(await saved(p)).some((x) => x.kind === "test"), "and is forgotten once finished");

    // the offer screen on a phone
    await openMode(p, "Practice test");
    await p.locator(".quiz .study-done-actions button", { hasText: "Start" }).click();
    await p.waitForSelector(".qz-q"); await pick(); await p.locator(".study-show").click();
    await p.locator(".quiz .study-top button[aria-label=Close]").click(); await p.waitForTimeout(200);
    await openMode(p, "Practice test");
    await p.locator(".drill-resume").waitFor();
    const btns = await p.locator(".drill-resume button").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= 390; }));
    check(btns.length === 2 && btns.every(Boolean), "the offer fits on a phone");
    await p.locator(".drill-resume button", { hasText: "Resume" }).click();
    await p.waitForSelector(".qz-write");
    check(/Question 2/.test(await p.locator(".qz-kicker").innerText()), "Resume on the offer lands on question 2");
    check(!errs.length, `no page errors ${errs.join(" | ")}`);
    await p.context().close();
  }

  await b.close();
  console.log(fails ? `${fails} failed` : "all good");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
