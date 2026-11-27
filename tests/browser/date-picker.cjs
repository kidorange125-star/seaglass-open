// The date picker (DatePicker.tsx) on a task and in a database date cell: Today / Tomorrow / Next week, a month calendar,
// "Add time", "Add a start date" (a task is due on its LAST day; the first is when it starts), Remind, Clear; a task
// over several days isn't overdue until its due day. Phone and iPad sheets in Chromium and WebKit. Mock model, wiped
// database. Screenshots go to the folder given as the first argument (or the temp folder).
const { chromium, webkit } = require("playwright");
const B = process.env.SEAGLASS_URL || "http://localhost:5173", out = process.argv[2] || require("os").tmpdir();
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const j = async (m, p, b) => (await fetch(B + p, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined })).json();
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const dueOf = async (id) => JSON.parse((await j("GET", `/api/notes/${id}`)).props || "{}").due;

(async () => {
  const tdb = (await j("POST", "/api/tasks/ensure", {})).id;
  const plain = await j("POST", "/api/notes", { parent_id: tdb, title: "Essay draft", props: { status: "todo" } });
  const ranged = await j("POST", "/api/notes", { parent_id: tdb, title: "Science project", props: { status: "todo", due: { start: day(-3), end: day(2) } } });
  const late = await j("POST", "/api/notes", { parent_id: tdb, title: "Late lab", props: { status: "todo", due: { start: day(-6), end: day(-1) } } });

  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(() => { localStorage.setItem("sg.agent", "0"); });
  await p.goto(`${B}/#/tasks`, { waitUntil: "networkidle" });
  const row = (t) => p.locator(".task", { hasText: t });

  // a task over several days is due on its last day
  const rangedDue = row("Science project").locator(".task-due");
  check(!/overdue/.test(await rangedDue.getAttribute("class")) && /Due/.test(await rangedDue.innerText()), `a task that started 3 days ago and is due in 2 isn't overdue ("${(await rangedDue.innerText()).trim()}")`);
  check(/overdue/.test(await row("Late lab").locator(".task-due").getAttribute("class")), "one whose due day has passed is overdue");
  const kids = await j("GET", `/api/notes/${tdb}/children`);
  const want = kids.filter((n) => { const q = JSON.parse(n.props || "{}"); const dl = q.due && (q.due.end || q.due.start); return q.status !== "done" && dl && dl <= day(0); }).length;
  const shown = await p.locator(".sidebar .sb-btn", { hasText: "My tasks" }).locator(".sb-count").innerText().catch(() => "0");
  check(Number(shown) === want, `the sidebar counts tasks due by today, by their due day (${shown}, the project not among them)`);

  // the picker on a task with no date
  await row("Essay draft").locator(".task-due").click();
  const dp = p.locator(".when-pop .dp");
  await dp.waitFor();
  check(/Due/.test(await dp.locator(".dp-field").first().innerText()) && /No date/.test(await dp.locator(".dp-field").first().innerText()), "it opens on Due: No date");
  check(await dp.locator("input[type=date]").count() === 0 && await dp.locator("input[type=time]").count() === 0, "no date or time boxes until asked for");
  await dp.locator(".dp-quick button", { hasText: "Tomorrow" }).click(); await p.waitForTimeout(400);
  check((await dueOf(plain.id))?.start === day(1), "Tomorrow saves straight away");
  const target = new Date(); target.setDate(20); if (target.getDate() !== 20 || iso(target) <= day(1)) target.setMonth(target.getMonth() + 1, 20);
  if (iso(target).slice(0, 7) !== day(0).slice(0, 7)) await dp.locator(".dp-month button[aria-label='Next month']").click();
  await dp.locator(".dp-day:not(.out)", { hasText: /^20$/ }).click(); await p.waitForTimeout(400);
  check((await dueOf(plain.id))?.start === iso(target), `a day from the calendar saves (${iso(target)})`);
  await dp.locator(".dp-link", { hasText: "Add time" }).click(); await p.waitForTimeout(400);
  check((await dueOf(plain.id))?.start_time === "09:00", "Add time sets 9:00 AM");
  await dp.locator("input[aria-label=Time]").fill("15:30"); await p.waitForTimeout(400);
  check((await dueOf(plain.id))?.start_time === "15:30", "and the time can be changed");
  await dp.locator(".dp-remind select").selectOption("30"); await p.waitForTimeout(400);
  check((await dueOf(plain.id))?.remind === "30", "Remind 30 min before");
  await dp.locator(".dp-times .dp-link", { hasText: "Remove" }).click(); await p.waitForTimeout(400);
  let d = await dueOf(plain.id);
  check(d && !d.start_time && d.remind === undefined, "Remove drops the time, and a reminder that needs one");
  // a start date: the day already set stays the due day
  await dp.locator(".dp-link", { hasText: "Add a start date" }).click();
  check(/Pick a day/.test(await dp.locator(".dp-field").first().innerText()) && /Due/.test(await dp.locator(".dp-field").nth(1).innerText()), "Add a start date asks for the start and keeps Due");
  await dp.locator(".dp-day:not(.out)", { hasText: /^(1[0-9])$/ }).first().click(); await p.waitForTimeout(400);
  d = await dueOf(plain.id);
  check(d?.end === iso(target) && d.start < d.end, `the start is the earlier day and the due day stays (${d?.start} to ${d?.end})`);
  await p.screenshot({ path: `${out}/dp-desktop.png` });
  check(await p.locator(".when-pop").evaluate((e) => e.getBoundingClientRect().bottom <= innerHeight), "the menu moves up to stay on screen as it grows");
  await dp.locator(".dp-link", { hasText: "No start date" }).click(); await p.waitForTimeout(400);
  d = await dueOf(plain.id);
  check(d?.start === iso(target) && !d.end, "No start date keeps just the due day");
  await dp.locator(".dp-foot button", { hasText: "Clear" }).click(); await p.waitForTimeout(400);
  check(!(await dueOf(plain.id)), "Clear removes the date");
  await p.keyboard.press("Escape"); await p.waitForTimeout(300);

  // the ⋯ menu has no list of days of its own: one row opens the same picker, on the due day
  await row("Science project").locator(".task-more button").click();
  check(await p.locator(".task-menu button", { hasText: /^\s*(Today|Tomorrow|Next week|No date)\s*$/ }).count() === 0, "the ⋯ menu has no separate Today / Tomorrow / Next week list");
  await p.locator(".task-menu button", { hasText: "Change due date" }).click();
  await p.locator(".when-pop .dp").waitFor();
  check(await p.locator(".when-pop .dp-field.on").innerText().then((x) => /Due/.test(x)), "Change due date opens the picker on the due day");
  await p.locator(".when-pop .dp-quick button", { hasText: "Tomorrow" }).click(); await p.waitForTimeout(400);
  d = await dueOf(ranged.id);
  check(d?.start === day(-3) && d.end === day(1), `Tomorrow there moves the due day, not the start (${d?.start} to ${d?.end})`);
  await p.keyboard.press("Escape"); await p.waitForTimeout(300);

  // the same picker in a database date cell (the task's Due in the side peek)
  await row("Late lab").locator(".task-title").click();
  await p.locator(".rp", { hasText: "Due" }).locator(".cell-btn").click();
  const cell = p.locator(".fixed-pop .dp");
  await cell.waitFor();
  check(/Starts/.test(await cell.locator(".dp-field").first().innerText()) && /Due/.test(await cell.locator(".dp-field").nth(1).innerText()), "the side peek's Due uses the same picker, start and due");
  await cell.locator(".dp-quick button", { hasText: "Today" }).click(); await p.waitForTimeout(400);
  d = await dueOf(late.id);
  check(d?.end === day(0) && d.start === day(-6), `picking Today there changes the due day (${d?.start} to ${d?.end})`);
  check(!errs.length, `no page errors ${errs.join(" | ")}`);
  await b.close();

  // phones and iPads: a sheet with big targets, in Chromium and WebKit (Safari)
  for (const [name, engine] of [["chromium", chromium], ["webkit", webkit]]) {
    const br = await engine.launch();
    for (const [w, h] of [[390, 844], [820, 1180]]) {
      const m = await br.newPage({ viewport: { width: w, height: h }, hasTouch: true, isMobile: name === "chromium" });
      await m.addInitScript(() => { localStorage.setItem("sg.agent", "0"); });
      await m.goto(`${B}/#/tasks`, { waitUntil: "networkidle" });
      await m.locator(".task", { hasText: "Science project" }).locator(".task-due").click();
      await m.locator(".when-pop .dp").waitFor(); await m.waitForTimeout(500);
      const fit = await m.locator(".when-pop").evaluate((e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight + 1; });
      const cellH = await m.locator(".dp-day").first().evaluate((e) => e.getBoundingClientRect().height);
      check(fit && cellH >= 44, `${name} ${w}px: the sheet fits and days are ${Math.round(cellH)}px tall`);
      await m.screenshot({ path: `${out}/dp-${name}-${w}.png` });
      await m.close();
    }
    await br.close();
  }
  console.log(fails ? `${fails} failed` : "all good");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
