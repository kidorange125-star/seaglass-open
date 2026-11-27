// Unfinished quizzes and tests kept on the device (src/client/study/resume.ts).
// node --experimental-strip-types tests/unit/resume.test.mts
const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
const R = await import("../../src/client/study/resume.ts");

let fails = 0, n = 0;
const eq = (what: string, got: unknown, want: unknown) => { n++; const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) { fails++; console.log(`FAIL ${what}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); } };
const DAY = 86_400_000, T = 1_800_000_000_000;
const entry = (key: string, extra: Partial<Parameters<typeof R.keepUnfinished>[0]> = {}) => ({ key, kind: "quiz" as const, ids: ["p1"], title: "Cells", replay: false, at: 0, done: 3, total: 10, elapsed: 60, state: { i: 3 }, ...extra });

// keys
eq("notes key", R.resumeKey("quiz", ["a", "b"]), "quiz:notes:a,b");
eq("same replay, same key", R.resumeKey("quiz", ["a"], { items: [1, 2] }), R.resumeKey("quiz", ["a"], { items: [1, 2] }));
eq("different replay questions, different key", R.resumeKey("quiz", ["a"], { items: [1, 2] }) === R.resumeKey("quiz", ["a"], { items: [1, 3] }), false);
eq("a replay never matches the notes key", R.resumeKey("test", ["a"], [{ q: "x" }]) === R.resumeKey("test", ["a"]), false);
eq("kinds differ", R.resumeKey("quiz", ["a"]) === R.resumeKey("blanks", ["a"]), false);

// keep, get, order
R.keepUnfinished(entry("k1"), T);
R.keepUnfinished(entry("k2", { title: "Atoms" }), T + 1000);
eq("newest first", R.unfinished(T + 2000).map((x) => x.key), ["k2", "k1"]);
eq("get one, stamped with when it was kept", R.getUnfinished("k1", T + 2000)?.at, T);
eq("state comes back intact", R.getUnfinished("k1", T + 2000)?.state, { i: 3 });
R.keepUnfinished(entry("k1", { done: 5 }), T + 3000);
eq("keeping again replaces it and moves it to the top", R.unfinished(T + 4000).map((x) => `${x.key}:${x.done}`), ["k1:5", "k2:3"]);

// limit and age
for (let i = 0; i < 7; i++) R.keepUnfinished(entry(`m${i}`), T + 10_000 + i);
eq(`at most ${R.MAX}`, R.unfinished(T + 20_000).length, R.MAX);
eq("the oldest ones go", R.unfinished(T + 20_000).map((x) => x.key), ["m6", "m5", "m4", "m3", "m2"]);
eq(`gone after ${R.DAYS} days`, R.unfinished(T + 10_006 + R.DAYS * DAY).length, 0);
eq("and not found", R.getUnfinished("m6", T + 10_006 + R.DAYS * DAY), null);
eq("still there just before", R.getUnfinished("m6", T + 10_006 + R.DAYS * DAY - 1)?.key, "m6");

// drop
R.dropUnfinished("m6");
eq("dropped", R.getUnfinished("m6", T + 20_000), null);
R.dropUnfinished("nothing-here");
eq("dropping one that isn't there is fine", R.unfinished(T + 20_000).length, R.MAX - 1);

// bad storage
mem.set("sg.study.unfinished", "{not json");
eq("broken storage reads as empty", R.unfinished(T), []);
mem.set("sg.study.unfinished", JSON.stringify([{ nope: 1 }, entry("ok", { at: T })]));
eq("junk entries are skipped", R.unfinished(T + 1).map((x) => x.key), ["ok"]);

// label
eq("lands on the next question", R.resumeAt({ done: 3, total: 10 }), "question 4 of 10");
eq("never past the last", R.resumeAt({ done: 10, total: 10 }), "question 10 of 10");

console.log(fails ? `${fails} of ${n} failed` : `${n} passed`);
process.exit(fails ? 1 : 0);
