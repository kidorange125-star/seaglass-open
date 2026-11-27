// Waffle's header moods follow what the assistant is doing: think, then "on a job" (comets) for every tool call or
// web search, held long enough to see even when the tool finishes in milliseconds, then idle. Needs the mock model.
const { chromium } = require("playwright");
const B = process.env.SEAGLASS_URL || "http://localhost:5173";
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };

(async () => {
  await fetch(B + "/api/persona", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ persona: "waffle" }) });
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(() => { localStorage.setItem("sg.persona", "waffle"); localStorage.removeItem("sg.waffle.force"); });
  await p.goto(B + "/?assistant=1#/", { waitUntil: "networkidle" });
  await p.waitForSelector(".agent .ag-box textarea");

  // Sample the header face's mood every 40ms while a message runs.
  const run = async (msg) => {
    await p.fill(".ag-box textarea", msg);
    await p.evaluate(() => {
      window.__moods = []; const t0 = performance.now();
      window.__timer = setInterval(() => {
        const w = document.querySelector(".ag-head-jeff .waffle");
        const m = w ? (w.className.baseVal ?? w.className).match(/waffle-(idle|think|tool)/)?.[1] : "none";
        const last = window.__moods[window.__moods.length - 1];
        if (!last || last.m !== m) window.__moods.push({ m, at: Math.round(performance.now() - t0) });
      }, 40);
    });
    await p.keyboard.press("Enter");
    await p.waitForFunction(() => !document.querySelector(".tx-typing") && !document.querySelector(".ag-stop"), null, { timeout: 15000 }).catch(() => {});
    await p.waitForTimeout(2600);
    const moods = await p.evaluate(() => { clearInterval(window.__timer); return window.__moods; });
    const tl = moods.map((x, i) => ({ ...x, for: (moods[i + 1]?.at ?? Infinity) - x.at }));
    console.log(`  ${msg}:`, tl.map((x) => `${x.m}@${x.at}`).join(" → "));
    return tl;
  };

  await run("hello"); // the header face appears once the conversation has a message
  let tl = await run("mock:create Mitosis notes");
  const tool = tl.find((x) => x.m === "tool");
  check(!!tool, "a tool call shows the tool animation");
  check(tool && tool.for >= 1500, `it stays long enough to see (${tool?.for}ms)`);
  check(tl[tl.length - 1].m === "idle", "back to idle when the reply is done");

  tl = await run("mock:web ducks");
  check(tl.some((x) => x.m === "tool"), "a web search shows the tool animation too");

  tl = await run("hello again");
  check(!tl.some((x) => x.m === "tool"), "a plain reply never shows it");

  check(!errs.length, `no page errors ${errs.length ? errs.join("; ") : ""}`);
  await b.close();
  console.log(fails ? `${fails} FAILED` : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
