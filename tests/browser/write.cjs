// "Write with Jeff" and "Continue writing" in the / menu (mock model: ANTHROPIC_API_KEY=mock, empty database).
const { chromium } = require("playwright");
const B = process.env.SEAGLASS_URL || "http://localhost:5173";
(async () => {
  const b = await chromium.launch(); const errs = [];
  const p = await (await b.newContext({ viewport: { width: 1280, height: 860 } })).newPage(); p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(() => { localStorage.setItem("sg.agent", "0"); localStorage.setItem("sg.sidebar", "1"); });
  const n = await (await fetch(B + "/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Essay", html: "<p>Ducks are birds.</p>" }) })).json();
  await p.goto(B + "/#/p/" + n.id, { waitUntil: "networkidle" }); await p.waitForSelector(".ProseMirror");
  await p.locator(".ProseMirror p").first().click(); await p.keyboard.press("End"); await p.keyboard.press("Enter");
  await p.keyboard.type("/write with"); await p.waitForSelector(".suggest-pop .on"); console.log("menu item:", await p.locator(".suggest-pop .on").innerText().then((t) => t.replace(/\s+/g, " ")));
  await p.keyboard.press("Enter");
  await p.waitForSelector(".modal input"); console.log("asks what to write:", await p.locator(".modal label").innerText());
  await p.locator(".modal input").fill("two sentences about swimming"); await p.keyboard.press("Enter");
  await p.waitForFunction(() => document.querySelector(".ProseMirror")?.innerText.includes("two sentences about swimming"), null, { timeout: 15000 });
  console.log("text inserted after the first line:", (await p.locator(".ProseMirror").innerText()).replace(/\s+/g, " "));
  await p.keyboard.press("Enter"); await p.keyboard.type("/continue"); await p.waitForSelector(".suggest-pop .on"); await p.keyboard.press("Enter");
  await p.waitForFunction(() => (document.querySelector(".ProseMirror")?.innerText.match(/\(mock\)/g) || []).length >= 2, null, { timeout: 15000 });
  console.log("continue writing worked:", (await p.locator(".ProseMirror p").count()) >= 3);
  await p.keyboard.press("Control+z"); await p.waitForTimeout(300);
  const after = (await p.locator(".ProseMirror").innerText()).replace(/\s+/g, " ");
  console.log("undo takes the inserted text back out:", (after.match(/\(mock\)/g) || []).length < 2, "|", after); // (the mock answers instantly, so both pieces can share one undo step)
  console.log("errors:", errs.length ? errs : "none");
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
