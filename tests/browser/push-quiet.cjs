// Quiet hours (worker push.ts / reminders.ts quietNow): during them only High or Urgent priority tasks buzz; the rest are held
// and arrive as one "While quiet hours were on" notification once they end. Needs Google Chrome (Playwright's Chromium has no
// push service) and internet access to Google's push service, like push.cjs. SEAGLASS_URL=http://localhost:5174 node tests/browser/push-quiet.cjs
const { chromium } = require("playwright");
const fs = require("fs"), os = require("os"), path = require("path");
const B = process.env.SEAGLASS_URL || "http://localhost:5173";
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const cron = async (ms) => (await fetch(`${B}/cdn-cgi/handler/scheduled?cron=*+*+*+*+*&time=${ms ?? Date.now()}`)).text();
const prefs = async (b) => (await fetch(`${B}/api/push/prefs`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })).json();

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sg-quiet-"));
  const ctx = await chromium.launchPersistentContext(dir, { channel: "chrome", headless: true, permissions: ["notifications"] });
  await ctx.grantPermissions(["notifications"], { origin: B });
  const p = ctx.pages()[0] ?? await ctx.newPage();
  await p.addInitScript(() => { localStorage.setItem("sg.agent", "0"); });
  await p.goto(B + "/#/", { waitUntil: "networkidle" });
  await p.waitForFunction(() => navigator.serviceWorker.getRegistration("/").then((r) => !!r?.active), null, { timeout: 15000 });
  await p.evaluate(async () => {
    const { key } = await (await fetch("/api/push")).json();
    const raw = Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/") + "==".slice(0, (4 - key.length % 4) % 4)), (c) => c.charCodeAt(0));
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw });
    const j = sub.toJSON();
    await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: j.endpoint, keys: j.keys, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, label: "quiet e2e" }) });
  });
  const shown = async () => p.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => ({ title: n.title, body: n.body })));
  // up to 30 s: a new subscription's first push can take a while
  const waitFor = async (pred) => { for (let i = 0; i < 60; i++) { const s = await shown(); if (s.some(pred)) return s; await p.waitForTimeout(500); } return shown(); };

  // two tasks 3 minutes from now: one High priority, one not
  const plan = await p.evaluate(async () => {
    const pad = (n) => String(n).padStart(2, "0");
    const at = new Date(Date.now() + 3 * 60_000);
    const day = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`, time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
    const db = (await (await fetch("/api/tasks/ensure", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json()).id;
    const mk = async (title, priority) => (await (await fetch("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parent_id: db, title, props: { status: "todo", due: { start: day, start_time: time }, ...(priority ? { priority } : {}) } }) })).json()).id;
    const lo = new Date(at.getTime() - 90 * 60_000), hi = new Date(at.getTime() + 90 * 60_000);
    const sameDay = lo.getDate() === at.getDate() && hi.getDate() === at.getDate();
    return { urgent: await mk("Hand in the lab report", "high"), plain: await mk("Water the plants"), fire: at.getTime() + 30_000, sameDay,
      quiet: `0123456@${pad(lo.getHours())}:${pad(lo.getMinutes())}-${pad(hi.getHours())}:${pad(hi.getMinutes())}` };
  });
  if (!plan.sameDay) { console.log("skipped: too close to midnight for a same-day quiet window"); await ctx.close(); process.exit(0); }
  const set = await prefs({ quiet: plan.quiet });
  check(set.quiet === plan.quiet, `quiet hours saved (${set.quiet})`);
  check((await fetch(`${B}/api/push/prefs`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quiet: "12345@15:00-08:00" }) })).status === 400, "an end before the start is refused");

  await cron(plan.fire);
  const s = await waitFor((n) => n.title === "Hand in the lab report");
  await p.waitForTimeout(1500);
  const now = await shown();
  check(s.some((n) => n.title === "Hand in the lab report"), "a High priority task still comes through");
  check(!now.some((n) => n.title === "Water the plants"), "an ordinary one is held during quiet hours");
  await cron(plan.fire + 60_000);
  await p.waitForTimeout(1500);
  check(!(await shown()).some((n) => /While quiet hours were on/.test(n.title)), "nothing more while it's still quiet");

  await prefs({ quiet: "" }); // quiet hours over
  await cron(plan.fire + 2 * 60_000);
  const after = await waitFor((n) => /While quiet hours were on/.test(n.title));
  const catchUp = after.find((n) => /While quiet hours were on/.test(n.title));
  check(!!catchUp && /1 notification/.test(catchUp.title) && /Water the plants/.test(catchUp.body), `when they end, what was held arrives in one notification (${JSON.stringify(catchUp)})`);
  await cron(plan.fire + 3 * 60_000);
  await p.waitForTimeout(1500);
  check((await shown()).filter((n) => /While quiet hours were on/.test(n.title)).length === 1, "and only once");

  await p.evaluate(async () => { const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription(); if (sub) { await fetch("/api/push/unsubscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }); await sub.unsubscribe(); } });
  await ctx.close();
  console.log(fails ? `${fails} failed` : "all good");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
