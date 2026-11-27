// What the assistant says after a session: only real sessions are saved, and only buttons that do something are shown.
import { bestMode, dayPart, insightLines, studyInsights, checkLine, cleanCheck, cleanPrompts, explainFromPlayed, cleanGrade, draftPlan, fitPlan, gradeVsPractice, practiceGap, summarizeSessions, cleanCoach, cleanPlayed, cleanSession, defaultOffers, fallbackText, missAfter, nextStudy, planOpener, readiness, UNTESTED_CAP, reviewOf, setFromPlayed, talkOpener, testFromPlayed } from "../../src/client/study/coach.ts";
import { cleanChange } from "../../src/client/study/generated.ts";

let ok = 0, bad = 0;
const eq = (what, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want); if (a === b) ok++; else { bad++; console.log(`FAIL ${what}\n  got  ${a}\n  want ${b}`); } };
const yes = (what, v) => eq(what, !!v, true);

const ID = "11111111-1111-4111-8111-111111111111";
const base = { mode: "quiz", ids: [ID], title: "Cells", right: 2, total: 3, missed: [{ q: "What?", a: "That", yours: "This" }] };
const dos = (r) => r.offers.map((o) => o.do);

// sessions
eq("session: a good one passes", cleanSession(base), base);
eq("session: unknown mode", cleanSession({ ...base, mode: "nap" }), null);
eq("session: no pages", cleanSession({ ...base, ids: ["nope"] }), null);
eq("session: more right than total", cleanSession({ ...base, right: 9 }), null);
eq("session: a fraction", cleanSession({ ...base, right: 1.5 }), null);
eq("session: nothing answered isn't a session", cleanSession({ ...base, right: 0, total: 0 }), null);
yes("session: a chat has no score", cleanSession({ ...base, mode: "chat", right: 0, total: 0, missed: [] }));
eq("session: not an object", cleanSession("x"), null);
eq("session: duplicate pages are one", cleanSession({ ...base, ids: [ID, ID] }).ids, [ID]);
eq("session: a miss needs a question and an answer", cleanSession({ ...base, missed: [{ q: "", a: "x" }, { q: "y" }, { q: " a  b ", a: "c" }] }).missed, [{ q: "a b", a: "c" }]);
eq("session: misses are capped", cleanSession({ ...base, missed: Array.from({ length: 50 }, (_, i) => ({ q: `q${i}`, a: "a" })) }).missed.length, 30);

// the reply
const s = cleanSession(base);
const r = cleanCoach({ text: "  Nice  work ", offers: [{ label: "Go", do: "focus" }, { label: "Nope", do: "launch" }, { label: "Plan it", do: "plan" }] }, s);
eq("coach: text is tidied", r.text, "Nice work");
yes("coach: a button that doesn't exist is dropped", !dos(r).includes("launch"));
eq("coach: the model's label is kept", r.offers.find((o) => o.do === "plan").label, "Plan it");
eq("coach: at most four, planning and talking last", dos(r).slice(-2), ["plan", "chat"]);
yes("coach: four buttons", r.offers.length === 4);
yes("coach: always a way to change the questions", dos(r).some((d) => ["focus", "harder", "easier"].includes(d)));
yes("coach: no empty text", cleanCoach({ text: "" }, s).text.length > 10);
yes("coach: garbage still gives buttons", cleanCoach("nope", s).offers.length === 4);
yes("coach: no offering the game just played", !dos(cleanCoach({ offers: [{ label: "x", do: "quiz" }] }, s)).includes("quiz"));
const clean = { ...s, right: 3, missed: [] };
yes("coach: no 'what I missed' when nothing was", !dos(cleanCoach({ offers: [{ label: "x", do: "focus" }] }, clean)).includes("focus"));
eq("coach: repeats collapse", dos(cleanCoach({ offers: [{ label: "a", do: "harder" }, { label: "b", do: "harder" }] }, clean)).filter((d) => d === "harder").length, 1);
eq("coach: a long label is cut", cleanCoach({ offers: [{ label: "x".repeat(80), do: "harder" }] }, clean).offers[0].label.length, 34);

