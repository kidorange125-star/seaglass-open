// Breaking assignments into steps (src/client/steps.ts) and the weekly tidy-up's rules (src/client/tidy.ts).
// node --experimental-strip-types tests/unit/tidy.test.mts
import { cleanSteps, partOf } from "../../src/client/steps.ts";
import { cleanMoves, findDuplicates, findEmpty, looseNotes, tidySummary, type TidyNote } from "../../src/client/tidy.ts";

let fails = 0, n = 0;
const eq = (what: string, got: unknown, want: unknown) => { n++; if (JSON.stringify(got) !== JSON.stringify(want)) { fails++; console.log(`FAIL ${what}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); } };

// ---- steps
const st = cleanSteps([
  { title: "  Write   the draft ", date: "2030-01-03", time: "16:00" },
  { title: "Outline", date: "2030-01-02", time: "bad" },
  { title: "Research", date: null },
  { title: "Too late", date: "2030-01-09" },
  { title: "Too early", date: "2029-12-30" },
  { title: "", date: "2030-01-02" },
], "2030-01-01", "2030-01-05");
eq("steps: titles tidied, empty ones dropped", st.map((s) => s.title), ["Outline", "Write the draft", "Research", "Too late", "Too early"]);
eq("steps: dated ones in date order, undated stay put, dates outside the window dropped", st.map((s) => s.date), ["2030-01-02", "2030-01-03", null, null, null]);
eq("steps: a time only with a date and when it's a real time", st.map((s) => s.time), [null, "16:00", null, null, null]);
eq("steps: with no due date, any future date is fine", cleanSteps([{ title: "A", date: "2031-06-01" }], "2030-01-01", null)[0].date, "2031-06-01");
eq("steps: at most 8", cleanSteps(Array.from({ length: 12 }, (_, k) => ({ title: `S${k}` })), "2030-01-01", null).length, 8);
eq("steps: not a list", cleanSteps("nope", "2030-01-01", null), []);
eq("part of", [partOf({ part_of: ["a", 3, "b"] }), partOf({})], [["a", "b"], []]);

// ---- tidy
const DAY = 864e5, NOW = 100 * DAY;
const note = (id: string, o: Partial<TidyNote> = {}): TidyNote => ({ id, title: id, parent_id: null, kind: "page", is_template: 0, system: null, created_at: NOW - 10 * DAY, updated_at: NOW - 5 * DAY, text: "", ...o });
const notes = [
  note("empty-old", { title: "" }),
  note("empty-new", { updated_at: NOW - 1000 }),
  note("empty-parent"), note("child", { parent_id: "empty-parent", text: "hi" }),
  note("template", { is_template: 1 }),
  note("db", { kind: "database" }), note("row", { parent_id: "db" }),
  note("Biology", { title: "Bio notes", text: "Cells", created_at: NOW - 20 * DAY }),
  note("copy", { title: "Bio notes", text: "  cells ", created_at: NOW - 2 * DAY }),
  note("other", { title: "Bio notes", text: "Different" }),
  note("untitled1", { title: "Untitled", text: "same" }), note("untitled2", { title: "Untitled", text: "same", created_at: NOW - 1 * DAY }),
];
eq("empty: old, untouched, no sub-pages, not a template, row or database", findEmpty(notes, NOW).map((x) => x.id), ["empty-old"]);
eq("empty: an empty title reads as New page", findEmpty(notes, NOW)[0].title, "New page");
eq("duplicates: same title and text (ignoring case and spaces), the oldest stays", findDuplicates(notes).map((x) => [x.id, x.why]), [["copy", "a copy of “Bio notes”"]]);
const loose = looseNotes([...notes, note("School", { text: "x" }), note("hw", { parent_id: "School", text: "y" }), note("fresh", { text: "z", created_at: NOW - DAY })], NOW);
eq("loose: folders are top-level pages with sub-pages", loose.folders.map((x) => x.id).sort(), ["School", "empty-parent"]);
eq("loose: top-level pages with text, a few days old", loose.loose.map((x) => x.id).includes("fresh"), false);
const moves = cleanMoves([{ id: "Biology", to: "School" }, { id: "Biology", to: "empty-parent" }, { id: "made-up", to: "School" }, { id: "other", to: "nowhere" }, { id: "School", to: "School" }], loose.loose, loose.folders);
eq("moves: real loose notes to real folders, once each", moves.map((m) => [m.id, m.to, m.to_title]), [["Biology", "School", "School"]]);
const grouped = tidySummary({ type: "tidy", trash: [1, 2, 3].map((i) => ({ id: `c${i}`, title: "Cells", why: "a copy of “Cells”" })), moves: [] });
eq("copies of one page are one line", grouped.body.split("\n").slice(1), ["- Move 3 pages called “Cells” to the trash (copies of “Cells”)"]);
const sum = tidySummary({ type: "tidy", trash: [{ id: "a", title: "A", why: "empty" }, { id: "b", title: "B", why: "a copy of “C”" }], moves: [{ id: "x", title: "X", to: "f", to_title: "F" }] });
eq("summary title", sum.title, "Weekly tidy-up: 1 empty page, 1 duplicate, 1 loose note to file");
eq("summary lists every change", sum.body.split("\n").slice(1), ["- Move “A” to the trash (empty)", "- Move “B” to the trash (a copy of “C”)", "- Put “X” in “F”"]);

console.log(fails ? `${fails} of ${n} failed` : `${n} passed`);
process.exit(fails ? 1 : 0);
