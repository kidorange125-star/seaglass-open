// Jeff's one-shot tools with the mock model (ANTHROPIC_API_KEY=mock): Ask Jeff on a selection (rewrite + explain),
// photo to notes, and a practice test with saving missed questions as flashcards.
const { chromium } = require("playwright");
const out = process.argv[2] || require("os").tmpdir(), B = process.env.SEAGLASS_URL || "http://localhost:5173";
// A tiny valid PNG (1x1) for the photo upload.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
(async () => {
  const b = await chromium.launch(); const errs = [];
  const p = await (await b.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
  p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(() => { localStorage.setItem("sg.agent", "0"); localStorage.setItem("sg.sidebar", "1"); });
  await p.goto(B + "/#/", { waitUntil: "networkidle" });
  const id = await p.evaluate(async () => (await (await fetch("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Cells", html: "<p>Osmosis is when water moves across a membrane from low to high solute.</p><p>Second paragraph stays.</p>" }) })).json()).id);
  await p.goto(B + "/#/p/" + id, { waitUntil: "networkidle" }); await p.waitForTimeout(800);

  // 1) select the first paragraph -> Ask Jeff -> Improve writing
  await p.locator(".ProseMirror p").first().click({ clickCount: 3 }); await p.waitForTimeout(300);
  await p.locator(".bubble .ask-jeff-btn").click(); await p.waitForTimeout(200);
  console.log("ask jeff menu:", (await p.locator(".ask-jeff-pop").innerText()).replace(/\n/g, " | "));
  await p.locator(".ask-jeff-pop button", { hasText: "Improve writing" }).click(); await p.waitForTimeout(900);
  const html1 = await p.locator(".ProseMirror").innerHTML();
  console.log("rewrite replaced the selection:", html1.includes("(mock) Osmosis") && html1.includes("Second paragraph stays"));
  await p.keyboard.press("Control+z"); await p.waitForTimeout(300);
  console.log("undo restores it:", (await p.locator(".ProseMirror").innerText()).includes("Osmosis is when water"));

  // 2) explain -> insert below
  await p.locator(".ProseMirror p").first().click({ clickCount: 3 }); await p.waitForTimeout(300);
  await p.locator(".bubble .ask-jeff-btn").click(); await p.waitForTimeout(200);
  await p.locator(".ask-jeff-pop button", { hasText: "Explain this" }).click(); await p.waitForTimeout(900);
  console.log("explanation:", await p.locator(".aj-explain p").innerText().catch(() => "-"));
  await p.locator(".aj-explain-actions button", { hasText: "Insert below" }).click(); await p.waitForTimeout(500);
  console.log("explanation inserted as a callout:", await p.locator('.ProseMirror [data-type="callout"]').count());

  // 3) practice test
  await p.locator(".topbar .actions button").last().click(); await p.waitForTimeout(300);
  await p.locator(".popover button", { hasText: "Practice test" }).click(); await p.waitForTimeout(400);
  await p.locator(".quiz button", { hasText: "Start" }).click(); await p.waitForTimeout(1000);
  console.log("question 1:", await p.locator(".quiz .qz-q").innerText());
  await p.locator(".qz-opt").nth(0).click(); await p.waitForTimeout(200); // wrong (answer is index 1)
  console.log("feedback:", await p.locator(".qz-why").innerText());
  await p.screenshot({ path: `${out}/q-mcq.png` });
  await p.locator(".quiz button", { hasText: "Next" }).click();
  await p.locator(".qz-write").fill("CO2"); await p.locator(".quiz button", { hasText: "Next" }).click();
  await p.locator(".qz-opt").nth(0).click(); await p.locator(".quiz button", { hasText: "Finish" }).click(); await p.waitForTimeout(1200);
  console.log("result:", await p.locator(".quiz .drill-results > b").innerText());
  await p.screenshot({ path: `${out}/q-results.png` });
  await p.locator(".quiz button", { hasText: "missed as flashcards" }).click(); await p.waitForTimeout(800);
  const saved = await p.evaluate(async (id) => (await (await fetch("/api/notes/" + id)).json()).html, id);
  console.log("missed saved as flashcards:", saved.includes("Missed in a practice test") && (saved.match(/<details/g) || []).length);
  await p.locator(".quiz button", { hasText: "Done" }).click(); await p.waitForTimeout(300);

  // 4) photo to notes (child of this page)
  await p.locator(".topbar .actions button").last().click(); await p.waitForTimeout(300);
  await p.locator(".popover button", { hasText: "Photo to notes here" }).click(); await p.waitForTimeout(300);
  await p.locator(".photo-notes input[type=file]").setInputFiles({ name: "notes.png", mimeType: "image/png", buffer: PNG });
  await p.waitForFunction(() => !document.querySelector(".photo-notes"), null, { timeout: 15000 });
  await p.waitForTimeout(800);
  const made = await p.evaluate(async () => { const id = location.hash.split("/").pop(); const n = await (await fetch("/api/notes/" + id)).json(); return { title: n.title, parent: n.parent_id, cards: (n.html.match(/<details/g) || []).length }; });
  console.log("photo page:", JSON.stringify(made), "| child of the page:", made.parent === id);
  console.log("errors:", errs.length ? errs : "none");
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