// defaults follow the score
yes("defaults: a perfect round goes harder", defaultOffers({ ...s, right: 3, missed: [] })[0].do === "harder");
yes("defaults: a bad round goes after the misses", defaultOffers({ ...s, right: 0 })[0].do === "focus");
yes("defaults: a bad round with no list goes easier", defaultOffers({ ...s, right: 0, missed: [] })[0].do === "easier");
yes("fallback: never praises a bad round", !/strong|perfect/i.test(fallbackText({ ...s, right: 0 })));
yes("fallback: a perfect round says so", fallbackText({ ...s, right: 3, missed: [] }).includes("All 3"));

// what the chat is told
yes("opener: the plan carries the score and the misses", planOpener(s).message.includes("2 of 3") && planOpener(s).message.includes("What?"));
yes("opener: talking it through carries what was said", talkOpener(s, "Well done").message.includes("Well done"));

// changing the questions
eq("change: a known kind", cleanChange({ kind: "harder" }), { kind: "harder" });
eq("change: unknown kind", cleanChange({ kind: "weird" }), undefined);
eq("change: nothing", cleanChange(undefined), undefined);
eq("change: custom needs words", cleanChange({ kind: "custom", text: " " }), undefined);
eq("change: misses are kept, blanks dropped", cleanChange({ kind: "focus", missed: ["a", "", 3] }), { kind: "focus", missed: ["a"] });

// the whole session, for History
const mcq = { type: "mcq", q: "Q?", answer: "A", right: true, yours: "A", why: "Because", options: ["A", "B"], correct: 0 };
eq("played: a good question passes", cleanPlayed([mcq], "quiz"), [mcq]);
eq("played: flashcards and Chat keep none", [cleanPlayed([mcq], "cards"), cleanPlayed([mcq], "chat")], [null, null]);
eq("played: not a list", cleanPlayed("nope", "quiz"), null);
eq("played: wrong kind for the mode is dropped", cleanPlayed([{ ...mcq, type: "short" }], "quiz"), null);
eq("played: an answer outside the options is dropped", cleanPlayed([{ ...mcq, correct: 2 }], "quiz"), null);
eq("played: a blank option would shift the answer, so it goes", cleanPlayed([{ ...mcq, options: ["A", ""] }], "quiz"), null);
eq("played: capped", cleanPlayed(Array(150).fill(mcq), "quiz").length, 100);
const blank = { type: "blank", q: "The _____ cell.", answer: "plant", right: false, yours: "dog", before: "The ", after: " cell." };
eq("played: the spaces around a gap survive", cleanPlayed([blank], "blanks"), [blank]);
eq("played: a blank needs a sentence", cleanPlayed([{ ...blank, before: " ", after: "" }], "blanks"), null);
const short = { type: "short", q: "Why?", answer: "Light", right: false, feedback: "Close" };
eq("review: mcq", reviewOf(mcq), { q: "Q?", right: true, answer: "A", yours: "A", note: undefined });
eq("review: nothing written", reviewOf(short).yours, "(blank)");
eq("review: feedback comes first", reviewOf({ ...short, why: "x" }).note, "Close");
eq("review: a pair shows its match", reviewOf({ type: "pair", q: "T", answer: "M", right: true }).yours, "M");
eq("retake: quiz", setFromPlayed("quiz", [mcq]), { mode: "quiz", items: [{ q: "Q?", options: ["A", "B"], answer: 0, why: "Because" }] });
eq("retake: blanks", setFromPlayed("blanks", [blank]), { mode: "blanks", items: [{ before: "The ", answer: "plant", after: " cell." }] });
eq("retake: match", setFromPlayed("match", [{ type: "pair", q: "T", answer: "M", right: true }]), { mode: "match", items: [{ term: "T", match: "M" }] });
eq("retake: practice test", testFromPlayed([mcq, short]), [{ type: "mcq", q: "Q?", options: ["A", "B"], answer: 0, explanation: "Because" }, { type: "short", q: "Why?", answer: "Light" }]);

