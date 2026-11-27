// The real grade after a test (StudyGrade.tsx, worker study.ts logGrade): once its date has passed the Study tab asks how it
// went; saving adds a row to Grades under the subject as a class (made if missing), marks the test done, keeps what practice
// predicted and says how they compare; Undo takes it all back; Skip; the assistant can log one too. Mock model, wiped database.
const { chromium } = require("playwright");
const B = process.env.SEAGLASS_URL || "http://localhost:5173";
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const j = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const overview = async () => (await j("GET", `/api/study-overview?today=${day(0)}`)).body;
const gradesRows = async () => {
  const tree = (await j("GET", "/api/tree")).body;
  const list = Array.isArray(tree) ? tree : tree.notes ?? tree.items ?? [];
  const g = list.find((n) => n.kind === "database" && n.title === "Grades");
  if (!g) return { db: null, rows: [] };
  const db = (await j("GET", `/api/notes/${g.id}`)).body;
  const rows = (await j("GET", `/api/notes/${g.id}/children`)).body;
  return { db, rows: Array.isArray(rows) ? rows : rows.children ?? [] };
};

(async () => {
  const page = (await j("POST", "/api/notes", { title: "Cell notes", html: "<p>Osmosis moves water across a membrane.</p>" })).body;
  const sub = (await j("POST", "/api/study-subjects", { name: "Biology", color: "green" })).body;
  await j("PUT", `/api/study-pages/${page.id}`, { subject: sub.id, pinned: true });
  await j("POST", "/api/study/session", { coach: false, session: { mode: "test", ids: [page.id], title: "Cell notes", right: 7, total: 10, missed: [] } });
  const past = (await j("POST", "/api/study-exams", { subject: sub.id, name: "Unit 2 test", exam_date: day(-2), pages: [page.id] })).body;
  await j("POST", "/api/study-exams", { subject: sub.id, name: "Unit 3 test", exam_date: day(4), pages: [page.id] });

  // ---- the API
  check((await j("POST", `/api/study-exams/${past.id}/grade`, { score: "abc" })).status === 400, "a score that isn't a number is refused");
  check((await j("POST", `/api/study-exams/${past.id}/grade`, { score: "500", outof: "100" })).status === 400, "and so is one far past the maximum");

  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { localStorage.setItem("sg.agent", "0"); localStorage.removeItem("sg.study.subject"); });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(`${B}/?n=${Date.now()}#/study`, { waitUntil: "networkidle" });

  // ---- asked once the date has passed, not before
  const card = p.locator(".st-grade");
  await card.first().waitFor();
  check(await card.count() === 1 && /How did Unit 2 test go\?/.test(await card.innerText()), "the Study tab asks how the test that just happened went, and not the one ahead");
  await card.locator("input[aria-label='Your score']").fill("42");
  await card.locator("input[aria-label='Out of']").fill("50");
  check(/84%/.test(await card.innerText()), "it shows the percent as you type");
  await card.locator("button", { hasText: "Save to Grades" }).click();
  await p.locator(".st-grade.done").waitFor();
  const said = await p.locator(".st-grade.done").innerText();
  check(/84%/.test(said) && /Practice said 70%, so you did 14 points better/.test(said), `it compares the grade with practice (${said.replace(/\n/g, " ")})`);

  let o = await overview();
  let ex = o.exams.find((e) => e.id === past.id);
  check(ex.done_at && ex.grade?.pct === 84 && ex.grade?.practice === 70, "the test is done, with the grade and what practice said");
  let g = await gradesRows();
  const cls = JSON.parse(g.db?.db_schema ?? "{}").properties?.find((x) => x.id === "class");
  const bio = cls?.options?.find((x) => x.name === "Biology");
  const row = g.rows.find((r) => r.title === "Unit 2 test");
  const props = row && (typeof row.props === "string" ? JSON.parse(row.props) : row.props);
  check(!!bio && bio.color === "green", "Grades gets Biology as a class, in the subject's colour");
  check(props && props.class === bio?.id && props.category === "test" && props.score === 42 && props.outof === 50 && props.date?.start === day(-2), `and a Test row with the score on the test's date (${JSON.stringify(props)})`);
  check(/\+14/.test(await p.locator(".st-stat", { hasText: "real vs practice" }).innerText().catch(() => "")), "the Study tab shows how real grades compare with practice");
  check((await j("POST", `/api/study-exams/${past.id}/grade`, { score: "40", outof: "50" })).status === 400, "a second grade for the same test is refused");

  // ---- undo
  await p.locator(".st-grade.done button", { hasText: "Undo" }).click();
  await p.locator(".st-grade:not(.done)").waitFor();
  o = await overview(); ex = o.exams.find((e) => e.id === past.id);
  g = await gradesRows();
  check(!ex.done_at && !ex.grade && !g.rows.some((r) => r.title === "Unit 2 test"), "Undo takes the row out of Grades and opens the test again");
  check(await p.locator(".st-grade:not(.done)").count() === 1, "and asks again");

  // ---- skip
  await p.locator(".st-grade button", { hasText: "Skip" }).click();
  await p.waitForTimeout(500);
  o = await overview(); ex = o.exams.find((e) => e.id === past.id);
  check(ex.done_at && ex.grade?.skipped && await p.locator(".st-grade").count() === 0, "Skip marks it done with no grade, and stops asking");
  check(!(await gradesRows()).rows.some((r) => r.title === "Unit 2 test"), "and adds nothing to Grades");
  await j("DELETE", `/api/study-exams/${past.id}/grade`);

  // ---- a phone
  const pc = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await pc.addInitScript(() => { localStorage.setItem("sg.agent", "0"); localStorage.removeItem("sg.study.subject"); });
  const m = await pc.newPage();
  const merrs = []; m.on("pageerror", (e) => merrs.push(e.message));
  await m.goto(`${B}/?n=${Date.now()}#/study`, { waitUntil: "networkidle" });
  await m.locator(".st-grade").waitFor();
  const fits = await m.locator(".st-grade, .st-grade input, .st-grade button").evaluateAll((els) => els.every((e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= 390; }));
  const font = await m.locator(".st-grade input").first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  check(fits && font >= 16, `the card fits on a phone, with 16px fields (${font}px)`);
  await m.locator(".st-grade input[aria-label='Your score']").fill("91");
  await m.locator(".st-grade button", { hasText: "Save to Grades" }).click();
  await m.locator(".st-grade.done").waitFor();
  check(/91%/.test(await m.locator(".st-grade.done").innerText()), "out of 100 by default");
  check(!merrs.length && !errs.length, `no page errors ${[...errs, ...merrs].join(" | ")}`);
  await b.close();

  o = await overview(); ex = o.exams.find((e) => e.id === past.id);
  g = await gradesRows();
  check(ex.grade?.pct === 91 && g.rows.some((r) => r.title === "Unit 2 test"), "after an Undo, the next grade still goes into Grades");

  // ---- a second graded test: the average gap (91 vs 70, 90 vs 70)
  const third = (await j("POST", "/api/study-exams", { subject: sub.id, name: "Pop quiz", exam_date: day(-1), pages: [page.id] })).body;
  const r = await j("POST", `/api/study-exams/${third.id}/grade`, { score: "18", outof: "20" });
  check(r.body.gap?.n === 2 && r.body.gap?.avg === 21, `two graded tests give the average gap (${JSON.stringify(r.body.gap)})`);

  console.log(fails ? `${fails} failed` : "all good");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
