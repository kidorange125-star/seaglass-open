// Sending what sources.ts read: upload the pictures and files (four at a time), fill in the placeholders, turn links
// between imported pages into page mentions, then make the pages through /api/import/pages, parents first, inside one
// new page "Imported from …". Deleting that page (it goes to the trash) takes the whole import back.
import { api } from "../api";
import { esc, isImage } from "./convert";
import { sendAll } from "./send";
import { APPS, findFile, nameIndex, pageIndex, type ImpPage, type ImpSet, type Src } from "./sources";

export type Progress = (step: string, done: number, total: number) => void;
export type Result = { rootId: string; title: string; pages: number; files: number; skipped: string[] };

const MAX_FILE = 25 * 1024 * 1024;
const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif",
  pdf: "application/pdf", mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", mp4: "video/mp4", webm: "video/webm",
};
const mimeOf = (s: Src) => s.mime || MIME[(s.path.split(".").pop() ?? "").toLowerCase()] || "";
const nameOf = (s: Src) => s.name || s.path.slice(s.path.lastIndexOf("/") + 1);
const CHUNK = 25, MAX_BYTES = 1_500_000; // small requests: each is sanitized and sealed within one request's time

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

export function rootTitle(set: ImpSet, picked?: string) {
  const day = new Date().toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  return `Imported from ${picked || APPS[set.app]}${set.name ? `: ${set.name}` : ""} (${day})`.slice(0, 300);
}

