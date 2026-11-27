// Snap a syllabus (#11, SyllabusDialog.tsx, worker syllabus.ts) and record a class (#12, LectureRecorder.tsx, worker
// lecture.ts). Chromium's fake microphone; pieces shortened to 2 s with sg.lecture.piece. Mock model, wiped database.
const { chromium } = require("playwright");
const path = require("path");
const B = process.env.SEAGLASS_URL || "http://localhost:5173";
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const j = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

(async () => {
  const b = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["microphone"] });
  await ctx.addInitScript(() => { localStorage.setItem("sg.agent", "0"); localStorage.removeItem("sg.study.subject"); localStorage.setItem("sg.lecture.piece", "2000"); });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));

  // ---- syllabus
  await p.goto(`${B}/?n=${Date.now()}#/study`, { waitUntil: "networkidle" });
  await p.locator(".st-syllabus").click();
  await p.locator(".modal.syllabus input[type=file]").setInputFiles(path.join(__dirname, "..", "..", "public", "icon-192.png"));
  await p.locator(".syl-review").waitFor();
  const rev = await p.locator(".syl-review").innerText();
  check((await p.locator(".syl-name input").inputValue()) === "(mock) Chemistry" && /Unit 1 test/.test(rev) && /Midterm/.test(rev) && /Lab report 1/.test(rev), "a photo is read into the class, its tests and its assignments");
  check(/Reading notes/.test(rev) && /No date/.test(rev), "an assignment without a real date is kept, with no date");
  await p.locator(".syl-name input").fill("Chemistry");
  await p.locator(".syl-review li", { hasText: "Midterm" }).locator("input").uncheck();
  await p.locator(".syl-actions .primary").click();
  await p.locator(".st-subject", { hasText: "Chemistry" }).waitFor();
  let o = (await j("GET", `/api/study-overview?today=${day(0)}`)).body;
  const chem = o.subjects.find((x) => x.name === "Chemistry");
  check(!!chem && chem.icon === "🧪", "the subject is made, with its emoji");
  const kept = o.exams.filter((e) => e.subject_id === chem?.id).map((e) => [e.name, e.exam_date]).join();
  check(kept === ["Unit 1 test", day(10)].join(), `only the tests the user kept, with their dates (${kept})`);
  const hub = (await j("GET", `/api/study-subjects/${chem.id}/hub?today=${day(0)}`)).body;
  check(hub.tasks.length === 2 && hub.tasks.some((t) => t.title === "Lab report 1" && t.due === day(5)), `the assignments are tasks, tagged with the subject (${JSON.stringify(hub.tasks)})`);
  await p.locator("button", { hasText: /^Undo$/ }).last().click(); await p.waitForTimeout(1200);
  o = (await j("GET", `/api/study-overview?today=${day(0)}`)).body;
  const tasksDb = (await j("POST", "/api/tasks/ensure", {})).body.id;
  const rows = (await j("GET", `/api/notes/${tasksDb}/children`)).body;
  check(!o.subjects.some((x) => x.name === "Chemistry") && !(Array.isArray(rows) ? rows : rows.children ?? []).some((r) => r.title === "Lab report 1"), "Undo takes the subject, tests and tasks back");

  // ---- record a class
  const bio = (await j("POST", "/api/study-subjects", { name: "Biology", color: "green" })).body;
  await p.goto(`${B}/?n=${Date.now()}#/study`, { waitUntil: "networkidle" });
  await p.locator(".st-folder", { hasText: "Biology" }).click();
  await p.locator(".st-subject-actions button", { hasText: "Record a class" }).click();
  await p.locator(".lecture").waitFor();
  check((await p.locator(".lecture select").inputValue()) === bio.id, "from a subject, its class is chosen");
  await p.locator(".lecture input[aria-label=Title]").fill("Photosynthesis lecture");
  await p.locator(".lecture-go").click();
  await p.locator(".lecture-clock").waitFor();
  await p.waitForFunction(() => /2 of 2 parts|[3-9] of [3-9] parts/.test(document.querySelector(".lecture-body")?.textContent ?? ""), null, { timeout: 20000 }).catch(() => {});
  check(/of \d+ parts? turned into text/.test(await p.locator(".lecture-body").innerText()), "it records in pieces and turns each into text as it goes");
  await p.locator(".lecture-go", { hasText: "Stop and make notes" }).click();
  await p.waitForURL(/#\/p\/[0-9a-f-]{36}/, { timeout: 30000 });
  const id = p.url().match(/#\/p\/([0-9a-f-]{36})/)[1];
  const note = (await j("GET", `/api/notes/${id}`)).body;
  check(note.title === "Photosynthesis lecture" && /Class notes/.test(note.html) && /Flashcards/.test(note.html) && /Transcript/.test(note.html), "stopping makes notes with flashcards and keeps the transcript");
  check(((note.html.match(/This is a transcribed voice note/g)) ?? []).length >= 2, "from every piece of the recording");
  o = (await j("GET", `/api/study-overview?today=${day(0)}`)).body;
  check(o.decks.some((d) => d.id === id && d.subject_id === bio.id), "filed under the subject in the Study tab");
  check(!errs.length, `no page errors ${errs.join(" | ")}`);

  // ---- phone: the Study tab's buttons and the recorder fit
  const m = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await m.addInitScript(() => { localStorage.setItem("sg.agent", "0"); localStorage.removeItem("sg.study.subject"); });
  await m.goto(`${B}/?n=${Date.now()}#/study`, { waitUntil: "networkidle" });
  await m.locator(".st-syllabus").waitFor();
  const fits = await m.locator(".st-decks .st-head button").evaluateAll((els) => els.every((e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= 390; }));
  check(fits, "the Study tab's buttons fit on a phone");
  await m.locator(".st-record").click(); await m.locator(".lecture").waitFor();
  const fits2 = await m.locator(".lecture-field select, .lecture-field input, .lecture-go").evaluateAll((els) => els.every((e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= 390; }));
  check(fits2, "and so does the recorder");
  await b.close();
  console.log(fails ? `${fails} failed` : "all good");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
