// Turning other apps' text into Seaglass page HTML (the server sanitizes it again). Pictures, files and links to other
// imported pages are left as placeholders for run.ts to fill in once everything has an address:
//   <img data-imp-src="path">            a picture in the export
//   <a data-imp-file="path">name</a>     any other file in the export (PDF, audio, video)
//   <a data-imp-ref="target">words</a>   another page (a relative path, or an Obsidian [[name]])
import { marked } from "marked";

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg|heic|bmp)$/i;
const FILE = /\.(pdf|mp3|m4a|wav|ogg|mp4|webm|mov|docx?|xlsx?|pptx?|zip)$/i; // not .md, .txt, .html or .csv: those are pages
export const isImage = (p: string) => IMAGE.test(p);

/** Splits off YAML front matter (`---` … `---` at the very top) into simple key/value pairs. */
export function frontMatter(md: string): { body: string; fields: [string, string][] } {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(md);
  if (!m) return { body: md.replace(/^﻿/, ""), fields: [] };
  const fields: [string, string][] = [];
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_ -]+):\s*(.*)$/.exec(line);
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (kv) fields.push([kv[1].trim(), kv[2].trim().replace(/^\[(.*)\]$/, "$1").replace(/^["']|["']$/g, "")]);
    else if (item && fields.length) { const last = fields[fields.length - 1]; last[1] = last[1] ? `${last[1]}, ${item[1].trim()}` : item[1].trim(); }
  }
  return { body: md.slice(m[0].length), fields };
}

/** Applies `fn` to the parts of Markdown outside code blocks and inline code. */
function outsideCode(md: string, fn: (s: string) => string) {
  return md.split(/(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]+`)/).map((part, i) => (i % 2 ? part : fn(part))).join("");
}

/** Obsidian's extras: [[links]], ![[embeds]], ==highlights==. */
export function obsidian(md: string) {
  return outsideCode(md, (s) => s
    .replace(/!\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]/g, (_, target: string, alias?: string) => {
      const t = target.trim();
      if (IMAGE.test(t)) return `<img data-imp-src="${esc(t)}" alt="${esc(alias && !/^\d+(x\d+)?$/.test(alias) ? alias : "")}">`;
      if (FILE.test(t)) return `<a data-imp-file="${esc(t)}">${esc(t.split("/").pop()!)}</a>`;
      return `<a data-imp-ref="${esc(t)}">${esc(alias || t.split("/").pop()!)}</a>`;
    })
    .replace(/\[\[([^\]|#\n]*)(#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]/g, (_, target: string, head?: string, alias?: string) => {
      const t = target.trim();
      const words = alias?.trim() || (t ? t.split("/").pop()! : (head ?? "").replace(/^#\^?/, ""));
      return t ? `<a data-imp-ref="${esc(t)}">${esc(words)}</a>` : esc(words);
    })
    .replace(/==([^=\n]+)==/g, "<mark>$1</mark>"));
}

/** Markdown to HTML (GitHub flavour, single line breaks kept), then the placeholders. */
export function markdown(md: string): string {
  return fixHtml(marked.parse(md, { gfm: true, breaks: true, async: false }) as string);
}

const linkify = (s: string) => esc(s).replace(/\bhttps?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]]/g, (u) => `<a href="${u}">${u}</a>`);
/** Plain text: paragraphs at blank lines, line breaks kept, web addresses made links. */
export function plainText(t: string): string {
  return t.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p>${p.split("\n").map(linkify).join("<br>")}</p>`).join("");
}

const parse = (html: string) => new DOMParser().parseFromString(`<!doctype html><body>${html}`, "text/html");
const isLocal = (u: string) => !!u && !/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(u);
const decode = (u: string) => { try { return decodeURIComponent(u); } catch { return u; } };

/** A whole HTML file (Notion's HTML export, Apple Notes, a saved page): its title and the part worth keeping. */
export function htmlFile(html: string): { title: string; html: string } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, link, meta, noscript, header.page-header, .page-title").forEach((e) => e.remove());
  const title = (doc.querySelector("title")?.textContent ?? "").trim();
  const body = doc.querySelector("article .page-body") ?? doc.querySelector("article") ?? doc.body;
  return { title, html: fixHtml(body?.innerHTML ?? "") };
}

/**
 * Cleans HTML from any source: local pictures and links become placeholders, checkbox lists become Seaglass task lists,
 * and Evernote's tags (en-media, en-todo, en-crypt) become their equivalents (`media` maps a picture's hash to its path).
 */
export function fixHtml(html: string, media?: Map<string, { path: string; image: boolean; name: string }>): string {
  const doc = parse(html);
  const b = doc.body;
  if (media) {
    b.querySelectorAll("en-media").forEach((el) => {
      const m = media.get((el.getAttribute("hash") ?? "").toLowerCase());
      if (!m) { el.replaceWith(...el.childNodes); return; }
      const r = m.image ? Object.assign(doc.createElement("img"), { alt: m.name }) : Object.assign(doc.createElement("a"), { textContent: m.name });
      r.setAttribute(m.image ? "data-imp-src" : "data-imp-file", m.path);
      el.replaceWith(r, ...el.childNodes);
    });
    b.querySelectorAll("en-crypt").forEach((el) => el.replaceWith(doc.createTextNode("[Encrypted text, not imported]")));
    b.querySelectorAll("en-todo").forEach((el) => {
      const cb = doc.createElement("input"); cb.type = "checkbox";
      if (el.getAttribute("checked") === "true") cb.setAttribute("checked", "");
      el.replaceWith(cb, ...el.childNodes);
    });
    // Evernote writes one checkbox per line, each line its own <div>: gather each run of them into a list.
    for (const cb of [...b.querySelectorAll('input[type="checkbox"]')]) {
      const line = cb.closest("div, p");
      if (!line || line === b || line.closest("li")) continue;
      const prev = line.previousElementSibling;
      const ul = prev?.tagName === "UL" && prev.hasAttribute("data-imp-todo") ? prev : line.parentNode!.insertBefore(doc.createElement("ul"), line);
      ul.setAttribute("data-imp-todo", "");
      const li = doc.createElement("li");
      while (line.firstChild) li.appendChild(line.firstChild);
      ul.appendChild(li); line.remove();
    }
  }
  b.querySelectorAll("img[src]").forEach((img) => {
    const src = img.getAttribute("src")!;
    if (/^data:image\//i.test(src)) { img.setAttribute("data-imp-src", src); img.removeAttribute("src"); }
    else if (isLocal(src)) { img.setAttribute("data-imp-src", decode(src.split(/[?#]/)[0])); img.removeAttribute("src"); }
  });
  b.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href")!;
    if (!isLocal(href)) return;
    const path = decode(href.split(/[?#]/)[0]);
    a.removeAttribute("href");
    if (!path) return;
    if (IMAGE.test(path) || FILE.test(path)) a.setAttribute("data-imp-file", path);
    else a.setAttribute("data-imp-ref", path);
  });
  // Checkbox lists (GitHub task lists, Keep and Evernote checklists) become task lists.
  b.querySelectorAll("ul, ol").forEach((list) => {
    const items = [...list.children].filter((c) => c.tagName === "LI");
    const box = (li: Element) => {
      const first = li.firstElementChild?.tagName === "P" ? li.firstElementChild : li;
      const c = first.querySelector(':scope > input[type="checkbox"]');
      return c && (!c.previousSibling || !(c.previousSibling.textContent ?? "").trim()) ? (c as HTMLInputElement) : null;
    };
    if (!items.length || !items.every(box)) return;
    const ul = doc.createElement("ul");
    ul.setAttribute("data-type", "taskList");
    for (const li of items) {
      const c = box(li)!;
      const checked = c.hasAttribute("checked") || c.checked;
      c.remove();
      const nested = [...li.children].filter((x) => x.tagName === "UL" || x.tagName === "OL");
      nested.forEach((x) => x.remove());
      const words = li.innerHTML.trim().replace(/^<p>([\s\S]*)<\/p>$/, "$1").trim();
      const item = doc.createElement("li");
      item.setAttribute("data-type", "taskItem");
      item.setAttribute("data-checked", String(checked));
      item.innerHTML = `<label><input type="checkbox"${checked ? " checked" : ""}><span></span></label><div><p>${words}</p></div>`;
      nested.forEach((x) => item.lastElementChild!.appendChild(x));
      ul.appendChild(item);
    }
    list.replaceWith(ul);
  });
  b.querySelectorAll("[data-imp-todo]").forEach((e) => e.removeAttribute("data-imp-todo"));
  return b.innerHTML;
}

/** Notion and Obsidian start a page with its title as a heading; Seaglass shows the title already. */
export function dropTitleHeading(html: string, title: string): string {
  const m = /^\s*<h1[^>]*>([\s\S]*?)<\/h1>\s*/.exec(html);
  if (!m) return html;
  const words = m[1].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim();
  return words.toLowerCase() === title.trim().toLowerCase() ? html.slice(m[0].length) : html;
}

/** Front matter shown at the top of the page as plain lines ("tags: school, math"). */
export function fieldsHtml(fields: [string, string][]): string {
  const keep = fields.filter(([k, v]) => v && !/^(title|aliases?|cssclass(es)?|publish)$/i.test(k));
  return keep.length ? `<p>${keep.map(([k, v]) => `<strong>${esc(k)}:</strong> ${esc(v)}`).join("<br>")}</p>` : "";
}
