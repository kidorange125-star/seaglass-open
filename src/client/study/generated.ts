// What the assistant writes for the Study tab: new flashcards for a page, and the questions for the Quiz, Fill in the
// blanks and Match games. The Worker checks a reply with these before saving it (a malformed item is dropped, never
// shown); the games turn a saved set into a round. Pure functions, DOM-free: tests/unit/study-modes.test.mjs.
import { cardId, type Card } from "./cards.ts"; // .ts so the unit tests can load this file in plain Node
import { norm, shuffle, type BlankItem, type QuizItem, type Rand } from "./modes.ts";

export type SetMode = "quiz" | "blanks" | "match";
export interface GenQuiz { q: string; options: string[]; answer: number; why?: string; miss?: string } // miss: a missed question coming back
export interface GenBlank { before: string; answer: string; after: string; clue?: string }
export interface GenPair { term: string; match: string }
export type StudySet = { mode: "quiz"; items: GenQuiz[] } | { mode: "blanks"; items: GenBlank[] } | { mode: "match"; items: GenPair[] };
export interface GenCard { q: string; a: string }

/** How to rewrite a game's questions: a button after a session, or the assistant's own words. */
export interface StudyChange { kind: "harder" | "easier" | "focus" | "custom"; missed?: string[]; text?: string }
export function cleanChange(raw: unknown): StudyChange | undefined {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (r.kind !== "harder" && r.kind !== "easier" && r.kind !== "focus" && r.kind !== "custom") return undefined;
  const missed = (Array.isArray(r.missed) ? r.missed : []).map((x) => str(x, 300)).filter(Boolean).slice(0, 15), text = str(r.text, 600);
  if (r.kind === "custom" && !text) return undefined;
  return { kind: r.kind, ...(missed.length ? { missed } : {}), ...(text ? { text } : {}) };
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);
const unique = <T>(xs: T[], key: (x: T) => string) => { const seen = new Set<string>(); return xs.filter((x) => { const k = key(x); return !seen.has(k) && !!seen.add(k); }); };

function cleanQuiz(raw: unknown): GenQuiz[] {
  const out: GenQuiz[] = [];
  for (const r of list(raw)) {
    const q = str(r.q, 500), given = Array.isArray(r.options) ? r.options : [];
    const options = given.map((o) => str(o, 300)).filter(Boolean);
    const answer = r.answer;
    // a dropped option would shift the answer's index, so the whole question goes
    if (!q || options.length !== given.length || options.length < 2 || options.length > 5) continue;
    if (typeof answer !== "number" || !Number.isInteger(answer) || answer < 0 || answer >= options.length) continue;
    if (new Set(options.map(norm)).size !== options.length) continue;
    const why = str(r.why, 400);
    out.push({ q, options, answer, ...(why ? { why } : {}) });
  }
  return unique(out, (x) => norm(x.q));
}

