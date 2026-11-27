// The chat's message field sizes to its text without jumping: typing letter by letter switches to the two-row layout
// (text full width, buttons underneath) exactly once and back exactly once when deleting, every line stays visible,
// and text put in from elsewhere (a prefill) grows the field too. Desktop window and phone.
const { chromium, devices } = require("playwright");
const B = process.env.SEAGLASS_URL || "http://localhost:5173";
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const text = "Quiz me on osmosis and diffusion and active transport and make it hard please with ten questions";

(async () => {
  const b = await chromium.launch();
  for (const [dev, opts] of [["desktop", { viewport: { width: 1280, height: 860 } }], ["phone", { ...devices["iPhone 14"] }]]) {
    const ctx = await b.newContext(opts); const p = await ctx.newPage();
    await p.goto(B + "/?assistant=1#/", { waitUntil: "networkidle" });
    const ta = p.locator(".ag-box textarea"); await ta.click();
    const state = () => p.evaluate(() => { const t = document.querySelector(".ag-box textarea"); return { multi: t.parentElement.classList.contains("multi"), h: t.getBoundingClientRect().height, sh: t.scrollHeight }; });
    const flips = (xs) => xs.reduce((n, x, i) => n + (i && x.multi !== xs[i - 1].multi ? 1 : 0), 0);
    const up = [], down = [];
    for (const ch of text) { await p.keyboard.type(ch); up.push(await state()); }
    for (let i = 0; i < text.length; i++) { await p.keyboard.press("Backspace"); down.push(await state()); }
    check(flips(up) === 1, `${dev}: typing switches to two rows once (${flips(up)} switches)`);
    check(flips(down) === 1, `${dev}: deleting switches back once (${flips(down)} switches)`);
    check([...up, ...down].every((x) => x.sh <= x.h + 1), `${dev}: no line is ever hidden`);
    await p.evaluate((t) => dispatchEvent(new CustomEvent("seaglass:agent-prefill", { detail: t + ", in three short paragraphs please" })), text);
    await p.waitForTimeout(250);
    const s = await state();
    check(s.multi && s.sh <= s.h + 1 && s.h > 60, `${dev}: a prefill grows the field (${Math.round(s.h)}px)`);
    await ctx.close();
  }
  await b.close();
  console.log(fails ? `${fails} FAILED` : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
