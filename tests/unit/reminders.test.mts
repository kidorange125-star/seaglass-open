// Task reminder planning. Run: node --experimental-strip-types tests/unit/reminders.test.mts
import { planReminders, zonedToUtc, localNow, clock, parseRemind, isTimeZone, isWeekly, isQuiet, quietNow, isUrgent, type Row, DEFAULT_PREFS } from "../../src/worker/reminders.ts";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra: unknown = "") => { if (cond) pass++; else { fail++; console.log("FAIL", name, extra); } };

const TZ = "America/Los_Angeles";
const tasksSchema = { system: "tasks", properties: [
  { id: "status", name: "Status", type: "status", options: [{ id: "todo", name: "Not started" }, { id: "done", name: "Done" }] },
  { id: "due", name: "Due", type: "date" },
] };
const otherSchema = { properties: [{ id: "when", name: "When", type: "date" }, { id: "fin", name: "Done", type: "checkbox" }] };
const row = (id: string, due: Record<string, unknown> | null, extra: Partial<Row> = {}, status = "todo"): Row =>
  ({ id, title: `Task ${id}`, props: { status, ...(due ? { due } : {}) }, updated_at: 0, schema: tasksSchema, db_title: "My tasks", ...extra });
const at = (date: string, time: string) => zonedToUtc(date, time, TZ);

// Time zones
ok("zonedToUtc PST", at("2026-11-07", "15:00") === Date.UTC(2026, 10, 7, 23, 0));
ok("zonedToUtc PDT", at("2026-07-01", "15:00") === Date.UTC(2026, 6, 1, 22, 0));
ok("zonedToUtc UTC", zonedToUtc("2026-11-07", "15:00", "UTC") === Date.UTC(2026, 10, 7, 15, 0));
ok("zonedToUtc Kolkata", zonedToUtc("2026-11-07", "09:30", "Asia/Kolkata") === Date.UTC(2026, 10, 7, 4, 0));
ok("DST fall back day", at("2026-11-01", "12:00") === Date.UTC(2026, 10, 1, 20, 0));
ok("DST spring forward gap moves on", localNow(at("2026-03-08", "02:30"), TZ).time === "03:30", localNow(at("2026-03-08", "02:30"), TZ));
ok("localNow", JSON.stringify(localNow(Date.UTC(2026, 10, 8, 2, 5), TZ)) === JSON.stringify({ date: "2026-11-07", time: "18:05" }));
ok("isTimeZone", isTimeZone(TZ) && !isTimeZone("Mars/Base") && !isTimeZone(""));
ok("clock", clock("15:00") === "3:00 PM" && clock("00:05") === "12:05 AM" && clock("12:30") === "12:30 PM");
ok("parseRemind", parseRemind("15") === 15 && parseRemind(0) === 0 && parseRemind("none") === null && parseRemind("x") === undefined && parseRemind(undefined) === undefined && parseRemind("99999") === undefined);

// Timed task, default (at start time)
const t1 = row("1", { start: "2026-11-07", start_time: "15:00", end_time: "16:30" });
let p = planReminders([t1], at("2026-11-07", "15:00") + 30_000, TZ, DEFAULT_PREFS);
ok("fires at start", p.reminders.length === 1 && p.reminders[0].body === "Now · 3:00 PM–4:30 PM", p.reminders);
ok("key", p.reminders[0]?.key === `r|1|2026-11-07|15:00|0|${TZ}`);
ok("not before", planReminders([t1], at("2026-11-07", "14:59"), TZ, DEFAULT_PREFS).reminders.length === 0);
ok("within window", planReminders([t1], at("2026-11-07", "15:09"), TZ, DEFAULT_PREFS).reminders.length === 1);
ok("not after window", planReminders([t1], at("2026-11-07", "15:11"), TZ, DEFAULT_PREFS).reminders.length === 0);
ok("default off", planReminders([t1], at("2026-11-07", "15:00"), TZ, { ...DEFAULT_PREFS, remind: "none" }).reminders.length === 0);
ok("default 15 before", planReminders([t1], at("2026-11-07", "14:45"), TZ, { ...DEFAULT_PREFS, remind: "15" }).reminders[0]?.body === "In 15 min · 3:00 PM–4:30 PM");