// how it's going, and what to do next
eq("readiness: nothing yet", readiness([]), null);
eq("readiness: one result", readiness([70]), 70);
eq("readiness: newer counts more", readiness([100, 0]), Math.round(500 / 9));
eq("readiness: only the last five", readiness([50, 50, 50, 50, 50, 0, 0]), 50);
// harder ways of studying count for more, so "ready" means ready
const m = (pct, mode) => ({ pct, mode });
eq("readiness: a practice test outweighs a match", readiness([m(100, "match"), m(60, "test")]), Math.round((100 * 5 + 60 * 4 * 3) / (5 + 12)));
eq("readiness: perfect matching alone can't look ready", readiness([m(100, "match"), m(100, "cards"), m(100, "match")]), UNTESTED_CAP);
eq("readiness: one quiz among them lifts the cap", readiness([m(100, "match"), m(95, "quiz")]), Math.round((100 * 5 + 95 * 4 * 2) / (5 + 8)));
eq("readiness: chat has no score", readiness([m(0, "chat"), m(80, "quiz")]), 80);
eq("readiness: same mode, same as before", readiness([m(100, "quiz"), m(0, "quiz")]), Math.round(500 / 9));

// missed questions coming back
const D = 864e5, T = 1_000 * D;
const miss1 = missAfter(null, false, T);
eq("miss: a new miss comes back in two days", miss1, { rights: 0, misses: 1, due_at: T + 2 * D });
eq("miss: right on a question never missed keeps nothing", missAfter(null, true, T), null);
yes("miss: right before it's due changes nothing", missAfter(miss1, true, T + D) === miss1);
const step = missAfter(miss1, true, T + 2 * D);
eq("miss: right once it's due, back in four days", step, { rights: 1, misses: 1, due_at: T + 6 * D });
eq("miss: right twice when due, it's gone", missAfter(step, true, T + 6 * D), "gone");
eq("miss: wrong again starts over", missAfter(step, false, T + 6 * D), { rights: 0, misses: 2, due_at: T + 8 * D });
const MISS = "22222222-2222-4222-8222-222222222222";
eq("played: keeps which missed question it was", cleanPlayed([{ type: "mcq", q: "Q?", answer: "A", right: true, options: ["A", "B"], correct: 0, miss: MISS }], "quiz")[0].miss, MISS);
eq("retake: a review round keeps which missed question each was", setFromPlayed("quiz", [{ type: "mcq", q: "Q?", answer: "A", right: false, options: ["A", "B"], correct: 0, miss: MISS }]).items[0].miss, MISS);
eq("played: a bad miss id is dropped", cleanPlayed([{ type: "mcq", q: "Q?", answer: "A", right: true, options: ["A", "B"], correct: 0, miss: "x" }], "quiz")[0].miss, undefined);
const NOW = Date.parse("2030-01-10T12:00:00Z"), TODAY = "2030-01-10", day = 864e5;
const pg = (id, score, ago, exam = null) => ({ id, title: id, score, last_at: ago === null ? null : NOW - ago * day, exam });
const bio = { id: "x1", name: "Biology test", exam_date: "2030-01-13" };
eq("next: nothing listed", nextStudy([], TODAY, NOW), null);
eq("next: a test soon beats a lower score elsewhere", nextStudy([pg("a", 10, 1), pg("b", 60, 1, bio)], TODAY, NOW).id, "b");
yes("next: names the test and when", /Biology test is in 3 days/.test(nextStudy([pg("b", 60, 1, bio)], TODAY, NOW).text));
eq("next: never practised comes first for a test", nextStudy([pg("a", 40, 1, bio), pg("b", null, null, bio)], TODAY, NOW).id, "b");
eq("next: strong with the test close means a practice test", nextStudy([pg("b", 75, 1, bio)], TODAY, NOW).mode, "test");
eq("next: a test long ago doesn't count", nextStudy([pg("b", 95, 9, { id: null, name: "X", exam_date: "2030-01-01" })], TODAY, NOW).text.includes("test"), false);
eq("next: names the test it's for", nextStudy([pg("b", 60, 1, bio)], TODAY, NOW).exam_id, "x1");
eq("next: lowest score", nextStudy([pg("a", 65, 1), pg("b", 30, 1)], TODAY, NOW).id, "b");
eq("next: untouched before stale", nextStudy([pg("a", 85, 9), pg("b", null, null)], TODAY, NOW).id, "b");
eq("next: stale", nextStudy([pg("a", 85, 9), pg("b", 85, 1)], TODAY, NOW).id, "a");
eq("next: all fresh and strong", nextStudy([pg("a", 95, 1), pg("b", 85, 1)], TODAY, NOW), null);
eq("next: just nailed before a test, leave it", nextStudy([pg("b", 95, 1, bio)], TODAY, NOW), null);

