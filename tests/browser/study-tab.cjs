// The Study tab: subjects as folders of tests, the picker for how to study (Flashcards, Quiz, Fill in the
// blanks, Match, Practice test, Chat), studying a whole subject, Review all due, one-tap Done / Exclude with Undo, subject
// management (create, colour, test date, rename, done, delete), and the assistant's study tools. No flashcards panel on
// Home; Study is a phone tab. Needs ANTHROPIC_API_KEY=mock and a wiped database.
const { chromium, devices } = require("playwright");
const B = process.env.SEAGLASS_URL || "http://localhost:5173";
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const j = (m, p, b) => fetch(B + p, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json());
const agent = (message) => fetch(B + "/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) }).then((r) => r.text());
const TERMS = { Osmosis: "Diffusion of water across a membrane", Mitochondria: "Makes ATP for the cell", Ribosome: "Builds proteins", Nucleus: "Holds the DNA", Vacuole: "Stores water and food" };
const CIVICS = { "Electoral College": "The 538 electors who elect the president", "Swing state": "A state either party could win" };
const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

(async () => {
  const bio = await j("POST", "/api/notes", { title: "Cell biology", icon: "🧬", html: "<p>mock-no-questions</p>" + Object.entries(TERMS).map(([t, d]) => `<p>${t} :: ${d}</p>`).join("") + "<p>Plants make glucose by <strong>photosynthesis</strong> in leaves.</p>" });
  const civ = await j("POST", "/api/notes", { title: "Civics notes", html: "<p>mock-no-questions</p>" + Object.entries(CIVICS).map(([t, d]) => `<p>${t} :: ${d}</p>`).join("") });
  const recipe = await j("POST", "/api/notes", { title: "Recipe", html: "<p>Flour :: 2 cups</p><p>Sugar :: 1 cup</p>" });
  await j("POST", "/api/notes", { title: "Shopping list", html: "<p>eggs, milk</p>" });

  // The assistant organises Study with its tools (mock model calls them directly)
  await agent(`mock:tool manage_subject {"action":"create","name":"Biology","exam_date":"${inDays(3)}","color":"green"}`);
  const moved = await agent(`mock:tool update_study_page {"page_id":"${bio.id}","subject":"biology"}`);
  check(/moved to a subject/.test(moved), "the assistant puts a page in a subject (by name, any case)");
  const ov = await agent("mock:tool study_overview {}");
  check(/Looked at Study · 1 subject, 3 pages/.test(ov) && /Biology/.test(ov), "the assistant can see the Study tab");
  const bad = await agent(`mock:tool update_study_page {"page_id":"${bio.id}","subject":"Chemistry"}`);
  check(/No subject \\"Chemistry\\"/.test(bad) || /No subject "Chemistry"/.test(bad), "an unknown subject is a clear error listing the real ones");

  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(() => { localStorage.setItem("sg.agent", "0"); localStorage.removeItem("sg.study.subject"); });

  await p.goto(B + "/#/", { waitUntil: "networkidle" });
  check(!(await p.locator(".home-study").count()), "Home has no flashcards panel");
  await p.locator(".sb-btn", { hasText: "Study" }).click();
  await p.waitForSelector(".st-folder");
  check(await p.locator(".st-folder", { hasText: "Biology" }).count() === 1, "subjects are folders");
  const looseTitles = await p.locator(".st-deck-head b").allInnerTexts();
  check(looseTitles.includes("Civics notes") && !looseTitles.includes("Cell biology") && !looseTitles.includes("Shopping list"), `only pages without a subject are loose (${looseTitles.join(", ")})`);
  check(/Test in 3 days/.test(await p.locator(".st-today").innerText()), "the next test counts down at the top");

  // one-tap Exclude (from the ⋯ menu) and Done, each with Undo
  const row = (t) => p.locator(".st-deck", { hasText: t });
  const openFolder = async (n) => { await p.locator(".st-folder", { hasText: n }).click(); await p.waitForSelector(".st-subject"); };
  const home = async () => { await p.locator(".st-back").click(); await p.waitForSelector(".st-today"); };
  const closePick = async () => { await p.keyboard.press("Escape"); await p.waitForTimeout(250); };
  await row("Recipe").locator("button[aria-label=More]").click();
  await p.locator(".st-menu button", { hasText: "Exclude from Study" }).click();
  await p.waitForTimeout(400);
  check(!(await row("Recipe").count()), "Exclude takes a page out of Study");
  await p.locator(".st-fold", { hasText: "Excluded" }).click();
  check(await p.locator(".st-arch-row", { hasText: "Recipe" }).count() === 1, "it's listed under Excluded");
  await p.locator(".st-arch-row", { hasText: "Recipe" }).locator("button", { hasText: "Include" }).click(); await p.waitForTimeout(400);
  check(await row("Recipe").count() === 1, "Include brings it back");
  await row("Recipe").locator("button[aria-label='Mark done']").click(); await p.waitForTimeout(400);
  check(!(await row("Recipe").count()), "Done takes it out of the list");
  await p.locator(".toasts .toast-act", { hasText: "Undo" }).last().click(); await p.waitForTimeout(500);
  check(await row("Recipe").count() === 1, "and Undo puts it back");
  await row("Recipe").locator("button[aria-label='Mark done']").click(); await p.waitForTimeout(400);
  await p.locator(".st-fold", { hasText: "Done" }).click();
  check(await p.locator(".st-arch-row", { hasText: "Recipe" }).count() === 1, "done pages are kept under Done");

  // a subject with a colour and an emoji
  await p.locator(".st-add-subject").click();
  await p.locator(".st-editor input").first().fill("Civics");
  await p.locator(".st-swatch.c-purple").click();
  await p.locator(".st-emojis button", { hasText: "🏛️" }).click();
  await p.locator(".st-editor input[type=date]").fill(inDays(10));
  await p.locator(".st-editor button", { hasText: "Create" }).click(); await p.waitForTimeout(500);
  check(await p.locator(".st-subject h2", { hasText: "Civics" }).count() === 1, "+ Subject creates it and opens it");
  check(await p.locator(".st-subject.c-purple .st-emoji", { hasText: "🏛️" }).count() === 1, "with its colour and emoji");
  check(/Test in 10 days/.test(await p.locator(".st-subject").innerText()), "and its test date");
  await home();
  check(await p.locator(".st-folder.c-purple .st-folder-mark", { hasText: "🏛️" }).count() === 1, "the folder shows them");
  await row("Civics notes").locator("button[aria-label=More]").click();
  await p.locator(".st-menu button", { hasText: "Civics" }).click(); await p.waitForTimeout(400);
  await openFolder("Civics");
  check((await p.locator(".st-deck-head b").allInnerTexts()).join() === "Civics notes", "the subject shows only its pages");
  // tests live inside a subject
  await p.locator(".st-empty button", { hasText: "New test" }).click();
  check(await p.locator(".st-exam-editor input[type=date]").inputValue() === inDays(10), "a first test starts with the subject's date");
  check(await p.locator(".st-check input:checked").count() === 1, "and its pages");
  await p.locator(".st-exam-editor input").first().fill("Unit 1 test");
  await p.locator(".st-exam-editor button", { hasText: "Create" }).click();
  await p.waitForSelector(".study-pick .pk-head");
  check(/Unit 1 test/.test(await p.locator(".pk-head h1").innerText()) && /Test in 10 days/.test(await p.locator(".pk-head").innerText()), "New test opens its study picker");
  check(await p.locator(".pk-best b").innerText() === "Quiz", "it suggests where to start");
  await closePick();
  check(await p.locator(".st-xrow", { hasText: "Unit 1 test" }).count() === 1 && /Test in 10 days/.test(await p.locator(".st-xrow").innerText()), "the test is listed in the folder with its date");
  check(!(await row("Civics notes").count()), "a page in a test isn't listed loose");
  await p.locator(".st-xrow").click(); await p.waitForSelector(".study-pick .pk-head");
  await p.locator("button[aria-label='Edit test']").click();
  await p.locator(".st-exam-editor input").first().fill("Unit 1 final"); await p.locator(".st-exam-editor button", { hasText: "Save" }).click(); await p.waitForTimeout(500);
  check(/Unit 1 final/.test(await p.locator(".pk-head h1").innerText()), "a test can be renamed from its picker");
  await closePick(); await home();

  await openFolder("Biology");
  const bar = await p.locator(".st-mastery .legend").innerText();
  check(/Not practised yet/.test(bar), `the subject shows how practice is going (${bar.replace(/\s+/g, " ")})`);
  await p.locator(".st-subject-actions button", { hasText: "Study all of Biology" }).click(); await p.waitForSelector(".study-pick .st-mode");
  await p.locator(".study-pick .st-mode", { hasText: "Quiz" }).click(); await p.waitForSelector(".qz-options");
  check(/straight from your flashcards/.test(await p.locator(".drill-note").innerText()), "if the assistant can't write a quiz, it comes from the page's own flashcards");
  check((await p.locator(".study-title b").last().innerText()) === "Biology", "Quiz runs on the whole subject");
  await p.keyboard.press("Escape"); await p.waitForTimeout(250);
  check(await p.locator(".study-pick").count() === 1, "Esc leaves the game and comes back to the picker");
  await closePick();

  // the assistant: a test with its date and pages, and an emoji
  const made = await agent(`mock:tool manage_exam {"action":"create","subject":"Biology","name":"Cells quiz","exam_date":"${inDays(2)}","pages":["${bio.id}"]}`);
  check(/Test “Cells quiz”/.test(made), "the assistant can make a test");
  check(/Updated subject/.test(await agent(`mock:tool manage_subject {"action":"update","subject":"Biology","icon":"🧬"}`)), "and set a subject's emoji");
  check(/single emoji/.test(await agent(`mock:tool manage_subject {"action":"update","subject":"Biology","icon":"hello"}`)), "a bad emoji is refused");
  check(/tests[\\"]*:\[\{/.test(await agent("mock:tool study_overview {}")), "study_overview shows tests");
  await p.reload({ waitUntil: "networkidle" }); await openFolder("Biology"); await p.waitForSelector(".st-xrow");
  check(/Test in 2 days/.test(await p.locator(".st-subject").innerText()), "a subject's date comes from its soonest test");

  // Flashcards: Again keeps a card due, then Review all due picks it up
  await p.locator(".st-xrow", { hasText: "Cells quiz" }).click(); await p.waitForSelector(".study-pick .st-mode");
  const mode = (n) => p.locator(".study-pick .st-mode", { hasText: n });
  await mode(/^Flashcards/).click(); await p.waitForSelector(".study-show");
  await p.keyboard.press("Space"); await p.keyboard.press("1"); await p.waitForTimeout(300);
  await p.keyboard.press("Escape"); await p.waitForTimeout(600);
  check(await p.locator(".study-pick").count() === 1, "flashcards come back to the picker too");

  // the ways to study still work from the picker
  check(await p.locator(".study-pick .st-mode").count() === 9, "the picker offers seven ways to study, more flashcards and History");
  await mode("Fill in").click(); await p.waitForSelector(".drill-sentence");
  let blanks = 0;
  while (await p.locator(".drill-sentence").count()) {
    const text = await p.locator(".drill-sentence").innerText();
    const term = Object.keys(TERMS).find((t) => text.includes(TERMS[t]));
    await p.locator(".drill-blank input").fill(term ?? "photosynthesis"); await p.keyboard.press("Enter"); await p.keyboard.press("Enter");
    if (++blanks > 10) break;
  }
  check(blanks === 6 && (await p.locator(".drill-score b").innerText()) === "100%", "fill in the blanks plays through");
  await p.locator(".study-done-actions button", { hasText: "Done" }).click(); await p.waitForTimeout(400);
  check(/100%/.test(await mode("Fill in").innerText()), "the picker shows your last score in that mode");
  await mode("Match").click(); await p.waitForSelector(".drill-tiles .tile");
  for (let g = 0; g < 20 && !(await p.locator(".drill-score").count()); g++) {
    const t = (await p.locator(".drill-tiles .tile:not(.gone)").allInnerTexts()).find((x) => TERMS[x]);
    if (!t) { await p.waitForTimeout(400); continue; }
    await p.locator(".drill-tiles .tile:not(.gone)", { hasText: new RegExp(`^${t}$`) }).click();
    await p.locator(".drill-tiles .tile:not(.gone)", { hasText: TERMS[t] }).click(); await p.waitForTimeout(120);
  }
  await p.waitForSelector(".drill-score", { timeout: 5000 }).catch(() => {});
  check(/All 5 matched/.test(await p.locator(".drill-results").innerText().catch(() => "")), "match plays through");
  await p.locator(".study-done-actions button", { hasText: "Done" }).click();
  await mode("Practice test").click(); await p.waitForSelector(".quiz");
  await p.keyboard.press("Escape"); await p.waitForTimeout(250);
  await closePick(); await home();
  const review = p.locator(".st-review"); await review.waitFor();
  check(/Review all 1 due/.test(await review.innerText()), "a card marked Again shows up as due");
  await review.click(); await p.waitForSelector(".study .study-q");
  check((await p.locator(".study-title b").innerText()) === "Everything due" && /1 left/.test(await p.locator(".study-count").innerText()), "Review all due runs just the due cards");
  await p.keyboard.press("Escape"); await p.waitForTimeout(250);

  // subject done, then delete (pages stay)
  await openFolder("Civics");
  await p.locator(".st-subject-actions button", { hasText: "Done with Civics" }).click(); await p.waitForTimeout(500);
  check(!(await p.locator(".st-folder", { hasText: "Civics" }).count()), "Done with a subject puts it away");
  await p.locator(".toasts .toast-act", { hasText: "Undo" }).last().click(); await p.waitForTimeout(500);
  await openFolder("Civics");
  await p.locator(".st-subject button[aria-label='Edit subject']").click();
  check(!(await p.locator(".st-editor input[type=date]").count()), "a subject with tests takes its date from them");
  await p.locator(".st-editor input").first().fill("US Civics"); await p.locator(".st-editor button", { hasText: "Save" }).click(); await p.waitForTimeout(400);
  check(await p.locator(".st-subject h2", { hasText: "US Civics" }).count() === 1, "a subject can be renamed");
  await p.locator(".st-subject button[aria-label='Edit subject']").click();
  await p.locator(".st-editor button", { hasText: "Delete" }).click();
  await p.locator(".modal button", { hasText: /OK|Confirm|Delete/ }).first().click().catch(() => p.keyboard.press("Enter"));
  await p.waitForTimeout(600);
  check(!(await p.locator(".st-folder", { hasText: "Civics" }).count()) && (await row("Civics notes").count()) === 1, "deleting a subject keeps its pages");

  // phone
  const ph = await (await b.newContext({ ...devices["iPhone 14"] })).newPage();
  ph.on("pageerror", (e) => errs.push("phone: " + e.message));
  await ph.goto(B + "/#/study", { waitUntil: "networkidle" }); await ph.waitForSelector(".st-folder");
  const tabs = await ph.locator(".tabbar .tb-pill > a, .tabbar .tb-pill > button").allInnerTexts();
  check(tabs.length === 4 && /Study/.test(tabs[1]), "the phone bottom bar has a Study tab");
  check(await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && [...document.querySelectorAll(".study-tab *")].every((e) => e.getBoundingClientRect().right <= innerWidth + 1)), "nothing sticks out sideways on a phone");
  await ph.locator(".st-folder", { hasText: "Biology" }).click(); await ph.waitForSelector(".st-xrow");
  await ph.locator("button[aria-label='Edit subject']").click(); await ph.locator(".st-emojis .st-more").click();
  await ph.waitForSelector(".emoji-grid button"); await ph.locator(".emoji-grid button").nth(3).click(); await ph.waitForTimeout(250);
  check(await ph.locator(".st-editor").count() === 1 && await ph.locator(".st-emojis button.on").count() === 1, "the full emoji list works on a phone and keeps the editor open");
  await ph.locator(".st-editor button", { hasText: "Cancel" }).click(); await ph.waitForTimeout(250);
  await ph.locator(".st-xrow").first().click(); await ph.waitForSelector(".study-pick .st-mode");
  const modes = await ph.locator(".study-pick .st-mode").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().right)));
  check(modes.length === 9 && modes.every((r) => r <= 390), "the picker fits the screen");
  check(await ph.evaluate(() => { const s = document.querySelector(".study-picker .study-stage"); return s.scrollWidth <= s.clientWidth; }), "and doesn't scroll sideways");
  await ph.locator(".study-top .icon-btn").first().click(); await ph.waitForTimeout(250);
  await ph.locator(".st-back").click(); await ph.waitForSelector(".st-deck");
  await ph.locator(".st-deck").first().locator("button[aria-label=More]").click();
  const sheet = await ph.locator(".st-menu").boundingBox();
  check(sheet && sheet.y + sheet.height <= 844 && sheet.x >= 0, "the ⋯ menu is a bottom sheet on a phone");

  check(!errs.length, `no page errors ${errs.join("; ")}`);
  await b.close();
  console.log(fails ? `${fails} FAILED` : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
