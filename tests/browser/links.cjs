// Links in pages (editor/links.ts, LinkDialog.tsx): a click follows a link (a web address in a new tab, a Seaglass address
// inside the app), the Link dialog gives a link its own words and address (from the toolbar, Ctrl+K and / Link), the link
// card (Open / Edit / Remove), and the phone. Mock model, wiped database.
const { chromium } = require("playwright");
const B = process.env.SEAGLASS_URL || "http://localhost:5173";
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const j = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const html = async (id) => (await j("GET", `/api/notes/${id}`)).body.html;
const settle = async (id, want, ms = 8000) => { const t = Date.now(); let h = await html(id); while (!want.test(h) && Date.now() - t < ms) { await new Promise((r) => setTimeout(r, 300)); h = await html(id); } return h; };

(async () => {
  const other = (await j("POST", "/api/notes", { title: "Other page", html: "<p>Over here</p>" })).body;
  const page = (await j("POST", "/api/notes", { title: "Links", html: `<p>Read <a href="https://example.com/notes">my lab notes</a> and the plain <a href="https://example.org/a/very/long/address/that/is/ugly">https://example.org/a/very/long/address/that/is/ugly</a>.</p><p>Back to <a href="#/p/${other.id}">the other page</a>.</p><p>Write here: </p>` })).body;
  check(new RegExp(`href="#/p/${other.id}"`).test(await html(page.id)), "the server keeps a link to a page in Seaglass");
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(() => { localStorage.setItem("sg.agent", "0"); });
  await p.goto(`${B}/?n=${Date.now()}#/p/${page.id}`, { waitUntil: "networkidle" });
  await p.locator(".ProseMirror a").first().waitFor();

  // ---- a click follows a link
  const popup = ctx.waitForEvent("page", { timeout: 5000 }).catch(() => null);
  await p.locator(".ProseMirror a", { hasText: "my lab notes" }).click();
  const tab = await popup;
  check(!!tab && /^https:\/\/example\.com\/notes/.test(tab.url()), `clicking a web link opens it in a new tab (${tab?.url()})`);
  if (tab) await tab.close();
  check(p.url().includes(`#/p/${page.id}`), "and the page itself stays where it was");
  await p.locator(".ProseMirror a", { hasText: "the other page" }).click(); await p.waitForTimeout(600);
  check(p.url().includes(`#/p/${other.id}`) && ctx.pages().length === 1, "clicking a link to another page goes there inside the app, no new tab");
  await p.goBack(); await p.locator(".ProseMirror a").first().waitFor();

  // ---- after a click that follows a link, no card covers the line below; the card shows when the arrow keys reach a link
  await p.locator(".ProseMirror a", { hasText: "my lab notes" }).click(); // opens the tab again; close it
  await p.waitForTimeout(500); for (const t of ctx.pages().slice(1)) await t.close();
  check(await p.locator(".link-card").count() === 0, "after clicking a link no card appears over the text below it");
  await p.keyboard.press("ArrowRight"); // the cursor moves inside the link
  await p.locator(".link-card").waitFor({ timeout: 4000 }).catch(() => {});
  check(await p.locator(".link-card").count() === 1 && /example\.com/.test(await p.locator(".link-card .link-url").innerText()), "with the cursor in a link a card shows where it goes");
  // ---- Edit: change the words and the address
  await p.locator(".link-card button", { hasText: "Edit" }).click();
  await p.locator(".link-dialog").waitFor();
  check(await p.inputValue("#link-words") === "my lab notes" && await p.inputValue("#link-href") === "https://example.com/notes", "the dialog starts with the link's words and address");
  await p.fill("#link-words", "Lab notes (unit 3)"); await p.fill("#link-href", "school.example.edu/unit3");
  await p.locator(".link-dialog button.primary").click();
  let h = await settle(page.id, /Lab notes \(unit 3\)/);
  check(/<a [^>]*href="https:\/\/school\.example\.edu\/unit3"[^>]*>Lab notes \(unit 3\)<\/a>/.test(h) && !/my lab notes/.test(h), "saving changes both the words and the address (https added)");

  // ---- the long ugly address gets short words: select it, Link, new words
  await p.evaluate(() => { const a = [...document.querySelectorAll(".ProseMirror a")].find((x) => /ugly/.test(x.textContent)); const r = document.createRange(); r.selectNodeContents(a); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.querySelector(".ProseMirror").focus(); });
  await p.locator(".bubble button[title='Link']").waitFor();
  await p.locator(".bubble button[title='Link']").click();
  await p.locator(".link-dialog").waitFor();
  check(/ugly/.test(await p.inputValue("#link-words")) && /ugly/.test(await p.inputValue("#link-href")), "a pasted address selected as words fills both boxes");
  await p.fill("#link-words", "the reading");
  await p.locator(".link-dialog button.primary").click();
  h = await settle(page.id, />the reading</);
  check(/<a [^>]*href="https:\/\/example\.org\/a\/very\/long\/address\/that\/is\/ugly"[^>]*>the reading<\/a>/.test(h), "the long address is now one short name");

  // ---- words with other formatting keep it when the address only changes
  await p.evaluate(() => { const el = document.querySelector(".ProseMirror p:last-child"); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); el.closest(".ProseMirror").focus(); });
  // ---- / Link: insert a new named link with nothing selected
  await p.keyboard.type("/link"); await p.waitForTimeout(400); await p.keyboard.press("Enter");
  await p.locator(".link-dialog").waitFor();
  check(await p.inputValue("#link-words") === "" && await p.inputValue("#link-href") === "", "/ Link opens the dialog empty when nothing is selected");
  await p.locator("#link-words").fill("Course page");
  await p.locator("#link-href").fill("course.example.com/bio");
  await p.keyboard.press("Enter");
  h = await settle(page.id, /Course page/);
  check(/Write here:\s*<a [^>]*href="https:\/\/course\.example\.com\/bio"[^>]*>Course page<\/a>/.test(h), `it inserts the words as a link at the cursor (${h.slice(h.lastIndexOf("<p>"))})`);
  check(!/\/link/.test(h), "and the slash text is gone");

  // ---- a bad address is refused, with a reason; the dialog stays
  await p.keyboard.type(" and ");
  await p.keyboard.press("Control+a"); await p.keyboard.press("Control+k");
  await p.locator(".link-dialog").waitFor({ timeout: 3000 }).catch(() => {});
  if (await p.locator(".link-dialog").count()) {
    await p.fill("#link-href", "javascript:alert(1)"); await p.keyboard.press("Enter");
    check(await p.locator(".link-dialog .when-err").count() === 1 && await p.locator(".link-dialog").count() === 1, "a script address is refused with a message, and the dialog stays");
    await p.keyboard.press("Escape");
    check(await p.locator(".link-dialog").count() === 0, "Escape closes it");
  } else check(false, "Ctrl+K with words selected opens the Link dialog");

  // ---- Remove keeps the words
  await p.locator(".ProseMirror a", { hasText: "Course page" }).click(); // opens a tab: close it
  await p.waitForTimeout(400); for (const t of ctx.pages().slice(1)) await t.close();
  await p.keyboard.press("ArrowLeft");
  await p.locator(".link-card").waitFor({ timeout: 4000 }).catch(() => {});
  await p.locator(".link-card button", { hasText: "Remove" }).click().catch(() => {});
  h = await settle(page.id, /Write here:\s*Course page(?!<\/a>)/);
  check(/Write here:\s*Course page/.test(h) && !/course\.example\.com/.test(h), `Remove takes the link off and keeps the words (${h.slice(h.lastIndexOf("<p>"))})`);

  // ---- a plain click while selecting words doesn't follow (drag-select across a link)
  const before = ctx.pages().length;
  await p.evaluate(() => { const a = document.querySelector(".ProseMirror a"); const r = document.createRange(); r.selectNodeContents(a); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await p.locator(".ProseMirror a").first().click({ modifiers: ["Shift"] }); await p.waitForTimeout(500);
  check(ctx.pages().length === before, "Shift+click doesn't follow (it selects)");

  // ---- a locked page's links open too
  await j("PATCH", `/api/notes/${page.id}`, { locked: true });
  await p.reload({ waitUntil: "networkidle" }); await p.locator(".ProseMirror a").first().waitFor();
  const pop2 = ctx.waitForEvent("page", { timeout: 5000 }).catch(() => null);
  await p.locator(".ProseMirror a").first().click();
  const t2 = await pop2;
  check(!!t2, "links on a locked (read-only) page open as well");
  if (t2) await t2.close();
  await j("PATCH", `/api/notes/${page.id}`, { locked: false });
  check(!errs.length, `no page errors ${errs.join(" | ")}`);

  // ---- a phone: the dialog fits, its fields don't zoom the page
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await m.newPage();
  await mp.addInitScript(() => { localStorage.setItem("sg.agent", "0"); });
  await mp.goto(`${B}/?n=${Date.now()}#/p/${page.id}`, { waitUntil: "networkidle" });
  await mp.locator(".ProseMirror p").first().waitFor();
  await mp.evaluate(() => { const el = document.querySelector(".ProseMirror p"); el.closest(".ProseMirror").focus(); const r = document.createRange(); r.setStart(el.firstChild, 0); r.setEnd(el.firstChild, 4); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await mp.waitForTimeout(500);
  const btn = mp.locator(".bubble button[title='Link']");
  if (await btn.count()) await btn.tap(); else await mp.evaluate(() => dispatchEvent(new CustomEvent("seaglass:link")));
  await mp.locator(".link-dialog").waitFor();
  const fit = await mp.evaluate(() => { const r = document.querySelector(".link-dialog").getBoundingClientRect(); const f = [...document.querySelectorAll(".link-dialog input")].map((i) => parseFloat(getComputedStyle(i).fontSize)); return { inside: r.left >= 0 && r.right <= innerWidth, sizes: f }; });
  check(fit.inside && fit.sizes.every((x) => x >= 16), `on a phone the Link dialog fits and its boxes are 16px or more (${JSON.stringify(fit)})`);
  await mp.keyboard.press("Escape");

  await b.close();
  console.log(fails ? `${fails} failed` : "all good");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
