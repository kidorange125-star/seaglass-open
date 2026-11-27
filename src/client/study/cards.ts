// Flashcards come straight from a page's content, so there is nothing separate to keep in sync:
//   - a toggle block: the toggle's title is the question, what's inside is the answer (not toggle headings)
//   - a line "term :: definition" (a paragraph or list item)
// Each card's id is a hash of its question, so editing an answer keeps your progress.

export interface Card { id: string; question: string; answerHtml: string; answerText: string }

/** A short, stable hash (FNV-1a) of the normalized question. */
export function cardId(question: string): string {
  let h = 0x811c9dc5;
  for (const ch of question.trim().toLowerCase().replace(/\s+/g, " ")) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

// a Cornell table's header (the same as editor/formats.ts, kept here so this file has no imports)
const CUES = /^\s*(cues?( and questions)?|questions?|keywords?|key words?)\s*$/i, NOTES = /^\s*notes?\s*$/i;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Finds the cards in a page's (sanitized) HTML. Browser only: it uses DOMParser. */
export function extractCards(html: string): Card[] {
  if (!html || typeof DOMParser === "undefined") return [];
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const out: Card[] = [];
  const seen = new Set<string>();
  const add = (question: string, answerHtml: string, answerText: string) => {
    const q = question.replace(/\s+/g, " ").trim(), a = answerText.replace(/\s+/g, " ").trim();
    if (!q || !a) return;
    const id = cardId(q);
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, question: q, answerHtml, answerText: a });
  };
  for (const d of doc.querySelectorAll("details")) {
    const summary = d.querySelector(":scope > summary");
    if (!summary || d.hasAttribute("data-heading")) continue; // toggle headings fold sections; they aren't cards
    const body = d.cloneNode(true) as HTMLElement;
    body.querySelector(":scope > summary")?.remove();
    add(summary.textContent ?? "", body.innerHTML, body.textContent ?? "");
  }
  // Cornell notes (editor/formats.ts): a table with a "Cues and questions | Notes" row (the topic row may sit above it);
  // each row after it with both cells is a card (the summary, one wide cell, isn't)
  for (const t of doc.querySelectorAll("table")) {
    const rows = [...t.querySelectorAll("tr")];
    // the lines-only format has no header words: it's marked instead, and every two-cell row counts
    const marked = !!t.querySelector('[data-format="cornell"]');
    const k = marked ? -1 : rows.slice(0, 3).findIndex((r) => { const top = [...r.querySelectorAll(":scope > th, :scope > td")]; return top.length >= 2 && CUES.test(top[0].textContent ?? "") && NOTES.test(top[1].textContent ?? ""); });
    if (k < 0 && !marked) continue;
    for (const r of rows.slice(k + 1)) {
      const c = [...r.querySelectorAll(":scope > td, :scope > th")];
      if (c.length >= 2) add(c[0].textContent ?? "", c[1].innerHTML, c[1].textContent ?? "");
    }
  }
  for (const el of doc.querySelectorAll("p, li")) {
    // Lines inside a regular toggle are that card's answer; inside a toggle heading (a folded section) they still count.
    const box = el.closest("details");
    if ((box && !box.hasAttribute("data-heading")) || el.closest("summary, pre, code")) continue;
    if (el.tagName === "LI" && el.querySelector("p")) continue; // the <p> inside the item is handled itself
    const text = el.textContent ?? "";
    const i = text.indexOf("::");
    if (i <= 0) continue;
    const q = text.slice(0, i), a = text.slice(i + 2);
    add(q, `<p>${esc(a.trim())}</p>`, a);
  }
  return out;
}

/** Sentences with their bold / highlighted phrases, for fill in the blanks. Browser only (DOMParser). */
export function extractMarks(html: string): { text: string; marks: string[] }[] {
  if (!html || typeof DOMParser === "undefined") return [];
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const out: { text: string; marks: string[] }[] = [];
  for (const el of doc.querySelectorAll("p, li, h1, h2, h3, blockquote")) {
    if (el.closest("summary, pre, code") || (el.tagName === "LI" && el.querySelector("p")) || (el.tagName === "BLOCKQUOTE" && el.querySelector("p"))) continue;
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!text || text.includes("::")) continue;
    const marks = [...el.querySelectorAll("strong, b, mark")].map((m) => (m.textContent ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);
    if (marks.length) out.push({ text, marks });
  }
  return out;
}

/**
 * About how many flashcards a page has, without a DOM (the Worker lists study pages with it): toggles that aren't
 * toggle headings, plus "term :: definition" lines outside code. extractCards is the exact count in the browser.
 */
export function countCards(html: string): number {
  if (!html) return 0;
  const toggles = (html.match(/<details(?![^>]*data-heading)[^>]*>/gi) ?? []).length;
  const plain = html.replace(/<pre[\s\S]*?<\/pre>/gi, "").replace(/<code[\s\S]*?<\/code>/gi, "");
  let lines = 0;
  for (const seg of plain.split(/<\/(?:p|li)>/i)) {
    const t = seg.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").trim();
    const i = t.lastIndexOf("::");
    if (i > 0 && t.slice(i + 2).trim()) lines++;
  }
  // Cornell rows with both cells filled
  let cornell = 0;
  for (const t of html.match(/<table[\s\S]*?<\/table>/gi) ?? []) {
    const rows = t.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
    const cells = (r: string) => (r.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi) ?? []).map((c) => c.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").trim());
    const marked = /data-format="cornell"/.test(t);
    const k = marked ? -1 : rows.slice(0, 3).findIndex((r) => { const top = cells(r); return top.length >= 2 && CUES.test(top[0]) && NOTES.test(top[1]); });
    if (k < 0 && !marked) continue;
    cornell += rows.slice(k + 1).filter((r) => { const c = cells(r); return c.length >= 2 && !!c[0] && !!c[1]; }).length;
  }
  return toggles + lines + cornell;
}
