// Weak spots inside notes (#14): the parts of a page the user keeps missing get a subtle highlight, "missed 3 times". The missed
// questions come from worker misses.ts (only ones missed at least twice); this finds where each answer sits in the page.
// Pure, no imports: tests/unit/weak.test.mts. The editor side is editor/weakSpots.ts.

export interface Spot { q: string; answer: string; misses: number }
export interface Term { term: string; misses: number; q: string }
export interface Block { pos: number; size: number; text: string }
export interface Found { pos: number; size: number; misses: number; label: string; title: string }

const norm = (s: string) => ` ${s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
const MIN = 3, MAX = 60;

/** What to look for: each answer short enough to appear in the notes as written ("a / b" alternatives are separate). */
export function spotTerms(spots: Spot[]): Term[] {
  const out: Term[] = [];
  for (const s of spots) {
    for (const alt of s.answer.split(/\s+\/\s+|\s+\|\s+/)) {
      const t = alt.trim();
      if (t.length >= MIN && t.length <= MAX && norm(t).trim().length >= MIN) out.push({ term: t, misses: s.misses, q: s.q });
    }
  }
  return out;
}

/** The block each term first appears in (whole words, any case or accent). A block found by several takes the most misses. */
export function findSpots(blocks: Block[], terms: Term[]): Found[] {
  const hits = new Map<number, Found>();
  const texts = blocks.map((b) => norm(b.text));
  for (const t of terms) {
    const want = norm(t.term);
    const k = texts.findIndex((x) => x.includes(want));
    if (k < 0) continue;
    const b = blocks[k], prev = hits.get(b.pos);
    const misses = Math.max(prev?.misses ?? 0, t.misses);
    hits.set(b.pos, { pos: b.pos, size: b.size, misses, label: `missed ${misses} times`, title: prev ? `${prev.title}\n${t.q}` : `You keep missing: ${t.q}` });
  }
  return [...hits.values()].sort((a, b) => a.pos - b.pos);
}

const KEY = "sg.weak.off";
export const weakSpotsOn = () => { try { return localStorage.getItem(KEY) !== "1"; } catch { return true; } };
export const setWeakSpotsOn = (on: boolean) => { try { if (on) localStorage.removeItem(KEY); else localStorage.setItem(KEY, "1"); } catch { /* storage blocked */ } dispatchEvent(new Event("seaglass:weak")); };
