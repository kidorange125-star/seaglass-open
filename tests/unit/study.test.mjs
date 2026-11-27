// Study mode scheduling (SM-2 style). Run: node tests/unit/study.test.mjs
import { newState, review, hint, isState } from "../../src/client/study/srs.ts";
import { cardId } from "../../src/client/study/cards.ts";

let ok = 0, bad = 0;
const eq = (name, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) ok++; else { bad++; console.log("FAIL", name, "got", g, "want", w); } };
const T = "2026-11-06";

const n = newState(T);
eq("new card: Again stays due today", review(n, "again", T).due, T);
eq("new card: Good -> tomorrow", review(n, "good", T).due, "2026-11-07");
eq("new card: Easy -> 4 days", review(n, "easy", T).interval, 4);
const g1 = review(n, "good", T);
eq("second Good -> 3 days", review(g1, "good", T).interval, 3);
eq("second Easy beats Good (5 days)", review(g1, "easy", T).interval, 5);
const g2 = review(g1, "good", T);
eq("third Good grows by ease (3 * 2.5 = 8)", review(g2, "good", T).interval, 8);
eq("Hard grows slower than Good", review(g2, "hard", T).interval < review(g2, "good", T).interval, true);
eq("Easy grows faster than Good", review(g2, "easy", T).interval > review(g2, "good", T).interval, true);
const lapsed = review(review(g2, "good", T), "again", T);
eq("forgetting a learned card counts a lapse", lapsed.lapses, 1);
eq("forgetting resets reps", lapsed.reps, 0);
eq("ease never drops below 1.3", Array.from({ length: 20 }).reduce((s) => review(s, "again", T), n).ease, 1.3);
eq("hints", ["again", "hard", "good", "easy"].map((x) => hint(g2, x, T)), ["Now", "4d", "8d", "10d"]);
eq("long intervals read as weeks/months", hint({ ease: 2.5, interval: 40, reps: 5, lapses: 0, due: T }, "good", T), "3mo");
eq("valid state", isState(g2), true);
eq("rejects junk", [isState(null), isState({ ease: "x" }), isState({ ...g2, due: "tomorrow" }), isState({ ...g2, interval: -1 })], [false, false, false, false]);
eq("card id ignores case and spacing", cardId("What is  Mitosis?") === cardId("what is mitosis?"), true);
eq("different questions differ", cardId("Mitosis") === cardId("Meiosis"), false);

console.log(`${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
