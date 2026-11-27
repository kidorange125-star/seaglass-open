// Real touch swipes through CDP (Input.dispatchTouchEvent) on a phone-sized page.
const { chromium } = require("playwright");
const out = process.argv[2] || require("os").tmpdir(), B = process.env.SEAGLASS_URL || "http://localhost:5173";
(async () => {
  const b = await chromium.launch(); const errs = [];
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await c.newPage(); p.on("pageerror", (e) => errs.push(e.message));
  const cdp = await c.newCDPSession(p);
  const swipe = async (x1, y1, x2, y2, ms = 260, steps = 14) => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x1, y: y1 }] });
    for (let i = 1; i <= steps; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x1 + ((x2 - x1) * i) / steps, y: y1 + ((y2 - y1) * i) / steps }] });
      await p.waitForTimeout(ms / steps);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await p.waitForTimeout(600);
  };
  await p.addInitScript(() => { localStorage.setItem("sg.theme", "light"); localStorage.setItem("sg.sidebar", "0"); localStorage.setItem("sg.agent", "0"); localStorage.removeItem("sg.agent.chats"); });
  await p.goto(B + "/#/", { waitUntil: "networkidle" }); await p.waitForTimeout(600);
  const has = (sel) => p.evaluate((s) => !!document.querySelector(s), sel);

  // 1-2 drawer
  await swipe(3, 400, 260, 405);
  console.log("edge swipe on Home opens the sidebar:", await has(".sidebar"));
  await p.screenshot({ path: `${out}/s-drawer.png` });
  await swipe(250, 400, 20, 402);
  console.log("swiping the sidebar left closes it:", !(await has(".sidebar")));

  // 3 back swipe
  const ids = await p.evaluate(async () => {
    const mk = async (b) => (await (await fetch("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })).json()).id;
    const page = await mk({ title: "Swipe page", html: "<p>" + "Some text. ".repeat(80) + "</p>" });
    const db = (await (await fetch("/api/tasks/ensure", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json()).id;
    const t1 = await mk({ parent_id: db, title: "Swipe me right", props: { status: "todo" } });
    const t2 = await mk({ parent_id: db, title: "Swipe me left", props: { status: "todo" } });
    const t3 = await mk({ parent_id: db, title: "Peek at me", props: { status: "todo" } });
    return { page, t1, t2, t3 };
  });
  await p.evaluate(() => { location.hash = "/"; });
  await p.waitForTimeout(400);
  await p.evaluate((id) => { location.hash = "/p/" + id; }, ids.page); await p.waitForTimeout(900);
  console.log("on page:", await p.evaluate(() => location.hash));
  await swipe(3, 500, 300, 505);
  console.log("edge swipe on a page goes back ->", await p.evaluate(() => location.hash));

  // 4 task rows
  await p.evaluate(() => { location.hash = "/tasks"; }); await p.waitForTimeout(1000);
  const rowBox = async (title) => (await p.locator(".task", { hasText: title }).first().boundingBox());
  let bx = await rowBox("Swipe me right");
  await swipe(bx.x + 120, bx.y + bx.height / 2, bx.x + 300, bx.y + bx.height / 2 + 3, 200);
  const st1 = await p.evaluate(async (id) => JSON.parse((await (await fetch("/api/notes/" + id)).json()).props).status, ids.t1);
  console.log("swipe right on a task completes it:", st1);
  bx = await rowBox("Swipe me left");
  await swipe(bx.x + 330, bx.y + bx.height / 2, bx.x + 20, bx.y + bx.height / 2 + 2, 220);
  await p.waitForTimeout(500);
  const gone = await p.evaluate(async (id) => (await fetch("/api/notes/" + id)).status, ids.t2);
  console.log("full swipe left moves it to Trash (GET status):", gone);
  console.log("overlays after row swipes:", await p.evaluate(() => [...document.querySelectorAll(".popover, .fixed-pop, .modal-back, .block-menu, .suggest-pop")].map((e) => e.className)));

  // 5 sheet drag-down
  await p.evaluate((id) => { location.hash = "/p/" + id; }, ids.page); await p.waitForTimeout(900);
  await p.locator(".topbar .actions button").last().tap(); await p.waitForTimeout(700);
  console.log("sheet open:", await p.evaluate(() => [...document.querySelectorAll(".popover")].map((e) => e.className)));
  const sb = await p.locator(".popover").first().boundingBox();
  await swipe(195, sb.y + 12, 198, sb.y + 360, 240);
  await p.waitForTimeout(600);
  console.log("dragging the sheet down closes it:", !(await has(".popover")), "| tab bar visible:", await p.evaluate(() => getComputedStyle(document.querySelector(".tabbar")).display));

  // 6 tab bar drag Home -> Jeff, then Jeff header drag down
  await p.evaluate(() => { location.hash = "/"; }); await p.waitForTimeout(800);
  const pill = await p.locator(".tabbar .tb-pill").boundingBox();
  await swipe(pill.x + 50, pill.y + pill.height / 2, pill.x + pill.width / 2, pill.y + pill.height / 2, 200);
  console.log("sliding along the tab bar to Jeff opens Jeff:", await has(".agent"));
  await p.screenshot({ path: `${out}/s-jeff.png` });
  await swipe(100, 30, 102, 600, 240);
  console.log("dragging Jeff's header down closes it:", !(await has(".agent")));

  // 7 peek edge swipe
  await p.evaluate(() => { location.hash = "/tasks"; }); await p.waitForTimeout(900);
  await p.locator(".task-title", { hasText: "Peek at me" }).first().tap(); await p.waitForTimeout(800);
  console.log("peek open:", await has(".peek"));
  await swipe(3, 500, 320, 505);
  console.log("edge swipe closes the peek:", !(await has(".peek")));

  // 8 normal navigation with the page transition
  await p.evaluate((id) => { location.hash = "/p/" + id; }, ids.page); await p.waitForTimeout(150);
  await p.screenshot({ path: `${out}/s-transition-mid.png` });
  await p.waitForTimeout(700);
  console.log("errors:", errs.length ? errs : "none");
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
