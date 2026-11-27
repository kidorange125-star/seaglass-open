// The routine gallery (ProactiveDialog.tsx STARTERS), and the calendar feed staying gone (removed: The user doesn't want an
// iCloud connector, stream or feed). Mock model, wiped database.
const { chromium } = require("playwright");
const B = process.env.SEAGLASS_URL || "http://localhost:5173";
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };

(async () => {
  check((await fetch(`${B}/api/cal/sgcal_not-a-real-key-at-all-1234.ics`)).status !== 200 && (await fetch(`${B}/api/calendar`)).status === 404, "there is no calendar feed");
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(() => { localStorage.setItem("sg.agent", "0"); localStorage.setItem("sg.sidebar", "1"); });
  await p.goto(`${B}/?n=${Date.now()}#/`, { waitUntil: "networkidle" });
  const settings = async (item) => { await p.locator(".sidebar button", { hasText: "Settings" }).first().click(); await p.waitForTimeout(250); await p.locator(".settings-pop button", { hasText: item }).click(); };
  await p.locator(".sidebar button", { hasText: "Settings" }).first().click(); await p.waitForTimeout(250);
  check(await p.locator(".settings-pop button", { hasText: "Calendar feed" }).count() === 0, "and nothing in Settings for it");
  await p.keyboard.press("Escape"); await p.waitForTimeout(200);

  await settings("Routines & saved prompts");
  await p.waitForSelector(".modal.proactive");
  const starters = p.locator(".pd-starter");
  await starters.first().waitFor();
  check(await starters.count() === 6, `six starters to pick from (${await starters.count()})`);
  await starters.filter({ hasText: "Morning brief" }).click();
  check((await p.locator(".pd-form input").first().inputValue()) === "Morning brief" && (await p.locator(".pd-form input[type=time]").inputValue()) === "07:00" && /morning brief/.test(await p.locator(".pd-form textarea").inputValue()), "a starter fills the form, ready to tweak");
  check(await p.locator(".pd-gallery").count() === 0, "and the gallery steps aside while editing");
  await p.locator(".pd-form button", { hasText: "Save routine" }).click(); await p.waitForTimeout(500);
  check(/Morning brief/.test(await p.locator(".pd-item").first().innerText()) && /Weekdays/.test(await p.locator(".pd-item").first().innerText()), "saved as a routine on weekdays");
  check(await starters.count() === 5 && !(await starters.filter({ hasText: "Morning brief" }).count()), "and it's no longer offered");
  check(!errs.length, `no page errors ${errs.join(" | ")}`);
  await b.close();
  console.log(fails ? `${fails} failed` : "all good");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
