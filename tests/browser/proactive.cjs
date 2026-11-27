// The proactive assistant in the app: Settings > Routines & saved prompts, its messages in the one ongoing conversation
// (badge, Add task, Ask, thumbs), /name saved prompts in the chat and in a page's / menu, a new-topic break. Mock model, no API_TOKEN, empty database.
const { chromium } = require("playwright");
const out = process.argv[2] || require("os").tmpdir(), B = process.env.SEAGLASS_URL || "http://localhost:5173";
const j = (m, p, b) => fetch(B + p, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json());
(async () => {
  const b = await chromium.launch(); const errs = [];
  const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(() => { localStorage.setItem("sg.agent", "0"); localStorage.setItem("sg.sidebar", "1"); });
  const page = await j("POST", "/api/notes", { title: "Biology", html: "<p>Cells are the basic unit of life.</p>" });
  await p.goto(B + "/#/", { waitUntil: "networkidle" }); await p.waitForTimeout(600);

  // Settings > Routines & saved prompts
  await p.locator(".sidebar button", { hasText: "Settings" }).first().click(); await p.waitForTimeout(250);
  await p.locator(".settings-pop button", { hasText: "Routines & saved prompts" }).click(); await p.waitForSelector(".modal.proactive");
  await p.locator(".pd-title button", { hasText: "New prompt" }).click();
  await p.locator(".pd-name input").fill("Cram!"); await p.locator(".pd-form textarea").fill("mock:create Cram page");
  await p.locator(".pd-form button", { hasText: "Save prompt" }).click(); await p.waitForTimeout(500);
  console.log("saved prompt listed:", await p.locator(".pd-item .pd-main b", { hasText: "/cram" }).count());
  await p.locator(".pd-title button", { hasText: "New routine" }).click();
  await p.locator(".pd-form input").first().fill("Evening recap"); await p.locator(".pd-form textarea").fill("mock:create Recap page");
  await p.locator(".pd-form input[type=time]").fill("19:30"); await p.locator(".pd-days button").nth(0).click(); // add Sunday to weekdays
  await p.locator(".pd-form button", { hasText: "Save routine" }).click(); await p.waitForTimeout(500);
  console.log("routine listed:", (await p.locator(".pd-item .pd-main").first().innerText()).replace(/\s+/g, " "));
  await p.screenshot({ path: `${out}/pro-settings.png` });
  await p.locator(".pd-item button[title='Run now']").first().click(); await p.waitForTimeout(1500);
  console.log("run now toast:", await p.locator(".toasts div").last().innerText().catch(() => "-"));
  await p.locator(".pd-checkin button", { hasText: "Check in now" }).click(); await p.waitForTimeout(1500);
  console.log("check-in toast:", await p.locator(".toasts div").last().innerText().catch(() => "-"));
  await p.keyboard.press("Escape"); await p.waitForTimeout(300);

  // badge + inbox in the empty chat
  await p.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))); await p.waitForTimeout(800);
  console.log("sidebar badge:", await p.locator(".sidebar .sb-badge").innerText().catch(() => "none"));
  await p.keyboard.press("Control+j"); await p.waitForSelector(".agent"); await p.waitForTimeout(900);
  console.log("its messages are ordinary texts:", await p.locator(".tx-row.them .tx-bubble.them").count(), "| quick replies:", (await p.locator(".tx-chips button").allInnerTexts()).join(" / "));
  await p.screenshot({ path: `${out}/pro-inbox.png` });
  await p.locator(".tx-chips button.primary").first().click(); await p.waitForTimeout(900);
  const tdb = (await j("POST", "/api/tasks/ensure", {})).id;
  console.log("accepted task exists:", (await j("GET", `/api/notes/${tdb}/children`)).some((n) => n.title === "(mock) Read chapter 5"));
  console.log("after accepting:", await p.locator(".tx-meta", { hasText: "Added to My tasks" }).count());
  await p.fill(".ag-box textarea", "yes please"); await p.keyboard.press("Enter");
  await p.waitForSelector(".tx-row.me .tx-bubble.me", { timeout: 15000 }); await p.waitForTimeout(1200);
  console.log("replying is just texting:", await p.locator(".tx-bubble.me").last().innerText());

  // saved prompt in the chat
  await p.locator(".agent .ag-head button[title^='New topic']").click(); await p.waitForTimeout(500);
  console.log("new topic divider:", await p.locator(".tx-divider").last().innerText());
  await p.fill(".ag-box textarea", "/cr"); await p.waitForTimeout(200);
  console.log("slash list offers it:", (await p.locator(".ag-cmds button").allInnerTexts()).join(", "));
  await p.fill(".ag-box textarea", "/cram"); await p.keyboard.press("Enter"); await p.waitForSelector(".tx-meta >> text=change", { timeout: 15000 }); await p.waitForTimeout(500);
  console.log("ran /cram (label, page made):", await p.locator(".tx-bubble.me").last().innerText(), (await j("GET", "/api/tree")).some((n) => n.title === "Cram page"));

  // the badge is gone once you've looked, and the conversation is the same after a reload
  await p.waitForTimeout(800);
  console.log("badge after reading:", await p.locator(".sidebar .sb-badge").count());
  await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(500);
  if (!(await p.locator(".agent").count())) { await p.keyboard.press("Control+j"); }
  await p.waitForSelector(".agent .tx-row"); await p.waitForTimeout(800);
  console.log("after a reload the thread is all there:", await p.locator(".tx-bubble.them").count(), "of its texts,", await p.locator(".tx-bubble.me").count(), "of yours,", await p.locator(".tx-time").count(), "time label(s)");
  await p.screenshot({ path: `${out}/pro-thread.png` });

  // saved prompt in a page's / menu
  await p.locator(".agent .ag-head button[title^='Close']").click();
  await p.goto(B + "/#/p/" + page.id, { waitUntil: "networkidle" }); await p.waitForSelector(".ProseMirror");
  await p.locator(".ProseMirror p").first().click(); await p.keyboard.press("End"); await p.keyboard.press("Enter");
  await p.keyboard.type("/cram"); await p.waitForSelector(".suggest-pop .on");
  console.log("page / menu offers it:", (await p.locator(".suggest-pop .on").innerText()).replace(/\s+/g, " "));
  await p.keyboard.press("Enter"); await p.waitForSelector(".agent .tx-meta", { timeout: 15000 }); await p.waitForTimeout(800);
  console.log("ran from the page:", await p.locator(".tx-bubble.me").last().innerText());
  console.log("errors:", errs.length ? errs : "none");
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
