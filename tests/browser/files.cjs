// PDFs and files in pages (#17: editor/nodes.tsx FileBlock, worker files.ts, read_file): a PDF from the / menu becomes a file
// block, is saved, served so browsers can show it, previews on a computer, and the assistant reads it (mock text). A recording
// gets a player. Desktop and 390px. Mock model, wiped database.
const { chromium } = require("playwright");
const B = process.env.SEAGLASS_URL || "http://localhost:5173";
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const j = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const agent = async (b) => { const r = await fetch(B + "/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }); return (await r.text()).trim().split("\n").map((l) => JSON.parse(l)); };

// A tiny one-page PDF with "Hello handout" on it.
function pdf() {
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>"];
  const text = "BT /F1 18 Tf 30 100 Td (Hello handout) Tj ET";
  objs.push(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let out = "%PDF-1.4\n"; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(() => { localStorage.setItem("sg.agent", "0"); });
  const page = (await j("POST", "/api/notes", { title: "History", html: "<p>Unit 4</p>" })).body;
  await p.goto(`${B}/?n=${Date.now()}#/p/${page.id}`, { waitUntil: "networkidle" });
  await p.locator(".ProseMirror p").first().click(); await p.keyboard.press("End"); await p.keyboard.press("Enter");
  await p.keyboard.type("/pdf"); await p.locator(".suggest-list", { hasText: "PDF or file" }).waitFor();
  const [chooser] = await Promise.all([p.waitForEvent("filechooser"), p.keyboard.press("Enter")]);
  await chooser.setFiles({ name: "Revolution handout.pdf", mimeType: "application/pdf", buffer: pdf() });
  await p.locator(".file-block").waitFor({ timeout: 10000 });
  check(/Revolution handout\.pdf/.test(await p.locator(".file-block").innerText()) && /PDF/.test(await p.locator(".fb-name small").innerText()), "a PDF from the / menu becomes a file block");
  await p.waitForTimeout(1500);
  const html = (await j("GET", `/api/notes/${page.id}`)).body.html;
  const src = /data-src="(\/files\/[^"]+)"/.exec(html)?.[1];
  check(/data-type="file"/.test(html) && /data-mime="application\/pdf"/.test(html) && !!src, "it's saved in the page");
  const r = await fetch(B + src);
  check(r.status === 200 && r.headers.get("content-type") === "application/pdf" && !/sandbox/.test(r.headers.get("content-security-policy") || "") && /frame-ancestors 'self'/.test(r.headers.get("content-security-policy") || ""), "served so a browser can show it, framed only by Seaglass");
  const png = (await fetch(B + "/api/upload?name=x.png", { method: "POST", headers: { "Content-Type": "image/png" }, body: Buffer.from("89504e470d0a1a0a", "hex") }).then((x) => x.json())).url;
  check(/sandbox/.test((await fetch(B + png)).headers.get("content-security-policy") || ""), "other files keep the sandbox");

  await p.locator(".fb-actions button", { hasText: "Preview" }).click();
  check(await p.locator("iframe.fb-preview").count() === 1 && (await p.locator("iframe.fb-preview").getAttribute("src")) === src, "Preview shows it in the page");
  await p.reload({ waitUntil: "networkidle" });
  check(await p.locator(".file-block").count() === 1, "and it's still there after a reload");

  // ---- the assistant reads it
  const ev = await agent({ message: `mock:tool read_file ${JSON.stringify({ page_id: page.id })}` });
  const res = ev.find((e) => e.type === "tool_result");
  check(res?.ok && /Read “Revolution handout\.pdf”/.test(res.label), `the assistant reads the PDF (${res?.label})`);
  check(/French Revolution/.test(JSON.stringify(ev)), "and gets its text");
  const none = await agent({ message: `mock:tool read_file ${JSON.stringify({ page_id: page.id, file: "nope.pdf" })}` });
  check(/No file called/.test(JSON.stringify(none)), "a wrong name says which files are there");

  // ---- a recording gets a player
  const rec = (await j("POST", "/api/notes", { title: "Lecture", html: `<div data-type="file" data-src="${src}" data-name="talk.mp3" data-size="2048" data-mime="audio/mpeg"><a href="${src}">talk.mp3</a></div>` })).body;
  await p.goto(`${B}/?n=${Date.now()}#/p/${rec.id}`, { waitUntil: "networkidle" });
  check(await p.locator(".file-block audio").count() === 1 && /Audio/.test(await p.locator(".fb-name small").innerText()), "a recording gets a player");

  // ---- phone
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(`${B}/?n=${Date.now()}#/p/${page.id}`, { waitUntil: "networkidle" });
  await p.locator(".file-block").waitFor();
  const fits = await p.locator(".file-block, .fb-actions button").evaluateAll((els) => els.every((e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= 390; }));
  check(fits && await p.locator(".fb-actions button", { hasText: "Preview" }).count() === 0 && await p.locator(".fb-actions button", { hasText: /^Ask / }).count() === 1, "on a phone: fits, no Preview, Ask is there");
  check(!errs.length, `no page errors ${errs.join(" | ")}`);
  await b.close();
  console.log(fails ? `${fails} failed` : "all good");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