// Own setting
const t2 = row("2", { start: "2026-11-07", start_time: "15:00", remind: "60" });
ok("own 60 before", planReminders([t2], at("2026-11-07", "14:00"), TZ, DEFAULT_PREFS).reminders[0]?.body === "In 1 hour · 3:00 PM");
ok("own beats default none", planReminders([t2], at("2026-11-07", "14:00"), TZ, { ...DEFAULT_PREFS, remind: "none" }).reminders.length === 1);
const t3 = row("3", { start: "2026-11-07", start_time: "15:00", remind: "none" });
ok("own none", planReminders([t3], at("2026-11-07", "15:00"), TZ, DEFAULT_PREFS).reminders.length === 0);

// Date-only tasks
const t4 = row("4", { start: "2026-11-07" });
ok("date-only: no reminder by default", planReminders([t4], at("2026-11-07", "09:00"), TZ, DEFAULT_PREFS).reminders.length === 0);
const t5 = row("5", { start: "2026-11-08", remind: "1440" });
p = planReminders([t5], at("2026-11-07", "09:01"), TZ, DEFAULT_PREFS);
ok("date-only day before 9am", p.reminders[0]?.body === "Due tomorrow", p.reminders);
const t6 = row("6", { start: "2026-11-07", remind: 0 });
ok("date-only 9am on the day", planReminders([t6], at("2026-11-07", "09:00"), TZ, DEFAULT_PREFS).reminders[0]?.body === "Due today");

// Skips
ok("done skipped", planReminders([row("7", { start: "2026-11-07", start_time: "15:00" }, {}, "done")], at("2026-11-07", "15:00"), TZ, DEFAULT_PREFS).reminders.length === 0);
ok("edited after fire time skipped", planReminders([row("8", { start: "2026-11-07", start_time: "15:00" }, { updated_at: at("2026-11-07", "15:02") })], at("2026-11-07", "15:03"), TZ, DEFAULT_PREFS).reminders.length === 0);
ok("edited before fire time fires", planReminders([row("9", { start: "2026-11-07", start_time: "15:00" }, { updated_at: at("2026-11-07", "14:00") })], at("2026-11-07", "15:03"), TZ, DEFAULT_PREFS).reminders.length === 1);
ok("bad time ignored", planReminders([row("10", { start: "2026-11-07", start_time: "25:00" })], at("2026-11-07", "09:00"), TZ, DEFAULT_PREFS).reminders.length === 0);

// Other databases: only with their own setting, and the body names the database
const o1: Row = { id: "o1", title: "Read ch. 4", props: { when: { start: "2026-11-07", start_time: "15:00" } }, updated_at: 0, schema: otherSchema, db_title: "Reading" };
ok("other db: no default", planReminders([o1], at("2026-11-07", "15:00"), TZ, DEFAULT_PREFS).reminders.length === 0);
const o2: Row = { ...o1, props: { when: { start: "2026-11-07", start_time: "15:00", remind: "0" } } };
ok("other db: own setting", planReminders([o2], at("2026-11-07", "15:00"), TZ, DEFAULT_PREFS).reminders[0]?.body === "Now · 3:00 PM · Reading");
ok("other db: checkbox done", planReminders([{ ...o2, props: { ...o2.props, fin: true } }], at("2026-11-07", "15:00"), TZ, DEFAULT_PREFS).reminders.length === 0);

