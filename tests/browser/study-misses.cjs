// Missed questions come back (worker misses.ts): kept when missed, not counted when reviewed early, reworded in a review
// round from the Study tab, and gone after two right answers once due. Needs ANTHROPIC_API_KEY=mock, a wiped database, and
// SEAGLASS_STATE set to the test server's state folder (to move due dates forward with wrangler).
const { execSync } = require("child_process");
const path = require("path");
const { chromium } = require("playwright");
const B = process.env.SEAGLASS_URL || "http://localhost:5173", STATE = process.env.SEAGLASS_STATE;
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const j = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const sql = (q) => execSync(`npx wrangler d1 execute seaglass --local --persist-to "${STATE}" --json --command "${q}"`, { cwd: path.join(__dirname, "..", ".."), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const rows = (q) => JSON.parse(sql(q))[0].results;
const now = new Date(), today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
const misses = async () => (await j("GET", `/api/study-overview?today=${today}`)).body.misses;
const mcq = (q, answer, right) => ({ type: "mcq", q, answer, right, yours: right ? answer : "Wrong", options: [answer, "Wrong", "Other"], correct: 0 });

(async () => {
  if (!STATE) { console.log("FAIL set SEAGLASS_STATE to the test server's state folder"); process.exit(1); }
  const page = (await j("POST", "/api/notes", { title: "Cell notes", html: "<p>Osmosis moves water across a membrane. The nucleus holds the DNA.</p>" })).body;
  const base = { ids: [page.id], title: "Cell notes", missed: [] };

  // ---- kept when missed
  await j("POST", "/api/study/session", { coach: false, session: { ...base, mode: "quiz", right: 1, total: 2, played: [mcq("What moves water across a membrane?", "Osmosis", false), mcq("What holds the DNA?", "The nucleus", true)] } });
  await j("POST", "/api/study/session", { coach: false, session: { ...base, mode: "blanks", right: 0, total: 1, played: [{ type: "blank", q: "Water crosses by _____.", answer: "osmosis", right: false, before: "Water crosses by ", after: "." }] } });
  await j("POST", "/api/study/session", { coach: false, session: { ...base, mode: "test", right: 0, total: 1, played: [{ type: "short", q: "Explain osmosis.", answer: "Water moving across a membrane", right: false, yours: "Something" }] } });
  await j("POST", "/api/study/session", { coach: false, session: { ...base, mode: "match", right: 2, total: 3, played: [{ type: "pair", q: "Osmosis", answer: "Water", right: true }] } });
  let m = await misses();
  check(m.open === 3 && m.due === 0, `misses from a quiz, blanks and a test are kept, nothing from Match, none due yet (${JSON.stringify(m)})`);
  await j("POST", "/api/study/session", { coach: false, session: { ...base, mode: "quiz", right: 0, total: 1, played: [mcq("what moves WATER across a membrane", "Osmosis", false)] } });
  check((await misses()).open === 3, "missing the same question again doesn't add a copy");
  check(rows("SELECT data FROM study_misses").every((r) => !/osmosis/i.test(r.data)), "what's kept is sealed");

  // ---- early review doesn't count
  const early = (await j("POST", "/api/study/misses/review")).body;
  check(early.items?.length === 3 && early.items.every((x) => /^\(mock reworded\)/.test(x.q) && x.miss), `a review round rewords each one and says which miss it is (${early.items?.length})`);
  const rightTo = (items) => items.map((x) => ({ type: "mcq", q: x.q, answer: x.options[x.answer], right: true, yours: x.options[x.answer], options: x.options, correct: x.answer, miss: x.miss }));
  await j("POST", "/api/study/session", { coach: false, session: { ...base, mode: "quiz", right: 3, total: 3, played: rightTo(early.items) } });
  check(rows("SELECT SUM(rights) AS n FROM study_misses")[0].n === 0, "right answers before they're due don't count");

  // ---- due: the Study tab offers them, reworded
  sql("UPDATE study_misses SET due_at = 0");
  check((await misses()).due === 3, "once due, the overview says so");
  const b = await chromium.launch();
  for (const width of [390, 1280]) {
    const p = await (await b.newContext({ viewport: { width, height: 860 }, ...(width < 600 ? { isMobile: true, hasTouch: true } : {}) })).newPage();
    const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(B + "/#/study", { waitUntil: "networkidle" });
    const btn = p.locator(".st-misses");
    check(/Review 3 missed questions/.test(await btn.innerText().catch(() => "")), `${width}px: the Study tab has a Review 3 missed questions button`);
    if (width === 390) { const box = await btn.boundingBox(); check(box && box.x >= 0 && box.x + box.width <= 390, "and it fits on a phone"); await p.context().close(); continue; }
    await btn.click();
    const saved = p.waitForRequest((r) => r.url().endsWith("/api/study/session"), { timeout: 30000 });
    for (let i = 0; i < 3; i++) {
      await p.locator(".qz-q").waitFor();
      check(/\(mock reworded\)/.test(await p.locator(".qz-q").innerText()), `question ${i + 1} is the reworded one`);
      const opts = p.locator(".qz-options button");
      const texts = await opts.allInnerTexts();
      const k = texts.findIndex((t) => /Osmosis|Water moving across a membrane|osmosis/.test(t));
      await opts.nth(k).click();
      await p.locator(".study-show:not(.qz-wait)").click();
    }
    const sent = (await saved).postDataJSON();
    check(sent.session.played.length === 3 && sent.session.played.every((x) => x.miss && x.right), "finishing it reports each missed question as answered right");
    await p.waitForTimeout(800);
    check(!errs.length, `no page errors ${errs.join(" | ")}`);
    await p.context().close();
  }
  await b.close();
  check(rows("SELECT MIN(rights) AS lo, MAX(rights) AS hi, MIN(due_at) AS due FROM study_misses").every((r) => r.lo === 1 && r.hi === 1 && r.due > Date.now()), "each counts once and comes back later");

  // ---- only the due ones: one due, two still waiting
  const rowsNow = rows("SELECT id FROM study_misses ORDER BY id");
  sql(`UPDATE study_misses SET due_at = 0 WHERE id = '${rowsNow[0].id}'`);
  const mixed = (await j("POST", "/api/study/misses/review")).body;
  check(mixed.items?.length === 1 && mixed.items[0].miss === rowsNow[0].id, `with one due, the round is just that one (${mixed.items?.length})`);
  const want = new Map(rows("SELECT id, data FROM study_misses").map((r) => [r.id, r]));
  check(early.items.every((x) => want.has(x.miss)), "each reworded question points at a real miss, even though the model answered in reverse order");

  // ---- right twice when due: gone
  sql("UPDATE study_misses SET due_at = 0");
  const again = (await j("POST", "/api/study/misses/review")).body;
  await j("POST", "/api/study/session", { coach: false, session: { ...base, mode: "quiz", right: 3, total: 3, played: rightTo(again.items) } });
  m = await misses();
  check(m.open === 0 && m.due === 0, `right twice once due and they're gone (${JSON.stringify(m)})`);
  check((await j("POST", "/api/study/misses/review")).status === 400, "with nothing to review, it says so");

  // ---- scores: a perfect Match alone doesn't look ready
  const other = (await j("POST", "/api/notes", { title: "Match only", html: "<p>Terms and their meanings.</p>" })).body;
  await j("POST", "/api/study/session", { coach: false, session: { ids: [other.id], title: "Match only", mode: "match", right: 6, total: 6, missed: [] } });
  const score = (await j("GET", `/api/study-overview?today=${today}`)).body.progress.pages[other.id].score;
  check(score === 85, `a perfect Match alone scores at most 85 (${score})`);

  console.log(fails ? `${fails} failed` : "all good");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
