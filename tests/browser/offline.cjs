// Offline mode against a PRODUCTION build (the service worker caches built assets; dev mode serves source files):
//   npm run build; $env:SEAGLASS_STATE="$env:TEMP\seaglass-test"; npx vite preview --port 5176 --strictPort
//   $env:SEAGLASS_URL="http://localhost:5176"; node tests/browser/offline.cjs
// Reads work offline (even a reload), edits and task changes are queued and sent when the connection returns, and an
// edit to a page that changed elsewhere in the meantime becomes a copy page instead of overwriting anything.
const { chromium } = require("playwright");
const B = process.env.SEAGLASS_URL || "http://localhost:5176";
const U = String(Date.now() % 1000000);
const api = async (m, p, body) => { const r = await fetch(B + p, { method: m, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); return t ? JSON.parse(t) : null; };
(async () => {
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, serviceWorkers: "allow" });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(() => { localStorage.setItem("sg.agent", "0"); localStorage.setItem("sg.sidebar", "1"); });
  const page = await api("POST", "/api/notes", { title: "Offline page " + U, html: "<p>Original text.</p>" });
  const other = await api("POST", "/api/notes", { title: "Shared page " + U, html: "<p>Server text.</p>" });
  const tdb = (await api("POST", "/api/tasks/ensure", {})).id;
  const task = await api("POST", "/api/notes", { parent_id: tdb, title: "Offline task " + U, props: { status: "todo" } });

  await p.goto(B + "/#/p/" + page.id, { waitUntil: "networkidle" });
  await p.waitForFunction(() => navigator.serviceWorker.getRegistration("/").then((r) => !!r?.active)); await p.reload({ waitUntil: "networkidle" });
  await p.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 });
  await p.goto(B + "/#/p/" + other.id, { waitUntil: "networkidle" }); await p.waitForTimeout(600);
  await p.goto(B + "/#/tasks", { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
  await p.goto(B + "/#/p/" + page.id, { waitUntil: "networkidle" }); await p.waitForTimeout(6500); // the background cache warm-up runs after ~4 s
  console.log("caches kept:", await p.evaluate(async () => { const c = await caches.open("sg-v1"); return (await c.keys()).map((r) => new URL(r.url).pathname).filter((x) => !x.startsWith("/assets/")).slice(0, 8); }));

  // go offline and reload: the app shell, page and list all come from the cache
  await ctx.setOffline(true);
  await p.reload({ waitUntil: "domcontentloaded" }); await p.waitForSelector(".ProseMirror", { timeout: 15000 });
  console.log("offline reload shows the page:", (await p.locator(".ProseMirror").innerText()).includes("Original text."), "| title:", await p.locator("textarea.title").inputValue());
  console.log("offline badge:", await p.locator(".offline-badge").innerText());

  // edit offline
  await p.locator(".ProseMirror p").first().click(); await p.keyboard.press("End"); await p.keyboard.type(" Added offline.");
  await p.waitForTimeout(2500);
  console.log("status:", await p.locator(".status").first().innerText(), "| queued:", await p.evaluate(() => JSON.parse(localStorage.getItem("sg.offline.queue") || "[]").length));
  // a task toggled offline
  await p.goto(B + "/#/tasks", { waitUntil: "domcontentloaded" }); await p.waitForSelector(".task", { timeout: 10000 });
  await p.locator(".task", { hasText: "Offline task " + U }).locator(".task-check").click(); await p.waitForTimeout(800);
  console.log("queued after the task change:", await p.evaluate(() => JSON.parse(localStorage.getItem("sg.offline.queue") || "[]").length), "| badge:", await p.locator(".offline-badge").innerText());
  // a page edited elsewhere while we are offline, then edited here too (this one will conflict)
  await p.goto(B + "/#/p/" + other.id, { waitUntil: "domcontentloaded" }); await p.waitForSelector(".ProseMirror");
  await p.locator(".ProseMirror p").first().click(); await p.keyboard.press("End"); await p.keyboard.type(" My offline edit.");
  await p.waitForTimeout(2500);
  const cur = await api("GET", "/api/notes/" + other.id);
  await api("PATCH", "/api/notes/" + other.id, { html: "<p>Server text. Changed elsewhere.</p>", revision: cur.revision });
  console.log("queued before reconnecting:", await p.evaluate(() => JSON.parse(localStorage.getItem("sg.offline.queue") || "[]").length));

  // back online: everything syncs
  await ctx.setOffline(false); await p.evaluate(() => dispatchEvent(new Event("online")));
  await p.waitForFunction(() => !localStorage.getItem("sg.offline.queue"), null, { timeout: 20000 }); await p.waitForTimeout(1200);
  const a = await api("GET", "/api/notes/" + page.id), t = await api("GET", "/api/notes/" + task.id), o = await api("GET", "/api/notes/" + other.id);
  console.log("page edit arrived:", a.html.includes("Added offline."), "| task done:", JSON.parse(t.props).status === "done");
  console.log("conflicting page kept the other change:", o.html.includes("Changed elsewhere") && !o.html.includes("My offline edit"));
  const tree = await api("GET", "/api/tree"); const copy = tree.find((n) => n.title === "Shared page " + U + " (offline edit)");
  const copyHtml = copy ? (await api("GET", "/api/notes/" + copy.id)).html : "";
  console.log("offline edit saved as a copy:", !!copy && copyHtml.includes("My offline edit."));
  console.log("badge gone:", (await p.locator(".offline-badge").count()) === 0);
  console.log("errors:", errs.length ? errs : "none");
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
