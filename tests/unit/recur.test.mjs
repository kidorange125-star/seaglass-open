// Repeating tasks: next dates and quick-add phrases. Run: node tests/unit/recur.test.mjs
import { step, nextDue, rollRepeat, takeRepeat } from "../../src/client/recur.ts";

let ok = 0, bad = 0;
const eq = (name, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) ok++; else { bad++; console.log("FAIL", name, "got", g, "want", w); } };

eq("daily", step("2026-11-06", "daily"), "2026-11-07");
eq("weekdays skips the weekend (Fri -> Mon)", step("2026-11-06", "weekdays"), "2026-11-09");
eq("weekly", step("2026-11-06", "weekly"), "2026-11-13");
eq("biweekly", step("2026-11-06", "biweekly"), "2026-11-20");
eq("monthly", step("2026-11-06", "monthly"), "2026-12-06");
eq("monthly clamps Jan 31 -> Feb 28", step("2027-01-31", "monthly"), "2027-02-28");
eq("monthly across the year", step("2026-12-15", "monthly"), "2027-01-15");
eq("done on time moves to the next one", nextDue("2026-11-06", "daily", "2026-11-06"), "2026-11-07");
eq("overdue daily lands after today", nextDue("2026-11-01", "daily", "2026-11-06"), "2026-11-07");
eq("overdue weekly keeps its weekday", nextDue("2026-11-02", "weekly", "2026-11-06"), "2026-11-09");
eq("done early skips ahead one step", nextDue("2026-11-13", "weekly", "2026-11-06"), "2026-11-20");

const r = rollRepeat({ system: "tasks" }, { status: "done", repeat: "weekly", due: { start: "2026-11-06", start_time: "15:00", end_time: "17:00" } }, "2026-11-06");
eq("roll keeps the time window", r && r.props.due, { start: "2026-11-13", start_time: "15:00", end_time: "17:00" });
const r2 = rollRepeat({ system: "tasks" }, { status: "done", repeat: "weekly", due: { start: "2026-11-06", end: "2026-11-08", start_time: "15:00", end_time: "12:00" } }, "2026-11-06");
eq("roll keeps a multi-day span (end moves with the start)", r2 && r2.props.due, { start: "2026-11-13", end: "2026-11-15", start_time: "15:00", end_time: "12:00" });
eq("roll reopens", r && r.props.status, "todo");
eq("no roll without repeat", rollRepeat({ system: "tasks" }, { status: "done" }, "2026-11-06"), null);
eq("no roll outside the tasks list", rollRepeat({}, { status: "done", repeat: "daily" }, "2026-11-06"), null);
eq("no roll when reopening", rollRepeat({ system: "tasks" }, { status: "todo", repeat: "daily" }, "2026-11-06"), null);

const t = (s) => { const x = takeRepeat(` ${s} `); return [x.repeat, x.weekday, x.text.replace(/\s+/g, " ").trim()]; };
eq("every day", t("Water plants every day"), ["daily", null, "Water plants"]);
eq("daily", t("Journal daily"), ["daily", null, "Journal"]);
eq("every weekday", t("Bus every weekday"), ["weekdays", null, "Bus"]);
eq("every 2 weeks", t("Laundry every 2 weeks"), ["biweekly", null, "Laundry"]);
eq("every month", t("Pay phone bill every month"), ["monthly", null, "Pay phone bill"]);
eq("every monday", t("Piano every monday"), ["weekly", 1, "Piano"]);
eq("every fri", t("Quiz every fri"), ["weekly", 5, "Quiz"]);
eq("no repeat", t("Read every page carefully"), [null, null, "Read every page carefully"]);

console.log(`${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
