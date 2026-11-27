// A study plan when a test is created (StudyPlan.tsx, worker coach.ts planForExam): creating a test with a date offers one,
// the assistant's sessions stay before the test, the user can drop some, the rest become dated tasks with reminders (Undo takes
// them back), a plain spread when the model fails, and a "Plan study sessions" row on any later visit. Mock model, wiped database.
const { chromium } = require("playwright");
const B = process.env.SEAGLASS_URL || "http://localhost:5173";
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const j = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };

(async () => {
  const page = (await j("POST", "/api/notes", { title: "Cell notes", html: "<p>Osmosis moves water across a membrane.</p>" })).body;
  const sub = (await j("POST", "/api/study-subjects", { name: "Biology", color: "green" })).body;
  await j("PUT", `/api/study-pages/${page.id}`, { subject: sub.id, pinned: true });

  // ---- the API
  const tdy = (await j("POST", "/api/study-exams", { subject: sub.id, name: "Pop quiz", exam_date: day(0), pages: [page.id] })).body;
  check((await j("POST", `/api/study-exams/${tdy.id}/plan`)).status === 400, "a test today has no plan");
  const none = (await j("POST", "/api/study-exams", { subject: sub.id, name: "Someday", pages: [page.id] })).body;
  check(/date/.test((await j("POST", `/api/study-exams/${none.id}/plan`)).body.error ?? ""), "a test with no date asks for one");
  check((await j("POST", "/api/study/plan", { sessions: [{ title: "x", date: "not a date" }] })).status === 400, "adding a plan with no real sessions is refused");
  await j("DELETE", `/api/study-exams/${tdy.id}`); await j("DELETE", `/api/study-exams/${none.id}`);

  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { localStorage.setItem("sg.agent", "0"); localStorage.removeItem("sg.study.subject"); });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  let plans = 0; p.on("request", (r) => { if (/\/plan$/.test(r.url()) && /study-exams/.test(r.url())) plans++; });

  // ---- creating a test with a date offers a plan
  await p.goto(B + "/#/study", { waitUntil: "networkidle" });
  await p.locator(".st-folder", { hasText: "Biology" }).click();
  await p.locator(".st-pick", { hasText: "New test" }).click();
  await p.locator("input[placeholder^='Test name']").fill("Unit 3 test");
  await p.locator(".st-date input[type=date]").fill(day(5));
  const box = p.locator(".st-check", { hasText: "Cell notes" }).locator("input");
  if (!(await box.isChecked())) await box.check();
  await p.locator("button[type=submit]", { hasText: "Create" }).click();
  const card = p.locator(".pk-plan");
  await card.waitFor();
  check(/Unit 3 test is in 5 days/.test(await card.innerText()), "a new test with a date offers a study plan");
  check(plans === 0, "nothing is asked of the model until the user says yes");

  await card.locator("button", { hasText: "Plan my sessions" }).click();
  await p.locator(".pk-plan-list li").first().waitFor();
  let rows = await p.locator(".pk-plan-list li").allInnerTexts();
  check(plans === 1, "one plan request");
  check(!rows.some((t) => /test day/.test(t)) && rows.some((t) => /Light review/.test(t)), `the session on the test day is dropped, the day before is kept (${rows.length})`);
  check(rows.some((t) => /6:00/.test(t)), "each session shows its time");
  if (rows.length === 2) { // the mock's session today is kept only if 16:30 hasn't passed yet
    await p.locator(".pk-plan-list li", { hasText: "weakest" }).locator(".st-act").click();
    rows = await p.locator(".pk-plan-list li").allInnerTexts();
  }
  check(rows.length === 1 && /Add 1 to My tasks/.test(await card.locator(".pk-plan-actions .primary").innerText()), "removing one leaves the rest to add");
  const added = p.waitForResponse((r) => r.url().endsWith("/api/study/plan"));
  await card.locator(".pk-plan-actions .primary").click();
  const res = await (await added).json();
  const task = (await j("GET", `/api/notes/${res.note_ids[0]}`)).body;
  const props = typeof task.props === "string" ? JSON.parse(task.props) : task.props;
  check(res.note_ids.length === 1 && props.due?.start === day(4) && props.due?.start_time === "18:00" && /Light review/.test(task.title), `it's a task the day before at 18:00, so it gets a reminder (${JSON.stringify(props.due)})`);
  await p.waitForTimeout(200);
  check(/They're in My tasks/.test(await card.innerText()) && /reminder/.test(await card.innerText()), "the card says they're added");
  await p.locator("button", { hasText: /^Undo$/ }).first().click();
  await p.waitForTimeout(600);
  const gone = await j("GET", `/api/notes/${res.note_ids[0]}`);
  check(gone.status === 404 || !!gone.body.deleted_at, "Undo takes the sessions back off");
  check(await p.locator(".pk-plan-list li").count() === 1, "and the plan is back to add again");

  // ---- a later visit: a row, not the offer
  await p.keyboard.press("Escape"); await p.waitForTimeout(200);
  await p.locator(".st-xrow", { hasText: "Unit 3 test" }).click();
  await p.locator(".pk-plan-open").waitFor();
  check(await p.locator(".pk-plan").count() === 0 && /in 5 days/.test(await p.locator(".pk-plan-open").innerText()), "opening the test later shows a Plan study sessions row instead");
  await p.keyboard.press("Escape"); await p.waitForTimeout(200);

  // ---- when the model fails: a plain spread, weakest first
  await j("POST", "/api/study-exams", { subject: sub.id, name: "mock-plan-fails test", exam_date: day(3), pages: [page.id] });
  await p.goto(`${B}/?n=${Date.now()}#/study`, { waitUntil: "networkidle" }); // a real reload (the tab remembers the open subject)
  await p.locator(".st-folder", { hasText: "Biology" }).click();
  await p.locator(".st-xrow", { hasText: "mock-plan-fails" }).click();
  await p.locator(".pk-plan-open").click();
  await p.locator(".pk-plan-list li").first().waitFor();
  const plain = await p.locator(".pk-plan-list li").allInnerTexts();
  check(plain.length === 3 && /couldn't plan this one/.test(await p.locator(".pk-plan").innerText()) && /light review/i.test(plain[2]), `without the model it still offers a plain spread (${plain.length})`);
  check(!errs.length, `no page errors ${errs.join(" | ")}`);
  await ctx.close();

  // ---- a phone
  const pc = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await pc.addInitScript(() => { localStorage.setItem("sg.agent", "0"); localStorage.removeItem("sg.study.subject"); });
  const m = await pc.newPage();
  const merrs = []; m.on("pageerror", (e) => merrs.push(e.message));
  await m.goto(B + "/#/study", { waitUntil: "networkidle" });
  await m.locator(".st-folder", { hasText: "Biology" }).click();
  await m.locator(".st-xrow", { hasText: "Unit 3 test" }).click();
  await m.locator(".pk-plan-open").click();
  await m.locator(".pk-plan-list li").first().waitFor();
  const fit = await m.locator(".pk-plan, .pk-plan-list li, .pk-plan-actions button").evaluateAll((els) => els.every((e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= 390; }));
  check(fit, "the plan and its buttons fit on a phone");
  check(!merrs.length, `no page errors on the phone ${merrs.join(" | ")}`);
  await b.close();

  console.log(fails ? `${fails} failed` : "all good");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
