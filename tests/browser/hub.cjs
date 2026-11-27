// Each subject as a class hub (#9, SubjectHub.tsx, worker hub.ts) and "what do I need on this test?" (#10). Mock model, wiped
// database.
const { chromium } = require("playwright");
const B = process.env.SEAGLASS_URL || "http://localhost:5173";
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const j = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

(async () => {
  const page = (await j("POST", "/api/notes", { title: "Cell notes", html: "<p>Osmosis.</p>" })).body;
  const sub = (await j("POST", "/api/study-subjects", { name: "Biology", color: "green" })).body;
  await j("PUT", `/api/study-pages/${page.id}`, { subject: sub.id, pinned: true });
  const t1 = (await j("POST", "/api/study-exams", { subject: sub.id, name: "Unit 1 test", exam_date: day(-20), pages: [page.id] })).body;
  const t2 = (await j("POST", "/api/study-exams", { subject: sub.id, name: "Unit 2 test", exam_date: day(-6), pages: [page.id] })).body;
  await j("POST", `/api/study-exams/${t1.id}/grade`, { score: "85" });
  await j("POST", `/api/study-exams/${t2.id}/grade`, { score: "42", outof: "50" });
  const t3 = (await j("POST", "/api/study-exams", { subject: sub.id, name: "Unit 3 test", exam_date: day(4), pages: [page.id] })).body;

  // ---- the API
  let hub = (await j("GET", `/api/study-subjects/${sub.id}/hub?today=${day(0)}`)).body;
  check(hub.class?.name === "Biology" && hub.average?.pct === 84.7 && hub.average?.letter === "B" && hub.grades.length === 2, `the subject finds its class in Grades by name: 84.7% (by points), a B (${JSON.stringify(hub.average)})`);
  check(hub.next?.id === t3.id && hub.next.outlook?.line === "You need 80% on Unit 3 test to keep your B; 92% gets you a B+.", `what the next test needs (${hub.next?.outlook?.line})`);
  check(!("tasks" in hub) && (await j("POST", `/api/study-subjects/${sub.id}/tasks`, { title: "Read chapter 4" })).status === 404, "no tasks in the hub (homework stays in My tasks)");

  // ---- in the app
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(() => { localStorage.setItem("sg.agent", "0"); localStorage.removeItem("sg.study.subject"); });
  await p.goto(`${B}/?n=${Date.now()}#/study`, { waitUntil: "networkidle" });
  await p.locator(".st-folder", { hasText: "Biology" }).click();
  const h = p.locator(".sh-hub");
  await h.locator(".sh-avg").waitFor();
  const txt = await h.innerText();
  check(/84\.7%/.test(txt) &&/\bB\b/.test(txt) && /2 graded/.test(txt), "the subject screen shows the class grade");
  check(/You need 80% on Unit 3 test to keep your B/.test(txt), "and what the next test needs");
  check(/Unit 1 test/.test(txt) && /Unit 2 test/.test(txt), "with its grades");
  check(await h.locator(".sh-card").count() === 1 && !/Tasks|Homework/.test(txt), "and no Tasks card");
  check(await h.locator(".sh-card-head select").count() === 1, "the class in Grades can be changed here");
  // the test's screen
  await p.locator(".st-xrow", { hasText: "Unit 3 test" }).click();
  await p.locator(".pk-need").waitFor();
  check(/You need 80% on Unit 3 test to keep your B; 92% gets you a B\+/.test(await p.locator(".pk-need").innerText()), "the test's screen says what it needs");
  check(!errs.length, `no page errors ${errs.join(" | ")}`);
  await p.keyboard.press("Escape");

  // ---- a phone
  const m = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await m.addInitScript(() => { localStorage.setItem("sg.agent", "0"); localStorage.removeItem("sg.study.subject"); });
  await m.goto(`${B}/?n=${Date.now()}#/study`, { waitUntil: "networkidle" });
  await m.locator(".st-folder", { hasText: "Biology" }).click();
  await m.locator(".sh-avg").waitFor();
  const fits = await m.locator(".sh-hub, .sh-card, .sh-card-head select").evaluateAll((els) => els.every((e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= 390; }));
  const font = await m.locator(".sh-card-head select").first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  check(fits && font >= 16, `the hub fits on a phone with a 16px class picker (${font}px)`);
  await b.close();
  console.log(fails ? `${fails} failed` : "all good");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