// Tasks over several days
const md = row("md", { start: "2026-11-07", start_time: "15:00", end: "2026-11-09", end_time: "12:00" });
ok("multi-day: fires at the start with the end in the body", planReminders([md], at("2026-11-07", "15:00"), TZ, DEFAULT_PREFS).reminders[0]?.body === "Now · 3:00 PM → Nov 9 12:00 PM", planReminders([md], at("2026-11-07", "15:00"), TZ, DEFAULT_PREFS).reminders);
const md2 = row("md2", { start: "2026-11-08", end: "2026-11-10", remind: "1440" });
// A task over several days is due on its last day: a reminder without a time is about the due day, not the start.
ok("multi-day, no time: no reminder the day before it starts", planReminders([md2], at("2026-11-07", "09:00"), TZ, DEFAULT_PREFS).reminders.length === 0);
ok("multi-day, no time: the day-before reminder is for the due day", planReminders([md2], at("2026-11-09", "09:00"), TZ, DEFAULT_PREFS).reminders[0]?.body === "Due tomorrow", planReminders([md2], at("2026-11-09", "09:00"), TZ, DEFAULT_PREFS).reminders);

// Daily summary
const rows = [row("a", { start: "2026-11-07" }), row("b", { start: "2026-11-07", start_time: "15:00" }), row("c", { start: "2026-11-05" }), row("d", { start: "2026-11-09" }), row("e", { start: "2026-11-07" }, {}, "done")];
p = planReminders(rows, at("2026-11-07", "08:00"), TZ, DEFAULT_PREFS);
ok("digest title", p.digest?.title === "2 tasks today", p.digest);
ok("digest body", p.digest?.body === "Task a, Task b (3:00 PM) · 1 overdue", p.digest);
ok("digest key", p.digest?.key === `d|2026-11-07|${TZ}`);
ok("digest not before", planReminders(rows, at("2026-11-07", "07:59"), TZ, DEFAULT_PREFS).digest === null);
ok("digest window", planReminders(rows, at("2026-11-07", "08:29"), TZ, DEFAULT_PREFS).digest !== null && planReminders(rows, at("2026-11-07", "08:31"), TZ, DEFAULT_PREFS).digest === null);
ok("digest off", planReminders(rows, at("2026-11-07", "08:00"), TZ, { ...DEFAULT_PREFS, digest: "" }).digest === null);
ok("digest nothing due", planReminders([row("d", { start: "2026-11-09" })], at("2026-11-07", "08:00"), TZ, DEFAULT_PREFS).digest === null);
ok("digest only overdue", planReminders([row("c", { start: "2026-11-05" })], at("2026-11-07", "08:00"), TZ, DEFAULT_PREFS).digest?.title === "1 overdue task");
const many = Array.from({ length: 6 }, (_, i) => row(`m${i}`, { start: "2026-11-07" }));
ok("digest caps list", planReminders(many, at("2026-11-07", "08:00"), TZ, DEFAULT_PREFS).digest?.body.endsWith("+2 more") === true);

