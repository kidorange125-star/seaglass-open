// Breaking an assignment into steps (#20, TaskSteps.tsx, worker steps.ts) and the weekly tidy-up (#25, worker tidy.ts). Mock
// model, wiped database, SEAGLASS_STATE set (dates are moved back with wrangler).
const { execSync } = require("child_process");
const path = require("path");
const { chromium } = require("playwright");
const B = process.env.SEAGLASS_URL || "http://localhost:5173", STATE = process.env.SEAGLASS_STATE;
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const j = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const sql = (q) => execSync(`npx wrangler d1 execute seaglass --local --persist-to "${STATE}" --command "${q}"`, { cwd: path.join(__dirname, "..", ".."), stdio: "ignore" });
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

(async () => {
  if (!STATE) { console.log("FAIL set SEAGLASS_STATE"); process.exit(1); }
  // ---- steps
  const tasks = (await j("POST", "/api/tasks/ensure", {})).body.id;
  const essay = (await j("POST", "/api/notes", { parent_id: tasks, title: "History essay", html: "<p>2000 words on the causes of WW1.</p>", props: { status: "todo", due: { start: day(5) } } })).body;
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(() => { localStorage.setItem("sg.agent", "0"); });
  await p.goto(`${B}/?n=${Date.now()}#/p/${essay.id}`, { waitUntil: "networkidle" });
  const panel = p.locator(".tsteps");
  await panel.locator("button", { hasText: "Break into steps" }).click();
  await panel.locator(".tsteps-draft li").first().waitFor();
  let rows = await panel.locator(".tsteps-draft li").allInnerTexts();
  check(rows.length === 4 && rows.some((r) => /No date/.test(r) && /After the due date/.test(r)), `a draft of 4 steps; a date past the due date is dropped (${rows.length})`);
  await panel.locator(".tsteps-draft li", { hasText: "After the due date" }).locator(".st-act").click();
  await panel.locator(".tsteps-actions .primary", { hasText: "Add 3 steps" }).click();
  await panel.locator(".tsteps-list li").first().waitFor();
  let steps = (await j("GET", `/api/tasks/${essay.id}/steps`)).body.steps;
  check(steps.length === 3 && steps[0].due === day(0) && steps[2].due === day(5), `3 steps added as tasks with their dates, in order (${steps.map((s) => s.due).join(", ")})`);
  const tdb = (await j("GET", `/api/notes/${tasks}`)).body;
  const partOf = JSON.parse(tdb.db_schema).properties.find((x) => x.id === "part_of");
  check(partOf && partOf.type === "relation" && partOf.relation.database_id === tasks, "My tasks gets a Part of relation to link them");
  const first = (await j("GET", `/api/notes/${steps[0].id}`)).body;
  const fp = JSON.parse(first.props);
  check(fp.part_of?.[0] === essay.id && fp.due?.start_time === "16:00", "each step points at the essay, and keeps its time for a reminder");
  check(/3 of 3 left/.test(await panel.innerText()), "the essay shows its steps");
  await panel.locator(".tsteps-list li").first().locator("input").click(); await p.waitForTimeout(900); // it ticks once saved
  check(/2 of 3 left/.test(await panel.innerText()) && JSON.parse((await j("GET", `/api/notes/${steps[0].id}`)).body.props).status === "done", "ticking a step finishes that task");
  // undo the whole thing from the toast
  await panel.locator(".tsteps-actions button", { hasText: "Add more steps" }).click();
  await panel.locator(".tsteps-draft li").first().waitFor();
  await panel.locator(".tsteps-actions .primary").click(); await p.waitForTimeout(600);
  check((await j("GET", `/api/tasks/${essay.id}/steps`)).body.steps.length === 7, "more steps can be added");
  await p.locator("button", { hasText: /^Undo$/ }).last().click(); await p.waitForTimeout(800); // the newest toast
  const after = (await j("GET", `/api/tasks/${essay.id}/steps`)).body.steps.length;
  check(after === 3, `Undo takes the last batch back off (${after} left)`);
  check(!errs.length, `no page errors ${errs.join(" | ")}`);

  // ---- tidy-up
  const empty = (await j("POST", "/api/notes", { title: "", html: "" })).body;
  const bio = (await j("POST", "/api/notes", { title: "Bio notes", html: "<p>Cells are the unit of life.</p>" })).body;
  const copy = (await j("POST", "/api/notes", { title: "Bio notes", html: "<p>Cells are the unit of life.</p>" })).body;
  const school = (await j("POST", "/api/notes", { title: "School", html: "<p>Classes</p>" })).body;
  await j("POST", "/api/notes", { title: "Maths", parent_id: school.id, html: "<p>Algebra</p>" });
  const chem = (await j("POST", "/api/notes", { title: "Chemistry homework", html: "<p>Balance the equations.</p>" })).body;
  const back = Date.now() - 5 * 864e5;
  sql(`UPDATE notes SET updated_at = ${back}, created_at = ${back} WHERE id IN ('${empty.id}', '${chem.id}', '${bio.id}', '${school.id}', '${essay.id}')`);
  sql(`UPDATE notes SET created_at = ${back + 1000} WHERE id = '${copy.id}'`);
  check((await j("POST", "/api/tidy")).body.proposed === 1, "Tidy up now proposes a cleanup");
  const item = (await j("GET", "/api/inbox")).body.items.find((x) => x.action?.proposal?.type === "tidy");
  const pr = item?.action?.proposal;
  check(pr && pr.trash.some((x) => x.id === empty.id && x.why === "empty") && pr.trash.some((x) => x.id === copy.id) && !pr.trash.some((x) => x.id === bio.id), "it finds the empty page and the copy, and keeps the original");
  check(pr && pr.moves.some((m) => m.id === chem.id && m.to === school.id), "and suggests filing the loose note into a folder");
  check(/Weekly tidy-up/.test(item?.title ?? "") && /Nothing changes unless you accept/.test(item?.body ?? ""), "the message says what it would do and that nothing changes until the user accepts");
  // in the conversation, with a button
  await p.goto(`${B}/?assistant=1&n=${Date.now()}#/`, { waitUntil: "networkidle" });
  const btn = p.locator("button", { hasText: /^Tidy up \(\d+ changes?\)$/ });
  await btn.first().waitFor({ timeout: 10000 }).catch(() => {});
  check(await btn.count() >= 1, "the conversation has a Tidy up button");
  const acc = (await j("POST", `/api/inbox/${item.id}`, { action: "accept", today: day(0) })).body;
  check(acc.ok && acc.run_id, "accepting applies it");
  const gone = async (id) => { const r = await j("GET", `/api/notes/${id}`); return r.status === 404 || !!r.body.deleted_at; };
  check(await gone(empty.id) && await gone(copy.id) && !(await gone(bio.id)) && (await j("GET", `/api/notes/${chem.id}`)).body.parent_id === school.id, "the empty page and the copy go to the trash, the loose note into School");
  await j("POST", `/api/runs/${acc.run_id}/undo`, { force: true });
  check(!(await gone(empty.id)) && !(await gone(copy.id)) && !(await j("GET", `/api/notes/${chem.id}`)).body.parent_id, "Undo puts everything back");
  check((await j("POST", "/api/tidy")).body.proposed === 1, "and it would offer it again");
  await b.close();
  console.log(fails ? `${fails} failed` : "all good");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
