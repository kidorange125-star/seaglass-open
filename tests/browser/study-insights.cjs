// What the time data says (#7, worker coach.ts insights) and weak spots inside notes (#14, editor/weakSpots.ts). Mock model,
// wiped database.
const { chromium } = require("playwright");
const B = process.env.SEAGLASS_URL || "http://localhost:5173";
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const j = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const NOTES = "<p>Cell structure basics.</p><p>Photosynthesis happens in the chloroplasts, using light.</p><p>Plants take in carbon dioxide and make sugar in the Calvin cycle.</p>";
const RIGHT = { "photosynthesis happen": "Chloroplasts", "gas do plants": "Carbon dioxide", "Calvin cycle": "Sugar" };

(async () => {
  const page = (await j("POST", "/api/notes", { title: "Plant notes", html: NOTES })).body;
  await j("PUT", `/api/study-pages/${page.id}`, { pinned: true });
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(() => { localStorage.setItem("sg.agent", "0"); localStorage.removeItem("sg.study.subject"); localStorage.removeItem("sg.weak.off"); });

  // ---- a quiz records the time on each question
  await p.goto(`${B}/?n=${Date.now()}#/study`, { waitUntil: "networkidle" });
  await p.locator(".st-deck", { hasText: "Plant notes" }).locator(".st-deck-head").click();
  await p.locator(".st-mode b", { hasText: /^Quiz$/ }).click();
  const sent = p.waitForRequest((r) => r.url().endsWith("/api/study/session"), { timeout: 30000 });
  for (let n = 0; n < 3; n++) {
    await p.waitForSelector(".qz-opt");
    await p.waitForTimeout(n === 0 ? 1200 : 300);
    const prompt = await p.locator(".qz-q").innerText();
    const right = RIGHT[Object.keys(RIGHT).find((k) => prompt.includes(k))];
    const texts = await p.locator(".qz-opt .qz-text").allInnerTexts();
    await p.keyboard.press(String((n === 0 ? texts.findIndex((t) => t !== right) : texts.indexOf(right)) + 1));
    await p.waitForSelector(".qz-why"); await p.keyboard.press("Enter"); await p.waitForTimeout(150);
  }
  const played = (await sent).postDataJSON().session.played;
  check(played.length === 3 && played.every((x) => typeof x.secs === "number" && x.secs > 0) && played[0].secs >= 1, `each answer carries the seconds spent on it (${played.map((x) => x.secs).join(", ")})`);
  await p.locator(".study-done-actions button", { hasText: "Done" }).click();

  // ---- rushing: misses answered much faster than right answers
  const mcq = (q, right, secs) => ({ type: "mcq", q, answer: "A", right, yours: right ? "A" : "B", options: ["A", "B"], correct: 0, secs });
  for (let s = 0; s < 2; s++) {
    await j("POST", "/api/study/session", { coach: false, session: { mode: "quiz", ids: [page.id], title: "Plant notes", right: 4, total: 7, missed: [], played: [
      mcq(`Fast miss ${s}a`, false, 2.5), mcq(`Fast miss ${s}b`, false, 3), mcq(`Fast miss ${s}c`, false, 2),
      mcq(`Slow right ${s}a`, true, 9), mcq(`Slow right ${s}b`, true, 11), mcq(`Slow right ${s}c`, true, 8), mcq(`Slow right ${s}d`, true, 10),
    ] } });
  }
  const ins = (await j("GET", "/api/study-insights")).body;
  check(ins.lines.some((l) => /faster than the ones you get right/.test(l)), `the time data spots rushing (${JSON.stringify(ins.lines)})`);
  await p.goto(`${B}/?n=${Date.now()}#/study`, { waitUntil: "networkidle" });
  await p.locator(".st-tips").waitFor();
  check(/Slowing down/.test(await p.locator(".st-tips").innerText()), "the Study tab says so under How you study");

  // ---- weak spots: missed twice, highlighted where it is in the page
  for (let s = 0; s < 2; s++) await j("POST", "/api/study/session", { coach: false, session: { mode: "quiz", ids: [page.id], title: "Plant notes", right: 0, total: 1, missed: [], played: [{ type: "mcq", q: "Where does photosynthesis happen?", answer: "Chloroplasts", right: false, yours: "Nucleus", options: ["Nucleus", "Chloroplasts"], correct: 1 }] } });
  const spots = (await j("GET", `/api/notes/${page.id}/weak-spots`)).body.spots;
  check(spots.some((x) => x.answer === "Chloroplasts" && x.misses >= 2), "a question missed twice is a weak spot for its page");
  await p.goto(`${B}/?n=${Date.now()}#/p/${page.id}`, { waitUntil: "networkidle" });
  const spot = p.locator(".ProseMirror .weak-spot");
  await spot.first().waitFor();
  check(await spot.count() === 1 && /chloroplasts/.test(await spot.innerText()) && /missed \d+ times/.test(await spot.getAttribute("data-weak")), `the paragraph with the answer is highlighted (${await spot.getAttribute("data-weak")})`);
  check(!(await p.locator(".ProseMirror p").first().getAttribute("class"))?.includes("weak-spot"), "and only that one");
  await p.locator(".ProseMirror p").nth(2).click(); await p.keyboard.press("End"); await p.keyboard.type(" Extra.");
  await p.waitForTimeout(1500);
  const saved = (await j("GET", `/api/notes/${page.id}`)).body.html;
  check(/Extra\./.test(saved) && !/weak/.test(saved), "editing still works, and the highlight is never saved into the page");
  check(await spot.count() === 1, "the highlight stays put while typing elsewhere");
  // the page menu turns it off and on
  await p.locator("button[title='Page options']").first().click(); await p.waitForTimeout(250);
  const sw = p.locator("label.switch", { hasText: "Show weak spots" });
  if (await sw.count()) {
    await sw.locator("input").uncheck(); await p.waitForTimeout(300);
    check(await spot.count() === 0, "the page menu hides weak spots");
    await sw.locator("input").check(); await p.waitForTimeout(800);
    check(await spot.count() === 1, "and shows them again");
  } else check(false, "the page menu has a Show weak spots switch");
  check(!errs.length, `no page errors ${errs.join(" | ")}`);
  await b.close();
  console.log(fails ? `${fails} failed` : "all good");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
