// Grades database + summary, study streak, weekly review screen and setting, focus timer.
const { chromium } = require("playwright");
const out = process.argv[2] || require("os").tmpdir(), B = process.env.SEAGLASS_URL || "http://localhost:5173";
(async () => {
  const b = await chromium.launch(); const errs = [];
  const p = await (await b.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
  p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(() => { localStorage.setItem("sg.agent", "0"); localStorage.setItem("sg.sidebar", "1"); localStorage.removeItem("sg.focus"); });
  await p.goto(B + "/#/", { waitUntil: "networkidle" });
  const j = (u, m, body) => p.evaluate(async ([u, m, body]) => { const r = await fetch(u, { method: m, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [u, m, body]);

  // grades: created once, rows via the API, summary on the page
  const [, g1] = await j("/api/grades/ensure", "POST", {}); const [, g2] = await j("/api/grades/ensure", "POST", {});
  console.log("grades created once:", g1.created === true && g2.created === false && g1.id === g2.id);
  const db = await (await p.request.get(B + "/api/notes/" + g1.id)).json();
  const schema = JSON.parse(db.db_schema); const cls = schema.properties.find((x) => x.id === "class");
  cls.options = [{ id: "alg", name: "Algebra", color: "blue" }, { id: "sci", name: "Science", color: "green" }];
  await j("/api/notes/" + g1.id, "PATCH", { db_schema: schema, revision: db.revision });
  for (const [t, c, s, o] of [["Unit 1 test", "alg", 45, 50], ["Quiz 2", "alg", 8, 10], ["Lab report", "sci", 18, 20], ["Pending", "sci", null, 10]])
    await j("/api/notes", "POST", { parent_id: g1.id, title: t, props: { class: c, ...(s === null ? {} : { score: s }), outof: o } });
  await p.goto(B + "/#/p/" + g1.id, { waitUntil: "networkidle" }); await p.waitForTimeout(900);
  const cards = await p.locator(".grade-card").allInnerTexts();
  console.log("grade cards:", cards.map((x) => x.replace(/\n/g, " ")));
  await p.screenshot({ path: `${out}/st-grades.png` });
  const pct = await p.locator('td:has-text("%")').first().innerText().catch(() => "-");
  console.log("percent formula column present:", await p.locator("th", { hasText: "Percent" }).count());

  // streak: no reviews yet -> 0; a review today -> 1
  const today = new Date(); const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const off = today.getTimezoneOffset();
  console.log("streak before:", JSON.stringify((await j(`/api/study-streak?today=${iso}&tz_offset=${off}`, "GET"))[1]));
  const page = (await j("/api/notes", "POST", { title: "Deck", html: '<details><summary>Q1</summary><div data-type="detailsContent"><p>A1</p></div></details>' }))[1];
  await j(`/api/study/${page.id}/abc123`, "PUT", { ease: 2.5, interval: 1, reps: 1, lapses: 0, due: iso });
  console.log("streak after a review:", JSON.stringify((await j(`/api/study-streak?today=${iso}&tz_offset=${off}`, "GET"))[1]));
  console.log("bad streak params rejected:", (await j("/api/study-streak?today=nope&tz_offset=0", "GET"))[0]);

  // weekly pref + review screen
  console.log("weekly pref saved:", JSON.stringify((await j("/api/push/prefs", "PUT", { weekly: "5@16:30" }))[1]));
  console.log("bad weekly rejected:", (await j("/api/push/prefs", "PUT", { weekly: "9@99:99" }))[0]);
  await j("/api/push/prefs", "PUT", { weekly: "0@17:00" });
  await p.goto(B + "/#/review", { waitUntil: "networkidle" }); await p.waitForTimeout(900);
  console.log("review sections:", await p.locator(".review h3").allInnerTexts());
  await p.screenshot({ path: `${out}/st-review.png` });
  await p.locator(".rv-done").click(); await p.waitForTimeout(500);
  console.log("finish goes home:", await p.evaluate(() => location.hash));

  // focus timer from Spotlight
  await p.keyboard.press("Control+k"); await p.waitForTimeout(400);
  await p.keyboard.type("focus"); await p.waitForTimeout(300); await p.keyboard.press("Enter"); await p.waitForTimeout(700);
  console.log("focus timer:", (await p.locator(".focus-pill").innerText()).replace(/\n/g, " "));
  await p.screenshot({ path: `${out}/st-focus.png` });
  await p.locator('.focus-pill button[aria-label="Pause"]').click(); await p.waitForTimeout(300);
  console.log("paused:", await p.locator('.focus-pill button[aria-label="Start"]').count());
  await p.locator('.focus-pill button[aria-label="Stop the timer"]').click(); await p.waitForTimeout(200);
  console.log("stopped:", (await p.locator(".focus-pill").count()) === 0);
  console.log("errors:", errs.length ? errs : "none");
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