eq("best: never practised", bestMode(null, 2).mode, "quiz");
eq("best: strong and close means a practice test", bestMode(75, 3).mode, "test");
eq("best: strong but far off", bestMode(75, 20).mode, "quiz");
eq("best: lost, so talk it through", bestMode(30, 1).mode, "chat");
eq("best: shaky", bestMode(60, null).mode, "blanks");
eq("best: solid", bestMode(90, null).mode, "test");
eq("best: a past test doesn't count as close", bestMode(75, -2).mode, "quiz");

// time, and the totals outside assistants read
eq("seconds: kept", cleanSession({ ...base, seconds: 94.4 }).seconds, 94);
eq("seconds: left open for hours isn't study time", "seconds" in cleanSession({ ...base, seconds: 90000 }), false);
eq("seconds: nonsense is dropped", "seconds" in cleanSession({ ...base, seconds: "lots" }), false);
const at = (d, extra) => ({ ...base, created_at: d, ...extra });
const sum = summarizeSessions([at(3, { seconds: 60 }), at(2, { mode: "test", right: 1, total: 1, missed: [], seconds: 30 }), at(1, { missed: [{ q: "WHAT?", a: "That" }] })], (d) => (d > 1 ? "day2" : "day1"));
eq("summary: counts and time", [sum.sessions, sum.seconds, sum.sessions_without_time], [3, 90, 1]);
eq("summary: by mode", sum.by_mode.map((x) => [x.mode, x.sessions, x.seconds, x.average_percent]), [["quiz", 2, 60, 67], ["test", 1, 30, 100]]);
eq("summary: by day", sum.by_day.map((x) => [x.date, x.sessions]), [["day2", 2], ["day1", 1]]);
eq("summary: the same question missed twice, any case", sum.most_missed[0].times, 2);
eq("summary: nothing yet", summarizeSessions([], () => "x").average_percent, null);

// what the time data says
const TI = (right, secs) => ({ right, secs });
const fastWrong = [...Array(6)].map(() => TI(false, 3)), slowRight = [...Array(8)].map(() => TI(true, 9));
eq("insights: rushing when misses come much faster", studyInsights([...fastWrong, ...slowRight], []).rushing, { wrong: 3, right: 9, n: 6 });
eq("insights: not with too few misses", studyInsights([...fastWrong.slice(0, 5), ...slowRight], []).rushing, null);
eq("insights: not when the times are close", studyInsights([...[...Array(6)].map(() => TI(false, 7)), ...slowRight], []).rushing, null);
eq("insights: not when everything is quick (taps on easy Match-like items)", studyInsights([...[...Array(6)].map(() => TI(false, 1)), ...[...Array(6)].map(() => TI(true, 2))], []).rushing, null);
const SH = (pct, hour) => ({ pct, hour });
const days = [SH(90, 9), SH(85, 10), SH(95, 8), SH(70, 20), SH(65, 21), SH(72, 19)];
eq("insights: the best part of the day", studyInsights([], days).bestTime, { part: "morning", avg: 90, others: 69, n: 3 });
eq("insights: needs 3 sessions in that part", studyInsights([], days.slice(1)).bestTime, null);
eq("insights: needs a clear gap", studyInsights([], [SH(80, 9), SH(80, 10), SH(80, 8), SH(78, 20), SH(76, 21), SH(77, 19)]).bestTime, null);
eq("day parts", [dayPart(3), dayPart(5), dayPart(12), dayPart(17), dayPart(21)], ["night", "morning", "afternoon", "evening", "night"]);
eq("insight lines", insightLines({ rushing: { wrong: 3, right: 9, n: 6 }, bestTime: null })[0].startsWith("You answer the questions you miss faster"), true);
eq("played: seconds kept when believable", cleanPlayed([{ type: "mcq", q: "Q", answer: "A", right: true, options: ["A", "B"], correct: 0, secs: 4.27 }, { type: "mcq", q: "Q2", answer: "A", right: true, options: ["A", "B"], correct: 0, secs: 99999 }], "quiz").map((x) => x.secs), [4.3, undefined]);

