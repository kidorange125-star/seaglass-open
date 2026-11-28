// Importing from other apps (client/import/, worker/importer.ts, ImportDialog.tsx): exports in each app's shape, built by
// import-fixtures.py, imported through Settings > Import from other apps, then checked through the API: titles, nesting,
// links between pages, pictures and files uploaded, checklists, databases from CSV, dates kept, nothing lost or doubled.
// Plus the endpoint's limits, Undo, and the dialog at 390px. Mock model, wiped database, AUTH_OPEN=1.
const { chromium } = require("playwright");
const { execFileSync } = require("node:child_process");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const B = process.env.SEAGLASS_URL || "http://localhost:5173";
let fails = 0;
const check = (ok, what, extra) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}${ok || extra === undefined ? "" : `  ${JSON.stringify(extra).slice(0, 300)}`}`); if (!ok) fails++; };
const j = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const tree = async () => (await j("GET", "/api/tree")).body;
const note = async (id) => (await j("GET", `/api/notes/${id}`)).body;
const kidsOf = (t, id) => t.filter((n) => n.parent_id === id).sort((a, b) => a.position - b.position);
const named = (t, parent, title) => t.find((n) => n.parent_id === parent && n.title === title);

(async () => {
  const dir = mkdtempSync(join(tmpdir(), "sg-import-"));
  execFileSync(process.platform === "win32" ? "python" : "python3", [join(__dirname, "import-fixtures.py"), dir], { stdio: "inherit" });
  const f = (n) => join(dir, n);

  // ---- the endpoint itself
  const ids = Array.from({ length: 26 }, () => crypto.randomUUID());
  check((await j("POST", "/api/import/pages", { pages: ids.map((id) => ({ id, parent_id: null, title: "x" })) })).status === 400, "more than 25 pages in one request is refused");
  const root0 = crypto.randomUUID(), lost = crypto.randomUUID(), kid = crypto.randomUUID();
  const r0 = await j("POST", "/api/import/pages", { root: root0, pages: [
    { id: root0, parent_id: null, title: "Endpoint root" },
    { id: kid, parent_id: lost, title: "Orphan", html: "<p>hi</p><script>alert(1)</script>", created_at: 1_500_000_000_000 },
    { id: "not-a-uuid", parent_id: null, title: "Bad" },
    { id: root0, parent_id: null, title: "Twice" },
  ] });
  check(r0.status === 200 && r0.body.made === 2 && r0.body.failed.length === 2, "pages are made; bad and repeated ids are refused", r0.body);
  const orphan = await note(kid);
  check(orphan.parent_id === root0 && !/script/.test(orphan.html) && orphan.created_at === 1_500_000_000_000, "a page whose parent is missing goes in the import's page, sanitized, with its own date", orphan);
  check((await j("GET", `/api/notes/${kid}/history`)).body.length >= 1, "and it's in version history");
  const hugeId = crypto.randomUUID();
  const big = await j("POST", "/api/import/pages", { root: root0, pages: [{ id: hugeId, parent_id: root0, title: "Huge", html: Array.from({ length: 2000 }, () => `<p>${"字".repeat(120)}</p>`).join("") }] });
  const huge = await note(hugeId);
  check(big.body.made === 1 && big.body.cut.includes("Huge") && /too long to import/.test(huge.html) && new Blob([huge.html]).size <= 600_000, "a page too big in bytes (240,000 characters, 720 KB) is kept in part and said so", [big.body, new Blob([huge.html || ""]).size]);
  await j("DELETE", `/api/notes/${root0}`);

  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto(`${B}/?n=${Date.now()}`, { waitUntil: "networkidle" });

  const run = async (app, files, { folder = false } = {}) => {
    await p.locator(".sb-btn", { hasText: "Settings" }).click();
    await p.getByRole("button", { name: "Import from other apps" }).click();
    await p.getByRole("radio", { name: app, exact: true }).click();
    await p.locator(folder ? 'input[aria-label="Export folder"]' : 'input[aria-label="Export file"]').setInputFiles(files);
    await p.getByRole("button", { name: "Import", exact: true }).click({ timeout: 20_000 });
    await p.locator(".imp-state", { hasText: "Imported" }).waitFor({ timeout: 60_000 });
    const text = await p.locator(".modal.importer").innerText();
    const t = await tree();
    const root = t.filter((n) => n.parent_id === null && n.title.startsWith(`Imported from ${app}`)).pop();
    await p.keyboard.press("Escape");
    return { text, t, root };
  };

  // ---- Obsidian
  {
    const { text, t, root } = await run("Obsidian", [f("vault.zip")]);
    check(!!root && /My Vault/.test(root.title), "Obsidian: one page holds the vault, named after it", root?.title);
    const home = named(t, root.id, "Home"), proj = named(t, root.id, "Projects");
    const plan = proj && named(t, proj.id, "Plan");
    check(home && proj && plan && kidsOf(t, root.id).length === 2, "notes and folders keep their places; the folder's own note is the folder's page", kidsOf(t, root.id).map((n) => n.title));
    const h = await note(home.id);
    check(new RegExp(`data-type="mention"[^>]*data-id="${plan.id}"`).test(h.html) && />the plan</.test(h.html), "[[links]] become mentions of the imported page, with their words", h.html.slice(0, 400));
    check(/Missing page/.test(h.html) && !/data-imp/.test(h.html), "a link to a page that isn't there stays as words");
    check(/<img[^>]*src="\/files\//.test(h.html), "![[pictures]] are uploaded");
    check(/<mark>Remember this<\/mark>/.test(h.html), "==highlights== are kept");
    check(/data-type="taskList"/.test(h.html) && /data-checked="true"[\s\S]*call mum/.test(h.html) && /data-checked="false"[\s\S]*buy paper/.test(h.html), "checklists become task lists, ticks kept");
    check(/\[\[inside code\]\]/.test(h.html) && /\[\[not a link\]\]/.test(h.html), "code is left alone");
    check(/tags:<\/strong> school, ideas/.test(h.html) && !/<h1>Home/.test(h.html), "front matter shows at the top; the title heading isn't repeated");
    check(new Date(h.created_at).toISOString().startsWith("2024-03-05"), "the note keeps its created date", h.created_at);
    const pl = await note(plan.id);
    check(new RegExp(`data-id="${home.id}"`).test(pl.html) && /data-type="file"[^>]*data-mime="application\/pdf"/.test(pl.html), "links back, and a PDF embed becomes a file block", pl.html);
    const r = await note(root.id);
    check(/Files/.test(r.html) && /<img[^>]*src="\/files\//.test(r.html), "an attachment no note shows still comes along", r.html);
    check(/Imported 3 pages and 3 files/.test(text), "the dialog says what came in", text);
  }

  // ---- Notion
  {
    const { t, root } = await run("Notion", [f("notion.zip")]);
    check(!!root && !/Export-/.test(root.title), "Notion: a zip of zips (Zip64 inside) is read; the export's folder name isn't the title", root?.title);
    const trip = named(t, root.id, "Trip");
    const day = trip && named(t, trip.id, "Day 1"), tasks = trip && named(t, trip.id, "Tasks");
    check(trip && day && tasks && tasks.kind === "database", "ids are dropped from names; sub-pages and the database sit inside their page", trip && kidsOf(t, trip.id).map((n) => n.title));
    const tr = await note(trip.id);
    check(new RegExp(`data-id="${day.id}"`).test(tr.html) && new RegExp(`data-id="${tasks.id}"`).test(tr.html) && /<img[^>]*src="\/files\//.test(tr.html) && !/<h1>Trip/.test(tr.html), "links to sub-pages and the table become mentions; the picture is uploaded", tr.html);
    const db = await note(tasks.id);
    const schema = JSON.parse(db.db_schema);
    const prop = (n) => schema.properties.find((x) => x.name === n);
    check(prop("Status")?.type === "select" && prop("Due")?.type === "date" && prop("Done")?.type === "checkbox", "the CSV's columns become properties of the right types", schema.properties.map((x) => `${x.name}:${x.type}`));
    const rows = kidsOf(t, tasks.id);
    check(rows.map((n) => n.title).join("|") === "Buy tickets|Pack bags and snacks for the whole trip|Book hotel", "every row once, in the CSV's order (the _all file)", rows.map((n) => n.title));
    const r1 = await note(rows[0].id), r2 = await note(rows[1].id);
    const props1 = JSON.parse(r1.props);
    check(/Train at 9/.test(r1.html) && props1[prop("Due").id]?.start === "2026-11-10" && props1[prop("Done").id] === true, "a row keeps its own page and its values", props1);
    check(/charger/.test(r2.html), "a row whose file name Notion shortened still finds its page", r2.html);
  }

  // ---- Google Keep
  {
    const { text, t, root } = await run("Google Keep", [f("takeout.zip")]);
    const shop = named(t, root.id, "Shopping"), idea = named(t, root.id, "Paint the shed green"), arch = named(t, root.id, "Archived");
    check(shop && idea && arch && named(t, arch.id, "Old idea") && !t.some((n) => n.title === "Binned"), "Keep: notes, archived ones apart, trashed ones left out", kidsOf(t, root.id).map((n) => n.title));
    const s = await note(shop.id);
    check(/data-checked="false"[\s\S]*Milk/.test(s.html) && /data-checked="true"[\s\S]*Eggs/.test(s.html) && /Labels:<\/strong> Home/.test(s.html), "checklists and labels", s.html);
    check(s.created_at === 1_600_000_000_000 && s.updated_at === 1_600_000_500_000, "Keep's dates are kept", [s.created_at, s.updated_at]);
    const i = await note(idea.id);
    check(/<img[^>]*src="\/files\//.test(i.html) && /href="https:\/\/example.com\/paint"/.test(i.html), "a picture saved as .jpeg though listed as .jpg is found; links kept", i.html);
    check(/couldn.t come along/.test(text), "the dialog says the trashed note was left out");
  }

  // ---- Evernote
  {
    const { t, root } = await run("Evernote", [f("Recipes.enex"), f("Work.enex")]);
    const rec = named(t, root.id, "Recipes"), work = named(t, root.id, "Work");
    check(rec && work && named(t, rec.id, "Pancakes") && named(t, work.id, "Standup"), "Evernote: each notebook is a page with its notes", kidsOf(t, root.id).map((n) => n.title));
    const pc = await note(named(t, rec.id, "Pancakes").id);
    check(/data-checked="true"[\s\S]*flour.first/.test(pc.html) && /data-checked="false"[\s\S]*eggs second/.test(pc.html), "checkboxes keep the words after them", pc.html);
    check(/<img[^>]*src="\/files\//.test(pc.html) && /Mix well after/.test(pc.html), "a picture is found by its MD5, and what follows it isn't lost");
    check(/data-type="file"[^>]*recipe\.pdf/.test(pc.html) && /Tags:<\/strong> breakfast, easy/.test(pc.html), "files and tags");
    check(new Date(pc.created_at).toISOString() === "2023-01-02T03:04:05.000Z", "Evernote's dates are kept", pc.created_at);
  }

  // ---- Apple Notes
  {
    const { t, root } = await run("Apple Notes", [f("icloud-notes.zip")]);
    const notes = named(t, root.id, "Notes"), recipes = named(t, root.id, "Recipes");
    check(/iCloud Notes/.test(root.title) && notes && recipes && named(t, notes.id, "Groceries") && named(t, recipes.id, "Soup"), "Apple Notes: folders become pages holding their notes", kidsOf(t, root.id).map((n) => n.title));
    const g = await note(named(t, notes.id, "Groceries").id);
    check(/Apples<br ?\/?>Pears/.test(g.html) && !/Groceries/.test(g.html) && /href="https:\/\/example.com\/list"/.test(g.html), "text keeps its lines and links, without repeating the title", g.html);
    const ph = await note(named(t, recipes.id, "Photo note").id);
    check(/<img[^>]*src="\/files\//.test(ph.html) && !/data:image/.test(ph.html) && !/<h1>/.test(ph.html), "a picture written into an HTML note becomes an uploaded file", ph.html.slice(0, 300));
  }

  // ---- 61 notes: several requests; a long page in Chinese is cut by bytes, the rest all arrive
  {
    const { text, t, root } = await run("Markdown", [f("big-vault.zip")]);
    const kids = kidsOf(t, root.id);
    const long = kids.find((n) => n.title === "Long");
    const ln = long && await note(long.id);
    check(kids.length === 61 && /Imported 61 pages/.test(text), "61 notes arrive over several requests", [kids.length, text.slice(0, 120)]);
    check(ln && /too long to import/.test(ln.html) && /这是一个很长的段落/.test(ln.html) && /1 thing couldn.t come along/.test(text), "a long page in Chinese is cut by its size in bytes, and the dialog says so", text.slice(-200));
    const n5 = await note(named(t, root.id, "Note 05").id);
    check(new RegExp(`data-id="${named(t, root.id, "Note 06").id}"`).test(n5.html), "links between notes in different requests still point at each other");
  }

  // ---- loose Markdown files, then Undo
  {
    await p.locator(".sb-btn", { hasText: "Settings" }).click();
    await p.getByRole("button", { name: "Import from other apps" }).click();
    await p.getByRole("radio", { name: "Markdown", exact: true }).click();
    await p.locator('input[aria-label="Export file"]').setInputFiles([f("loose-one.md"), f("loose-two.md")]);
    await p.getByRole("button", { name: "Import", exact: true }).click();
    await p.locator(".imp-state", { hasText: "Imported" }).waitFor({ timeout: 30_000 });
    const t = await tree();
    const root = t.filter((n) => n.parent_id === null && n.title.startsWith("Imported from Markdown")).pop();
    const one = named(t, root.id, "Loose one") || named(t, root.id, "loose-one"), two = named(t, root.id, "loose-two");
    const tw = two && await note(two.id), on = one && await note(one.id);
    check(one && two && new RegExp(`data-id="${one.id}"`).test(tw.html) && /<table/.test(on.html) && /<strong>bold<\/strong>/.test(on.html), "Markdown: loose files, a [[link]] by file name, tables and bold", [one?.title, tw?.html]);
    await p.getByRole("button", { name: "Undo import" }).click();
    await p.waitForTimeout(800);
    check(!(await tree()).some((n) => n.id === root.id) && (await j("GET", `/api/notes/${root.id}?deleted=1`)).body.deleted_at, "Undo import puts the whole import in the trash");
  }

  // ---- at 390px
  await p.setViewportSize({ width: 390, height: 844 });
  await p.reload({ waitUntil: "networkidle" });
  await p.locator(".tab-bar, .sb-btn").first().waitFor().catch(() => {});
  await p.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  const openOnPhone = async () => {
    const menu = p.getByRole("button", { name: "Open sidebar" });
    if (await menu.isVisible().catch(() => false)) await menu.click();
    await p.locator(".sb-btn", { hasText: "Settings" }).click();
    await p.getByRole("button", { name: "Import from other apps" }).click();
  };
  await openOnPhone().catch((e) => check(false, "the dialog opens on a phone", String(e)));
  await p.waitForTimeout(1000); // the dialog fades in
  const m = await p.locator(".modal.importer").boundingBox().catch(() => null);
  const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check(m && m.width <= 390 && over <= 0, "at 390px it fills the screen, nothing wider than it", { m, over });
  const fonts = await p.$$eval(".imp-apps button", (bs) => bs.map((x) => parseFloat(getComputedStyle(x).fontSize)));
  check(fonts.every((s) => s >= 15) && fonts.length === 6, "big enough to tap", fonts);
  await p.screenshot({ path: join(dir, "import-phone.png") });
  console.log(`screenshot: ${join(dir, "import-phone.png")}`);

  check(!errors.length, "no page errors", errors);
  await b.close();
  console.log(fails ? `${fails} failed` : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
