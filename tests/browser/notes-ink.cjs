// Note formats (#44, editor/formats.ts) and handwriting (#45, #46: components/Handwriting.tsx, handwriting/ink.ts). Pen input
// is real PointerEvents with pointerType "pen" and pressure, dispatched on the canvas. Writing by hand is for the iPad
// (device.ts): the main page runs as one (sg.device = tablet); the iPhone and the computer only type, and what they type
// into a handwritten page is outlined on the iPad to write in. Mock model, wiped database.
const { chromium } = require("playwright");
const B = process.env.SEAGLASS_URL || "http://localhost:5173";
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const j = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };

// a stroke on the canvas: pointerdown, moves, pointerup, as one pointer type
const stroke = (p, type, pts, pressure = 0.6) => p.evaluate(({ type, pts, pressure }) => {
  const c = document.querySelector(".ink-paper"), r = c.getBoundingClientRect(), id = type === "pen" ? 7 : type === "touch" ? 9 : 1;
  const ev = (name, [x, y]) => c.dispatchEvent(new PointerEvent(name, { bubbles: true, pointerId: id, pointerType: type, isPrimary: true, pressure, clientX: r.left + x, clientY: r.top + y, buttons: name === "pointerup" ? 0 : 1 }));
  ev("pointerdown", pts[0]); for (const q of pts.slice(1)) ev("pointermove", q); ev("pointerup", pts[pts.length - 1]);
}, { type, pts, pressure });
const line = (x0, y0, x1, y1, n = 12) => Array.from({ length: n }, (_, i) => [x0 + ((x1 - x0) * i) / (n - 1), y0 + ((y1 - y0) * i) / (n - 1)]);

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(() => { localStorage.setItem("sg.agent", "0"); localStorage.setItem("sg.device", "tablet"); localStorage.setItem("sg.ink.auto", "0"); }); // opening straight to the paper is tested at the end

  // ---- note formats from a new page
  const a = (await j("POST", "/api/notes", { title: "Bio lecture" })).body;
  await p.goto(`${B}/?n=${Date.now()}#/p/${a.id}`, { waitUntil: "networkidle" });
  await p.locator(".st-formats button").first().click(); // Cornell notes (typed)
  await p.locator(".ProseMirror table").waitFor();
  const sheet = (await p.locator(".ProseMirror table").innerText()).trim();
  check(sheet === "", `a new page can start as Cornell notes, with no words in it (${JSON.stringify(sheet)})`);
  const look = await p.evaluate(() => {
    const t = document.querySelector(".ProseMirror table"), rows = t.querySelectorAll("tr"), cue = rows[0].children[0], notes = rows[0].children[1], sum = rows[rows.length - 1].children[0];
    const cs = (e) => getComputedStyle(e), px = (v) => parseFloat(v) || 0, clear = (e) => ["rgba(0, 0, 0, 0)", "transparent"].includes(cs(e).backgroundColor) && cs(e).backgroundImage === "none";
    return { top: px(cs(t).borderTopWidth) >= 1, side: px(cs(cue).borderRightWidth) >= 1, bottom: sum.colSpan === 2 && px(cs(sum).borderTopWidth) >= 1,
      noOther: px(cs(t).borderLeftWidth) + px(cs(t).borderRightWidth) + px(cs(t).borderBottomWidth) + px(cs(notes).borderRightWidth) + px(cs(notes).borderBottomWidth) + px(cs(cue).borderBottomWidth) === 0,
      noFill: [cue, notes, sum].every(clear), room: notes.getBoundingClientRect().height >= 140 };
  });
  check(Object.values(look).every(Boolean), `lines only: a top line, a side line, a bottom line, nothing else (${JSON.stringify(look)})`);
  await p.locator(".ProseMirror table td").nth(0).click(); await p.keyboard.type("What is osmosis?");
  await p.locator(".ProseMirror table td").nth(1).click(); await p.keyboard.type("Water moving across a membrane");
  await p.waitForTimeout(1500);
  const saved = (await j("GET", `/api/notes/${a.id}`)).body.html;
  check(/colwidth="210"/.test(saved) && /data-format="cornell"/.test(saved) && /What is osmosis\?/.test(saved), "it's saved with the cues column's width and its mark");
  await p.reload({ waitUntil: "networkidle" });
  check(/Study 1 flashcard/.test(await p.locator(".study-pill").innerText().catch(() => "")), "a filled Cornell row is a flashcard");
  // from the / menu
  const c = (await j("POST", "/api/notes", { title: "Chem", html: "<p>Intro</p>" })).body;
  await p.goto(`${B}/?n=${Date.now()}#/p/${c.id}`, { waitUntil: "networkidle" });
  await p.locator(".ProseMirror p").first().click(); await p.keyboard.press("End"); await p.keyboard.press("Enter");
  await p.keyboard.type("/q&a"); await p.waitForTimeout(300);
  check(/Q&A/.test(await p.locator(".suggest-list").first().innerText().catch(() => "")), "the / menu has the note formats");
  await p.keyboard.press("Enter"); await p.waitForTimeout(400);
  check(await p.locator(".ProseMirror [data-type=details]").count() === 3, "Q&A adds three question toggles");

  // the other formats look like theirs: an I. / A. / 1. outline, a comparison chart, a header card with stacked lines
  const o = (await j("POST", "/api/notes", { title: "Outline" })).body;
  await p.goto(`${B}/?n=${Date.now()}#/p/${o.id}`, { waitUntil: "networkidle" });
  await p.locator(".st-formats button", { hasText: "Outline" }).click(); await p.locator(".ProseMirror ol").first().waitFor();
  const kinds = await p.evaluate(() => [...document.querySelectorAll(".ProseMirror ol")].slice(0, 3).map((e) => getComputedStyle(e).listStyleType));
  check(kinds.join() === "upper-roman,upper-alpha,decimal", `Outline numbers I. / A. / 1. (${kinds})`);
  // the page's ⋯ menu adds a format to the end of a page that already has writing
  await p.locator(".topbar button[title='Page options']").click();
  await p.locator(".menu-pop button", { hasText: "Add a note format" }).click();
  await p.locator(".formats-pop .fmt-item", { hasText: "Lecture notes" }).click(); await p.waitForTimeout(1200);
  const lec = (await j("GET", `/api/notes/${o.id}`)).body.html;
  check(lec.indexOf("data-format=\"outline\"") < lec.indexOf("Key ideas") && /data-type="callout"/.test(lec), "the ⋯ menu's Add a note format adds Lecture notes after the outline");
  const stacked = await p.evaluate(() => { const ps = [...document.querySelectorAll(".ProseMirror [data-type=callout]")][0].querySelectorAll(":scope > p"); return ps[1].getBoundingClientRect().top > ps[0].getBoundingClientRect().bottom - 1; });
  check(stacked, "a callout's lines stack (Class above Date), not side by side");
  await p.locator(".topbar button[title='Page options']").click();
  await p.locator(".menu-pop button", { hasText: "Add a note format" }).click();
  await p.locator(".formats-pop .fmt-item", { hasText: "Charting" }).click(); await p.waitForTimeout(600);
  const chart = await p.evaluate(() => { const t = [...document.querySelectorAll(".ProseMirror table")].pop(), h = t.querySelector("th:nth-child(2)"), side = t.querySelector("tr:nth-child(2) > td"), cell = t.querySelector("tr:nth-child(2) > td:nth-child(2)"); return getComputedStyle(h).backgroundColor !== getComputedStyle(cell).backgroundColor && getComputedStyle(side).fontWeight >= 600; });
  check(chart, "Charting: a tinted header row and bold items down the side");

  // ---- handwriting
  const d = (await j("POST", "/api/notes", { title: "Sketches", html: "<p>Before</p>" })).body;
  await p.goto(`${B}/?n=${Date.now()}#/p/${d.id}`, { waitUntil: "networkidle" });
  await p.locator(".ProseMirror p").first().click(); await p.keyboard.press("End"); await p.keyboard.press("Enter");
  await p.keyboard.type("/handwriting"); await p.waitForTimeout(300); await p.keyboard.press("Enter");
  await p.locator(".ink .ink-paper").waitFor();
  check(/Apple Pencil/.test(await p.locator(".ink-hint").innerText()), "the / menu opens the writing screen");
  await stroke(p, "pen", line(40, 60, 300, 70), 0.9);
  await stroke(p, "touch", line(100, 200, 400, 260)); // the palm, after the pencil: scrolls, never draws
  await stroke(p, "pen", line(40, 120, 260, 140), 0.3);
  await p.locator(".ink-tool[aria-label='Highlighter']").click();
  await stroke(p, "pen", line(30, 65, 320, 65));
  check(await p.locator(".ink-tool[aria-label='Undo']").isEnabled(), "pencil strokes are drawn");
  const layers = await p.evaluate(() => { const l = document.querySelector(".ink-sheet .ink-live"), b = document.querySelector(".ink-sheet .ink-paper"); return !!l && !!b && getComputedStyle(l).pointerEvents === "none" && Math.abs(l.getBoundingClientRect().top - b.getBoundingClientRect().top) < 1; });
  check(layers, "the stroke being written has its own layer over the page's ink (no lag)");
  // palm rejection: a palm landing and moving mid-stroke adds nothing and doesn't end the stroke; a resting hand is ignored
  const palm = await p.evaluate(() => {
    const c = document.querySelector(".ink-paper"), r = c.getBoundingClientRect();
    const ev = (name, id, type, x, y, size = 1) => c.dispatchEvent(new PointerEvent(name, { bubbles: true, pointerId: id, pointerType: type, isPrimary: type === "pen", pressure: 0.5, width: size, height: size, clientX: r.left + x, clientY: r.top + y, buttons: name === "pointerup" ? 0 : 1 }));
    ev("pointerdown", 7, "pen", 50, 300); ev("pointermove", 7, "pen", 80, 302);
    ev("pointerdown", 9, "touch", 400, 420); ev("pointermove", 9, "touch", 600, 520); ev("pointerup", 9, "touch", 600, 520); // the palm, mid-stroke
    ev("pointermove", 7, "pen", 120, 304); ev("pointerup", 7, "pen", 120, 304);
    ev("pointerdown", 11, "touch", 200, 500, 80); ev("pointermove", 11, "touch", 260, 560, 80); ev("pointerup", 11, "touch", 260, 560, 80); // a resting hand
    return localStorage.getItem("sg.ink.pen");
  });
  await p.waitForTimeout(200);
  const inked = await p.evaluate(() => { const c = document.querySelector(".ink-paper"), x = c.getContext("2d"), d = c.width / c.getBoundingClientRect().width;
    const any = (x0, y0, x1, y1) => { const im = x.getImageData(Math.round(x0 * d), Math.round(y0 * d), Math.round((x1 - x0) * d), Math.round((y1 - y0) * d)).data; for (let i = 3; i < im.length; i += 4) if (im[i] > 0) return true; return false; };
    return { pen: any(60, 295, 115, 310), palm: any(420, 430, 590, 515), hand: any(205, 505, 255, 555) }; });
  check(palm === "1" && inked.pen && !inked.palm && !inked.hand, `palm rejection: the Pencil's stroke is drawn, a palm mid-stroke and a resting hand draw nothing (${JSON.stringify(inked)})`);
  await p.locator(".ink-tool[aria-label='Undo']").click(); // take the test stroke back off
  // turn into text, keep the drawing
  await p.locator(".ink-read").click();
  await p.locator(".ink-text-body").waitFor();
  check(/Osmosis moves water/.test(await p.locator(".ink-text-body").innerText()), "Turn into text reads the writing");
  await p.locator(".ink-text-actions button", { hasText: "Add below the drawing" }).click();
  await p.locator(".ProseMirror img[data-drawing]").waitFor();
  await p.waitForTimeout(1500);
  let html = (await j("GET", `/api/notes/${d.id}`)).body.html;
  const drawing = /data-drawing="([^"]+)"/.exec(html)?.[1];
  check(!!drawing && /Osmosis moves water/.test(html) && html.indexOf("data-drawing") < html.indexOf("Osmosis"), "the drawing goes in the page with the text below it");
  check(await p.locator(".ink-sheet .ink-live").count() === 0, "(the writing screen is closed)");
  const ink = await (await fetch(B + drawing)).json();
  check(ink.v === 1 && ink.strokes.length === 3 && ink.strokes[0].tool === "pen" && ink.strokes[2].tool === "highlighter", `its strokes are saved to edit again: 2 pen and a highlighter, no palm (${ink.strokes.length})`);
  check(ink.strokes[0].points.some((q) => q[2] > 0.8) && ink.strokes[1].points.every((q) => q[2] < 0.5), "with the pencil's pressure");
  // open it again, erase a stroke
  await p.locator(".ProseMirror img[data-drawing]").click();
  await p.locator(".ink .ink-paper").waitFor();
  await p.waitForTimeout(400);
  check(await p.locator(".ink-tool[aria-label='Undo']").isEnabled(), "tapping the drawing opens it with its strokes");
  await p.locator(".ink-tool[aria-label='Eraser']").click();
  await stroke(p, "pen", [[150, 130], [152, 131]]);
  await p.locator(".ink-bar .primary", { hasText: "Done" }).click();
  await p.waitForTimeout(1500);
  html = (await j("GET", `/api/notes/${d.id}`)).body.html;
  const drawing2 = /data-drawing="([^"]+)"/.exec(html)?.[1];
  check(drawing2 && drawing2 !== drawing && (await (await fetch(B + drawing2)).json()).strokes.length === 2, "erasing a stroke and Done updates the drawing in place");
  // replace with text
  await p.locator(".ProseMirror img[data-drawing]").click();
  await p.locator(".ink-read").waitFor(); await p.waitForTimeout(300);
  await p.locator(".ink-read").click();
  await p.locator(".ink-text-actions button", { hasText: "Use the text instead" }).click();
  await p.waitForTimeout(1500);
  html = (await j("GET", `/api/notes/${d.id}`)).body.html;
  check(!/data-drawing/.test(html) && (html.match(/Osmosis moves water/g) ?? []).length === 2, "Use the text instead swaps the drawing for its text");
  check(!errs.length, `no page errors ${errs.join(" | ")}`);

  // the pencil in the page's top bar: always there, the drawing goes at the end of the page
  await p.locator(".topbar button[aria-label='Write by hand']").click();
  await p.locator(".ink .ink-paper").waitFor();
  await stroke(p, "pen", line(40, 60, 300, 70), 0.7);
  await p.locator(".ink-bar .primary", { hasText: "Done" }).click(); await p.waitForTimeout(1800);
  html = (await j("GET", `/api/notes/${d.id}`)).body.html;
  check(/data-drawing/.test(html) && html.lastIndexOf("data-drawing") > html.lastIndexOf("Osmosis"), "the top bar's pencil adds a drawing at the end of the page");
  check(!errs.length, `no page errors ${errs.join(" | ")}`);

  // Snap to lines: a big crooked word between two lines is straightened onto a line and sized to fit, after a pause
  const sn = (await j("POST", "/api/notes", { title: "Snap", html: "<p>x</p>" })).body;
  await p.goto(`${B}/?n=${Date.now()}#/p/${sn.id}`, { waitUntil: "networkidle" });
  await p.locator(".topbar button[aria-label='Write by hand']").click(); await p.locator(".ink .ink-paper").waitFor();
  await p.locator(".ink-snap").click();
  check(await p.locator(".ink-snap").getAttribute("aria-pressed") === "true", "Snap to lines turns on");
  await stroke(p, "pen", [[100, 140], [115, 85], [130, 142]], 0.6);
  await stroke(p, "pen", [[135, 110], [160, 112], [170, 141]], 0.6);
  await p.waitForTimeout(1100);
  await p.locator(".ink-bar .primary", { hasText: "Done" }).click(); await p.waitForTimeout(1800);
  const snapHtml = (await j("GET", `/api/notes/${sn.id}`)).body.html;
  const snapInk = await (await fetch(B + /data-drawing="([^"]+)"/.exec(snapHtml)[1])).json();
  const sy = snapInk.strokes.flatMap((x) => x.points.map((q) => q[1]));
  const bottom = Math.max(...sy), tall = bottom - Math.min(...sy);
  check(Math.abs(bottom - Math.round(bottom / 32) * 32) <= 6 && tall <= 32 * 0.9, `the word now sits on a line and fits it (bottom ${bottom}, ${Math.round(tall)}px tall, was 57)`);
  const remembered = await p.evaluate(() => localStorage.getItem("sg.ink.snap"));
  check(remembered === "1", "the switch is remembered on this device");
  await p.evaluate(() => localStorage.setItem("sg.ink.snap", "0"));

  // handwritten Cornell notes: a Cornell sheet; the title written above the top line names the page
  const hc = (await j("POST", "/api/notes", { title: "" })).body;
  await p.goto(`${B}/?n=${Date.now()}#/p/${hc.id}`, { waitUntil: "networkidle" });
  await p.locator(".st-formats button", { hasText: "Cornell notes, handwritten" }).click();
  await p.locator(".ink .ink-paper.cornell").waitFor(); await p.waitForTimeout(300);
  check(await p.locator(".ink.as-page .ink-paper.cornell").count() === 1, "it starts a handwritten note on a Cornell sheet");
  const lines = await p.evaluate(() => { const c = document.querySelector(".ink-paper"), x = c.getContext("2d"), d = devicePixelRatio || 1, w = c.width, h = c.height;
    const dark = (px, py) => x.getImageData(Math.round(px * d), Math.round(py * d), 1, 1).data[3] > 0;
    const cssW = w / d, cssH = h / d; return { top: dark(cssW * 0.6, 96), side: dark(cssW * 0.3, cssH / 2), bottom: dark(cssW * 0.6, cssH - 192), nothingElse: !dark(cssW * 0.6, cssH / 2) && !dark(cssW * 0.1, cssH / 2) }; });
  check(Object.values(lines).every(Boolean), `the sheet has a top, side and bottom line and nothing else (${JSON.stringify(lines)})`);
  const full = await p.evaluate(() => {
    const vis = (q) => { const e = document.querySelector(q); return !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden"; };
    const paper = document.querySelector(".page .ink.as-page .ink-paper").getBoundingClientRect(), main = document.querySelector("main.main").getBoundingClientRect(), menu = document.querySelector(".topbar button[title='Page options']").getBoundingClientRect();
    return { fills: Math.abs(paper.width - main.width) < 4 && Math.abs(paper.left - main.left) < 3, top: paper.top - main.top < 4, menuCorner: main.right - menu.right < 30 && menu.top - main.top < 30, title: vis("textarea.title"), crumbs: vis(".topbar .crumbs"), share: vis(".share-btn"), pens: vis(".ink-float .ink-tools"), bar: !!document.querySelector(".ink-bar, .ink-opts, .ink-done"), sidebar: vis(".sidebar") };
  });
  check(full.fills && full.top && full.menuCorner && !full.title && !full.crumbs && !full.share && full.pens && !full.bar && full.sidebar,
    `a handwritten note is the paper, full screen beside the sidebar: ⋯ in the corner, the pens floating, no typed title or page chrome (${JSON.stringify(full)})`);
  await stroke(p, "pen", line(40, 50, 260, 55), 0.7);   // the title, above the top line
  await stroke(p, "pen", line(300, 200, 600, 210), 0.7); // notes
  for (let i = 0; i < 30 && !(await j("GET", `/api/notes/${hc.id}`)).body.title; i++) await p.waitForTimeout(500);
  await p.waitForTimeout(1500); // and the drawing's save
  check(/Osmosis/.test((await j("GET", `/api/notes/${hc.id}`)).body.title), "the page's title is read from the handwriting");
  const sideTitle = await p.locator(".sidebar", { hasText: "Osmosis moves water" }).count();
  check(sideTitle > 0, "and so does the sidebar");
  const named = (await j("GET", `/api/notes/${hc.id}`)).body;
  check(/Osmosis moves water/.test(named.title) && /data-drawing/.test(named.html), `the handwritten title names the page ("${named.title}")`);
  const ink2 = await (await fetch(B + /data-drawing="([^"]+)"/.exec(named.html)[1])).json();
  check(ink2.paper === "cornell", "the drawing remembers it's on Cornell paper");
  // its settings are in the page's ⋯ menu
  await p.locator(".topbar button[title='Page options']").click();
  const menu = await p.locator(".menu-pop").innerText();
  check(/Handwritten note/.test(menu) && /Cornell sheet ✓/.test(menu) && /Lined paper/.test(menu) && /Snap to lines/.test(menu) && /Add lines/.test(menu) && /Turn into text/.test(menu) && !/Write by hand/.test(menu), "the ⋯ menu has the paper, Snap to lines, Add lines and Turn into text");
  await p.locator(".menu-pop button", { hasText: "Lined paper" }).click(); await p.waitForTimeout(300);
  check(await p.locator(".ink.as-page .ink-paper:not(.cornell)").count() === 1, "and switching the paper there works");
  await p.locator(".topbar button[title='Page options']").click();
  await p.locator(".menu-pop button", { hasText: "Cornell sheet" }).click(); await p.waitForTimeout(1500);
  // a page that already has a name keeps it
  const kept = (await j("POST", "/api/notes", { title: "Biology unit 3" })).body;
  await p.goto(`${B}/?n=${Date.now()}#/p/${kept.id}`, { waitUntil: "networkidle" });
  await p.evaluate(() => dispatchEvent(new CustomEvent("seaglass:ink", { detail: { end: true, paper: "cornell" } })));
  await p.locator(".ink .ink-paper.cornell").waitFor();
  await stroke(p, "pen", line(40, 50, 260, 55), 0.7);
  await p.waitForTimeout(3000); // saved as the user writes
  check((await j("GET", `/api/notes/${kept.id}`)).body.title === "Biology unit 3" && /data-drawing/.test((await j("GET", `/api/notes/${kept.id}`)).body.html), "it saves as the user writes, and a page that already has a typed name keeps it");

  // the Cornell sheet is lined paper, and its lines sit on the ruled lines
  const paperCss = "";
  await p.goto(`${B}/?n=${Date.now()}#/p/${c.id}`, { waitUntil: "networkidle" });
  await p.evaluate(() => dispatchEvent(new CustomEvent("seaglass:ink", { detail: { end: true, paper: "cornell" } })));
  await p.locator(".ink .ink-paper.cornell").waitFor();
  const ruled = await p.locator(".ink-paper").evaluate((c) => getComputedStyle(c).backgroundImage);
  check(/gradient/.test(ruled), "the Cornell sheet is on lined paper");
  await p.locator(".ink-bar button[aria-label^='Cancel']").click(); await p.waitForTimeout(300);
  void paperCss;

  // ---- only the iPad writes by hand: the pencil is in its top bar
  const iPad = await b.newPage({ viewport: { width: 820, height: 1180 }, hasTouch: true });
  iPad.on("pageerror", (e) => errs.push(e.message));
  await iPad.addInitScript(() => { localStorage.setItem("sg.agent", "0"); localStorage.setItem("sg.device", "tablet"); localStorage.setItem("sg.ink.auto", "0"); });
  await iPad.goto(`${B}/?n=${Date.now()}#/p/${d.id}`, { waitUntil: "networkidle" });
  const penBox = await iPad.locator(".topbar button[aria-label='Write by hand']").boundingBox();
  check(!!penBox && penBox.x + penBox.width <= 820, "iPad: the pencil shows in the top bar");

  // the iPhone and the computer only type: no pencil, no / Handwriting, no handwritten Cornell, a drawing doesn't open
  for (const [name, w, h, mobile] of [["iPhone", 390, 844, true], ["computer", 1280, 900, false]]) {
    const t = await b.newPage({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
    t.on("pageerror", (e) => errs.push(e.message));
    await t.addInitScript(() => { localStorage.setItem("sg.agent", "0"); localStorage.setItem("sg.device", "other"); });
    await t.goto(`${B}/?n=${Date.now()}#/p/${d.id}`, { waitUntil: "networkidle" });
    const noPen = await t.locator(".topbar button[aria-label='Write by hand']").count() === 0;
    await t.locator(".ProseMirror img[data-drawing]").last().click(); await t.waitForTimeout(500);
    const noOpen = await t.locator(".ink").count() === 0;
    await t.goto(`${B}/?n=${Date.now()}#/p/${c.id}`, { waitUntil: "networkidle" });
    await t.locator(".ProseMirror p").first().click(); await t.keyboard.press("End"); await t.keyboard.press("Enter");
    await t.keyboard.type("/handwri"); await t.waitForTimeout(400);
    const list = await t.locator(".suggest-list").first().innerText().catch(() => "");
    await t.keyboard.press("Escape");
    check(noPen && noOpen && !/Handwriting|handwritten/.test(list), `${name}: no pencil, no / Handwriting, and a drawing is just a picture`);
    await t.close();
  }

  // typed on the computer into a handwritten page: kept as text, outlined on the iPad to write in by hand
  const pc = await b.newPage({ viewport: { width: 1280, height: 900 } });
  pc.on("pageerror", (e) => errs.push(e.message));
  await pc.addInitScript(() => { localStorage.setItem("sg.agent", "0"); localStorage.setItem("sg.device", "other"); });
  const typeLine = async (text) => {
    await pc.goto(`${B}/?n=${Date.now()}#/p/${d.id}`, { waitUntil: "networkidle" });
    await pc.locator(".ProseMirror > p").first().click(); await pc.keyboard.press("End"); await pc.keyboard.press("Enter");
    await pc.keyboard.type(text); await pc.waitForTimeout(1500);
  };
  await typeLine("Remember the cell membrane");
  html = (await j("GET", `/api/notes/${d.id}`)).body.html;
  check(/data-ink-todo="1"[^>]*>Remember the cell membrane/.test(html) && await pc.locator(".ink-todo").count() === 0, "typed on the computer: saved as normal text, marked, and not outlined there");
  await iPad.reload({ waitUntil: "networkidle" }); await iPad.waitForTimeout(500);
  const todo = iPad.locator(".ProseMirror .ink-todo", { hasText: "Remember the cell membrane" });
  check(await todo.count() === 1 && await todo.locator(".ink-todo-write").isVisible(), "on the iPad it's outlined with Write this by hand");
  await iPad.screenshot({ path: `${require("os").tmpdir()}/ink-todo-ipad.png` }).catch(() => {});
  await todo.locator(".ink-todo-write").click();
  await iPad.locator(".ink .ink-paper").waitFor();
  check(/Remember the cell membrane/.test(await iPad.locator(".ink-copy").innerText()), "the writing screen shows the words to write in");
  await iPad.evaluate(({ pts }) => { const c = document.querySelector(".ink-paper"), r = c.getBoundingClientRect(); const ev = (n, [x, y]) => c.dispatchEvent(new PointerEvent(n, { bubbles: true, pointerId: 7, pointerType: "pen", isPrimary: true, pressure: 0.6, clientX: r.left + x, clientY: r.top + y, buttons: n === "pointerup" ? 0 : 1 })); ev("pointerdown", pts[0]); for (const q of pts.slice(1)) ev("pointermove", q); ev("pointerup", pts[pts.length - 1]); }, { pts: line(40, 60, 300, 64) });
  await iPad.locator(".ink-bar .primary", { hasText: "Done" }).click(); await iPad.waitForTimeout(2000);
  html = (await j("GET", `/api/notes/${d.id}`)).body.html;
  check(!/Remember the cell membrane/.test(html) && !/data-ink-todo/.test(html) && (html.match(/data-drawing/g) ?? []).length >= 2, "written in by hand: the typed words go and the drawing takes their place");
  // × keeps it typed
  await typeLine("Keep me typed");
  await iPad.reload({ waitUntil: "networkidle" }); await iPad.waitForTimeout(500);
  await iPad.locator(".ProseMirror .ink-todo", { hasText: "Keep me typed" }).locator(".ink-todo-keep").click(); await iPad.waitForTimeout(1500);
  html = (await j("GET", `/api/notes/${d.id}`)).body.html;
  check(/Keep me typed/.test(html) && !/data-ink-todo/.test(html), "× keeps it as typed text, without the outline");

  // ---- the iPad opens a handwritten note straight to its paper
  const pad = await b.newPage({ viewport: { width: 1180, height: 820 }, hasTouch: true });
  pad.on("pageerror", (e) => errs.push(e.message));
  await pad.addInitScript(() => { localStorage.setItem("sg.agent", "0"); localStorage.setItem("sg.device", "tablet"); localStorage.setItem("sg.ink.snap", "0"); });
  const penLine = (pts) => pad.evaluate(({ pts }) => { const c = document.querySelector(".ink-paper"), r = c.getBoundingClientRect(); const ev = (n, [x, y]) => c.dispatchEvent(new PointerEvent(n, { bubbles: true, pointerId: 7, pointerType: "pen", isPrimary: true, pressure: 0.6, clientX: r.left + x, clientY: r.top + y, buttons: n === "pointerup" ? 0 : 1 })); ev("pointerdown", pts[0]); for (const q of pts.slice(1)) ev("pointermove", q); ev("pointerup", pts[pts.length - 1]); }, { pts });
  await pad.goto(`${B}/?n=${Date.now()}#/`, { waitUntil: "networkidle" });
  await pad.evaluate((id) => { location.hash = `#/p/${id}`; }, hc.id); // opened from inside the app, like the sidebar
  await pad.locator(".ink.as-page .ink-paper.cornell").waitFor({ timeout: 8000 }).catch(() => {});
  check(await pad.locator(".ink.as-page .ink-paper.cornell").count() === 1 && await pad.locator(".ink-tool[aria-label='Undo']").isEnabled(), "a handwritten Cornell note opens straight to its sheet, as the note, with its writing");
  // more lines: Add lines, and writing on the last line before the summary
  const h0 = await pad.locator(".ink-paper").evaluate((c) => c.getBoundingClientRect().height);
  await pad.locator(".ink-more").click(); await pad.waitForTimeout(200);
  const h1 = await pad.locator(".ink-paper").evaluate((c) => c.getBoundingClientRect().height);
  const sc = (h1 - h0) / (6 * 32); // the sheet may be drawn smaller to fit the screen
  check(sc > 0.5, `Add lines gives the sheet six more lines (${Math.round(h0)} to ${Math.round(h1)}px on screen)`);
  const bottomLine = h1 - 192 * sc;
  await penLine(line(300, bottomLine - 20 * sc, 500, bottomLine - 14 * sc));
  await pad.waitForTimeout(200);
  const h2 = await pad.locator(".ink-paper").evaluate((c) => c.getBoundingClientRect().height);
  check(Math.abs((h2 - h1) / sc - 4 * 32) < 2, `writing on the last line adds four more (${Math.round(h1)} to ${Math.round(h2)}px)`);
  // leaving it (straight after writing) saves it
  await penLine(line(300, 300, 520, 306));
  await pad.evaluate(() => { location.hash = "#/"; }); await pad.waitForTimeout(2500);
  const backHtml = (await j("GET", `/api/notes/${hc.id}`)).body.html;
  const backInk = await (await fetch(B + /data-drawing="([^"]+)"/.exec(backHtml)[1])).json();
  check(await pad.locator(".ink").count() === 0 && backInk.height > h0 && backInk.strokes.length >= 4, `leaving the note saves it, even straight after writing (${backInk.strokes.length} strokes)`);
  let altHtml = "";
  for (let i = 0; i < 20 && !/alt="Handwriting: \(mock\) Osmosis/.test(altHtml); i++) { await pad.waitForTimeout(500); altHtml = (await j("GET", `/api/notes/${hc.id}`)).body.html; }
  check(/alt="Handwriting: \(mock\) Osmosis moves water across a membrane\.\n?\(mock\) toward more solute"/.test(altHtml.replace(/&#10;|\n/g, "\n")) || /alt="Handwriting: \(mock\) Osmosis/.test(altHtml), "what the user wrote is read and kept with the drawing (its alt)");
  const said = await (await fetch(B + "/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: `mock:tool read_note {"id":"${hc.id}"}`, history: [] }) })).text();
  check(/Handwriting: \(mock\) Osmosis/.test(said), "and the assistant reads it with read_note");
  // typed on the computer into the note: listed on the iPad to write in
  const pc2 = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await pc2.addInitScript(() => { localStorage.setItem("sg.agent", "0"); localStorage.setItem("sg.device", "other"); });
  await pc2.goto(`${B}/?n=${Date.now()}#/p/${hc.id}`, { waitUntil: "networkidle" });
  const wide = await pc2.evaluate(() => { const i = document.querySelector(".ProseMirror img[data-drawing]"), e = document.querySelector(".ProseMirror"); return i.getBoundingClientRect().width >= e.getBoundingClientRect().width - 2; });
  check(wide, "on the computer the handwritten note fills the page width, for reading");
  await pc2.locator(".ProseMirror img[data-drawing]").click();
  await pc2.locator(".ink-view").waitFor();
  const w1 = await pc2.locator(".ink-view img").evaluate((i) => i.getBoundingClientRect().width);
  await pc2.locator(".ink-view-bar button", { hasText: "Zoom in" }).click(); await pc2.waitForTimeout(200);
  const w2 = await pc2.locator(".ink-view img").evaluate((i) => i.getBoundingClientRect().width);
  check(w2 > w1 * 1.5 && await pc2.locator(".ink").count() === 0, `tapping it opens a viewer that zooms (and no writing screen) (${Math.round(w1)} to ${Math.round(w2)}, ${await pc2.locator(".ink").count()})`);
  await pc2.locator(".ink-view-bar button", { hasText: "Close" }).click();
  await pc2.locator(".ProseMirror").click({ position: { x: 20, y: 5 } }).catch(() => {});
  await pc2.keyboard.press("Control+End"); await pc2.keyboard.press("Enter"); await pc2.keyboard.type("Add the mitochondria part"); await pc2.waitForTimeout(1500);
  const typedHtml = (await j("GET", `/api/notes/${hc.id}`)).body.html;
  check(/data-ink-todo="1"[^>]*>Add the mitochondria part/.test(typedHtml), "typed there, it's kept as text and marked to write in");
  await pc2.close();
  await pad.goto(`${B}/?n=${Date.now()}#/p/${hc.id}`, { waitUntil: "networkidle" });
  await pad.locator(".ink.as-page .ink-todos").waitFor({ timeout: 8000 }).catch(() => {});
  check(/Add the mitochondria part/.test(await pad.locator(".ink-todos").innerText().catch(() => "")), "on the iPad the note lists it to write in");
  await pad.locator(".ink-todo-item button", { hasText: "Written" }).click(); await pad.waitForTimeout(1500);
  check(!/mitochondria/.test((await j("GET", `/api/notes/${hc.id}`)).body.html) && await pad.locator(".ink-todos").count() === 0, "Written ✓ removes the typed words");
  // Turn into text from the ⋯ menu: its card isn't covered by the pens, and its buttons can be tapped
  await pad.locator(".topbar button[title='Page options']").click();
  await pad.locator(".menu-pop button", { hasText: "Turn into text" }).click();
  await pad.locator(".ink-text-body").waitFor({ timeout: 10000 });
  await pad.locator(".ink-text").scrollIntoViewIfNeeded();
  const tappable = await pad.evaluate(() => { const b = [...document.querySelectorAll(".ink-text-actions button")]; return b.every((x) => { const r = x.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return top === x || x.contains(top); }); });
  check(tappable && await pad.locator(".ink-float").count() === 0, "Turn into text: the pens step aside and every button on its card can be tapped");
  await pad.locator(".ink-text-actions button", { hasText: "Back to writing" }).click(); await pad.waitForTimeout(200);
  check(await pad.locator(".ink-float").count() === 1, "and the pens come back");
  // the pen's width: Fine / Medium / Bold, remembered on the device, and used for new strokes
  await pad.locator(".ink-float .ink-width").click();
  check(await pad.locator(".ink-widths button").count() === 3 && await pad.locator(".ink-widths button.on").innerText() === "Medium", "the width button offers Fine, Medium and Bold (Medium to start)");
  await pad.locator(".ink-widths button", { hasText: "Fine" }).click();
  check(await pad.evaluate(() => localStorage.getItem("sg.ink.width")) === "fine" && await pad.locator(".ink-widths").count() === 0 && /Fine/.test(await pad.locator(".ink-float .ink-width").getAttribute("aria-label")), "picking Fine closes the menu and is remembered");
  const savedInk = async () => (await fetch(B + /data-drawing="([^"]+)"/.exec((await j("GET", `/api/notes/${hc.id}`)).body.html)[1])).json();
  const n0 = (await savedInk()).strokes.length;
  await penLine(line(300, 340, 480, 344));
  let fineInk = await savedInk();
  for (let i = 0; i < 16 && fineInk.strokes.length <= n0; i++) { await pad.waitForTimeout(500); fineInk = await savedInk(); }
  check(fineInk.strokes.length > n0 && fineInk.strokes[fineInk.strokes.length - 1].size === 1.15, `a stroke written then is fine, and saved as the user writes even after Written ✓ changed the page (${n0} to ${fineInk.strokes.length} strokes, ${fineInk.strokes.map((x) => x.size).join(",")})`);
  // while a stroke is being written the pens fade and let touches through
  const fade = await pad.evaluate(() => { const c = document.querySelector(".ink-paper"), r = c.getBoundingClientRect(), f = document.querySelector(".ink-float");
    const ev = (n, x, y) => c.dispatchEvent(new PointerEvent(n, { bubbles: true, pointerId: 7, pointerType: "pen", isPrimary: true, pressure: 0.5, clientX: r.left + x, clientY: r.top + y, buttons: n === "pointerup" ? 0 : 1 }));
    ev("pointerdown", 300, 380); ev("pointermove", 340, 382);
    const during = { cls: document.querySelector(".ink").classList.contains("writing"), pe: getComputedStyle(f).pointerEvents };
    ev("pointerup", 340, 382);
    return { during, after: document.querySelector(".ink").classList.contains("writing") }; });
  check(fade.during.cls && fade.during.pe === "none" && !fade.after, `the pens fade while writing and come back after (${JSON.stringify(fade)})`);
  // a quick two-finger tap undoes, three fingers redo
  const tapWith = (n) => pad.evaluate((n) => { const c = document.querySelector(".ink-paper"), r = c.getBoundingClientRect();
    const ts = Array.from({ length: n }, (_, i) => new Touch({ identifier: 40 + i, target: c, clientX: r.left + 400 + i * 40, clientY: r.top + 450, radiusX: 8, radiusY: 8 }));
    c.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: ts, targetTouches: ts, changedTouches: ts }));
    c.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: ts })); }, n);
  const redoOff = () => pad.locator(".ink-float .ink-tool[aria-label='Redo']").isDisabled();
  const before = await redoOff();
  await tapWith(2); await pad.waitForTimeout(150);
  const afterUndo = await redoOff();
  await tapWith(3); await pad.waitForTimeout(150);
  check(before && !afterUndo && await redoOff(), "a two-finger tap undoes and a three-finger tap redoes");
  await pad.locator(".ink-float .ink-width").click(); await pad.locator(".ink-widths button", { hasText: "Medium" }).click();
  // a new empty page opens as a normal page; writing by hand on it makes it a handwritten note
  const blank = (await j("POST", "/api/notes", { title: "" })).body;
  await pad.goto(`${B}/?n=${Date.now()}#/p/${blank.id}`, { waitUntil: "networkidle" }); await pad.waitForTimeout(800);
  check(await pad.locator(".ink").count() === 0 && await pad.locator(".starter").count() === 1, "a new empty page opens as a normal page, not to the paper");
  await pad.locator(".topbar button[aria-label='Write by hand']").click(); await pad.locator(".ink.as-page .ink-paper").waitFor();
  check(await pad.locator(".starter").count() === 0, "writing by hand on it makes it a handwritten note (the starter goes)");
  const hint = await pad.evaluate(() => { const h = document.querySelector(".ink-float-hint"); if (!h) return null; const r = h.getBoundingClientRect(); return { text: h.textContent, seen: r.top >= 0 && r.bottom <= innerHeight }; });
  check(!!hint && hint.seen && /title/.test(hint.text), `an empty note says how to start, just above the pens where it's seen (${JSON.stringify(hint)})`);
  await pad.locator(".topbar button[title='Page options']").click();
  await pad.locator(".menu-pop button", { hasText: "Lined paper" }).click(); await pad.waitForTimeout(200);
  await penLine(line(40, 50, 250, 54));
  for (let i = 0; i < 30 && !(await j("GET", `/api/notes/${blank.id}`)).body.title; i++) await pad.waitForTimeout(500);
  check(/Osmosis/.test((await j("GET", `/api/notes/${blank.id}`)).body.title), "writing by hand on it makes it a handwritten note; on lined paper the first line names it");
  // a typed page opens as text
  await pad.goto(`${B}/?n=${Date.now()}#/p/${c.id}`, { waitUntil: "networkidle" }); await pad.waitForTimeout(800);
  check(await pad.locator(".ink").count() === 0, "a typed page opens as text");
  // writing never selects or highlights anything (Safari's engine): a drag from the paper up across the title selects nothing
  const { webkit } = require("playwright");
  const wk = await webkit.launch();
  const wp = await wk.newPage({ viewport: { width: 1180, height: 820 } });
  await wp.addInitScript(() => { localStorage.setItem("sg.agent", "0"); localStorage.setItem("sg.device", "tablet"); });
  await wp.goto(`${B}/?n=${Date.now()}#/p/${hc.id}`, { waitUntil: "networkidle" });
  await wp.locator(".ink.as-page .ink-paper").waitFor({ timeout: 10000 });
  const pr = await wp.locator(".ink-paper").boundingBox();
  await wp.mouse.move(pr.x + 400, pr.y + 300); await wp.mouse.down();
  for (let k = 1; k <= 12; k++) await wp.mouse.move(pr.x + 400 - k * 20, pr.y + 300 - k * 28); // up off the paper, across the page
  await wp.mouse.up();
  const sel = await wp.evaluate(() => ({ text: String(getSelection()), us: getComputedStyle(document.querySelector(".ink-paper")).webkitUserSelect || getComputedStyle(document.querySelector(".ink-paper")).userSelect }));
  check(sel.text === "" && sel.us === "none", `writing doesn't select or highlight anything in Safari's engine (${JSON.stringify(sel)})`);
  // upright: the sidebar is away, so the paper is the whole screen, ⋯ is still in the corner, and nothing can be selected
  await wp.setViewportSize({ width: 820, height: 1180 }); await wp.waitForTimeout(600);
  const port = await wp.evaluate(() => { const p = document.querySelector(".ink-paper").getBoundingClientRect(), m = document.querySelector(".topbar button[title='Page options']").getBoundingClientRect(), pg = getComputedStyle(document.querySelector(".page")); return { paper: Math.round(p.width), screen: innerWidth, menuRight: Math.round(innerWidth - m.right), menuTop: Math.round(m.top), sel: pg.webkitUserSelect || pg.userSelect }; });
  check(port.paper >= port.screen - 4 && port.menuRight < 30 && port.menuTop < 60 && port.sel === "none", `upright, the paper is the whole screen with ⋯ in the corner, and the page can't be selected (${JSON.stringify(port)})`);
  await wp.keyboard.press("Escape"); await wp.waitForTimeout(300);
  check(await wp.locator(".ink.as-page").count() === 1, "Escape (a keyboard on the iPad) doesn't close the handwritten note");
  await wk.close();
  check(!errs.length, `no page errors ${errs.join(" | ")}`);
  await b.close();
  console.log(fails ? `${fails} failed` : "all good");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