export async function runImport(set: ImpSet, progress: Progress, picked?: string): Promise<Result> {
  const skipped = [...set.skipped];
  const byName = nameIndex(set);
  const findPage = pageIndex(set);
  const ids = new Map<string, string>(set.pages.map((p) => [p.key, crypto.randomUUID()]));
  const rootId = crypto.randomUUID();
  const title = rootTitle(set, picked);
  const all: ImpPage[] = [{ key: "", parent: null, title, html: set.rootHtml, base: "" }, ...set.pages];

  // 1. Upload every file a page shows.
  const docs = new Map<ImpPage, Document>();
  const wanted = new Map<string, Src>();
  for (const p of all) {
    const doc = new DOMParser().parseFromString(`<!doctype html><body>${p.html}`, "text/html");
    docs.set(p, doc);
    doc.querySelectorAll("[data-imp-src], [data-imp-file]").forEach((el) => {
      const f = findFile(set, p.base, el.getAttribute("data-imp-src") ?? el.getAttribute("data-imp-file") ?? "", byName);
      if (f) wanted.set(f.path, f);
    });
  }
  const uploaded = new Map<string, { url: string; mime: string; size: number; name: string }>();
  let done = 0;
  const files = [...wanted.values()];
  progress("Uploading pictures and files", 0, files.length);
  await pool(files, 4, async (f) => {
    const mime = mimeOf(f), name = nameOf(f);
    try {
      if (!mime) throw new Error("Seaglass can't keep this kind of file");
      if (f.size > MAX_FILE) throw new Error("over 25 MB");
      const blob = await f.read();
      const url = await api.upload(new Blob([blob], { type: mime }), name);
      uploaded.set(f.path, { url, mime, size: blob.size, name });
    } catch (e) { skipped.push(`${name}: ${(e as Error).message}`); }
    progress("Uploading pictures and files", ++done, files.length);
  });

  // 2. Fill in placeholders and links.
  const html = new Map<ImpPage, string>();
  for (const p of all) {
    const doc = docs.get(p)!;
    doc.querySelectorAll("[data-imp-src], [data-imp-file]").forEach((el) => {
      const ref = el.getAttribute("data-imp-src") ?? el.getAttribute("data-imp-file") ?? "";
      const f = findFile(set, p.base, ref, byName);
      const u = f ? uploaded.get(f.path) : undefined;
      if (!u) { el.replaceWith(doc.createTextNode(el.tagName === "IMG" ? "" : el.textContent || ref)); return; }
      if (u.mime.startsWith("image/")) {
        const img = el.tagName === "IMG" ? el : doc.createElement("img");
        img.removeAttribute("data-imp-src"); img.removeAttribute("data-imp-file");
        img.setAttribute("src", u.url);
        if (!img.getAttribute("alt")) img.setAttribute("alt", isImage(u.name) ? "" : u.name);
        if (img !== el) el.replaceWith(img);
        return;
      }
      // Any other file is a file block, which is a block of its own: it replaces its line when it's alone on it.
      const block = doc.createElement("div");
      block.setAttribute("data-type", "file");
      block.setAttribute("data-src", u.url); block.setAttribute("data-name", u.name);
      block.setAttribute("data-size", String(u.size)); block.setAttribute("data-mime", u.mime);
      block.innerHTML = `<a href="${esc(u.url)}">${esc(u.name)}</a>`;
      const line = el.closest("p, li, h1, h2, h3, div");
      if (line && line !== doc.body && (line.textContent ?? "").trim() === (el.textContent ?? "").trim() && line.querySelectorAll("img, [data-imp-src], [data-imp-file]").length <= 1) line.replaceWith(block);
      else if (line && line !== doc.body) { el.replaceWith(doc.createTextNode(u.name)); line.parentNode!.insertBefore(block, line.nextSibling); }
      else el.replaceWith(block);
    });
    doc.querySelectorAll("[data-imp-ref]").forEach((el) => {
      const target = findPage(p.base, el.getAttribute("data-imp-ref") ?? "");
      const words = (el.textContent ?? "").trim() || target?.title || "";
      if (!target) { el.replaceWith(doc.createTextNode(words)); return; }
      const m = doc.createElement("span");
      m.setAttribute("data-type", "mention"); m.setAttribute("class", "mention");
      m.setAttribute("data-id", ids.get(target.key)!); m.setAttribute("data-label", words);
      m.textContent = words;
      el.replaceWith(m);
    });
    html.set(p, doc.body.innerHTML);
  }

  // 3. Make the pages, parents first.
  const kids = new Map<string | null, ImpPage[]>();
  for (const p of set.pages) { const k = p.parent && ids.has(p.parent) ? p.parent : null; (kids.get(k) ?? kids.set(k, []).get(k)!).push(p); }
  const ordered: ImpPage[] = [];
  const queue: (string | null)[] = [null];
  while (queue.length) { const k = queue.shift()!; for (const c of kids.get(k) ?? []) { ordered.push(c); queue.push(c.key); } }
  const body = (p: ImpPage, root = false) => ({
    id: root ? rootId : ids.get(p.key)!, parent_id: root ? null : p.parent && ids.has(p.parent) ? ids.get(p.parent)! : rootId,
    title: p.title, html: html.get(p) ?? "", kind: p.kind ?? "page", db_schema: p.schema, props: p.props ?? {},
    created_at: p.created, updated_at: p.updated, icon: root ? "📥" : null,
  });
  const runId = crypto.randomUUID();
  const send = [body(all[0], true), ...ordered.map((p) => body(p))];
  // A few pages per request, and a few megabytes at most (a page's HTML can be large).
  const batches: (typeof send)[] = [];
  let cur: typeof send = [], bytes = 0;
  for (const b of send) {
    const n = new Blob([b.html]).size + b.title.length + 500;
    if (cur.length && (cur.length >= CHUNK || bytes + n > MAX_BYTES)) { batches.push(cur); cur = []; bytes = 0; }
    cur.push(b); bytes += n;
  }
  if (cur.length) batches.push(cur);
  let sent = 0;
  progress("Making pages", 0, send.length);
  let r: Awaited<ReturnType<typeof sendAll>>;
  try {
    r = await sendAll(batches, (b) => api.importPages(b, rootId, runId), (n) => progress("Making pages", (sent += n), send.length), rootId);
  } catch (e) {
    throw Object.assign(new Error((e as Error).message), { rootId: sent ? rootId : null });
  }
  for (const f of r.failed) skipped.push(`${f.title || "A page"}: ${f.error}`);
  for (const t of r.cut) skipped.push(`${t}: too long, only the first part was imported`);
  const made = r.made;
  return { rootId, title, pages: made - 1, files: uploaded.size, skipped };
}
