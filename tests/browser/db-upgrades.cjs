// Database upgrades (#24): the chart view (Grades' "Over time": a line per class, legend, tooltip), CSV export of the view
// and import (new properties, options, Undo), and a linked view of a database on another page (pick it, its own view,
// edits save to the database). Desktop and 390px. Mock model, wiped database.
const { chromium } = require("playwright");
const fs = require("node:fs");
const B = process.env.SEAGLASS_URL || "http://localhost:5173";
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const j = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };

(async () => {
  const g = (await j("POST", "/api/grades/ensure")).body;
  const schema = JSON.parse((await j("GET", `/api/notes/${g.id}`)).body.db_schema);
  const cls = schema.properties.find((p) => p.id === "class");
  cls.options = [{ id: "bio", name: "Biology", color: "green" }, { id: "alg", name: "Algebra", color: "blue" }];
  await j("PATCH", `/api/notes/${g.id}`, { db_schema: schema });
  const add = (title, c, score, outof, date) => j("POST", "/api/notes", { parent_id: g.id, title, props: { class: c, category: "quiz", score, outof, date: { start: date } } });
  await add("Cells quiz", "bio", 8, 10, "2026-09-10"); await add("Cells test", "bio", 45, 50, "2026-09-24"); await add("Lines quiz", "alg", 7, 10, "2026-09-12"); await add("Slopes quiz", "alg", 9, 10, "2026-09-26");

  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(() => { localStorage.setItem("sg.agent", "0"); });
  await p.goto(`${B}/?n=${Date.now()}#/p/${g.id}`, { waitUntil: "networkidle" });

  // ---- chart
  await p.locator(".db-toolbar .tab", { hasText: "Over time" }).click();
  await p.locator(".chart-plot svg").waitFor();
  check(await p.locator(".chart-plot polyline").count() === 2, "Grades has an Over time chart, a line per class");
  check((await p.locator(".chart-legend").innerText()).replace(/\s+/g, " ").trim() === "Biology Algebra", "with a legend");
  const stroke = await p.locator(".chart-plot svg g").filter({ has: p.locator("polyline") }).first().evaluate((e) => getComputedStyle(e).color);
  check(/rgb/.test(stroke), `lines in the class's colour (${stroke})`);
  const svg = await p.locator(".chart-plot svg").boundingBox();
  await p.mouse.move(svg.x + svg.width - 20, svg.y + 120);
  await p.locator(".chart-tip").waitFor();
  check(/Sep 26/.test(await p.locator(".chart-tip").innerText()) && /Algebra: 90%/.test(await p.locator(".chart-tip").innerText()), `hovering shows the values (${(await p.locator(".chart-tip").innerText()).replace(/\n/g, " | ")})`);
  // switch it to bars by category in the view's settings
  await p.locator(".db-toolbar .tab.on").click();
  const panel = p.locator(".panel").last();
  await panel.locator("select").nth(1).selectOption("bar");
  await panel.locator("select").nth(2).selectOption({ label: "Class" });
  await panel.locator("select").nth(3).selectOption("count");
  await p.keyboard.press("Escape"); await p.waitForTimeout(800);
  check(await p.locator(".chart-plot path").count() === 2 && await p.locator(".chart-plot polyline").count() === 0, "the view's settings turn it into bars (count by class)");
  const saved = JSON.parse((await j("GET", `/api/notes/${g.id}`)).body.db_schema).views.find((v) => v.type === "chart").chart;
  check(saved.kind === "bar" && saved.x === "class" && saved.y === "count", "and that's saved with the view");

  // ---- CSV export
  await p.locator(".db-toolbar .tab", { hasText: "Recent" }).click();
  await p.locator(".db-toolbar button[aria-label='More']").click();
  const [dl] = await Promise.all([p.waitForEvent("download"), p.locator(".opt", { hasText: "Export this view as CSV" }).click()]);
  const csv = fs.readFileSync(await dl.path(), "utf8");
  check(/^﻿Assignment,Class,Category,Score,Out of,Weight,Percent,Date\r\n/.test(csv) && /Slopes quiz,Algebra,Quiz,9,10,,90,2026-09-26/.test(csv), `exports the view as CSV (${dl.suggestedFilename()})`);

  // ---- CSV import
  const file = "Assignment,Class,Score,Out of,Date,Late\r\nEssay 1,English,18,20,10/3/2026,yes\r\nLab report,Biology,9,10,2026-10-04,no\r\nEssay 2,English,17,20,2026-10-17,no\r\n";
  await p.locator(".db-toolbar button[aria-label='More']").click();
  const [chooser] = await Promise.all([p.waitForEvent("filechooser"), p.locator(".opt", { hasText: "Import CSV" }).click()]);
  await chooser.setFiles({ name: "grades.csv", mimeType: "text/csv", buffer: Buffer.from(file) });
  await p.locator(".modal", { hasText: "Add 3 rows" }).waitFor();
  check(/New properties: Late/.test(await p.locator(".modal").innerText()), "import asks first, naming new properties");
  await p.locator(".modal button.primary").click();
  await p.locator(".toasts > div", { hasText: "Imported 3 rows" }).waitFor({ timeout: 15000 });
  const kids = (await j("GET", `/api/notes/${g.id}/children`)).body;
  const s2 = JSON.parse((await j("GET", `/api/notes/${g.id}`)).body.db_schema);
  const eng = s2.properties.find((x) => x.id === "class").options.find((o) => o.name === "English");
  const late = s2.properties.find((x) => x.name === "Late");
  const essay = kids.find((k) => k.title === "Essay 1"), ep = JSON.parse(essay?.props || "{}");
  check(kids.length === 7 && !!eng && late?.type === "checkbox", "rows added, a new class option and a Late checkbox");
  check(ep.class === eng?.id && ep.score === 18 && ep.date?.start === "2026-10-03" && ep[late?.id] === true, "values read as the right types (US date, yes)");
  await p.locator(".toasts > div", { hasText: "Imported 3 rows" }).locator("button", { hasText: "Undo" }).click();
  await p.waitForTimeout(1500);
  check((await j("GET", `/api/notes/${g.id}/children`)).body.length === 4, "Undo takes the imported rows away");

  // ---- linked view on another page
  const host = (await j("POST", "/api/notes", { title: "Bio hub", html: "<p>My grades:</p>" })).body;
  await p.goto(`${B}/?n=${Date.now()}#/p/${host.id}`, { waitUntil: "networkidle" });
  await p.locator(".ProseMirror p").first().click(); await p.keyboard.press("End"); await p.keyboard.press("Enter");
  await p.keyboard.type("/linked"); await p.locator(".suggest-list", { hasText: "Linked view" }).waitFor(); await p.keyboard.press("Enter");
  await p.locator(".ldb-pick button", { hasText: "Grades" }).click();
  await p.locator(".linked-db .db-toolbar").waitFor(); await p.locator(".linked-db tr[data-row]").first().waitFor();
  check(/Grades/.test(await p.locator(".ldb-title").innerText()) && await p.locator(".linked-db tr[data-row]").count() >= 4, "a linked view shows the database on the page");
  await p.locator(".linked-db .db-toolbar .tab", { hasText: "Over time" }).click();
  await p.locator(".linked-db .chart-plot svg").waitFor();
  await p.waitForTimeout(1500);
  const html = (await j("GET", `/api/notes/${host.id}`)).body.html;
  check(new RegExp(`data-type="db-view"[^>]*data-db="${g.id}"|data-db="${g.id}"[^>]*data-type="db-view"`).test(html) && /data-view="v-chart"/.test(html), "the page keeps which database and which view");
  await p.reload({ waitUntil: "networkidle" });
  await p.locator(".linked-db .chart-plot svg").waitFor();
  check(true, "and shows that view again after a reload");
  await p.locator(".linked-db .db-toolbar .tab", { hasText: "Recent" }).click();
  const cell = p.locator(".linked-db tr[data-row] input").first();
  await cell.click(); await cell.fill("Cells quiz (retake)"); await cell.press("Enter"); await p.waitForTimeout(1200);
  check((await j("GET", `/api/notes/${g.id}/children`)).body.some((k) => k.title === "Cells quiz (retake)"), "editing a row in the linked view saves to the database");
  check(!/Cells quiz \(retake\)/.test((await j("GET", `/api/notes/${host.id}`)).body.html), "and not into the page");

  // ---- phone
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(`${B}/?n=${Date.now()}#/p/${g.id}`, { waitUntil: "networkidle" });
  await p.locator(".db-toolbar .tab", { hasText: "Over time" }).click();
  await p.locator(".chart-plot svg").waitFor(); await p.waitForTimeout(300);
  const w = await p.locator(".chart-plot svg").evaluate((e) => e.getBoundingClientRect().right);
  const page = await p.evaluate(() => document.documentElement.scrollWidth);
  check(w <= 390 && page <= 390, `the chart fits a phone (${Math.round(w)}px, page ${page}px)`);
  check(!errs.length, `no page errors ${errs.join(" | ")}`);
  await b.close();
  console.log(fails ? `${fails} failed` : "all good");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
