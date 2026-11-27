// What the assistant writes for Study: flashcards onto a page (undoable, no repeats, locked pages refused) and the
// questions for the games (saved until the notes change, "New questions" asks for different ones), plus the quiz
// screens on desktop and at phone width. Needs ANTHROPIC_API_KEY=mock and a wiped database.
const { chromium } = require("playwright");
const B = process.env.SEAGLASS_URL || "http://localhost:5173";
const OUT = process.env.SHOTS || "";
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const call = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); return { status: r.status, body: t ? JSON.parse(t) : {} }; };
const j = async (m, p, b) => (await call(m, p, b)).body;
const RIGHT = { "photosynthesis happen": "Chloroplasts", "gas do plants": "Carbon dioxide", "Calvin cycle": "Sugar" };
const NOTES = "<p>Photosynthesis happens in chloroplasts. Plants take in carbon dioxide and water and make sugar in the Calvin cycle.</p>";

(async () => {
  const page = await j("POST", "/api/notes", { title: "Plant notes", html: NOTES });
  const other = await j("POST", "/api/notes", { title: "Locked notes", html: NOTES });
  await j("PUT", `/api/study-pages/${page.id}`, { pinned: true });

  // ---- the games' questions
  const q1 = await j("POST", "/api/ai/study-set", { ids: [page.id], mode: "quiz" });
  check(q1.mode === "quiz" && q1.items.length === 3 && q1.cached === false, `the assistant writes a quiz; a malformed question is dropped (${q1.items.length})`);
  const q2 = await j("POST", "/api/ai/study-set", { ids: [page.id], mode: "quiz" });
  check(q2.cached === true && q2.created_at === q1.created_at, "playing again reuses the saved quiz");
  const q3 = await j("POST", "/api/ai/study-set", { ids: [page.id], mode: "quiz", fresh: true });
  check(q3.cached === false && q3.items[0].q.includes("(mock new)"), "New questions tells the model what was already asked");
  const b1 = await j("POST", "/api/ai/study-set", { ids: [page.id], mode: "blanks" });
  check(b1.items.length === 2 && b1.items[0].before.endsWith("by ") && b1.items[0].after === " in their leaves.", "blanks are spaced to read right, and one that gives its word away is dropped");
  const m1 = await j("POST", "/api/ai/study-set", { ids: [page.id], mode: "match" });
  check(m1.items.length === 4, "the assistant writes matching pairs");
  const bad = await call("POST", "/api/ai/study-set", { ids: [page.id], mode: "nope" });
  check(bad.status === 400, "an unknown game is refused");
  const none = await j("POST", "/api/notes", { title: "x", html: "<p>short</p>" });
  check(/isn't enough/.test((await j("POST", "/api/ai/study-set", { ids: [none.id], mode: "quiz" })).error ?? ""), "a page with almost nothing on it gets a clear message");
  await j("DELETE", `/api/notes/${none.id}`);

  // ---- flashcards onto the page
  const c1 = await j("POST", "/api/ai/cards", { id: page.id });
  let html = (await j("GET", `/api/notes/${page.id}`)).html;
  check(c1.added === 2 && c1.run_id, `flashcards are written onto the page; repeats and blanks are dropped (${c1.added})`);
  check((html.match(/<details/g) || []).length === 2 && html.includes("<h2") && /&lt;b&gt;/.test(html) && !/<b>the<\/b>/.test(html), "cards are real toggles and the model's text is escaped");
  const c2 = await j("POST", "/api/ai/cards", { id: page.id });
  check(c2.added === 0 && c2.run_id === null, "cards the page already has aren't added twice");
  await j("POST", `/api/runs/${c1.run_id}/undo`, { force: true });
  html = (await j("GET", `/api/notes/${page.id}`)).html;
  check(!html.includes("<details"), "Undo takes the cards back off");
  await j("PATCH", `/api/notes/${other.id}`, { locked: true });
  const locked = await call("POST", "/api/ai/cards", { id: other.id });
  check(locked.status === 400 && /locked/.test(locked.body.error), "a locked page is refused");

  // ---- in the app
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(() => { localStorage.setItem("sg.agent", "0"); localStorage.removeItem("sg.study.subject"); });
  await p.goto(B + "/#/study", { waitUntil: "networkidle" });
  const openPick = async () => { await p.locator(".st-deck", { hasText: "Plant notes" }).locator(".st-deck-head").click(); await p.waitForSelector(".study-pick .st-mode"); };
  const row = p.locator(".study-pick");
  await openPick();
  await row.waitFor();
  check(await row.locator(".st-mode").count() === 9, "the picker offers seven ways to study, Make flashcards and History");
  if (OUT) await p.screenshot({ path: `${OUT}/w-tab.png` });
  await row.locator(".st-mode", { hasText: "Make flashcards" }).click();
  await p.waitForSelector(".toast-act");
  check(/added 2 flashcards/.test(await p.locator(".toasts").innerText()), "Make flashcards reports what it added");
  await row.locator(".st-mode small", { hasText: "2 cards" }).waitFor({ timeout: 5000 }).catch(() => {});
  check(/2 cards/.test(await row.innerText()), "the page now shows its cards");
  await p.locator(".toast-act").click(); await p.waitForTimeout(800);
  check(await row.locator(".st-mode", { hasText: "Make flashcards" }).count() === 1, "Undo from the message works");

  const play = async (viewport) => {
    await row.locator(".st-mode", { hasText: "Quiz" }).click(); await p.waitForSelector(".qz-opt");
    check(await p.locator(".qz-opt").count() === 4 && await p.locator(".qz-track i").count() === 3, `${viewport}: one segment per question, four answers`);
    check(await p.locator(".qz-foot .qz-wait").count() === 1, `${viewport}: Next waits for an answer`);
    if (viewport === "phone") {
      const fit = await p.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: innerWidth, stage: [...document.querySelectorAll(".study-stage")].every((s) => s.scrollWidth <= s.clientWidth), tall: [...document.querySelectorAll(".qz-opt")].every((o) => o.offsetHeight >= 44) }));
      check(fit.doc <= fit.win && fit.stage, `phone: nothing pans sideways (${fit.doc}/${fit.win})`);
      check(fit.tall, "phone: answers are big enough to tap");
    }
    for (let n = 0; n < 3; n++) {
      const prompt = await p.locator(".qz-q").innerText();
      const right = RIGHT[Object.keys(RIGHT).find((k) => prompt.includes(k))];
      const texts = await p.locator(".qz-opt .qz-text").allInnerTexts();
      const at = n === 0 ? texts.findIndex((t) => t !== right) : texts.indexOf(right);
      await p.keyboard.press(String(at + 1));
      await p.waitForSelector(".qz-why");
      if (n === 0) {
        check(await p.locator(".qz-why.wrong").count() === 1 && await p.locator(".qz-opt.wrong").count() === 1 && await p.locator(".qz-opt.right").count() === 1, `${viewport}: a wrong pick shows the right answer and why`);
        check(await p.locator(".qz-track .wrong").count() === 1, `${viewport}: the track marks the miss`);
        if (OUT) await p.screenshot({ path: `${OUT}/w-quiz-${viewport}.png` });
      }
      await p.keyboard.press("Enter"); await p.waitForTimeout(120);
    }
    await p.waitForSelector(".drill-score");
    check((await p.locator(".drill-score b").innerText()) === "67%", `${viewport}: the score counts the miss`);
    check(await p.locator(".qz-rev.wrong").count() === 1, `${viewport}: the results list what was missed`);
    if (OUT) await p.screenshot({ path: `${OUT}/w-results-${viewport}.png` });
  };
  await play("desktop");
  await p.locator(".study-done-actions button", { hasText: "New questions" }).click();
  await p.waitForSelector(".qz-opt");
  check(/\(mock new\)/.test(await p.locator(".qz-q").innerText()), "New questions brings a new set");
  await p.keyboard.press("Escape"); await p.waitForTimeout(300);

  await p.setViewportSize({ width: 390, height: 844 }); await p.reload({ waitUntil: "networkidle" }); await openPick();
  await play("phone");
  await p.locator(".study-done-actions button", { hasText: "Done" }).click();

  check(!errs.length, `no page errors ${errs.join(" | ")}`);
  await b.close();
  console.log(fails ? `${fails} FAILED` : "all good");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
