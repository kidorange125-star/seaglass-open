// The assistant as study coach: what it says after every kind of session and what its buttons do, Chat, its study tools,
// and the study plan the check-in can offer. Needs ANTHROPIC_API_KEY=mock and a wiped database.
const { chromium } = require("playwright");
const B = process.env.SEAGLASS_URL || "http://localhost:5173";
const OUT = process.env.SHOTS || "";
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const call = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); let body = {}; try { body = t ? JSON.parse(t) : {}; } catch { body = t; } return { status: r.status, body }; };
const j = async (m, p, b) => (await call(m, p, b)).body;
const agent = async (b) => { const r = await fetch(B + "/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }); return (await r.text()).trim().split("\n").map((l) => JSON.parse(l)); };
const tool = (name, input) => agent({ message: `mock:tool ${name} ${JSON.stringify(input)}` });
const result = (ev) => ev.find((e) => e.type === "tool_result");
const said = (ev) => ev.filter((e) => e.type === "text").map((e) => e.delta).join("");
const RIGHT = { "photosynthesis happen": "Chloroplasts", "gas do plants": "Carbon dioxide", "Calvin cycle": "Sugar" };
const NOTES = "<p>Photosynthesis happens in chloroplasts. Plants take in carbon dioxide and water and make sugar in the Calvin cycle.</p><details><summary>What is osmosis?</summary><div data-type=\"detailsContent\"><p>Water across a membrane</p></div></details><details><summary>What is mitosis?</summary><div data-type=\"detailsContent\"><p>Cell division</p></div></details>";

(async () => {
  const page = await j("POST", "/api/notes", { title: "Plant notes", html: NOTES });
  await j("PUT", `/api/study-pages/${page.id}`, { pinned: true });

  // ---- a finished session
  const session = { mode: "quiz", ids: [page.id], title: "Plant notes", right: 2, total: 3, missed: [{ q: "Where?", a: "Chloroplasts", yours: "Nucleus" }] };
  const first = await j("POST", "/api/study/session", { session });
  check(/67% on it, great first go/.test(first.coach.text), `the assistant talks about the real score (${first.coach.text})`);
  check(first.coach.offers.map((o) => o.do).join() === "focus,harder,plan,chat" && first.coach.offers[0].label === "Hit what I missed", `it offers real next steps, and a made-up button is dropped (${first.coach.offers.map((o) => o.do)})`);
  check(/you came back/.test((await j("POST", "/api/study/session", { session })).coach.text), "it knows this isn't the first session on these pages");
  check((await call("POST", "/api/study/session", { session: { ...session, right: 99 } })).status === 400, "a nonsense session is refused");
  check(!("coach" in (await j("POST", "/api/study/session", { session, coach: false }))), "a session can be saved without a message");

  // ---- the assistant's tools
  const res = result(await tool("study_results", { page_ids: [page.id] }));
  check(res.ok && /3 sessions/.test(res.label), `study_results sees the sessions (${res.label})`);
  const ov = await agent({ message: 'mock:tool study_overview {}' });
  check(result(ov).ok, "study_overview still works with the last score added");
  const game = result(await tool("make_study_game", { mode: "quiz", page_ids: [page.id], change: "Only exam-style questions" }));
  check(game.ok && game.game?.mode === "quiz" && game.game.ids[0] === page.id, "make_study_game writes a game and links to it");
  const again = await j("POST", "/api/ai/study-set", { ids: [page.id], mode: "quiz" });
  check(again.cached === true && /\(mock custom\)/.test(again.items[0].q), "the changed game is what's saved");
  const thread = await j("GET", "/api/thread?limit=4");
  check(thread.messages.some((m) => m.meta.tools?.some((t) => t.game?.mode === "quiz")), "the play button survives a reload of the chat");
  const plan = result(await tool("plan_study_sessions", { sessions: [{ title: "Plants: quiz (25 min)", date: "2030-02-01", time: "16:30" }, { title: "No date" }, { title: "Plants: review", date: "2030-02-02" }] }));
  check(plan.ok && plan.note_ids.length === 2, `a study plan adds dated tasks; a bad one is skipped (${plan.label})`);
  const row = await j("GET", `/api/notes/${plan.note_ids[0]}`);
  const due = JSON.parse(row.props).due;
  check(due.start === "2030-02-01" && due.start_time === "16:30", "a session keeps its date and time, so it gets a reminder");
  check(result(await tool("plan_study_sessions", { sessions: [] })).ok === false, "an empty plan is refused");
  check(result(await tool("grades_overview", {})).ok, "grades_overview works with no grades yet");
  const r1 = result(await tool("manage_routine", { action: "create", name: "Night review", prompt: "Plan tomorrow", time: "20:30" }));
  check(r1.ok && /20:30/.test(r1.label), "the assistant can set up a routine");
  check(result(await tool("manage_routine", { action: "create", name: "Bad", prompt: "x", time: "nope" })).ok === false, "a bad routine is refused with a reason");
  const routines = await j("GET", "/api/routines");
  const routineId = (routines.routines ?? routines)[0].id;
  check(result(await tool("manage_routine", { action: "update", id: routineId, time: "21:00" })).ok, "it can change one");
  check(result(await tool("manage_routine", { action: "delete", id: routineId })).ok, "and remove one");
  check(result(await tool("study_results", {})).ok, "study_results works with no filter");

  // ---- Chat's context
  const ctx = await agent({ message: "Start", label: "Studying", study: { ids: [page.id], title: "Plant notes", after: 0 } });
  check(/Let's study "Plant notes" from your notes/.test(said(ctx)), `Chat gets the notes in its context (${said(ctx).slice(0, 60)})`);
  const plain = await agent({ message: "hello" });
  check(/Nothing to do/.test(said(plain)), "an ordinary message doesn't");

  // ---- the check-in's plan
  await j("POST", "/api/study-subjects", { name: "mock-plan-me", color: "blue", exam_date: "2030-01-07" });
  await j("POST", "/api/checkin/run");
  const planItem = (await j("GET", "/api/inbox?limit=20")).items.find((i) => i.action?.proposal?.type === "study_plan");
  check(planItem && planItem.urgent && planItem.action.proposal.sessions.length === 2, "the check-in can offer a study plan, and a session with no date is dropped");
  const accepted = await j("POST", `/api/inbox/${planItem.id}`, { action: "accept", today: "2030-01-01" });
  check(accepted.note_ids?.length === 2, "one tap adds its sessions to the tasks");
  await j("POST", `/api/runs/${accepted.run_id}/undo`, { force: true });
  check((await call("GET", `/api/notes/${accepted.note_ids[0]}`)).body.is_trashed !== false, "and it can be undone");

  // ---- in the app
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(() => { localStorage.setItem("sg.agent", "0"); localStorage.removeItem("sg.study.subject"); });
  await p.goto(B + "/#/study", { waitUntil: "networkidle" });
  await p.locator(".st-deck", { hasText: "Plant notes" }).locator(".st-deck-head").click();
  const row2 = p.locator(".study-pick"); await row2.locator(".st-mode").first().waitFor();
  check(await row2.locator(".st-mode").count() === 9, "the study picker offers Chat as a way to study");
  if (OUT) await p.screenshot({ path: `${OUT}/c-tab.png` });

  const playQuiz = async () => {
    for (let n = 0; n < 3; n++) {
      await p.waitForSelector(".qz-opt");
      const prompt = await p.locator(".qz-q").innerText();
      const right = RIGHT[Object.keys(RIGHT).find((k) => prompt.includes(k))];
      const texts = await p.locator(".qz-opt .qz-text").allInnerTexts();
      await p.keyboard.press(String((n === 0 ? texts.findIndex((t) => t !== right) : texts.indexOf(right)) + 1));
      await p.waitForSelector(".qz-why"); await p.keyboard.press("Enter"); await p.waitForTimeout(120);
    }
  };
  const openQuiz = async () => { await row2.locator(".st-mode", { hasText: "Quiz" }).click(); };

  await openQuiz(); await playQuiz();
  await p.waitForSelector(".coach-text");
  check(/67%/.test(await p.locator(".coach-text").innerText()), "the quiz results have the assistant's message about the score");
  check(await p.locator(".coach-chips button").count() === 4, "with four next steps");
  if (OUT) await p.screenshot({ path: `${OUT}/c-coach.png` });
  await p.locator(".coach-chips button", { hasText: "Hit what I missed" }).click();
  await p.waitForSelector(".qz-opt");
  check(/\(mock focus\)/.test(await p.locator(".qz-q").innerText()), "the button rewrites the quiz around what was missed");
  await playQuiz().catch(() => {});
  await p.waitForSelector(".coach-text");
  await p.locator(".coach-chips button", { hasText: "Plan it out" }).click();
  await p.waitForSelector(".study-chat .tx-bubble.them.ag-md");
  check(/Make a study plan/.test(await p.locator(".study-chat .tx-sys").first().innerText()), "the plan button opens Chat with the result");
  check(/Let's study/.test(await p.locator(".study-chat .tx-bubble.them.ag-md").first().innerText()), "and the assistant speaks first");
  await p.keyboard.press("Escape"); await p.waitForTimeout(250);
  check(await p.locator(".study-chat").count() === 0, "Esc closes Chat");

  await row2.locator(".st-mode", { hasText: "Flashcards" }).first().click();
  await p.waitForSelector(".study-card");
  await p.keyboard.press(" "); await p.keyboard.press("1"); await p.waitForTimeout(100);
  for (let n = 0; n < 4 && await p.locator(".study-card").count(); n++) { await p.keyboard.press(" "); await p.waitForTimeout(40); await p.keyboard.press("3"); await p.waitForTimeout(100); }
  await p.waitForSelector(".coach-text");
  check(await p.locator(".coach-chips button").count() === 4, "flashcards end with the assistant's message too");
  await p.keyboard.press("Escape"); await p.waitForTimeout(250);

  await row2.locator(".st-mode", { hasText: "Practice test" }).click();
  await p.locator(".study-done-actions button", { hasText: "Start" }).click();
  await p.waitForSelector(".qz-opt"); await p.locator(".qz-opt").nth(0).click(); await p.waitForTimeout(150);
  await p.locator(".study-foot .primary").click(); await p.waitForTimeout(150);
  await p.locator(".qz-write").fill("CO2"); await p.locator(".study-foot .primary").click(); await p.waitForTimeout(150);
  await p.locator(".qz-opt").nth(0).click(); await p.waitForTimeout(150); await p.locator(".study-foot .primary").click();
  await p.waitForSelector(".coach-text");
  check(await p.locator(".coach-chips button").count() === 4, "so does a practice test");
  await p.keyboard.press("Escape"); await p.waitForTimeout(250);

  // Chat from the Study tab
  const chat = async (viewport) => {
    await row2.locator(".st-mode", { hasText: "Chat" }).click();
    await p.waitForSelector(".study-chat .tx-bubble.them.ag-md");
    check(/Let's study "Plant notes"/.test(await p.locator(".study-chat .tx-bubble.them.ag-md").first().innerText()), `${viewport}: Chat opens with the assistant talking`);
    await p.locator(".sc-form textarea").fill("mock:tool make_study_game " + JSON.stringify({ mode: "quiz", page_ids: [page.id], change: "harder" }));
    await p.locator(".sc-send.primary").click();
    await p.waitForSelector(".study-chat .tx-chips button");
    check(/Wrote a new quiz/.test(await p.locator(".study-chat .tx-tool").last().innerText()), `${viewport}: the assistant's tools run from Chat`);
    if (viewport === "phone") {
      const fit = await p.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: innerWidth, size: getComputedStyle(document.querySelector(".sc-form textarea")).fontSize, list: document.querySelector(".sc-scroll").scrollWidth <= document.querySelector(".sc-scroll").clientWidth, foot: document.querySelector(".sc-foot").getBoundingClientRect().bottom <= innerHeight + 1 }));
      check(fit.doc <= fit.win && fit.list, `phone: nothing pans sideways (${fit.doc}/${fit.win})`);
      check(fit.size === "16px", `phone: the field won't make iOS zoom (${fit.size})`);
      check(fit.foot, "phone: the input is on screen");
    }
    if (OUT) await p.screenshot({ path: `${OUT}/c-chat-${viewport}.png` });
    await p.locator(".study-chat .tx-chips button").click();
    await p.waitForSelector(".qz-opt");
    check(await p.locator(".study-chat").count() === 0, `${viewport}: Play it now swaps Chat for the game`);
    await p.keyboard.press("Escape"); await p.waitForTimeout(250);
  };
  await chat("desktop");
  await p.setViewportSize({ width: 390, height: 844 }); await p.reload({ waitUntil: "networkidle" }); await p.locator(".st-deck", { hasText: "Plant notes" }).locator(".st-deck-head").click(); await row2.waitFor();
  const tiles = await p.evaluate(() => { const m = document.querySelector(".study-pick"); return m ? m.scrollWidth <= m.clientWidth : false; });
  check(tiles, "phone: the picker fits");
  await chat("phone");
  await row2.waitFor();
  await openQuiz(); await p.waitForSelector(".qz-opt"); await playQuiz();
  await p.waitForSelector(".coach-text");
  const fitted = await p.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: innerWidth, stage: [...document.querySelectorAll(".study-stage")].every((s) => s.scrollWidth <= s.clientWidth) }));
  check(fitted.doc <= fitted.win && fitted.stage, `phone: the message fits on the results screen (${fitted.doc}/${fitted.win})`);
  if (OUT) await p.screenshot({ path: `${OUT}/c-coach-phone.png`, fullPage: false });
  const results = result(await tool("study_results", { days: 1 }));
  check(/session/.test(results.label), "everything studied was recorded");

  check(!errs.length, `no page errors ${errs.join(" | ")}`);
  await b.close();
  console.log(fails ? `${fails} FAILED` : "all good");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
