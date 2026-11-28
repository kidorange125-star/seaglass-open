// Reading another app's export into pages (0.2.4). Everything runs in the browser; nothing is sent until run.ts.
//   Notion       Settings > Export > "Markdown & CSV" (a zip of zips): page names lose Notion's ids, a page's folder
//                holds its sub-pages, a CSV becomes a database whose rows keep their own pages.
//   Obsidian     the vault folder or a zip of it: [[links]] become page mentions, ![[embeds]] pictures and files,
//                front matter shows at the top, a folder becomes a page holding its notes.
//   Markdown     any folder or zip of .md / .txt / .html files, same as Obsidian.
//   Apple Notes  Apple's data copy (privacy.apple.com, iCloud Notes) or any export to text, HTML or Markdown files.
//   Google Keep  Google Takeout, Keep only: each note's .json (checklists, labels, pictures, dates), archived notes
//                in a page of their own, trashed ones left out.
//   Evernote     .enex notebooks: pictures and files (found by their MD5), checkboxes, tags, dates.
// Pictures and files stay placeholders (convert.ts) until run.ts uploads them.
import { importPlan, parseCsv } from "../db/csv";
import { newProp, newView } from "../db/logic";
import type { DbSchema } from "../types";
import * as C from "./convert";
import { md5 } from "./md5";
import { readZip } from "./zip";

export type App = "notion" | "obsidian" | "markdown" | "apple" | "keep" | "evernote";
export const APPS: Record<App, string> = { notion: "Notion", obsidian: "Obsidian", markdown: "Markdown", apple: "Apple Notes", keep: "Google Keep", evernote: "Evernote" };

export type Src = { path: string; size: number; read: () => Promise<Blob>; name?: string; mime?: string };
export type ImpPage = {
  key: string; parent: string | null; title: string; html: string; base: string;
  kind?: "page" | "database"; schema?: DbSchema; props?: Record<string, unknown>; created?: number; updated?: number; row?: boolean;
};
export type ImpSet = { app: App; name: string; pages: ImpPage[]; files: Map<string, Src>; skipped: string[]; rootHtml: string };