// Weekly review (Sunday 2026-11-08, 5 PM by default)
const wk = [row("w1", { start: "2026-11-05" }), row("w2", { start: "2026-11-09" }), row("w3", { start: "2026-11-12", start_time: "10:00" }), row("w4", { start: "2026-11-20" })];
let wp = planReminders(wk, at("2026-11-08", "17:00"), TZ, DEFAULT_PREFS, 12);
ok("weekly fires on Sunday at 5 PM", wp.weekly?.title === "Time for your weekly review" && wp.weekly?.body === "1 overdue · 2 due this week · 12 flashcards to review", wp.weekly);
ok("weekly key per day and zone", wp.weekly?.key === `w|2026-11-08|${TZ}`);
ok("weekly not on Saturday", planReminders(wk, at("2026-11-07", "17:00"), TZ, DEFAULT_PREFS).weekly === null);
ok("weekly not before the time", planReminders(wk, at("2026-11-08", "16:59"), TZ, DEFAULT_PREFS).weekly === null);
ok("weekly off", planReminders(wk, at("2026-11-08", "17:00"), TZ, { ...DEFAULT_PREFS, weekly: "" }).weekly === null);
ok("weekly custom day/time", planReminders(wk, at("2026-11-09", "07:30"), TZ, { ...DEFAULT_PREFS, weekly: "1@07:30" }).weekly !== null);
ok("isWeekly", isWeekly("0@17:00") && !isWeekly("7@17:00") && !isWeekly("0@25:00") && !isWeekly(""));
const ongoing = row("og", { start: "2026-11-06", end: "2026-11-10" });
ok("a task under way isn't overdue, and is due this week (on its last day)", planReminders([ongoing], at("2026-11-08", "17:00"), TZ, DEFAULT_PREFS).weekly?.body === "1 due this week", planReminders([ongoing], at("2026-11-08", "17:00"), TZ, DEFAULT_PREFS).weekly);
ok("a task over several days is in the summary on its due day, not its start", planReminders([ongoing], at("2026-11-10", "08:00"), TZ, DEFAULT_PREFS).digest?.title === "1 task today" && planReminders([ongoing], at("2026-11-06", "08:00"), TZ, DEFAULT_PREFS).digest === null);
ok("and overdue only after its due day", planReminders([ongoing], at("2026-11-11", "08:00"), TZ, DEFAULT_PREFS).digest?.title === "1 overdue task");

// Quiet hours (school): Monday to Friday 08:00 to 15:00
const Q = "12345@08:00-15:00";
ok("quiet: a valid setting", isQuiet(Q) && isQuiet("0@09:00-09:30"));
ok("quiet: bad settings", !isQuiet("12345@15:00-08:00") && !isQuiet("17@08:00-15:00") && !isQuiet("112@08:00-15:00") && !isQuiet("12345@8:00-15:00") && !isQuiet("@08:00-15:00"));
ok("quiet: a Monday at 10:00", quietNow(Q, at("2026-11-09", "10:00"), TZ));
ok("quiet: from the start, not at the end", quietNow(Q, at("2026-11-09", "08:00"), TZ) && !quietNow(Q, at("2026-11-09", "15:00"), TZ) && !quietNow(Q, at("2026-11-09", "07:59"), TZ));
ok("quiet: not on a Saturday", !quietNow(Q, at("2026-11-07", "10:00"), TZ));
ok("quiet: off is never quiet", !quietNow("", at("2026-11-09", "10:00"), TZ));
ok("quiet: in their time zone, not UTC", quietNow(Q, Date.UTC(2026, 10, 9, 18, 0), TZ) && !quietNow(Q, Date.UTC(2026, 10, 9, 10, 0), TZ));
const pschema = { ...tasksSchema, properties: [...tasksSchema.properties, { id: "priority", name: "Priority", type: "select", options: [{ id: "high", name: "High" }, { id: "p2", name: "Urgent!" }, { id: "low", name: "Low" }] }] };
const pr = (v: string | undefined) => isUrgent({ id: "x", title: "x", props: v ? { priority: v } : {}, updated_at: 0, schema: pschema, db_title: "My tasks" });
ok("urgent: High or Urgent priority comes through", pr("high") && pr("p2") && !pr("low") && !pr(undefined));
const urgentTask = row("u", { start: "2026-11-09", start_time: "10:00" }, { schema: pschema, props: { status: "todo", due: { start: "2026-11-09", start_time: "10:00" }, priority: "high" } });
const plainTask = row("v", { start: "2026-11-09", start_time: "10:00" });
const both = planReminders([urgentTask, plainTask], at("2026-11-09", "10:00") + 1000, TZ, { ...DEFAULT_PREFS, quiet: Q }).reminders;
ok("planned reminders say which are urgent", both.length === 2 && both.find((r) => r.id === "u")?.urgent === true && both.find((r) => r.id === "v")?.urgent === false, both);

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
