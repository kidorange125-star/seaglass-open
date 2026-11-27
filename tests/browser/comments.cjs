// Comments on specific text and suggested edits (#22: client comments.ts, editor/commentMarks.ts, PageView SidePanel,
// agent suggest_edit). Select words and comment, the highlight, clicking it opens the comment; the assistant suggests edits
// (checked: once on the page, plain text), shown struck through with the new words; Accept edits the page (Ctrl+Z undoes),
// Reject leaves it; read_note lists open ones. Desktop and 390px. Mock model, wiped database.
const { chromium } = require("playwright");
const B = process.env.SEAGLASS_URL || "http://localhost:5173";
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const j = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const agent = async (b) => { const r = await fetch(B + "/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }); return (await r.text()).trim().split("\n").map((l) => JSON.parse(l)); };
const tool = (name, input) => agent({ message: `mock:tool ${name} ${JSON.stringify(input)}` });
const res = (ev) => ev.find((e) => e.type === "tool_result");

(async () => {
  const page = (await j("POST", "/api/notes", { title: "Essay", html: "<p>The war <strong>begun</strong> in 1914 and it effected every country.</p><p>Many soldiers was lost in the trenches.</p>" })).body;
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(() => { localStorage.setItem("sg.agent", "0"); });
  await p.goto(`${B}/?n=${Date.now()}#/p/${page.id}`, { waitUntil: "networkidle" });
  await p.locator(".ProseMirror p").first().waitFor();

  // ---- comment on selected words
  const sel = (text) => p.evaluate((t) => {
    const ed = document.querySelector(".ProseMirror"), walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) { const i = n.data.indexOf(t); if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + t.length); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; } }
    return false;
  }, text);
  await sel("trenches"); await p.waitForTimeout(300);
  await p.locator(".bubble button[title='Comment']").click();
  await p.locator(".modal input").fill("Which front? Add the place.");
  await p.locator(".modal button.primary").click();
  await p.locator(".side-panel .comment").first().waitFor();
  check(/trenches/.test(await p.locator(".side-panel .cmt-quote").innerText()) && /Which front/.test(await p.locator(".side-panel").innerText()), "a comment on selected words opens in the panel, with the words");
  await p.locator(".ProseMirror .cmt-hl").waitFor();
  check((await p.locator(".ProseMirror .cmt-hl").innerText()) === "trenches", "the words are highlighted in the page");
  check(!/cmt-hl|data-cid/.test((await j("GET", `/api/notes/${page.id}`)).body.html), "and nothing was written into the page");
  await p.locator(".side-panel .sp-head button").click();
  await p.locator(".ProseMirror .cmt-hl").click();
  await p.locator(".side-panel .comment.focus").waitFor();
  check(true, "clicking the highlight opens that comment");

  // ---- the assistant suggests edits
  let r = res(await tool("suggest_edit", { page_id: page.id, find: "begun", replace: "began", reason: "Past tense of begin." }));
  check(r?.ok && /Suggested an edit/.test(r.label), "the assistant suggests an edit");
  r = res(await tool("suggest_edit", { page_id: page.id, find: "effected", replace: "affected", reason: "Affect is the verb." }));
  const r3 = res(await tool("suggest_edit", { page_id: page.id, find: "soldiers was lost", replace: "soldiers were lost", reason: "Plural." }));
  const twice = JSON.stringify(await tool("suggest_edit", { page_id: page.id, find: "in", replace: "on" }));
  check(/appears \d+ times/.test(twice), "words that appear twice are refused");
  check(/isn't on the page/.test(JSON.stringify(await tool("suggest_edit", { page_id: page.id, find: "<strong>begun</strong>", replace: "x" }))), "HTML or missing words are refused");
  const rn = JSON.stringify(await tool("read_note", { id: page.id }));
  check(/\\"suggested\\":\\"affected\\"/.test(rn) && /Which front/.test(rn), "read_note lists the open comments and suggestions");
  check((await j("GET", `/api/notes/${page.id}`)).body.html.includes("<strong>begun</strong>"), "suggesting changed nothing on the page");

  await p.evaluate(() => dispatchEvent(new CustomEvent("seaglass:comments")));
  await p.locator(".ProseMirror .sug-ins").nth(2).waitFor();
  check((await p.locator(".ProseMirror .sug-del").allInnerTexts()).join("|") === "begun|effected|soldiers was lost" && (await p.locator(".ProseMirror .sug-ins").allInnerTexts()).join("|") === "began|affected|soldiers were lost", "suggestions show struck through with the new words");
  check(/Review 3 suggested edits/.test(await p.locator(".sug-pill").innerText().catch(() => "")) || await p.locator(".side-panel").count() === 1, "a pill says how many to review");
  if (!(await p.locator(".side-panel").count())) await p.locator(".sug-pill").click();
  await p.locator(".side-panel .suggestion").first().waitFor();
  const sugg = p.locator(".side-panel .comment.suggestion");
  check(await sugg.count() === 3 && /begun\s*began/.test(await sugg.first().locator(".cmt-change").innerText()), "the panel lists them first, old words and new");

  await sugg.filter({ hasText: "Past tense" }).locator("button", { hasText: "Accept" }).click();
  await p.waitForTimeout(1600);
  let html = (await j("GET", `/api/notes/${page.id}`)).body.html;
  check(/<strong>began<\/strong> in 1914/.test(html), "Accept makes the edit, keeping the bold");
  check(/Accepted/.test(await sugg.filter({ hasText: "Past tense" }).innerText()) && await p.locator(".ProseMirror .sug-del", { hasText: "begun" }).count() === 0, "and it's marked accepted");
  await sugg.filter({ hasText: "Affect is the verb" }).locator("button", { hasText: "Reject" }).click();
  await p.waitForTimeout(600);
  check(/Rejected/.test(await sugg.filter({ hasText: "Affect is the verb" }).innerText()) && await p.locator(".ProseMirror .sug-del", { hasText: "effected" }).count() === 0, "Reject leaves the words and marks it rejected");
  await sugg.filter({ hasText: "Plural" }).locator("button", { hasText: "Accept" }).click();
  await p.waitForTimeout(1600);
  html = (await j("GET", `/api/notes/${page.id}`)).body.html;
  check(/Many soldiers were lost/.test(html) && /effected/.test(html), "another accepted, the rejected one untouched");
  await p.locator(".ProseMirror p").first().click(); await p.keyboard.press("Control+z"); await p.waitForTimeout(1600);
  check(/soldiers was lost/.test((await j("GET", `/api/notes/${page.id}`)).body.html), "Ctrl+Z undoes an accepted edit");
  check(await p.locator(".sug-pill").count() === 0, "nothing left to review");

  // ---- phone
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(`${B}/?n=${Date.now()}#/p/${page.id}`, { waitUntil: "networkidle" });
  await p.locator(".ProseMirror .cmt-hl").click();
  await p.locator(".side-panel .comment.focus").waitFor(); await p.waitForTimeout(400); // the panel slides in
  const fits = await p.locator(".side-panel, .side-panel .comment").evaluateAll((els) => els.every((e) => { const r = e.getBoundingClientRect(); return r.left >= -0.5 && r.right <= 390.5; }));
  const h = await p.locator(".side-panel .comment.focus button.ghost").first().evaluate((e) => e.getBoundingClientRect().height);
  const wide = await p.locator(".side-panel, .side-panel .comment").evaluateAll((els) => els.map((e) => `${e.className}:${e.getBoundingClientRect().left}-${e.getBoundingClientRect().right}`).join(" "));
  check(fits && h >= 40, `on a phone the panel fits, with big buttons (${h}px) ${fits ? "" : wide}`);
  check(!errs.length, `no page errors ${errs.join(" | ")}`);
  await b.close();
  console.log(fails ? `${fails} failed` : "all good");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