const NOTE = /\.(md|markdown|txt|html?)$/i;
const CHOICE = /^(status|priority|stage|type|category|kind|class|subject|tags?|labels?)$/i;
const NOTION_ID = / [0-9a-f]{32}(?=$|_all$)/i;
const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const stemOf = (p: string) => p.replace(/\.[^./]+$/, "");
const text = async (s: Src) => (await s.read()).text();
const squash = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** The files picked: zips opened (and zips inside them), folders keep their paths. */
export async function gather(list: File[]): Promise<Src[]> {
  const zips = list.filter((f) => /\.zip$/i.test(f.name));
  const out: Src[] = [];
  for (const f of list) {
    if (zips.includes(f)) out.push(...await readZip(f, zips.length > 1 ? f.name.replace(/\.zip$/i, "") + "/" : ""));
    else out.push({ path: ((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name).replace(/\\/g, "/"), size: f.size, read: async () => f });
  }
  return out.filter((s) => !s.path.split("/").some((seg) => seg.startsWith(".") || seg === "__MACOSX"));
}

/** Which app an export came from, by its files. */
export async function detect(srcs: Src[]): Promise<App> {
  const paths = srcs.map((s) => s.path);
  if (paths.some((p) => /\.enex$/i.test(p))) return "evernote";
  if (paths.some((p) => /(^|\/)Keep\/[^/]+\.json$/i.test(p))) return "keep";
  if (paths.some((p) => p.split("/").some((seg) => NOTION_ID.test(stemOf(seg))))) return "notion";
  const json = srcs.find((s) => /\.json$/i.test(s.path));
  if (json && json.size < 2_000_000) { try { const o = JSON.parse(await text(json)); if (o && ("textContent" in o || "listContent" in o)) return "keep"; } catch { /* not Keep */ } }
  if (paths.some((p) => /\.(md|markdown)$/i.test(p))) return "markdown";
  return "apple";
}

/** Drops folders every file shares ("My vault/…", Notion's "Export-…-Part-1/…"), keeping the last one's name. */
function stripTop(srcs: Src[]) {
  let list = srcs, top = "";
  for (;;) {
    const firsts = new Set(list.map((s) => s.path.split("/")[0]));
    if (firsts.size !== 1 || list.some((s) => !s.path.includes("/"))) break;
    top = [...firsts][0];
    list = list.map((s) => ({ ...s, path: s.path.slice(top.length + 1) }));
  }
  return { list, top };
}

export async function build(srcs: Src[], app: App): Promise<ImpSet> {
  const set: ImpSet = { app, name: "", pages: [], files: new Map(), skipped: [], rootHtml: "" };
  if (app === "evernote") await fromEnex(set, srcs);
  else if (app === "keep") await fromKeep(set, srcs);
  else await fromFiles(set, srcs);
  addLeftovers(set);
  // Siblings in name order; a database's rows first, in the CSV's order.
  const groups = new Map<string | null, ImpPage[]>();
  for (const p of set.pages) (groups.get(p.parent) ?? groups.set(p.parent, []).get(p.parent)!).push(p);
  set.pages = [...groups.values()].flatMap((g) => [...g.filter((p) => p.row), ...g.filter((p) => !p.row).sort((a, b) => natural(a.title, b.title))]);
  return set;
}

// ---------------------------------------------------------------- folders of files (Notion, Obsidian, Markdown, Apple)

async function fromFiles(set: ImpSet, all: Src[]) {
  const { list, top } = stripTop(all);
  const notion = set.app === "notion";
  set.name = notion ? (/^Export-/i.test(top) ? "" : top.replace(NOTION_ID, "")) : top;
  const clean = (name: string) => (notion ? name.replace(NOTION_ID, "").replace(/_all$/, "") : name).trim() || "Untitled";
  const notes = list.filter((s) => NOTE.test(s.path)).sort((a, b) => natural(a.path, b.path));
  // A CSV (a Notion database, or any table): Notion writes "X.csv" and "X_all.csv" (every row); keep the fuller one.
  const csvs = new Map<string, Src>();
  for (const s of list.filter((x) => /\.csv$/i.test(x.path))) {
    const stem = stemOf(s.path).replace(/_all$/, "");
    if (!csvs.has(stem) || /_all\.csv$/i.test(s.path)) csvs.set(stem, s);
  }
  for (const s of list) if (!NOTE.test(s.path) && !/\.csv$/i.test(s.path)) set.files.set(s.path, s);

  // A folder's page: a note or table with the folder's name next to it (Notion) or inside it (Obsidian folder notes),
  // else a page made for the folder. Only folders that hold notes get one.
  const keys = new Set([...notes.map((n) => n.path), ...[...csvs.values()].map((c) => c.path)]);
  const aliasOf = (dir: string): string | null => {
    for (const ext of [".md", ".markdown", ".html", ".htm", ".txt"]) {
      if (keys.has(dir + ext)) return dir + ext;
      const inside = `${dir}/${baseName(dir)}${ext}`;
      if (keys.has(inside)) return inside;
    }
    return csvs.get(dir)?.path ?? null;
  };
  const folderPages = new Map<string, ImpPage>();
  const pageFor = (dir: string, self: string): string | null => {
    if (!dir) return null;
    const alias = aliasOf(dir);
    if (alias && alias !== self) return alias;
    if (alias === self) return pageFor(dirOf(dir), self);
    let f = folderPages.get(dir);
    if (!f) {
      f = { key: `dir:${dir}`, parent: pageFor(dirOf(dir), ""), title: clean(baseName(dir)), html: "", base: dir };
      folderPages.set(dir, f); set.pages.push(f);
    }
    return f.key;
  };

  const byKey = new Map<string, ImpPage>();
  for (const s of notes) {
    const title0 = clean(stemOf(baseName(s.path)));
    const page: ImpPage = { key: s.path, parent: pageFor(dirOf(s.path), s.path), title: title0, html: "", base: dirOf(s.path) };
    try {
      const raw = await text(s);
      if (/\.(md|markdown)$/i.test(s.path)) {
        const fm = C.frontMatter(raw);
        const get = (k: string) => fm.fields.find(([f]) => f.toLowerCase() === k)?.[1];
        if (get("title")) page.title = get("title")!.slice(0, 300);
        // Notion shortens and cleans file names; the page's real title is its first heading.
        const h1 = notion ? /^\s*# (.+?)[ \t]*(?:\r?\n|$)/.exec(fm.body) : null;
        if (h1) page.title = h1[1].slice(0, 300);
        const born = Date.parse(get("created") ?? get("date") ?? "");
        if (born) page.created = born;
        const edited = Date.parse(get("updated") ?? get("modified") ?? "");
        if (edited) page.updated = edited;
        page.html = C.fieldsHtml(fm.fields) + C.dropTitleHeading(C.markdown(C.obsidian(fm.body)), page.title);
      } else if (/\.txt$/i.test(s.path)) {
        const lines = raw.replace(/^﻿/, "").split(/\r?\n/);
        if ((lines[0] ?? "").trim() === page.title.trim()) lines.shift();
        page.html = C.plainText(lines.join("\n"));
      } else {
        const h = C.htmlFile(raw);
        if (h.title && !notion && /^(untitled|index)$/i.test(page.title)) page.title = h.title;
        page.html = C.dropTitleHeading(h.html, page.title);
      }
    } catch (e) { set.skipped.push(`${s.path}: ${(e as Error).message}`); }
    set.pages.push(page); byKey.set(page.key, page);
  }

  for (const [stem, s] of csvs) {
    const head = parseCsv(await text(s).catch(() => ""));
    const titleName = (head[0]?.[0] ?? "Name").trim() || "Name";
    const base: DbSchema = { properties: [{ id: "title", name: titleName, type: "title" }], views: [newView("table", "Table")] } as DbSchema;
    // Columns that are choices in Notion (a few rows rarely repeat a value, so the CSV alone can't tell).
    (head[0] ?? []).slice(1).forEach((h, i) => {
      const name = h.trim(), values = head.slice(1).map((r) => (r[i + 1] ?? "").trim()).filter(Boolean);
      if (!CHOICE.test(name) || values.some((v) => v.length > 60)) return;
      const prop = newProp(/^(tags?|labels?)$/i.test(name) ? "multi_select" : "select", name.slice(0, 100));
      prop.options = [];
      base.properties.push(prop);
    });
    const plan = importPlan(base, head);
    const db: ImpPage = { key: s.path, parent: pageFor(dirOf(s.path), s.path), title: clean(baseName(stem)), html: "", base: dirOf(s.path), kind: "database", schema: plan.schema };
    set.pages.push(db);
    // Rows that have a page of their own (in the database's folder) keep its words; the rest are just rows.
    const own = notes.filter((n) => dirOf(n.path) === stem).map((n) => byKey.get(n.path)!).filter(Boolean);
    plan.rows.forEach((r, i) => {
      const want = squash(r.title || "Untitled");
      const mine = own.find((p) => !p.row && squash(p.title) === want) ?? own.find((p) => !p.row && squash(p.title).length >= 8 && want.startsWith(squash(p.title)));
      if (mine) { mine.row = true; mine.props = r.props; mine.parent = db.key; return; }
      set.pages.push({ key: `row:${s.path}:${i}`, parent: db.key, title: r.title, html: "", base: stem, props: r.props, row: true });
    });
  }
}

// ---------------------------------------------------------------- Google Keep (Takeout)

type KeepNote = {
  title?: string; textContent?: string; textContentHtml?: string; listContent?: { text: string; isChecked: boolean }[];
  labels?: { name: string }[]; attachments?: { filePath: string; mimetype?: string }[]; annotations?: { url?: string; title?: string }[];
  isTrashed?: boolean; isArchived?: boolean; isPinned?: boolean; createdTimestampUsec?: number; userEditedTimestampUsec?: number;
};

async function fromKeep(set: ImpSet, srcs: Src[]) {
  set.name = "";
  for (const s of srcs) if (!/\.(json|html?)$/i.test(s.path)) set.files.set(s.path, s);
  let archived: ImpPage | null = null;
  let trashed = 0;
  for (const s of srcs.filter((x) => /\.json$/i.test(x.path))) {
    let o: KeepNote;
    try { o = JSON.parse(await text(s)); } catch { continue; }
    if (!o || typeof o !== "object" || !("textContent" in o || "listContent" in o)) continue;
    if (o.isTrashed) { trashed++; continue; }
    const words = (o.textContent ?? "").trim();
    const title = (o.title ?? "").trim() || words.split("\n")[0].slice(0, 80) || o.listContent?.[0]?.text?.slice(0, 80) || "Untitled note";
    let html = o.labels?.length ? `<p><strong>Labels:</strong> ${C.esc(o.labels.map((l) => l.name).join(", "))}</p>` : "";
    html += o.textContentHtml ? C.fixHtml(o.textContentHtml) : C.plainText(o.textContent ?? "");
    if (o.listContent?.length) html += C.fixHtml(`<ul>${o.listContent.map((i) => `<li><input type="checkbox"${i.isChecked ? " checked" : ""}> ${C.esc(i.text ?? "")}</li>`).join("")}</ul>`);
    for (const a of o.attachments ?? []) {
      const image = (a.mimetype ?? "").startsWith("image/") || C.isImage(a.filePath);
      html += image ? `<p><img data-imp-src="${C.esc(a.filePath)}" alt=""></p>` : `<p><a data-imp-file="${C.esc(a.filePath)}">${C.esc(baseName(a.filePath))}</a></p>`;
    }
    for (const a of o.annotations ?? []) if (a.url && /^https?:/i.test(a.url)) html += `<p><a href="${C.esc(a.url)}">${C.esc(a.title || a.url)}</a></p>`;
    if (o.isArchived && !archived) { archived = { key: "keep:archived", parent: null, title: "Archived", html: "", base: "" }; set.pages.push(archived); }
    set.pages.push({
      key: s.path, parent: o.isArchived ? archived!.key : null, title: title.slice(0, 300), html, base: dirOf(s.path),
      created: o.createdTimestampUsec ? Math.floor(o.createdTimestampUsec / 1000) : undefined,
      updated: o.userEditedTimestampUsec ? Math.floor(o.userEditedTimestampUsec / 1000) : undefined,
    });
  }
  if (trashed) set.skipped.push(`${trashed} note${trashed === 1 ? "" : "s"} in Keep's trash`);
}

// ---------------------------------------------------------------- Evernote (.enex)

const enDate = (s: string) => { const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s.trim()); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : undefined; };
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "application/pdf": "pdf", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/mp4": "m4a", "video/mp4": "mp4" };

