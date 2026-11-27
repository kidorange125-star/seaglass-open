// PDFs and files in pages (#17). A page holds an uploaded file as a file block (<div data-type="file" data-src="/files/..."
// data-name data-size data-mime>). The assistant reads a PDF's text with read_file: the file is opened from R2, turned into
// Markdown by Workers AI (toMarkdown, which handles PDFs), and that text is kept next to it in R2 (sealed like the file) so
// the next read is free. Text is cut into parts so a long handout doesn't fill the assistant's context.
import type { Env } from "./env";
import * as Vault from "./vault";
import { authMode } from "./claude-auth";
import { ownerOf } from "./scope";
import * as Usage from "./usage";

/** Whose uploaded file this is. Files from before people had their own things carry no owner: the first account's. */
export async function fileOwner(env: Env, obj: { customMetadata?: Record<string, string> }) {
  const o = obj.customMetadata?.owner;
  if (o) return o;
  return (await env.DB.prepare("SELECT id FROM users ORDER BY created_at LIMIT 1").first<{ id: string }>())?.id ?? "dev";
}

export interface PageFile { src: string; name: string; mime: string; size: number }
export const PART = 30_000;
const SRC = /^\/files\/([\w-]+)\/([\w.\-]+)$/;

const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? "";
  return m.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
};
/** The file blocks on a page, in order. */
export function filesOn(html: string): PageFile[] {
  const out: PageFile[] = [];
  for (const m of html.matchAll(/<div[^>]*data-type="file"[^>]*>/g)) {
    const src = attr(m[0], "data-src");
    if (!SRC.test(src)) continue;
    out.push({ src, name: attr(m[0], "data-name") || src.split("/").pop()!, mime: attr(m[0], "data-mime"), size: Number(attr(m[0], "data-size")) || 0 });
  }
  return out;
}
const keyOf = (src: string) => { const m = SRC.exec(src); return m ? `${m[1]}/${m[2]}` : null; };
export const readable = (f: Pick<PageFile, "mime" | "name">) => f.mime === "application/pdf" || /\.pdf$/i.test(f.name);

/** A file's text (Markdown), converted once and cached. */
export async function textOf(env: Env, f: PageFile): Promise<string> {
  const key = keyOf(f.src);
  if (!key) throw new Error("That isn't a file in Seaglass.");
  if (!readable(f)) throw new Error(`${f.name} isn't a PDF, so there's no text to read.`);
  // Only the person who uploaded it (a link to someone else's file pasted into a page opens nothing).
  const head = await env.FILES.head(key);
  if (head && (await fileOwner(env, head)) !== ownerOf(env.DB)) throw new Error(`${f.name} is missing from file storage.`);
  const cacheKey = `filetext/${key}.md`;
  const cached = await env.FILES.get(cacheKey);
  if (cached) return new TextDecoder().decode(await Vault.openBytes("files", cacheKey, "body", new Uint8Array(await cached.arrayBuffer())));
  let text: string;
  if (authMode(env) === "mock") text = `# ${f.name}\n\n(mock) The French Revolution began in 1789. The Estates-General met at Versailles; the Third Estate formed the National Assembly and took the Tennis Court Oath.`;
  else {
    const obj = await env.FILES.get(key);
    if (!obj) throw new Error(`${f.name} is missing from file storage.`);
    const plain = await Vault.openBytes("files", key, "body", new Uint8Array(await obj.arrayBuffer()));
    if (!env.AI) throw new Error("Reading PDFs needs Workers AI, which isn't set up.");
    const r = await env.AI.toMarkdown({ name: f.name.endsWith(".pdf") ? f.name : `${f.name}.pdf`, blob: new Blob([plain as BlobPart], { type: "application/pdf" }) });
    await Usage.record(env.DB, "read a PDF", "toMarkdown");
    if (r.format === "error") throw new Error(`Couldn't read ${f.name}: ${r.error}`);
    text = r.data.trim();
    if (!text) text = `(${f.name} has no text in it: it may be scanned pictures of pages.)`;
  }
  await env.FILES.put(cacheKey, await Vault.sealBytes("files", cacheKey, "body", new TextEncoder().encode(text)), { httpMetadata: { contentType: "text/markdown" }, customMetadata: { sealed: await Vault.currentKeyId(), kind: "filetext" } });
  return text;
}

/** One part of a file's text, for the assistant. */
export function part(text: string, n = 1) {
  const parts = Math.max(1, Math.ceil(text.length / PART));
  const p = Math.min(Math.max(1, Math.floor(n) || 1), parts);
  return { part: p, parts, text: text.slice((p - 1) * PART, p * PART) };
}