// Explain it
eq("prompts: real ones kept, blanks and repeats dropped", cleanPrompts([{ q: "Explain osmosis", points: ["water", "membrane"] }, { q: "explain OSMOSIS", points: ["x"] }, { q: "", points: ["x"] }, { q: "No points", points: [] }, { q: "Why?", points: ["a", "", 3] }]), [{ q: "Explain osmosis", points: ["water", "membrane"] }, { q: "Why?", points: ["a"] }]);
eq("prompts: at most count", cleanPrompts(Array.from({ length: 9 }, (_, k) => ({ q: `Q${k}`, points: ["p"] })), 3).length, 3);
eq("check: a good one", cleanCheck({ verdict: "partly", got: ["a"], missing: ["b"], wrong: [{ said: "x", fix: "y" }, { said: "no fix" }], tip: "Add b." }), { verdict: "partly", got: ["a"], missing: ["b"], wrong: [{ said: "x", fix: "y" }], tip: "Add b." });
eq("check: no verdict, no grade", cleanCheck({ verdict: "great", got: ["a"] }), null);
eq("check line: what's off and missing", checkLine({ verdict: "off", got: [], missing: ["b"], wrong: [{ said: "x", fix: "y" }], tip: "t" }), "Off: y Missing: b");
eq("check line: right", checkLine({ verdict: "right", got: ["a"], missing: [], wrong: [], tip: "" }), "Covered every key point.");
eq("explain: retake from History", explainFromPlayed([{ type: "short", q: "Explain osmosis", answer: "water | membrane", right: false }]), [{ q: "Explain osmosis", points: ["water", "membrane"] }]);
eq("explain: played answers are kept", cleanPlayed([{ type: "short", q: "Explain osmosis", answer: "water | membrane", right: true, yours: "Water crosses a membrane" }, { type: "mcq", q: "no", answer: "x", options: ["x", "y"], correct: 0 }], "explain").length, 1);
eq("explain: counts as tested, like a practice test", readiness([{ pct: 100, mode: "explain" }]), 100);

// real grades vs practice
eq("grade: score out of", cleanGrade("42", "50"), { score: 42, outof: 50, pct: 84 });
eq("grade: out of defaults to 100", cleanGrade(88, ""), { score: 88, outof: 100, pct: 88 });
eq("grade: a percent sign is fine", cleanGrade("91%", undefined), { score: 91, outof: 100, pct: 91 });
eq("grade: one decimal", cleanGrade("2", "3").pct, 66.7);
eq("grade: extra credit is fine", cleanGrade("105", "100").pct, 105);
eq("grade: nonsense is refused", [cleanGrade("", "100"), cleanGrade("abc", "100"), cleanGrade("-1", "100"), cleanGrade("5", "0"), cleanGrade("500", "100")], [null, null, null, null, null]);
const G = (pct, practice) => ({ score: pct, outof: 100, pct, practice, row_id: null, run_id: null, at: 1 });
eq("gap: average of real minus practice", practiceGap([G(85, 78), G(70, 75), null, { skipped: true, at: 1 }, G(90, null)]), { n: 2, avg: 1 });
eq("gap: nothing to compare", practiceGap([G(90, null), null]), null);
eq("vs practice: close", gradeVsPractice(80, 78), "Practice said 78%, so it predicted this well.");
eq("vs practice: better", gradeVsPractice(85, 78), "Practice said 78%, so you did 7 points better than practice.");
eq("vs practice: worse", gradeVsPractice(60, 78), "Practice said 78%, so you did 18 points worse than practice.");
eq("vs practice: none", gradeVsPractice(60, null), "There was no practice score to compare it with.");