async function fromEnex(set: ImpSet, srcs: Src[]) {
  const books = srcs.filter((s) => /\.enex$/i.test(s.path));
  set.name = books.length === 1 ? stemOf(baseName(books[0].path)) : "";
  for (const [b, book] of books.entries()) {
    const doc = new DOMParser().parseFromString(await text(book), "application/xml");
    if (doc.querySelector("parsererror")) { set.skipped.push(`${baseName(book.path)}: not a readable Evernote file`); continue; }
    let parent: string | null = null;
    if (books.length > 1) { parent = `enex:${book.path}`; set.pages.push({ key: parent, parent: null, title: stemOf(baseName(book.path)), html: "", base: "" }); }
    [...doc.getElementsByTagName("note")].forEach((note, i) => {
      const get = (el: Element, tag: string) => el.getElementsByTagName(tag)[0]?.textContent ?? "";
      const media = new Map<string, { path: string; image: boolean; name: string }>();
      for (const r of [...note.getElementsByTagName("resource")]) {
        try {
          const bytes = Uint8Array.from(atob(get(r, "data").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
          const mime = get(r, "mime").trim() || "application/octet-stream";
          const hash = md5(bytes);
          const name = get(r, "file-name").trim() || `${hash.slice(0, 8)}.${EXT[mime] ?? "bin"}`;
          const path = `enex/${b}/${i}/${hash}/${name}`;
          set.files.set(path, { path, size: bytes.length, name, mime, read: async () => new Blob([bytes], { type: mime }) });
          media.set(hash, { path, image: mime.startsWith("image/"), name });
        } catch { set.skipped.push(`A file in "${get(note, "title")}" couldn't be read`); }
      }
      const content = get(note, "content");
      // ENML is XML: <en-todo/> and <en-media/> close themselves, which an HTML parser doesn't know (it would put the
      // rest of the line inside them), and XML would choke on HTML entities, so close them first and read it as HTML.
      const enml = new DOMParser().parseFromString(content.replace(/<(en-todo|en-media)([^>]*?)\s*\/>/gi, "<$1$2></$1>"), "text/html");
      let html = C.fixHtml(enml.querySelector("en-note")?.innerHTML ?? enml.body.innerHTML, media);
      const tags = [...note.getElementsByTagName("tag")].map((t) => t.textContent ?? "").filter(Boolean);
      if (tags.length) html = `<p><strong>Tags:</strong> ${C.esc(tags.join(", "))}</p>` + html;
      const url = get(note, "source-url");
      if (/^https?:/i.test(url)) html += `<p><a href="${C.esc(url)}">${C.esc(url)}</a></p>`;
      for (const [hash, m] of media) if (!content.toLowerCase().includes(hash)) html += m.image ? `<p><img data-imp-src="${C.esc(m.path)}" alt=""></p>` : `<p><a data-imp-file="${C.esc(m.path)}">${C.esc(m.name)}</a></p>`;
      set.pages.push({ key: `enex:${b}:${i}`, parent, title: get(note, "title").trim().slice(0, 300) || "Untitled note", html, base: "", created: enDate(get(note, "created")), updated: enDate(get(note, "updated")) });
    });
  }
}

// ---------------------------------------------------------------- finding things, and files nothing points at

const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
export function join(base: string, rel: string): string {
  const out = rel.startsWith("/") ? [] : base.split("/").filter(Boolean);
  for (const seg of rel.split("/")) { if (!seg || seg === ".") continue; if (seg === "..") out.pop(); else out.push(seg); }
  return out.join("/");
}

/** The file a placeholder means: by path from the page's folder, from the top, then by name (Obsidian finds files anywhere). */
export function findFile(set: ImpSet, base: string, ref: string, byName?: Map<string, Src>): Src | null {
  if (ref.startsWith("data:")) return set.files.get(ref) ?? (() => { const d = dataSrc(ref); if (d) set.files.set(ref, d); return d; })();
  return set.files.get(join(base, ref)) ?? set.files.get(join("", ref)) ?? byName?.get(baseName(ref).toLowerCase()) ?? byName?.get(stemOf(baseName(ref)).toLowerCase()) ?? null;
}
/** A picture written into the page itself (data: address) becomes a file like the others, so pages stay small. */
function dataSrc(ref: string): Src | null {
  const m = /^data:(image\/[a-z0-9.+-]+)(;base64)?,(.*)$/is.exec(ref);
  if (!m) return null;
  const bytes = m[2] ? Uint8Array.from(atob(m[3].replace(/\s+/g, "")), (c) => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(m[3]));
  const ext = m[1].split("/")[1].replace("jpeg", "jpg").replace(/\+.*/, "");
  return { path: ref, size: bytes.length, mime: m[1].toLowerCase(), name: `picture-${md5(bytes).slice(0, 8)}.${ext}`, read: async () => new Blob([bytes], { type: m[1] }) };
}
export function nameIndex(set: ImpSet) {
  const m = new Map<string, Src>();
  for (const s of set.files.values()) {
    const n = baseName(s.path).toLowerCase();
    if (!m.has(n)) m.set(n, s);
    const st = stemOf(n);
    if (!m.has(st)) m.set(st, s); // Keep lists "x.jpg" for a file saved as "x.jpeg"
  }
  return m;
}

/** Pictures and files no page shows go on the page of their folder (or the one above), so nothing is left behind. */
function addLeftovers(set: ImpSet) {
  const used = new Set<string>();
  const byName = nameIndex(set);
  for (const p of set.pages) {
    for (const m of p.html.matchAll(/data-imp-(?:src|file)="([^"]*)"/g)) { const f = findFile(set, p.base, unesc(m[1]), byName); if (f) used.add(f.path); }
  }
  const pageOfDir = new Map<string, ImpPage>();
  for (const p of set.pages) if (p.key.startsWith("dir:")) pageOfDir.set(p.key.slice(4), p);
  for (const p of set.pages) if (!p.key.includes(":")) { const d = p.key.replace(/\.[^./]+$/, ""); if (!pageOfDir.has(d)) pageOfDir.set(d, p); }
  const extra = new Map<ImpPage | null, string[]>();
  for (const f of set.files.values()) {
    if (used.has(f.path) || set.app === "keep" || set.app === "evernote") continue;
    let dir = dirOf(f.path), page: ImpPage | null = null;
    for (;;) {
      page = pageOfDir.get(dir) ?? null;
      if (!page && dir) { const here = set.pages.filter((p) => !p.key.includes(":") && dirOf(p.key) === dir); if (here.length === 1) page = here[0]; }
      if (page || !dir) break;
      dir = dirOf(dir);
    }
    const ref = page ? relative(page.base, f.path) : f.path;
    const tag = C.isImage(f.path) ? `<p><img data-imp-src="${C.esc(ref)}" alt=""></p>` : `<p><a data-imp-file="${C.esc(ref)}">${C.esc(baseName(f.path))}</a></p>`;
    (extra.get(page) ?? extra.set(page, []).get(page)!).push(tag);
  }
  for (const [page, tags] of extra) {
    const html = `<h3>Files</h3>${tags.join("")}`;
    if (page) page.html += html; else set.rootHtml += html;
  }
}
const relative = (base: string, path: string) => (base && path.startsWith(base + "/") ? path.slice(base.length + 1) : "/" + path);

/** The page a link means: a path from the linking page's folder (Notion), or a page name (Obsidian). */
export function pageIndex(set: ImpSet) {
  const byKey = new Map(set.pages.map((p) => [p.key, p]));
  const byName = new Map<string, ImpPage>();
  for (const p of set.pages) for (const n of [p.title, p.key.includes(":") ? "" : stemOf(baseName(p.key)).replace(NOTION_ID, "")]) {
    const k = n.trim().toLowerCase();
    if (k && !byName.has(k)) byName.set(k, p);
  }
  return (base: string, ref: string): ImpPage | null => {
    const r = ref.split("#")[0].trim();
    if (!r) return null;
    for (const c of [join(base, r), join("", r)]) {
      const hit = byKey.get(c) ?? byKey.get(c + ".md") ?? byKey.get(`dir:${c}`);
      if (hit) return hit;
    }
    return byName.get(stemOf(baseName(r)).replace(NOTION_ID, "").trim().toLowerCase()) ?? byName.get(baseName(r).trim().toLowerCase()) ?? null;
  };
}
