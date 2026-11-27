// Database charts and CSV (src/client/db/chart.ts, csv.ts). node --experimental-strip-types tests/unit/dbtools.test.mts
import { chartData, defaultChart, niceTop } from "../../src/client/db/chart.ts";
import { exportRows, guessType, importPlan, parseCsv, parseDay, toCsv } from "../../src/client/db/csv.ts";
import type { DbSchema, Note } from "../../src/client/types.ts";

let ok = 0, bad = 0;
const eq = (n: string, g: unknown, w: unknown) => { const a = JSON.stringify(g), b = JSON.stringify(w); if (a === b) ok++; else { bad++; console.log("FAIL", n, a, "!=", b); } };

const grades: DbSchema = {
  system: "grades",
  properties: [
    { id: "title", name: "Assignment", type: "title" },
    { id: "class", name: "Class", type: "select", options: [{ id: "bio", name: "Biology", color: "green" }, { id: "alg", name: "Algebra", color: "blue" }] },
    { id: "category", name: "Category", type: "select", options: [{ id: "test", name: "Test", color: "red" }, { id: "quiz", name: "Quiz", color: "orange" }] },
    { id: "score", name: "Score", type: "number" }, { id: "outof", name: "Out of", type: "number" },
    { id: "percent", name: "Percent", type: "formula", formula: 'if(prop("Out of") > 0, round(prop("Score") / prop("Out of") * 100, 1), "")' },
    { id: "date", name: "Date", type: "date" },
  ],
  views: [],
};
let n = 0;
const row = (title: string, props: Record<string, unknown>) => ({ id: `r${++n}`, title, props: JSON.stringify(props), is_template: 0, created_at: 0, updated_at: 0 }) as unknown as Note;
const rows = [
  row("Quiz 1", { class: "bio", category: "quiz", score: 8, outof: 10, date: { start: "2026-09-10" } }),
  row("Test 1", { class: "bio", category: "test", score: 45, outof: 50, date: { start: "2026-09-20" } }),
  row("Quiz A", { class: "alg", category: "quiz", score: 7, outof: 10, date: { start: "2026-09-10" } }),
  row("Quiz A2", { class: "alg", category: "quiz", score: 9, outof: 10, date: { start: "2026-09-10" } }),
  row("No date", { class: "alg", category: "test", score: 30, outof: 50 }),
];
const ctx = { schema: grades, related: new Map() };

// ---- charts
const cfg = defaultChart(grades);
eq("grades default: percent over time, a line per class", cfg, { kind: "line", x: "date", y: "percent", agg: "avg", series: "class" });
const d = chartData(rows, grades, cfg, ctx);
eq("dates across, in order, rows with no date left out", d.xs.map((x) => x.x), ["2026-09-10", "2026-09-20"]);
eq("one series per class in option order", d.series.map((s) => `${s.name}:${s.color}`), ["Biology:green", "Algebra:blue"]);
eq("points averaged on the same day", d.series[1].points.map((p) => [p.x, p.y, p.n]), [["2026-09-10", 80, 2]]);
eq("biology", d.series[0].points.map((p) => p.y), [80, 90]);
eq("percent axis to 100", [d.percent, d.min, d.max], [true, 0, 100]);
const pct = chartData(rows, grades, { kind: "line", x: "date", y: "score", of: "outof", agg: "avg" }, ctx);
eq("score as a percent of out of", pct.series[0].points.map((p) => p.y), [80, 90]);
const bars = chartData(rows, grades, { kind: "bar", x: "category", y: "count", agg: "avg" }, ctx);
eq("count by category, in option order", bars.series[0].points.map((p) => [p.label, p.y]), [["Test", 2], ["Quiz", 3]]);
eq("sum", chartData(rows, grades, { kind: "bar", x: "class", y: "score", agg: "sum" }, ctx).series[0].points.map((p) => p.y), [53, 46]);
eq("nothing to show", chartData([], grades, cfg, ctx).empty, true);
eq("nice tops", [niceTop(7), niceTop(45), niceTop(130), niceTop(0)], [10, 50, 200, 1]);
eq("a tasks-like database gets a bar per status", defaultChart({ properties: [{ id: "title", name: "Name", type: "title" }, { id: "s", name: "Status", type: "status", options: [] }], views: [] }), { kind: "bar", x: "s", y: "count", agg: "avg" });

