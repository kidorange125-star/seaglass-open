// History in the Study tab: finished quizzes and practice tests are kept in full, can be reopened, and retake the same
// questions without asking the model again. Needs ANTHROPIC_API_KEY=mock and a wiped database.
const { chromium } = require("playwright");
const B = process.env.SEAGLASS_URL || "http://localhost:5173";
const OUT = process.env.SHOTS || "";
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const j = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const RIGHT = { "photosynthesis happen": "Chloroplasts", "gas do plants": "Carbon dioxide", "Calvin cycle": "Sugar" };
const NOTES = "<p>Photosynthesis happens in chloroplasts. Plants take in carbon dioxide and water and make sugar in the Calvin cycle.</p><details><summary>What is osmosis?</summary><div data-type=\"detailsContent\"><p>Water across a membrane</p></div></details><details><summary>What is diffusion?</summary><div data-type=\"detailsContent\"><p>Particles spreading out</p></div></details>";

(async () => {
  const page = (await j("POST", "/api/notes", { title: "Plant notes", html: NOTES })).body;
  const other = (await j("POST", "/api/notes", { title: "History notes", html: NOTES })).body;
  await j("PUT", `/api/study-pages/${page.id}`, { pinned: true });
  await j("PUT", `/api/study-pages/${other.id}`, { pinned: true });

  // ---- the API
  const base = { mode: "quiz", ids: [other.id], title: "History notes", right: 1, total: 2, missed: [{ q: "Old question?", a: "Old answer", yours: "Nope" }] };
  await j("POST", "/api/study/session", { session: base, coach: false }); // saved the way sessions were before
  await j("POST", "/api/study/session", { session: { ...base, mode: "cards" }, coach: false });
  await j("POST", "/api/study/session", { session: { ...base, mode: "chat", right: 0, total: 0, missed: [] }, coach: false });
  const played = [
    { type: "mcq", q: "Fine?", answer: "A", right: true, yours: "A", options: ["A", "B"], correct: 0 },
    { type: "mcq", q: "Broken: answer out of range", answer: "A", right: false, options: ["A", "B"], correct: 7 },
    { type: "short", q: "A written one has no place in a quiz", answer: "A", right: false },
  ];
  await j("POST", "/api/study/session", { session: { ...base, played }, coach: false });
  let list = (await j("GET", "/api/study-history")).body.sessions;
  check(list.length === 2 && list.every((x) => x.mode === "quiz"), `only games and tests are listed, not flashcards or Chat (${list.length})`);
  check(!("played" in list[0]) && !("missed" in list[0]), "the list carries no questions");
  const clean = (await j("GET", `/api/study-history/${list[0].id}`)).body;
  check(clean.played.length === 1 && clean.played[0].q === "Fine?", "a malformed question is dropped, never saved");
  check((await j("GET", `/api/study-history/${list[1].id}`)).body.played === null, "an older session has no questions, and says so");
  check((await j("GET", `/api/study-history?ids=${page.id}`)).body.sessions.length === 0, "the list can be limited to a page");
  check((await j("GET", "/api/study-history/00000000-0000-0000-0000-000000000000")).status === 404, "an unknown session is a 404");

  // the tab's numbers come from sessions
  const now = new Date(), iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const streak = (await j("GET", `/api/study-streak?today=${iso}&tz_offset=${now.getTimezoneOffset()}`)).body;
  check(streak.streak === 1 && streak.today && streak.dates[0] === iso, "a finished session counts toward the streak, with no flashcard reviewed");
  const blank = (await j("POST", "/api/notes", { title: "Plain page", html: "<p>Nothing but text here, no flashcards at all.</p>" })).body;
  await j("POST", "/api/study/session", { session: { ...base, ids: [blank.id], title: "Plain page", right: 3, total: 4, missed: [] }, coach: false });
  const over = (await j("GET", `/api/study-overview?today=${iso}`)).body;
  check(over.decks.some((d) => d.id === blank.id && d.cards === 0), "a page you studied is listed even with no flashcards");
  check(over.progress.pages[blank.id].score === 75 && over.progress.pages[blank.id].last_pct === 75, "and its score comes from the session");
  check(over.progress.week.sessions === 5 && over.progress.recent.length === 3, `the week and Recent come from sessions (${over.progress.week.sessions})`);
  await j("DELETE", `/api/notes/${blank.id}`);

  // ---- in the app
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  let writes = 0; p.on("request", (r) => { if (/\/api\/ai\/(study-set|quiz)$/.test(r.url())) writes++; });
  await p.addInitScript(() => { localStorage.setItem("sg.agent", "0"); localStorage.removeItem("sg.study.subject"); });
  await p.goto(B + "/#/study", { waitUntil: "networkidle" });
  await p.locator(".st-deck", { hasText: "Plant notes" }).locator(".st-deck-head").click();
  const row = p.locator(".study-pick"); await row.locator(".st-mode").first().waitFor();
  check(await row.locator(".st-mode").count() === 9, "a page has a History tile");

  const playQuiz = async (wrongFirst) => {
    for (let n = 0; n < 3; n++) {
      await p.waitForSelector(".qz-opt");
      const prompt = await p.locator(".qz-q").innerText();
      const right = RIGHT[Object.keys(RIGHT).find((k) => prompt.includes(k))];
      const texts = await p.locator(".qz-opt .qz-text").allInnerTexts();
      await p.keyboard.press(String((wrongFirst && n === 0 ? texts.findIndex((t) => t !== right) : texts.indexOf(right)) + 1));
      await p.waitForSelector(".qz-why"); await p.keyboard.press("Enter"); await p.waitForTimeout(120);
    }
    await p.waitForSelector(".coach-text");
  };
  const history = async () => { await row.locator(".st-mode", { hasText: "History" }).click(); await p.waitForSelector(".study-history"); };

  await history();
  await p.waitForSelector(".study-history .study-empty");
  check(/Nothing here yet/.test(await p.locator(".study-history").innerText()), "a page with no past quizzes says so");
  await p.keyboard.press("Escape"); await p.waitForTimeout(200);
  check(await p.locator(".study-history").count() === 0, "Esc closes History");

  // a quiz, and back to it
  await row.locator(".st-mode", { hasText: "Quiz" }).click();
  await p.waitForSelector(".qz-opt"); await p.waitForTimeout(2000); // long enough to count as time spent
  await playQuiz(true);
  await p.locator(".drill .study-done-actions .primary").click(); await p.waitForTimeout(250);
  await history();
  await p.waitForSelector(".sh-row");
  const newest = (await j("GET", "/api/study-history")).body.sessions[0];
  check((await j("GET", `/api/study-history/${newest.id}`)).body.seconds >= 2, "a finished quiz records how long it took");
  check(/67%/.test(await p.locator(".sh-row .sh-score").first().innerText()) && /Quiz/.test(await p.locator(".sh-row").first().innerText()), "the finished quiz is listed with its score");
  if (OUT) await p.screenshot({ path: `${OUT}/h-list.png` });
  await p.locator(".sh-row").first().click();
  await p.waitForSelector(".study-history .qz-review");
  check(await p.locator(".qz-rev").count() === 3, "every question is there to read");
  check(await p.locator(".qz-rev.wrong").count() === 1 && await p.locator(".qz-rev.wrong .yours").count() === 1 && await p.locator(".qz-rev.wrong .ans").count() === 1, "the missed one shows what was answered and the right answer");
  if (OUT) await p.screenshot({ path: `${OUT}/h-detail.png` });
  await p.keyboard.press("Escape"); await p.waitForSelector(".sh-row");
  check(await p.locator(".study-history .qz-review").count() === 0, "Esc steps back to the list first");
  await p.locator(".sh-row").first().click(); await p.waitForSelector(".study-history .qz-review");

  const before = writes;
  await p.locator(".study-history .study-done-actions button", { hasText: /^Retake$/ }).click();
  await playQuiz(false);
  check(writes === before, "retaking asks the model for nothing");
  check(/100%/.test(await p.locator(".drill-score").innerText()), "the retake is scored");
  await p.locator(".drill .study-done-actions .primary").click(); await p.waitForTimeout(250);

  await history(); await p.waitForSelector(".sh-row");
  check(await p.locator(".sh-row").count() === 2, "the retake is its own entry, and the first one is still there");
  await p.locator(".sh-row").nth(1).click(); await p.waitForSelector(".study-history .qz-review");
  await p.locator(".study-history .study-done-actions button", { hasText: "Retake the 1 missed" }).click();
  await p.waitForSelector(".qz-opt");
  check(await p.locator(".qz-track i").count() === 1, "it can retake just what was missed");
  await p.keyboard.press("Escape"); await p.waitForTimeout(250);

  // a practice test, with a written answer
  const test = async () => {
    await p.waitForSelector(".qz-opt"); await p.locator(".qz-opt").nth(0).click(); await p.waitForTimeout(150);
    await p.locator(".study-foot .primary").click(); await p.waitForTimeout(150);
    await p.locator(".qz-write").fill("CO2"); await p.locator(".study-foot .primary").click(); await p.waitForTimeout(150);
    await p.locator(".qz-opt").nth(0).click(); await p.waitForTimeout(150); await p.locator(".study-foot .primary").click();
    await p.waitForSelector(".coach-text");
  };
  await row.locator(".st-mode", { hasText: "Practice test" }).click();
  await p.locator(".study-done-actions button", { hasText: "Start" }).click();
  await test();
  await p.locator(".quiz .study-foot .study-done-actions .ghost").click(); await p.waitForTimeout(250);
  await history(); await p.waitForSelector(".sh-row");
  check(/Practice test/.test(await p.locator(".sh-row").first().innerText()), "the practice test is listed");
  await p.locator(".sh-row").first().click(); await p.waitForSelector(".study-history .qz-review");
  check(/CO2/.test(await p.locator(".qz-review").innerText()), "with the written answer");
  const w2 = writes;
  await p.locator(".study-history .study-done-actions button", { hasText: /^Retake$/ }).click();
  await test();
  check(writes === w2, "a practice test retakes the same questions too");
  await p.locator(".quiz .study-foot .study-done-actions button", { hasText: "Retake" }).click();
  await p.waitForSelector(".qz-opt");
  check(await p.locator(".qz-opt.right, .qz-opt.wrong").count() === 0, "and it can be retaken again from its results, with the answers cleared");
  await p.keyboard.press("Escape"); await p.waitForTimeout(250);

  // fill in the blanks and match, from what the games save
  const pastGame = async (mode, title, items) => {
    await j("POST", "/api/study/session", { session: { mode, ids: [page.id], title, right: 1, total: items.length, missed: [], played: items }, coach: false });
    await row.locator(".st-mode", { hasText: "History" }).click(); await p.waitForSelector(".sh-row");
    await p.locator(".sh-row", { hasText: title }).click(); await p.waitForSelector(".study-history .qz-review");
    await p.locator(".study-history .study-done-actions button", { hasText: /^Retake$/ }).click();
  };
  await pastGame("blanks", "Blank notes", [{ type: "blank", q: "Plants use _____ to grow.", answer: "sunlight", right: true, yours: "sunlight", before: "Plants use ", after: " to grow." }]);
  await p.waitForSelector(".drill-sentence");
  check(/^Plants use\s+to grow\.$/.test((await p.locator(".drill-sentence").innerText()).trim()), "fill in the blanks retakes the same sentence");
  await p.locator(".drill-sentence input").fill("sunlight"); await p.keyboard.press("Enter"); await p.waitForTimeout(150); await p.keyboard.press("Enter");
  await p.waitForSelector(".coach-text");
  check(/100%/.test(await p.locator(".drill-score").innerText()), "and it scores");
  await p.locator(".drill .study-done-actions .primary").click(); await p.waitForTimeout(250);
  await pastGame("match", "Match notes", [{ type: "pair", q: "Xylem", answer: "Carries water", right: true }, { type: "pair", q: "Phloem", answer: "Carries sugar", right: true }]);
  await p.waitForSelector(".drill-tiles .tile");
  check((await p.locator(".drill-tiles .tile").allInnerTexts()).sort().join() === "Carries sugar,Carries water,Phloem,Xylem", "match retakes the same pairs");
  await p.keyboard.press("Escape"); await p.waitForTimeout(250);

  await p.keyboard.press("Escape"); await p.waitForTimeout(250); // leave the picker
  // the older one, the whole list and the phone
  await p.locator(".st-head button", { hasText: "History" }).click(); await p.waitForSelector(".sh-row");
  const rows = await p.locator(".sh-row").count();
  check(rows >= 8, `History from the top of the tab shows everything (${rows})`);
  await p.locator(".sh-row", { hasText: "History notes" }).last().click(); await p.waitForSelector(".study-history .study-done-actions");
  check(/from before full history/.test(await p.locator(".study-history").innerText()) && await p.locator(".study-history .study-done-actions button", { hasText: "Retake" }).count() === 0, "an older session shows what it has, with no Retake");
  await p.keyboard.press("Escape"); await p.waitForTimeout(150); await p.keyboard.press("Escape"); await p.waitForTimeout(200);

  const phone = await b.newPage({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
  phone.on("pageerror", (e) => errs.push(e.message));
  await phone.addInitScript(() => { localStorage.setItem("sg.agent", "0"); localStorage.removeItem("sg.study.subject"); });
  await phone.goto(B + "/#/study", { waitUntil: "networkidle" });
  await phone.locator(".st-head button", { hasText: "History" }).click(); await phone.waitForSelector(".sh-row");
  const fit = () => phone.evaluate(() => ({ doc: document.documentElement.scrollWidth <= innerWidth, stage: (() => { const s = document.querySelector(".study-history .study-stage"); return s.scrollWidth <= s.clientWidth; })() }));
  let f = await fit();
  check(f.doc && f.stage, "the list fits a phone");
  if (OUT) await phone.screenshot({ path: `${OUT}/h-phone.png` });
  await phone.locator(".sh-row").first().click(); await phone.waitForSelector(".study-history .qz-review");
  f = await fit();
  const btn = await phone.locator(".study-history .study-done-actions button").first().boundingBox();
  check(f.doc && f.stage && btn.height >= 36, "so does a past test");
  if (OUT) await phone.screenshot({ path: `${OUT}/h-phone-detail.png` });

  check(errs.length === 0, `no page errors (${errs.slice(0, 2).join(" | ")})`);
  await b.close();
  console.log(fails ? `${fails} FAILED` : "all good");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
