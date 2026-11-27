// "You wrote about this before" (#18, RelatedNotes.tsx, worker semantic.ts related): notes close in meaning under a page, on
// open and while writing. Mock mode: embeddings are a word hash, so pages sharing words are "close". Wiped database.
const { chromium } = require("playwright");
const B = process.env.SEAGLASS_URL || "http://localhost:5173";
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const j = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const cron = async () => (await fetch(`${B}/cdn-cgi/handler/scheduled?cron=*+*+*+*+*&time=${Date.now()}`)).text();

(async () => {
  const lab = (await j("POST", "/api/notes", { title: "Osmosis lab", html: "<p>Osmosis moves water across a membrane toward the side with more solute. Potato cells in salt water lost water.</p>" })).body;
  const transport = (await j("POST", "/api/notes", { title: "Cell transport", html: "<p>Water crosses the membrane by osmosis; solute particles spread by diffusion across the cell membrane.</p>" })).body;
  await j("POST", "/api/notes", { title: "Football practice", html: "<p>Drills on Tuesday, bring cleats and a ball, scrimmage after warmups.</p>" });
  await cron(); await cron();
  check((await j("POST", `/api/notes/${transport.id}/related`, {})).body.hits.some((h) => h.id === lab.id), "a page's related notes come from its stored embedding");
  check(!(await j("POST", `/api/notes/${transport.id}/related`, {})).body.hits.some((h) => h.title === "Football practice" || h.id === transport.id), "not unrelated notes, and never itself");

  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(() => { localStorage.setItem("sg.agent", "0"); });
  await p.goto(`${B}/?n=${Date.now()}#/p/${transport.id}`, { waitUntil: "networkidle" });
  const strip = p.locator(".related");
  await strip.waitFor({ timeout: 8000 }).catch(() => {});
  check(/You wrote about this before/.test(await strip.innerText().catch(() => "")) && /Osmosis lab/.test(await strip.innerText().catch(() => "")), "opening a page shows what you wrote about this before");
  await strip.locator(".related-item", { hasText: "Osmosis lab" }).click();
  const opened = await p.locator(".peek textarea, .peek .ProseMirror", { hasText: /Osmosis/ }).first().waitFor({ timeout: 8000 }).then(() => true).catch(async () => /Osmosis lab/.test(await p.locator(".peek").evaluate((e) => e.textContent + [...e.querySelectorAll("textarea")].map((t) => t.value).join(" ")).catch(() => "")));
  check(opened, "tapping one opens it in the side peek");
  await p.keyboard.press("Escape").catch(() => {});

  // while writing a new page
  const fresh = (await j("POST", "/api/notes", { title: "Biology homework" })).body;
  await p.goto(`${B}/?n=${Date.now()}#/p/${fresh.id}`, { waitUntil: "networkidle" });
  check(await strip.count() === 0, "a brand new page shows nothing");
  await p.locator(".ProseMirror").click();
  await p.keyboard.type("Today we learned how osmosis moves water across a membrane, and why potato cells in salt water shrink.", { delay: 5 });
  await strip.waitFor({ timeout: 10000 }).catch(() => {});
  check(/Osmosis lab/.test(await strip.innerText().catch(() => "")), "writing about the same thing brings them up after a pause");
  await strip.locator("button[aria-label='Hide']").click();
  check(await strip.count() === 0, "and × hides the strip");
  check(!errs.length, `no page errors ${errs.join(" | ")}`);

  // a phone
  const m = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await m.addInitScript(() => { localStorage.setItem("sg.agent", "0"); });
  await m.goto(`${B}/?n=${Date.now()}#/p/${transport.id}`, { waitUntil: "networkidle" });
  await m.locator(".related").waitFor({ timeout: 8000 }).catch(() => {});
  const fits = await m.locator(".related, .related-item").evaluateAll((els) => els.length > 0 && els.every((e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= 390; }));
  check(fits, "it fits on a phone");
  await b.close();
  console.log(fails ? `${fails} failed` : "all good");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