// ---- CSV
eq("parse quotes, commas and new lines in cells", parseCsv('﻿Name,Notes\r\n"Smith, J","The user said ""hi""\nthen left"\r\nB,\r\n'), [["Name", "Notes"], ["Smith, J", 'The user said "hi"\nthen left'], ["B", ""]]);
eq("semicolons", parseCsv("a;b\n1;2"), [["a", "b"], ["1", "2"]]);
eq("blank lines dropped", parseCsv("a\n\n\nb\n"), [["a"], ["b"]]);
eq("round trip", parseCsv(toCsv([["x", 'say "y"', "a,b"], ["1", "", " lead"]])), [["x", 'say "y"', "a,b"], ["1", "", " lead"]]);
eq("days", [parseDay("2026-11-10"), parseDay("11/10/2026"), parseDay("1/2/26"), parseDay("Nov 10, 2026"), parseDay("2026-02-30"), parseDay("soon")], ["2026-11-10", "2026-11-10", "2026-01-02", "2026-11-10", null, null]);
eq("guess types", [guessType(["1", "2.5", "$3"]), guessType(["2026-01-01", "1/2/2026"]), guessType(["Yes", "No", ""]), guessType(["A", "B", "A", "A"]), guessType(["a long sentence here", "another one", "third"])], ["number", "date", "checkbox", "select", "text"]);

const out = exportRows(rows, grades, grades.properties.filter((p) => ["class", "score", "date", "percent"].includes(p.id)), ctx);
eq("export: header, title first", out[0], ["Assignment", "Class", "Score", "Percent", "Date"]);
eq("export: values as a spreadsheet shows them, dates as YYYY-MM-DD", out[1], ["Quiz 1", "Biology", "8", "80", "2026-09-10"]);

const plan = importPlan(grades, parseCsv("Assignment,Class,Score,Out of,Date,Late,Teacher note\nEssay,English,18,20,10/3/2026,yes,Good work on the thesis\nLab,Biology,9,10,2026-10-04,no,Check units in part 2\n,,,,,,\nWorksheet,English,,,,,"));
eq("import: new columns become properties with a guessed type", plan.added, ["Late", "Teacher note"]);
eq("import: types", plan.schema.properties.filter((p) => plan.added.includes(p.name)).map((p) => p.type), ["checkbox", "text"]);
eq("import: a new class becomes an option, an existing one is reused", plan.schema.properties.find((p) => p.id === "class")!.options!.map((o) => o.name), ["Biology", "Algebra", "English"]);
const english = plan.schema.properties.find((p) => p.id === "class")!.options![2].id;
eq("import: rows", plan.rows.map((r) => [r.title, r.props.class, r.props.score, r.props.date]), [["Essay", english, 18, { start: "2026-10-03" }], ["Lab", "bio", 9, { start: "2026-10-04" }], ["Worksheet", english, undefined, undefined]]);
eq("import: empty lines skipped, checkbox read", [plan.skipped, plan.rows[0].props[plan.schema.properties.find((p) => p.name === "Late")!.id], plan.rows[1].props[plan.schema.properties.find((p) => p.name === "Late")!.id]], [0, true, false]);
eq("import: formulas aren't written", importPlan(grades, [["Assignment", "Percent"], ["X", "50"]]).rows[0].props, {});
eq("import: the base schema is left alone", grades.properties.length, 7);
console.log(`${ok} passed, ${bad} failed`); if (bad) process.exit(1);