/** Text around the gap, spaced so the sentence reads right (no space next to punctuation). */
const beforeGap = (s: string) => (!s || /[(\[“"'‘]$/.test(s) ? s : `${s} `);
const afterGap = (s: string) => (!s || /^[.,;:!?)\]”"'’]/.test(s) ? s : ` ${s}`);

function cleanBlanks(raw: unknown): GenBlank[] {
  const out: GenBlank[] = [];
  for (const r of list(raw)) {
    const before = str(r.before, 400), after = str(r.after, 400), answer = str(r.answer, 80), clue = str(r.clue, 300);
    if (!answer || (!before && !after)) continue;
    // the sentence mustn't give the word away
    const first = answer.split(/\s*[/;]\s*/)[0];
    if (norm(first) && ` ${norm(`${before} ${after}`)} `.includes(` ${norm(first)} `)) continue;
    out.push({ before: beforeGap(before), answer, after: afterGap(after), ...(clue ? { clue } : {}) });
  }
  return unique(out, (x) => norm(`${x.before}|${x.after}`));
}

function cleanPairs(raw: unknown): GenPair[] {
  const out: GenPair[] = [];
  for (const r of list(raw)) {
    const term = str(r.term, 90), match = str(r.match, 160);
    if (term && match && norm(term) !== norm(match)) out.push({ term, match });
  }
  return unique(unique(out, (x) => norm(x.term)), (x) => norm(x.match));
}

/** Keeps only well-formed items of a game's set. */
export function cleanSet(mode: SetMode, raw: unknown): StudySet {
  if (mode === "quiz") return { mode, items: cleanQuiz(raw) };
  if (mode === "blanks") return { mode, items: cleanBlanks(raw) };
  return { mode, items: cleanPairs(raw) };
}

/** Enough to play? Match needs two pairs to have anything to tell apart. */
export const playable = (set: StudySet) => set.items.length >= (set.mode === "match" ? 2 : 1);

/** What a set already asks, so "New questions" can ask something else. */
export function asked(set: StudySet): string[] {
  if (set.mode === "quiz") return set.items.map((x) => x.q);
  if (set.mode === "blanks") return set.items.map((x) => `${x.before}_____${x.after}`);
  return set.items.map((x) => x.term);
}

// ---------------------------------------------------------------- from a saved set to a round
/** Questions in a new order and each question's options shuffled (models favour certain answer positions). */
export function quizFromSet(items: GenQuiz[], rand: Rand = Math.random): QuizItem[] {
  return shuffle(items.map((x, i) => ({ x, i })), rand).map(({ x, i }) => {
    const opts = shuffle(x.options.map((text, k) => ({ text, k })), rand);
    return { cardId: `w${i}`, prompt: x.q, options: opts.map((o) => o.text), answer: opts.findIndex((o) => o.k === x.answer), reverse: false, why: x.why, ...(x.miss ? { miss: x.miss } : {}) };
  });
}
export const blanksFromSet = (items: GenBlank[]): BlankItem[] => items.map((x, i) => ({ id: `w${i}`, before: x.before, after: x.after, answer: x.answer, clue: x.clue }));
export const pairsToCards = (items: GenPair[]): Card[] => items.map((x) => ({ id: cardId(x.term), question: x.term, answerText: x.match, answerHtml: "" }));

// ---------------------------------------------------------------- flashcards written onto a page
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/** The questions a page's flashcards already ask, without a DOM (the Worker uses it to avoid repeats). */
export function existingQuestions(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<details(?![^>]*data-heading)[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>/gi)) out.push(text(m[1]));
  const plain = html.replace(/<pre[\s\S]*?<\/pre>/gi, "").replace(/<code[\s\S]*?<\/code>/gi, "").replace(/<details(?![^>]*data-heading)[\s\S]*?<\/details>/gi, "");
  for (const seg of plain.split(/<\/(?:p|li)>/i)) {
    const line = text(seg.split(/<\/(?:h[1-6]|div|ul|ol|details|summary|blockquote)>/i).pop() ?? "");
    const i = line.indexOf("::");
    if (i > 0 && line.slice(i + 2).trim()) out.push(line.slice(0, i).trim());
  }
  return out.filter(Boolean);
}

/** Well-formed new cards: no repeats of each other or of what the page already has. */
export function cleanCards(raw: unknown, existing: string[] = [], max = 30): GenCard[] {
  const have = new Set(existing.map(cardId));
  const cards = list(raw).map((r) => ({ q: str(r.q, 300), a: str(r.a, 1000) })).filter((c) => c.q && c.a && !have.has(cardId(c.q)));
  return unique(cards, (c) => cardId(c.q)).slice(0, max);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The toggles to add to a page, under a "Flashcards" heading unless it already has one. */
export function cardsHtml(cards: GenCard[], pageHtml: string): string {
  const heading = /<h2[^>]*>\s*Flashcards\s*<\/h2>/i.test(pageHtml) ? "" : "<h2>Flashcards</h2>";
  return heading + cards.map((c) => `<details><summary>${esc(c.q)}</summary><div data-type="detailsContent"><p>${esc(c.a)}</p></div></details>`).join("");
}
