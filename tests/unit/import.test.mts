// The importers' pure parts (client/import/): the zip reader (stored, deflated, zips inside zips, macOS junk skipped),
// MD5 (Evernote finds pictures by it) and the Markdown helpers (front matter, Obsidian links, plain text).
// The rest is DOM work, tested end to end in tests/browser/import.cjs.
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { readZip, isZip } from "../../src/client/import/zip.ts";
import { md5 } from "../../src/client/import/md5.ts";
import { frontMatter, obsidian, plainText } from "../../src/client/import/convert.ts";

let fails = 0;
const check = (ok: unknown, what: string, extra?: unknown) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}${ok || extra === undefined ? "" : `  ${JSON.stringify(extra)}`}`); if (!ok) fails++; };

/** A minimal zip writer (no Zip64) to build test zips. */
function zip(files: [string, Uint8Array | string, boolean?][]): Uint8Array {
  const enc = new TextEncoder(), parts: Uint8Array[] = [], cd: Uint8Array[] = [];
  let off = 0;
  for (const [name, data0, store] of files) {
    const data = typeof data0 === "string" ? enc.encode(data0) : data0;
    const body = store ? data : new Uint8Array(deflateRawSync(data));
    const n = enc.encode(name), crc = 0;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(8, store ? 0 : 8, true); h.setUint32(14, crc, true);
    h.setUint32(18, body.length, true); h.setUint32(22, data.length, true); h.setUint16(26, n.length, true);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(10, store ? 0 : 8, true);
    c.setUint32(20, body.length, true); c.setUint32(24, data.length, true); c.setUint16(28, n.length, true); c.setUint32(42, off, true);
    parts.push(new Uint8Array(h.buffer), n, body); cd.push(new Uint8Array(c.buffer), n);
    off += 30 + n.length + body.length;
  }
  const cdLen = cd.reduce((a, b) => a + b.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdLen, true); e.setUint32(16, off, true);
  const all = [...parts, ...cd, new Uint8Array(e.buffer)];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}
const blob = (u: Uint8Array) => new Blob([u]);
const txt = async (b: Blob) => b.text();

// ---- zip
const inner = zip([["Page 1.md", "# One\n\nhello"], ["img/a.bin", new Uint8Array([1, 2, 3, 250]), true]]);
const outer = zip([["Export-Part-1.zip", inner, true], ["top.txt", "top words ".repeat(200)], ["__MACOSX/._top.txt", "junk"], ["dir/", ""], ["dir/.DS_Store", "x"]]);
const entries = await readZip(blob(outer));
const paths = entries.map((e) => e.path).sort();
check(JSON.stringify(paths) === JSON.stringify(["Export-Part-1/Page 1.md", "Export-Part-1/img/a.bin", "top.txt"]), "a zip inside a zip is opened under its name; macOS junk and folders skipped", paths);
check((await txt(await entries.find((e) => e.path === "top.txt")!.read())) === "top words ".repeat(200), "a deflated entry reads back");
check((await txt(await entries.find((e) => e.path.endsWith("Page 1.md"))!.read())).includes("hello"), "an entry of the inner zip reads back");
const bin = new Uint8Array(await (await entries.find((e) => e.path.endsWith("a.bin"))!.read()).arrayBuffer());
check(bin.join() === "1,2,3,250", "a stored entry reads back byte for byte");
check(await isZip(blob(outer)) && !(await isZip(new Blob(["hello"]))), "a zip is told from text");
let refused = false;
try { await readZip(new Blob(["not a zip at all"])); } catch { refused = true; }
check(refused, "something that isn't a zip is refused");

// ---- md5
for (const s of ["", "abc", "x".repeat(55), "x".repeat(56), "y".repeat(64), "z".repeat(1000)]) {
  const u = new TextEncoder().encode(s);
  check(md5(u) === createHash("md5").update(u).digest("hex"), `md5 of ${s.length} bytes`);
}
const big = new Uint8Array(300_000).map((_, i) => (i * 7) % 251);
check(md5(big) === createHash("md5").update(big).digest("hex"), "md5 of 300 KB");

// ---- Markdown helpers
const fm = frontMatter("---\ntitle: Hi\ntags:\n  - a\n  - b\ncreated: 2024-03-05\n---\nBody");
check(fm.body === "Body" && fm.fields.find(([k]) => k === "tags")?.[1] === "a, b" && fm.fields.find(([k]) => k === "title")?.[1] === "Hi", "front matter: fields and lists", fm);
check(frontMatter("No front matter\n---\n").fields.length === 0, "a --- later on isn't front matter");
const o = obsidian("See [[Plan|the plan]], [[Folder/Note]], ![[pic.png|300]], ![[doc.pdf]], ![[Other note]], ==hi==, `[[code]]`\n```\n[[block]]\n```");
check(/<a data-imp-ref="Plan">the plan<\/a>/.test(o) && /<a data-imp-ref="Folder\/Note">Note<\/a>/.test(o), "[[links]] with and without words", o);
check(/<img data-imp-src="pic.png" alt="">/.test(o) && /<a data-imp-file="doc.pdf">doc.pdf<\/a>/.test(o) && /<a data-imp-ref="Other note">/.test(o), "![[embeds]]: pictures, files and notes");
check(/<mark>hi<\/mark>/.test(o) && /`\[\[code\]\]`/.test(o) && /\[\[block\]\]/.test(o), "highlights; code left alone");
check(plainText("Title line\nsecond\n\nhttps://example.com/x.") === '<p>Title line<br>second</p><p><a href="https://example.com/x">https://example.com/x</a>.</p>', "plain text: paragraphs, line breaks, links", plainText("Title line\nsecond\n\nhttps://example.com/x."));
check(plainText("<b>&</b>") === "<p>&lt;b&gt;&amp;&lt;/b&gt;</p>", "plain text is escaped");

console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
