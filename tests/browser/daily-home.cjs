// Home as a daily plan (#13, TodayPlan.tsx) and daily notes (#19, DailyPanel.tsx, worker daily.ts): the next test, the study
// most worth doing and what's due (no Start buttons; tapping the study item opens how to study it); Today's note shows
// the day's tasks, takes quick captures once used, and gets a wrap-up (on demand and at 9:30 PM). Mock model, wiped database.
const { chromium } = require("playwright");
const B = process.env.SEAGLASS_URL || "http://localhost:5173";
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const j = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const cron = async (ms) => (await fetch(`${B}/cdn-cgi/handler/scheduled?cron=*+*+*+*+*&time=${ms}`)).text();

(async () => {
  const tasks = (await j("POST", "/api/tasks/ensure", {})).body.id;
  await j("POST", "/api/notes", { parent_id: tasks, title: "Hand in the lab report", props: { status: "todo", due: { start: day(0) } } });
  await j("POST", "/api/notes", { parent_id: tasks, title: "Library books", props: { status: "todo", due: { start: day(-2) } } });
  await j("POST", "/api/notes", { parent_id: tasks, title: "Next week thing", props: { status: "todo", due: { start: day(6) } } });
  const page = (await j("POST", "/api/notes", { title: "Cell notes", html: "<p>Osmosis moves water across a membrane.</p>" })).body;
  const sub = (await j("POST", "/api/study-subjects", { name: "Biology", color: "green" })).body;
  await j("PUT", `/api/study-pages/${page.id}`, { subject: sub.id, pinned: true });
  await j("POST", "/api/study-exams", { subject: sub.id, name: "Unit 3 test", exam_date: day(3), pages: [page.id] });

  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(() => { localStorage.setItem("sg.agent", "0"); }); // (a new context: no focus timer yet)
  await p.goto(`${B}/?n=${Date.now()}#/`, { waitUntil: "networkidle" });
  const plan = p.locator(".today-plan");
  await plan.locator(".tp-list li").first().waitFor();
  let txt = await plan.innerText();
  for (let i = 0; i < 20 && !/Library books/.test(txt); i++) { await p.waitForTimeout(250); txt = await plan.innerText(); } // the tasks can arrive after the study items
  check(/Unit 3 test/.test(txt) && /Test in 3 days/.test(txt), "Home's plan has the next test");
  check(/Study Cell notes/.test(txt), "and the study most worth doing");
  check(/Hand in the lab report/.test(txt) && /Library books/.test(txt) && /Overdue/.test(txt) && !/Next week thing/.test(txt), "and what's due today or overdue, not next week");
  check(await plan.locator(".tp-start").count() === 0 && !/Start/.test(txt), "no Start buttons");
  // tapping the study item opens how to study it
  await plan.locator("li", { hasText: "Study Cell notes" }).locator(".tp-main").click();
  await p.locator(".study-picker").waitFor();
  check(await p.locator(".focus-pill").count() === 0, "tapping the study item opens how to study it, with no timer");
  await p.keyboard.press("Escape"); await p.waitForTimeout(200);

  // ---- captures go to the Inbox until daily notes are used
  await j("POST", "/api/capture", { text: "before daily notes", type: "note", today: day(0) });
  const tree0 = (await j("GET", "/api/tree")).body;
  check((Array.isArray(tree0) ? tree0 : tree0.notes).some((n) => n.title === "Inbox"), "a capture goes to the Inbox before daily notes are used");

  // ---- Today's note
  await p.goto(`${B}/?n=${Date.now()}#/`, { waitUntil: "networkidle" });
  await plan.locator("button", { hasText: "Today's note" }).click();
  await p.locator(".daily-panel").waitFor();
  const title = await p.locator("textarea.title, .title textarea, h1 textarea, .page-title").first().inputValue().catch(async () => (await p.locator(".page h1, .title").first().innerText().catch(() => "")));
  const want = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  check(title.includes(want), `Today's note is named for the day (${title})`);
  check(/Hand in the lab report/.test(await p.locator(".daily-panel").innerText()) && !/Library books/.test(await p.locator(".daily-panel").innerText()), "it shows the day's tasks");
  const id = p.url().match(/#\/p\/([0-9a-f-]{36})/)?.[1];
  const again = (await j("POST", "/api/daily", { date: day(0) })).body;
  check(again.id === id && again.created === false, "opening it again gives the same page");
  // a capture lands in it now
  await j("POST", "/api/capture", { text: "Buy graph paper", type: "note", today: day(0), tz: Intl.DateTimeFormat().resolvedOptions().timeZone }); // as the app sends it
  const note = (await j("GET", `/api/notes/${id}`)).body;
  check(/\d\d:\d\d · Buy graph paper/.test(note.html), "once daily notes are used, a capture is a timed line in today's note");
  // a capture with no date (an iPhone Shortcut) still lands in HIS today, at their local time, even in the evening when
  // the server's UTC day is already tomorrow: the time zone the device sent once is remembered
  const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const sent = new Date();
  await j("POST", "/api/capture", { text: "From a Shortcut", type: "note" });
  const note2 = (await j("GET", `/api/notes/${id}`)).body;
  const capAt = /(\d\d:\d\d) · From a Shortcut/.exec(note2.html)?.[1];
  check(!!capAt && [hhmm(sent), hhmm(new Date(sent.getTime() + 60000))].includes(capAt), `a capture with no date goes in today's note at their local time (${capAt}, local ${hhmm(sent)})`);
  // wrap up on demand
  await p.reload({ waitUntil: "networkidle" });
  await p.locator(".daily-panel button", { hasText: "Wrap up my day" }).click(); await p.waitForTimeout(1200);
  let html = (await j("GET", `/api/notes/${id}`)).body.html;
  check(/Wrap-up/.test(html) && /mock/.test(html) && /still open/.test(html), "Wrap up my day adds a short wrap-up");
  await p.locator("button", { hasText: /^Undo$/ }).last().click(); await p.waitForTimeout(800);
  html = (await j("GET", `/api/notes/${id}`)).body.html;
  check(!/Wrap-up/.test(html) && /Buy graph paper/.test(html), "and Undo takes just that back off");
  // and at 9:30 PM by itself, once
  // the server keeps the time zone the app last sent with the thread; send it, or 9:30 PM here is another hour in UTC
  await j("GET", `/api/thread?tz=${encodeURIComponent(await p.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone))}`);
  const at = await p.evaluate(() => { const d = new Date(); d.setHours(21, 31, 0, 0); return d.getTime(); });
  await cron(at); await cron(at + 60_000);
  html = (await j("GET", `/api/notes/${id}`)).body.html;
  check((html.match(/Wrap-up/g) ?? []).length === 1, "at 9:30 PM the wrap-up is added by itself, once");
  check(!errs.length, `no page errors ${errs.join(" | ")}`);
  // the evening case, made to happen now: where it's already tomorrow (UTC+14), a capture goes in THAT day's note
  const far = "Pacific/Kiritimati", farDay = new Date().toLocaleDateString("en-CA", { timeZone: far });
  await j("POST", "/api/capture", { text: "Sent from far away", type: "note", tz: far });
  const farNote = (await j("POST", "/api/daily", { date: farDay })).body;
  const farHtml = (await j("GET", `/api/notes/${farNote.id}`)).body.html;
  check(farNote.created === false && /Sent from far away/.test(farHtml), `a capture uses the sender's day, not the server's UTC day (${farDay}, UTC ${new Date().toISOString().slice(0, 10)})`);

  // ---- a phone
  const m = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await m.addInitScript(() => { localStorage.setItem("sg.agent", "0"); });
  await m.goto(`${B}/?n=${Date.now()}#/`, { waitUntil: "networkidle" });
  await m.locator(".today-plan .tp-list li").first().waitFor();
  const fits = await m.locator(".today-plan, .today-plan button").evaluateAll((els) => els.every((e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= 390; }));
  check(fits, "the plan fits on a phone");
  await b.close();
  console.log(fails ? `${fails} failed` : "all good");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
