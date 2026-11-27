// Menus show in full: a page's ⋯ menu at the bottom of a long sidebar list moves up instead of being cut off by the
// list (or hidden behind Settings / Trash), and headings with a description (Trash) don't overlap it.
const { chromium } = require("playwright");
const B = process.env.SEAGLASS_URL || "http://localhost:5173";
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const post = (b) => fetch(B + "/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());

(async () => {
  for (let i = 1; i <= 30; i++) await post({ title: `Menu test page ${String(i).padStart(2, "0")}`, html: "<p>x</p>" });
  const b = await chromium.launch();
  for (const [w, h] of [[1280, 720], [1024, 600]]) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(B + "/#/", { waitUntil: "networkidle" });
    const row = p.locator(".sidebar .row", { hasText: "Menu test page" }).last();
    await row.scrollIntoViewIfNeeded();
    await row.hover();
    await row.locator("button[title=More]").click();
    const menu = p.locator(".row-menu"); await menu.waitFor();
    await p.waitForTimeout(200); // let the open animation finish
    const fit = await p.evaluate(() => {
      const m = document.querySelector(".row-menu").getBoundingClientRect();
      let clip = { top: 0, bottom: innerHeight };
      for (let a = document.querySelector(".row-menu").parentElement; a && a !== document.body; a = a.parentElement) {
        const cs = getComputedStyle(a); if (cs.overflowY === "visible" && cs.overflowX === "visible") continue;
        const r = a.getBoundingClientRect(); clip = { top: Math.max(clip.top, r.top), bottom: Math.min(clip.bottom, r.bottom) };
      }
      const last = [...document.querySelectorAll(".row-menu button")].pop().getBoundingClientRect();
      const under = document.elementFromPoint(last.left + last.width / 2, last.top + last.height / 2);
      return { m: [Math.round(m.top), Math.round(m.bottom)], clip: [Math.round(clip.top), Math.round(clip.bottom)], lastOnTop: !!under?.closest(".row-menu") };
    });
    check(fit.m[0] >= fit.clip[0] - 1 && fit.m[1] <= fit.clip[1] + 1, `${w}x${h}: the ⋯ menu fits inside the page list (menu ${fit.m}, list ${fit.clip})`);
    check(fit.lastOnTop, `${w}x${h}: its last item (Move to Trash) can be clicked, not covered`);
    await p.keyboard.press("Escape");
    await p.goto(B + "/#/trash", { waitUntil: "networkidle" });
    const [h1, para] = [await p.locator(".hero h1").boundingBox(), await p.locator(".hero p").boundingBox()];
    check(para.y >= h1.y + h1.height - 1, `${w}x${h}: Trash's description sits under its heading`);
    check(!errs.length, `${w}x${h}: no page errors ${errs.join("; ")}`);
    await p.close();
  }
  await b.close();
  console.log(fails ? `${fails} FAILED` : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