// a plan for a test, without the model
const PAGES = [{ title: "Strong", score: 92 }, { title: "Weak", score: 40 }, { title: "New", score: null }];
const p7 = draftPlan("Bio test", "2030-01-08", PAGES, "2030-01-01");
eq("plan: six sessions over a week", p7.length, 6);
eq("plan: from today to the day before, never the test day", [p7[0].date, p7.at(-1).date], ["2030-01-01", "2030-01-07"]);
eq("plan: all before the test, in order", p7.every((x, k) => x.date < "2030-01-08" && (k === 0 || x.date >= p7[k - 1].date)), true);
eq("plan: weakest first (never practised, then lowest score)", [p7[0].title, p7[1].title], ["Bio test: quiz on New (25 min)", "Bio test: quiz on Weak (25 min)"]);
eq("plan: a practice test, then a light review the day before", [p7.at(-2).title, p7.at(-1).title], ["Bio test: practice test (30 min)", "Bio test: light review of everything (20 min)"]);
eq("plan: no times without the model", p7.every((x) => x.time === null), true);
eq("plan: tomorrow is one light review today", draftPlan("Quiz", "2030-01-02", PAGES, "2030-01-01").map((x) => [x.date, x.title]), [["2030-01-01", "Quiz: light review of everything (20 min)"]]);
eq("plan: today or past, nothing", [draftPlan("Q", "2030-01-01", PAGES, "2030-01-01"), draftPlan("Q", "2029-12-01", PAGES, "2030-01-01")], [[], []]);
eq("plan: three days, no room for a practice test", draftPlan("Q", "2030-01-04", PAGES, "2030-01-01").map((x) => x.date), ["2030-01-01", "2030-01-02", "2030-01-03"]);
eq("plan: one page coming round again is studied a different way", draftPlan("Q", "2030-01-06", [{ title: "Only", score: 50 }], "2030-01-01").slice(0, 3).map((x) => x.title), ["Q: quiz on Only (25 min)", "Q: fill in the blanks on Only (20 min)", "Q: quiz on Only (25 min)"]);
eq("plan: no pages yet", draftPlan("Q", "2030-01-03", [], "2030-01-01")[0].title, "Q: practice quiz (25 min)");
eq("plan: across a month end", draftPlan("Q", "2030-02-02", PAGES, "2030-01-30").map((x) => x.date), ["2030-01-30", "2030-01-31", "2030-02-01"]);
const fit = fitPlan([
  { title: "late", date: "2030-01-05", time: "18:00" }, { title: "test day", date: "2030-01-08", time: "08:00" }, { title: "past", date: "2029-12-31", time: null },
  { title: "early", date: "2030-01-05", time: "16:00" }, { title: "earlier today", date: "2030-01-01", time: "09:00" }, { title: "tonight", date: "2030-01-01", time: "19:00" }, { title: "today, any time", date: "2030-01-01", time: null },
], "2030-01-01", "2030-01-08", "14:30");
eq("fit: only today (not a time gone) to the day before, sorted", fit.map((x) => x.title), ["tonight", "today, any time", "early", "late"]);
eq("fit: at most 8", fitPlan(Array.from({ length: 12 }, (_, k) => ({ title: `s${k}`, date: "2030-01-03", time: null })), "2030-01-01", "2030-01-08").length, 8);

console.log(`${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
