// Automatic backups (worker backup.ts, BackupDialog.tsx, scripts/restore-backup.mjs): back up, the download keeps pages
// sealed, a real restore into the test database brings a changed page back, keeps the newest 14, and the Settings screen
// (desktop and 390px). Mock model, wiped database, SEAGLASS_STATE set to the test server's state folder (for the restore).
const { chromium } = require("playwright");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const B = process.env.SEAGLASS_URL || "http://localhost:5173", STATE = process.env.SEAGLASS_STATE;
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const j = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (!STATE) { console.log("FAIL set SEAGLASS_STATE to the test server's state folder"); process.exit(1); }
  const page = (await j("POST", "/api/notes", { title: "Backup canary", html: "<p>The mitochondria is the powerhouse of the cell.</p>" })).body;
  // a long page edited a few times: rows (and history snapshots) far over D1's 100 KB statement limit
  const line = (i) => `<p>Line ${i}; it's "quoted", café, ${"ab".repeat(40)}</p>`;
  const longHtml = (v) => Array.from({ length: 1400 }, (_, i) => line(i)).join("") + `<p>Version ${v}</p>`;
  let big = (await j("POST", "/api/notes", { title: "Long notes", html: longHtml(1) })).body;
  for (const v of [2, 3]) big = (await j("PATCH", `/api/notes/${big.id}`, { html: longHtml(v), revision: big.revision })).body;
  const histBefore = (await j("GET", `/api/notes/${big.id}/history`)).body.length;
  const first = await j("POST", "/api/backups");
  check(first.status === 200 && first.body.ok && /note titles opened/.test(first.body.checked || ""), `a backup is made and checked (${first.body.checked || first.body.error})`);
  const listed = (await j("GET", "/api/backups")).body;
  check(listed.status?.ok && listed.backups.length >= 1 && listed.backups[0].name === first.body.name, "it's listed, newest first, with its status");

  const raw = await (await fetch(`${B}/api/backups/${first.body.name}`)).text();
  const dump = JSON.parse(raw);
  check(dump.app === "seaglass" && dump.kind === "backup" && dump.tables.notes.some((n) => n.id === page.id), "the download is the whole database");
  check(!raw.includes("Backup canary") && !raw.includes("powerhouse"), "with the pages still sealed inside it");
  check(!("embeddings" in dump.tables) && !Object.keys(dump.tables).some((t) => /^(d1_|_cf_|sqlite_)/.test(t)), "search vectors and system tables left out");
  check((await fetch(`${B}/api/backups/..%2F..%2Fsecret.sgb`)).status === 404 && (await fetch(`${B}/api/backups/2020-01-01T00-00-00Z.sgb`)).status === 404, "made-up names are a 404");

  // ---- a real restore
  await j("PATCH", `/api/notes/${page.id}`, { title: "Changed after the backup", revision: page.revision });
  const later = (await j("POST", "/api/notes", { title: "Made after the backup" })).body;
  const file = join(mkdtempSync(join(tmpdir(), "sg-backup-")), "backup.json");
  writeFileSync(file, raw);
  let out = "";
  try { out = execFileSync(process.execPath, ["scripts/restore-backup.mjs", file, `--persist-to=${STATE}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String(e.stdout) + String(e.stderr); }
  check(/Restored/.test(out), "the restore script runs");
  const back = (await j("GET", `/api/notes/${page.id}`)).body;
  check(back.title === "Backup canary" && /powerhouse/.test(back.html || ""), `the page is back as it was (${back.title})`);
  const bigBack = (await j("GET", `/api/notes/${big.id}`)).body;
  check(bigBack.html === big.html && bigBack.html.length > 150_000 && /Version 3/.test(bigBack.html), `a long page comes back whole (${bigBack.html?.length} characters)`);
  const hist = (await j("GET", `/api/notes/${big.id}/history`)).body;
  check(Array.isArray(hist) && hist.length === histBefore && histBefore >= 1, `with its history (${hist.length} of ${histBefore} versions)`);
  check((await j("GET", `/api/notes/${later.id}`)).status === 404, "and what came after the backup is gone");
  out = "";
  try { execFileSync(process.execPath, ["scripts/restore-backup.mjs", file, "--remote"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { out = String(e.stderr); }
  check(/--yes/.test(out), "a restore to production needs --yes");

  // ---- keeps the newest 14
  for (let i = 0; i < 14; i++) { await wait(1050); await j("POST", "/api/backups"); }
  const many = (await j("GET", "/api/backups")).body.backups;
  check(many.length === 14 && !many.some((b) => b.name === first.body.name), `keeps the newest 14 (${many.length})`);

  // ---- Settings > Backups
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(() => { localStorage.setItem("sg.agent", "0"); localStorage.setItem("sg.sidebar", "1"); });
  await p.goto(`${B}/?n=${Date.now()}#/`, { waitUntil: "networkidle" });
  await p.locator(".sidebar button", { hasText: "Settings" }).first().click(); await p.waitForTimeout(250);
  await p.locator(".settings-pop button", { hasText: "Backups" }).click();
  await p.waitForSelector(".backup-state");
  check(/checked and fine/.test(await p.locator(".backup-state").innerText()), "the screen says the last backup was checked");
  check(await p.locator(".backup-list li").count() === 14, "and lists them");
  check(/DATA_KEY/.test(await p.locator(".modal.backups").innerText()), "it says to keep the data key safe");
  await wait(1100);
  await p.locator(".modal.backups button", { hasText: "Back up now" }).click();
  await p.locator(".toasts > div", { hasText: /Backed up|Backup failed/ }).waitFor({ timeout: 15000 });
  check(/Backed up and checked/.test(await p.locator(".toasts > div").last().innerText()), "Back up now works");
  const [dl] = await Promise.all([p.waitForEvent("download"), p.locator(".backup-list li button").first().click()]);
  check(/^seaglass-database-.*\.json$/.test(dl.suggestedFilename()), `a backup downloads (${dl.suggestedFilename()})`);
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(300);
  const fits = await p.locator(".modal.backups, .modal.backups button, .backup-list li").evaluateAll((els) => els.every((e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= 390; }));
  check(fits, "it fits on a phone");
  check(!errs.length, `no page errors ${errs.join(" | ")}`);
  await b.close();
  console.log(fails ? `${fails} failed` : "all good");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
