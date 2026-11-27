// Cron path: a task due a few minutes from now, the scheduled handler run at that time, the notification shown,
// then the Done and Snooze buttons' endpoint.
const { chromium } = require("playwright");
const fs = require("fs"), os = require("os"), path = require("path");
// Needs Google Chrome installed (channel "chrome": Playwright's own Chromium has no push service) and internet
// access to Google's push service. Run against the test server: SEAGLASS_URL=http://localhost:5174 node tests/browser/push.cjs
const B = process.env.SEAGLASS_URL || "http://localhost:5173";
const cron = async (ms) => (await fetch(`${B}/cdn-cgi/handler/scheduled?cron=*+*+*+*+*&time=${ms ?? Date.now()}`)).text(); // local handler passes `time` through as scheduledTime (ms)
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sg-push-"));
  const ctx = await chromium.launchPersistentContext(dir, { channel: "chrome", headless: true, permissions: ["notifications"] });
  await ctx.grantPermissions(["notifications"], { origin: B });
  const p = ctx.pages()[0] ?? await ctx.newPage();
  await p.addInitScript(() => { localStorage.setItem("sg.agent", "0"); });
  await p.goto(B + "/#/", { waitUntil: "networkidle" });
  await p.waitForFunction(() => navigator.serviceWorker.getRegistration("/").then((r) => !!r?.active), null, { timeout: 15000 });
  // Subscribe through the same code the dialog uses.
  await p.evaluate(async () => {
    const { key } = await (await fetch("/api/push")).json();
    const raw = Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/") + "==".slice(0, (4 - key.length % 4) % 4)), (c) => c.charCodeAt(0));
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw });
    const j = sub.toJSON();
    await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: j.endpoint, keys: j.keys, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, label: "e2e" }) });
  });
  const shown = async () => p.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => ({ title: n.title, body: n.body, tag: n.tag, actions: (n.actions || []).map((a) => a.title) })));
  const waitFor = async (pred) => { for (let i = 0; i < 30; i++) { const s = await shown(); if (s.some(pred)) return s; await p.waitForTimeout(500); } return shown(); };

  // A task 3 minutes from now (local time), then run the cron as if it were 3.5 minutes from now.
  const plan = await p.evaluate(async () => {
    const pad = (n) => String(n).padStart(2, "0");
    const at = new Date(Date.now() + 3 * 60_000);
    const day = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`, time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
    const db = (await (await fetch("/api/tasks/ensure", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json()).id;
    const n = await (await fetch("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parent_id: db, title: "Practice piano", props: { status: "todo", due: { start: day, start_time: time }, repeat: "daily" } }) })).json();
    return { id: n.id, day, time, fire: Math.floor((at.getTime() + 30_000) / 1000) };
  });
  console.log("task", plan);
  console.log("cron outcome:", await cron()); // now: too early, nothing
  await p.waitForTimeout(1500);
  console.log("too early:", (await shown()).filter((n) => n.title === "Practice piano").length === 0 ? "nothing (good)" : "SENT EARLY");
  await cron(plan.fire * 1000);
  let s = await waitFor((n) => n.title === "Practice piano");
  console.log("at the time:", JSON.stringify(s.filter((n) => n.title === "Practice piano")));
  await cron(plan.fire * 1000 + 60_000); // again a minute later: must not repeat
  await p.waitForTimeout(1500);
  console.log("after repeat run, piano notifications:", (await shown()).filter((n) => n.title === "Practice piano").length);
  console.log("devices:", await p.evaluate(async () => (await (await fetch("/api/push")).json()).devices.map((d) => d.label + (d.last_error ? " ERR " + d.last_error : ""))));

  // Done (repeating: moves to tomorrow, stays open) via the endpoint the notification button calls.
  const done = await p.evaluate(async ({ id, day }) => (await fetch("/api/push/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action: "done", today: day }) })).json(), plan);
  const after = await p.evaluate(async (id) => JSON.parse((await (await fetch("/api/notes/" + id)).json()).props), plan.id);
  console.log("done:", JSON.stringify(done), "-> props", JSON.stringify(after));
  // Snooze: comes back 10 minutes later.
  await p.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).forEach((x) => x.close()));
  const sn = await p.evaluate(async (id) => (await fetch("/api/push/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action: "snooze" }) })).json(), plan.id);
  await cron(Date.now() + 11 * 60_000);
  s = await waitFor((n) => n.body === "Snoozed reminder");
  console.log("snooze:", JSON.stringify(sn), JSON.stringify(s.filter((n) => n.body === "Snoozed reminder")));
  const bad = await p.evaluate(async () => (await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: "https://evil.example/x", keys: { p256dh: "a".repeat(87), auth: "b".repeat(22) }, tz: "UTC" }) })).status);
  console.log("non-push endpoint refused:", bad);
  await ctx.close(); fs.rmSync(dir, { recursive: true, force: true });
})().catch((e) => { console.error(e); process.exit(1); });
