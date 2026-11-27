// On a phone nothing may pan sideways (iOS lets you drag any overflowing scroller left and right): long links in
// to-dos, callouts, toggles and columns wrap, long tool chips in the chat shorten with "…", and only the things meant
// to scroll sideways (tables, boards, timelines, code) do, inside their own box.
const { chromium, devices } = require("playwright");
const B = process.env.SEAGLASS_URL || "http://localhost:5173";
const j = (m, p, b) => fetch(B + p, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json());
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const url = "https://example.com/" + "averyveryverylongpathsegment".repeat(4);

(async () => {
  const page = await j("POST", "/api/notes", { title: "Electoral College notes for the civics unit assessment review", html:
    `<p>${url}</p><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Read ${url}</p></li></ul>` +
    `<div data-type="callout" data-emoji="💡"><p>${url}</p></div>` +
    `<div data-type="details"><button></button><div><summary>${url}</summary><div data-type="detailsContent"><p>${url}</p></div></div></div>` +
    `<div data-type="columns"><div data-type="column"><p>${url}</p></div><div data-type="column"><p>${url}</p></div></div>` +
    `<pre><code>const reallyLongIdentifierNameThatGoesOnAndOn = computeEverything(withAllTheArguments, andMore);</code></pre>` });
  const b = await chromium.launch();
  const errs = [];
  // Scrollers that can pan sideways, other than the ones meant to.
  const sideways = (p) => p.evaluate(() => {
    const meant = ".dbtable-wrap,.board,.tl-wrap,.jcards,pre,.tableWrapper,.su-row code,.ag-setup pre,.ag-md table";
    const bad = [];
    for (const el of [document.scrollingElement, ...document.querySelectorAll("body *")]) {
      if (!/auto|scroll/.test(getComputedStyle(el).overflowX) || el.scrollWidth <= el.clientWidth + 1 || el.matches(meant)) continue;
      const r = el.getBoundingClientRect(); if (!r.width || r.right <= 0 || r.left >= innerWidth) continue;
      bad.push(`${el.tagName.toLowerCase()}.${String(el.className.baseVal ?? el.className).split(" ")[0]} ${el.scrollWidth}>${el.clientWidth}`);
    }
    return bad;
  });
  // Text that runs past the right edge of the page (would be cut off rather than wrapped).
  const pastEdge = (p, root) => p.evaluate((root) => {
    const sc = document.querySelector(root); if (!sc) return ["no " + root];
    const R = sc.getBoundingClientRect().right, out = [];
    for (const el of sc.querySelectorAll("*")) { const r = el.getBoundingClientRect(); if (r.width && r.right > R + 1 && !el.closest("pre,.tableWrapper")) out.push(el.tagName.toLowerCase()); }
    return out;
  }, root);

  for (const [name, path, setup] of [["home", "/#/"], ["tasks", "/#/tasks"], ["page", `/#/p/${page.id}`], ["chat", "/?assistant=1#/", true]]) {
    const ctx = await b.newContext({ ...devices["iPhone 14"] });
    const p = await ctx.newPage(); p.on("pageerror", (e) => errs.push(`${name}: ${e.message}`));
    await p.goto(B + path, { waitUntil: "networkidle" }); await p.waitForTimeout(600);
    if (setup) await p.evaluate((url) => {
      // the chat's own markup for a run with long tool steps and a reply holding a long link, a table and code
      const row = document.createElement("div"); row.className = "tx-row them first last";
      row.innerHTML = `<div class="tx-line"><div class="tx-col"><div class="tx-tools">
        <button class="tx-tool error"><span>Unknown property "Due Date". Available: Task, Status, Due, Priority, Tags, Assignee, Notes, Estimate</span></button>
        <button class="tx-tool done"><span>Searched “Study Voting &amp; Electoral College Notes for the assessment” · 2 results</span></button></div>
        <div class="tx-bubble them ag-md"><p>${url}</p><table><tr><td>Column one heading</td><td>Column two heading</td><td>Column three heading</td><td>Four</td></tr></table><pre><code>const somethingVeryLong = "${"a".repeat(60)}";</code></pre></div></div></div>`;
      document.querySelector(".ag-scroll").appendChild(row);
    }, url);
    const bad = await sideways(p);
    check(!bad.length, `${name}: nothing pans sideways ${bad.length ? bad.join(", ") : ""}`);
    if (name === "page") { const e = await pastEdge(p, ".page > .scroll"); check(!e.length, `page: long links wrap instead of running off the edge ${e.length ? e.join(",") : ""}`); }
    if (name === "chat") { const e = await pastEdge(p, ".ag-scroll"); check(!e.length, `chat: long tool steps and links fit the screen ${e.length ? e.join(",") : ""}`); }
    await ctx.close();
  }
  check(!errs.length, `no page errors ${errs.join("; ")}`);
  await b.close();
  console.log(fails ? `${fails} FAILED` : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
