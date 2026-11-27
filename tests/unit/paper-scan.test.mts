// Paper Lock, version 2: finding the card in a photo (scan.ts) and matching its drawing (match.ts). Synthetic phone photos
// of a card on a darker surface, turned, tilted and lit unevenly. The same card must match from any photo; the same
// motif drawn again (strokes 3 to 8% off), other cards, mirror images and too-simple drawings must not.
// node --experimental-strip-types tests/unit/paper-scan.test.mts
import { findCard, rectify, CARD_W, CARD_H, type Quad } from "../../src/client/paper/scan.ts";
import { cardInk, matchesCard, MATCH, ENROLL, packBits, quality, score, unpackBits, vote, GN } from "../../src/client/paper/match.ts";
import { fullCard, redraw, scene, type Card, type Pt } from "../helpers/paperCards.mts";

let fails = 0, n = 0;
const ok = (what: string, cond: boolean, extra = "") => { n++; if (!cond) { fails++; console.log(`FAIL ${what} ${extra}`); } };

/** A photo read the way the phone reads it: find the card at about 360 px across, straighten it at full size, read the ink. */
function read(s: ReturnType<typeof scene>) {
  const f = findCard(s.px, s.W, s.H);
  if (!f.ok) return { found: f, bits: null as Uint8Array | null };
  return { found: f, bits: cardInk(rectify(s.px, s.W, s.H, f.quad), CARD_W, CARD_H) };
}
const err = (q: Quad, truth: Pt[]) => Math.max(...q.map((p, i) => Math.hypot(p[0] - truth[i][0], p[1] - truth[i][1]))) / Math.hypot(truth[1][0] - truth[0][0], truth[1][1] - truth[0][1]);

// ---- finding the card
let worst = 0, missed = 0;
for (let i = 0; i < 24; i++) {
  const s = scene(fullCard(10 + i), 100 + i, { turn: 18, tilt: 0.08, fill: 0.5 + (i % 4) * 0.08 });
  const f = findCard(s.px, s.W, s.H);
  if (!f.ok) { missed++; console.log("  missed:", f.message); continue; }
  worst = Math.max(worst, err(f.quad, s.corners));
}
console.log(`corners: worst error ${(worst * 100).toFixed(2)}% of the card's width, missed ${missed} of 24`);
ok("the card is found in every photo (turned, tilted, near or far)", missed === 0);
ok("its corners within 2% of the card's width", worst < 0.02, `${worst}`);
ok("a card on a lighter table is still found", findCard(...(() => { const s = scene(fullCard(3), 3, { bg: 110 }); return [s.px, s.W, s.H] as const; })()).ok);
const refuse = (what: string, s: ReturnType<typeof scene>, reason: string) => { const f = findCard(s.px, s.W, s.H); ok(what, !f.ok && f.reason === reason, JSON.stringify(f.ok ? "found" : f.reason)); };
refuse("two overlapping cards are refused (show one card)", scene(fullCard(4), 4, { extra: "overlap" }), "shape");
refuse("a card cut off by the edge of the photo is refused", scene(fullCard(5), 5, { extra: "edge", turn: 0 }), "edge");
refuse("a card held upright is asked to be turned sideways", scene(fullCard(6), 6, { extra: "portrait", turn: 0, fill: 0.45 }), "sideways");
const black = new Uint8ClampedArray(480 * 640 * 4).fill(40); for (let i = 3; i < black.length; i += 4) black[i] = 255;
ok("a dark frame with no card is refused", !findCard(black, 480, 640).ok);
ok("a card far away is asked to come closer", (() => { const s = scene(fullCard(7), 7, { fill: 0.18 }); const f = findCard(s.px, s.W, s.H); return !f.ok && f.reason === "small"; })());

// ---- quality: no rule on how much is drawn, only that there's a drawing and the photo isn't dark
const waves: Card = { strokes: [0, 1, 2].map((k) => Array.from({ length: 12 }, (_, i): Pt => [170 + i * 15, 95 + k * 55 + Math.sin(i / 1.8) * 16])), ink: [30, 110, 190] };
const wr = read(scene(waves, 8));
ok("three curved strokes are a card", !!wr.bits && quality(wr.bits).ok, wr.bits ? JSON.stringify(quality(wr.bits)) : "not found");
const blankCard = read(scene({ strokes: [], ink: [20, 20, 30] }, 8));
ok("a blank card is not", !!blankCard.bits && !quality(blankCard.bits).ok);
// two simple cards in the same style, drawn separately, stay far apart
const waves2: Card = { strokes: [0, 1, 2].map((k) => Array.from({ length: 12 }, (_, i): Pt => [150 + i * 17, 110 + k * 50 + Math.sin(i / 2.2 + k) * 20])), ink: [30, 110, 190] };
const simpleSetup = [11, 12, 13].map((k) => read(scene(waves, k)).bits!);
ok("another card of three waves doesn't open a three-wave card", !matchesCard(read(scene(waves2, 14)).bits!, simpleSetup), String(score(read(scene(waves2, 14)).bits!, simpleSetup[0])));
ok("the three-wave card itself, from another photo, does", matchesCard(read(scene(waves, 15, { turn: 15, tilt: 0.08 })).bits!, simpleSetup));
ok("the same three waves redrawn by hand (5% off) don't", !matchesCard(read(scene(redraw(waves, 16, 0.05), 17)).bits!, simpleSetup));
const fr = read(scene(fullCard(9), 9));
ok("a card drawn all over is a good key", !!fr.bits && quality(fr.bits).ok, fr.bits ? JSON.stringify(quality(fr.bits)) : "not found");

