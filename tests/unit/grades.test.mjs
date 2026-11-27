// Grade math. Run: node tests/unit/grades.test.mjs
import { letter, classAverages, gradeOf, neededFor, testOutlook, outlookLine } from "../../src/client/grades.ts";
let ok = 0, bad = 0;
const eq = (n, g, w) => { const a = JSON.stringify(g), b = JSON.stringify(w); if (a === b) ok++; else { bad++; console.log("FAIL", n, a, "!=", b); } };
eq("letters", [93, 92.9, 90, 87, 83, 80, 77, 73, 70, 67, 63, 60, 59.9, 100, 0].map(letter), ["A", "A-", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F", "A", "F"]);
const name = (id) => ({ a: "Algebra", s: "Science" })[id] ?? "";
const avg = classAverages([
  { props: { class: "a", score: 45, outof: 50 } },           // 90%
  { props: { class: "a", score: 8, outof: 10, weight: 2 } }, // weighted x2: (45+16)/(50+20) = 87.14%
  { props: { class: "s", score: 7, outof: 10 } },
  { props: { class: "s", score: "", outof: 10 } },           // ungraded: skipped
  { props: { class: "s", score: 5, outof: 0 } },             // bad max: skipped
  { props: { score: 1, outof: 2 } },                         // no class
], name);
eq("per class, sorted", avg.map((x) => x.name), ["Algebra", "No class", "Science"]);
eq("weighted average", Math.round(avg[0].pct * 100) / 100, 87.14);
eq("counts only graded", avg.find((x) => x.name === "Science").n, 1);
eq("no rows", classAverages([], name), []);

// what the user needs on the next test
const G = (score, outof = 100, weight = 1) => ({ score, outof, weight });
eq("needed: 90 and 80 so far, 85 to stay at 85", neededFor([G(90), G(80)], 85), 85);
eq("needed: to reach 90 from 90 and 80", neededFor([G(90), G(80)], 90), 100);
eq("needed: a heavier test needs less", neededFor([G(90), G(80)], 85, 2) <= 85, true);
eq("needed: nothing graded yet", neededFor([], 90), null);
eq("needed: other sizes count by percent", neededFor([G(45, 50), G(8, 10)], 90), neededFor([G(45, 50), G(8, 10)], 90));
const o = testOutlook([G(95), G(92)]);
eq("outlook: an A at 93.5, keep it with 92", [o.pct, o.letter, o.keep.letter, Math.ceil(o.keep.need)], [93.5, "A", "A", 92]);
eq("outlook: nothing above an A", o.up, null);
const b = testOutlook([G(85), G(84)]);
eq("outlook: a B at 84.5, B+ within reach", [b.letter, Math.ceil(b.keep.need), b.up.letter, Math.ceil(b.up.need)], ["B", 80, "B+", 92]);
eq("outlook: ten perfect scores still need 23% to keep the A", Math.ceil(testOutlook(Array(10).fill(G(100))).keep.need), 23);
eq("outlook: thirty perfect scores: safe whatever happens", testOutlook(Array(30).fill(G(100))).keep.need, 0);
eq("outlook: out of reach is left out", testOutlook([G(70), G(70)]).up.letter, "C");
eq("outlook line", outlookLine(b, "Unit 3 test"), "You need 80% on Unit 3 test to keep your B; 92% gets you a B+.");
eq("outlook line, A", outlookLine(o, "the final"), "You need 92% on the final to keep your A.");
eq("graded rows only", [gradeOf({ score: 8, outof: 10 }), gradeOf({ score: "", outof: 10 }), gradeOf({ score: 1, outof: 0 }), gradeOf({ score: 9, outof: 10, weight: 2 })], [{ score: 8, outof: 10, weight: 1 }, null, null, { score: 9, outof: 10, weight: 2 }]);
console.log(`${ok} passed, ${bad} failed`); if (bad) process.exit(1);
