// Weak spots inside notes (src/client/study/weak.ts). node --experimental-strip-types tests/unit/weak.test.mts
import { findSpots, spotTerms } from "../../src/client/study/weak.ts";

let fails = 0, n = 0;
const eq = (what: string, got: unknown, want: unknown) => { n++; if (JSON.stringify(got) !== JSON.stringify(want)) { fails++; console.log(`FAIL ${what}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); } };

eq("terms: short answers, alternatives split", spotTerms([{ q: "Where?", answer: "Chloroplasts", misses: 3 }, { q: "Word?", answer: "osmosis / osmotic", misses: 2 }]).map((t) => t.term), ["Chloroplasts", "osmosis", "osmotic"]);
eq("terms: too short or too long are skipped", spotTerms([{ q: "a", answer: "ab", misses: 2 }, { q: "b", answer: "x".repeat(61), misses: 2 }, { q: "c", answer: "!!!", misses: 2 }]).length, 0);
eq("terms: key points split on |", spotTerms([{ q: "Explain", answer: "water moves | across a membrane", misses: 2 }]).map((t) => t.term), ["water moves", "across a membrane"]);

const blocks = [
  { pos: 0, size: 30, text: "Cell structure" },
  { pos: 30, size: 80, text: "Photosynthesis happens in the chloroplasts, using light." },
  { pos: 110, size: 60, text: "Osmosis moves water across a membrane." },
  { pos: 170, size: 40, text: "The chloroplasts again." },
];
const found = findSpots(blocks, spotTerms([{ q: "Where does photosynthesis happen?", answer: "Chloroplasts", misses: 3 }, { q: "What moves water?", answer: "osmosis", misses: 2 }]));
eq("found: the first block with each answer, any case", found.map((f) => [f.pos, f.label]), [[30, "missed 3 times"], [110, "missed 2 times"]]);
eq("found: the question in the tooltip", found[0].title, "You keep missing: Where does photosynthesis happen?");
eq("found: whole words only", findSpots([{ pos: 0, size: 10, text: "chloroplastsy" }], [{ term: "chloroplasts", misses: 2, q: "q" }]).length, 0);
eq("found: accents and punctuation don't matter", findSpots([{ pos: 0, size: 10, text: "Le café, c'est bon." }], [{ term: "cafe", misses: 2, q: "q" }]).length, 1);
const two = findSpots([blocks[1]], [{ term: "chloroplasts", misses: 2, q: "A?" }, { term: "light", misses: 4, q: "B?" }]);
eq("found: one block found twice keeps the most misses and both questions", [two.length, two[0].label, two[0].title], [1, "missed 4 times", "You keep missing: A?\nB?"]);
eq("found: nothing to find", findSpots(blocks, []), []);

console.log(fails ? `${fails} of ${n} failed` : `${n} passed`);
process.exit(fails ? 1 : 0);