// ---- the same card from different photos; the same motif drawn again; other cards
const genuine: number[] = [], copies: number[][] = [[], [], []], others: number[] = [];
for (let c = 0; c < 8; c++) {
  const card = fullCard(200 + c);
  const shots = [0, 1, 2, 3].map((k) => read(scene(card, 300 + c * 10 + k, { turn: 15, tilt: 0.07 })).bits!);
  for (let k = 1; k < 4; k++) genuine.push(score(shots[k], shots[0]));
  [0.03, 0.05, 0.08].forEach((amt, j) => { copies[j].push(score(read(scene(redraw(card, 400 + c, amt), 500 + c)).bits!, shots[0])); });
  others.push(score(read(scene(fullCard(600 + c), 700 + c)).bits!, shots[0])); 
}
const ta = read(scene(fullCard(900), 950)).bits!, tb = read(scene(fullCard(900), 951)).bits!, t0 = Date.now(); for (let i = 0; i < 20; i++) score(ta, tb); const ms = (Date.now() - t0) / 20;
const min = (a: number[]) => Math.min(...a).toFixed(3), max = (a: number[]) => Math.max(...a).toFixed(3);
console.log(`same card from another photo: min ${min(genuine)} | redrawn 3%: max ${max(copies[0])}, 5%: max ${max(copies[1])}, 8%: max ${max(copies[2])} | other cards: max ${max(others)} | match at ${MATCH} | ~${ms.toFixed(1)} ms a compare`);
ok("the same card matches from any photo, with room to spare", Math.min(...genuine) >= MATCH + 0.06, min(genuine));
ok("the same motif drawn again 5% off does not match", Math.max(...copies[1]) < MATCH - 0.1, max(copies[1]));
ok("8% off is nowhere near", Math.max(...copies[2]) < MATCH - 0.2, max(copies[2]));
ok("a careful copy (3% off, close to tracing) still scores below the card itself", Math.max(...copies[0]) < Math.min(...genuine), max(copies[0]));
ok("other cards are nowhere near", Math.max(...others) < MATCH - 0.25, max(others));

// ---- the whole decision: three setup scans, then a scan must agree with two of them
const key = fullCard(800);
const setup = [1, 2, 3].map((k) => read(scene(key, 810 + k)).bits!);
ok("the setup scans agree with each other", score(setup[0], setup[1]) >= ENROLL && score(setup[1], setup[2]) >= ENROLL);
ok("a new photo of the card opens it", matchesCard(read(scene(key, 820, { turn: 20, tilt: 0.1, fill: 0.85 })).bits!, setup));
ok("a copy drawn from memory doesn't", !matchesCard(read(scene(redraw(key, 821, 0.05), 822)).bits!, setup));
const mirror: Card = { ...key, strokes: key.strokes.map((s) => s.map(([x, y]): Pt => [500 - x, y])) };
ok("the card's mirror image doesn't", !matchesCard(read(scene(mirror, 823)).bits!, setup));
const upside: Card = { ...key, strokes: key.strokes.map((s) => s.map(([x, y]): Pt => [500 - x, 300 - y])) };
ok("the card upside down doesn't", !matchesCard(read(scene(upside, 824)).bits!, setup));
ok("three frames voted into one are still the card", matchesCard(vote([820, 825, 826].map((k) => read(scene(key, k)).bits!)), setup));
ok("timing: a comparison of two full cards stays under 10 ms", ms < 10, `${ms}`);

// ---- travel
const bits = setup[0], back = unpackBits(packBits(bits))!;
ok("a read survives packing", back.length === GN && back.every((v, i) => v === bits[i]));
ok("junk is not a read", unpackBits("abc") === null && unpackBits(7) === null && unpackBits("A".repeat(9000)) === null);

console.log(fails ? `${fails} of ${n} failed` : `all ${n} good`);
process.exit(fails ? 1 : 0);
