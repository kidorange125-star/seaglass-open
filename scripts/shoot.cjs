// Screenshot the local app (npm run dev must be running). Needs Playwright: npm i --no-save playwright
//   node scripts/shoot.cjs <name> [hash] [width] [height] [light|dark]
//   node scripts/shoot.cjs page "#/p/<id>" 1440 900 dark
// Saves to shots/<name>.png. In Git Bash set MSYS_NO_PATHCONV=1 first, or it rewrites "#/p/..." as a path.
const path = require("path");
const { chromium } = require("playwright");
(async () => {
  const [name = "shot", hash = "#/", w = "1440", h = "900", theme = "light"] = process.argv.slice(2);
  const browser = await chromium.launch();
  const phone = +w < 600;
  const page = await (await browser.newContext({ viewport: { width: +w, height: +h }, colorScheme: theme, hasTouch: phone, isMobile: phone })).newPage();
  await page.addInitScript((t) => localStorage.setItem("sg.theme", t), theme);
  await page.goto("http://localhost:5173/" + hash, { waitUntil: "networkidle" });
  await page.waitForTimeout(+(process.env.SHOOT_WAIT ?? 700));
  const out = path.join(__dirname, "..", "shots", `${name}.png`);
  await page.screenshot({ path: out });
  await browser.close();
  console.log(out);
})().catch((e) => { console.error(e); process.exit(1); });
