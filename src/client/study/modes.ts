// Study games built from a page's flashcards (study/cards.ts): a multiple-choice quiz, fill in the blanks and a
// matching game. Pure functions (randomness passed in) so they can be tested in Node: tests/unit/study.test.mjs.
import type { Card } from "./cards";

export type Rand = () => number;

export function shuffle<T>(xs: readonly T[], rand: Rand = Math.random): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Lower case, no accents, punctuation or extra spaces: what two answers are compared on. */
export const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

/** Edit distance (Levenshtein), for forgiving small typos. */
export function distance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

const ARTICLE = /^(the|a|an) /;
/**
 * Whether a typed answer counts: same words ignoring case, accents and punctuation, an optional leading "the/a/an",
 * and a typo or two on longer words (none on short ones, so "cat" isn't "car"). "x / y" or "x; y" accepts either.
 */
export function answerMatches(expected: string, given: string): boolean {
  const g = norm(given).replace(ARTICLE, "");
  if (!g) return false;
  return expected.split(/\s*(?:\/|;)\s*/).some((alt) => {
    const e = norm(alt).replace(ARTICLE, "");
    if (!e) return false;
    if (e === g) return true;
    const allow = e.length <= 4 ? 0 : e.length <= 8 ? 1 : 2;
    return distance(e, g) <= allow;
  });
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);

// ---------------------------------------------------------------- quiz (multiple choice)
export interface QuizItem { cardId: string; prompt: string; options: string[]; answer: number; reverse: boolean; why?: string; miss?: string }

/**
 * One question per card: pick its answer among up to three other cards' answers. Short "term :: definition" cards are
 * sometimes asked the other way round (definition shown, pick the term), so both directions get practised.
 */
export function makeQuiz(cards: Card[], rand: Rand = Math.random): QuizItem[] {
  if (cards.length < 2) return [];
  return shuffle(cards, rand).map((c) => {
    const reverse = words(c.question).length <= 5 && rand() < 0.4;
    const right = reverse ? c.question : clip(c.answerText, 180);
    const pool = shuffle(cards.filter((o) => o.id !== c.id), rand).map((o) => (reverse ? o.question : clip(o.answerText, 180)));
    const wrong: string[] = [];
    for (const w of pool) if (wrong.length < 3 && norm(w) !== norm(right) && !wrong.some((x) => norm(x) === norm(w))) wrong.push(w);
    const options = shuffle([right, ...wrong], rand);
    return { cardId: c.id, prompt: reverse ? clip(c.answerText, 300) : c.question, options, answer: options.indexOf(right), reverse };
  });
}

// ---------------------------------------------------------------- fill in the blanks
export interface BlankItem { id: string; cardId?: string; clue?: string; before: string; after: string; answer: string }

const STOP = new Set(("about above after again against also among because been before being below between both but called can could does doing down during each from further have having here into itself just like made make many more most much must only other over same should since some such than that their them then there these they this those through under until very were what when where which while with within would your").split(" "));

/** The word in a sentence most worth blanking: the longest non-filler word (ties: the earliest), or null. */
export function keyWord(text: string, avoid = ""): string | null {
  const skip = new Set(words(norm(avoid)));
  let best: string | null = null;
  for (const w of text.match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? []) {
    const n = norm(w);
    if (n.length < 4 || STOP.has(n) || skip.has(n) || /^\d+$/.test(n)) continue;
    if (!best || n.length > norm(best).length) best = w;
  }
  return best;
}

/** Splits text around the first whole-word occurrence of `word`. */
function around(text: string, word: string): { before: string; after: string } | null {
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?![\\p{L}\\p{N}])`, "iu");
  const m = re.exec(text);
  if (!m) return null;
  const at = m.index + m[1].length;
  return { before: text.slice(0, at), after: text.slice(at + m[2].length) };
}

/**
 * Blanks from cards: a short term is blanked with its definition as the clue ("_____ : the powerhouse of the cell");
 * a longer question keeps the question as the clue and blanks the key word of the answer.
 */
export function blanksFromCards(cards: Card[]): BlankItem[] {
  const out: BlankItem[] = [];
  for (const c of cards) {
    if (words(c.question).length <= 4) {
      out.push({ id: `t-${c.id}`, cardId: c.id, before: "", after: ` : ${clip(c.answerText, 260)}`, answer: c.question.replace(/[?:]\s*$/, "") });
      continue;
    }
    const text = clip(c.answerText, 300), w = keyWord(text, c.question);
    const parts = w ? around(text, w) : null;
    if (w && parts) out.push({ id: `a-${c.id}`, cardId: c.id, clue: c.question, ...parts, answer: w });
  }
  return out;
}

/** Blanks from a page's own sentences: every bold or highlighted phrase (up to five words) becomes a blank. */
export function blanksFromMarks(sentences: { text: string; marks: string[] }[]): BlankItem[] {
  const out: BlankItem[] = [], seen = new Set<string>();
  sentences.forEach((s, i) => {
    for (const m of s.marks) {
      const mark = m.trim();
      if (!mark || words(mark).length > 5 || seen.has(norm(mark)) || s.text.trim().length <= mark.length + 3) continue;
      const parts = around(s.text, mark);
      if (!parts) continue;
      seen.add(norm(mark));
      out.push({ id: `m-${i}-${norm(mark)}`, ...parts, answer: mark });
    }
  });
  return out;
}

// ---------------------------------------------------------------- match
export interface MatchTile { key: string; pair: string; side: "term" | "def"; text: string }

/** Rounds of up to `size` pairs, each round's tiles shuffled: terms and their answers to pair up. */
export function matchRounds(cards: Card[], size = 6, rand: Rand = Math.random): MatchTile[][] {
  const pool = shuffle(cards, rand), rounds: MatchTile[][] = [];
  for (let i = 0; i < pool.length; i += size) {
    const chunk = pool.slice(i, i + size);
    if (chunk.length < 2 && rounds.length) { rounds[rounds.length - 1] = shuffle([...rounds[rounds.length - 1], ...tiles(chunk)], rand); break; }
    rounds.push(shuffle(tiles(chunk), rand));
  }
  return rounds;
}
const tiles = (cs: Card[]): MatchTile[] => cs.flatMap((c) => [
  { key: `q-${c.id}`, pair: c.id, side: "term" as const, text: clip(c.question, 90) },
  { key: `a-${c.id}`, pair: c.id, side: "def" as const, text: clip(c.answerText, 120) },
]);
