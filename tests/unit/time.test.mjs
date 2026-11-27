// Time windows: quick-add parsing and labels. Run: node tests/unit/time.test.mjs
import { takeTime, timeLabel, isTime, spanLabel, isMultiDay, clockLabel } from "../../src/client/time.ts";

let ok = 0, bad = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { ok++; } else { bad++; console.log("FAIL", name, "got", g, "want", w); }
};
const t = (s) => { const r = takeTime(` ${s} `); return [r.start_time, r.end_time, r.text.replace(/\s+/g, " ").trim()]; };

eq("range pm", t("Study 3-5pm"), ["15:00", "17:00", "Study"]);
eq("range borrows across noon", t("Lunch 11-1pm"), ["11:00", "13:00", "Lunch"]);
eq("range both meridiems", t("Shift 11am-1pm fri"), ["11:00", "13:00", "Shift fri"]);
eq("range 24h", t("Lab 15:00-17:30"), ["15:00", "17:30", "Lab"]);
eq("range with to", t("Gym 6 to 7am"), ["06:00", "07:00", "Gym"]);
eq("single at", t("Call dentist at 9:30am"), ["09:30", null, "Call dentist"]);
eq("single pm", t("Practice 4pm"), ["16:00", null, "Practice"]);
eq("single 24h", t("Bus 07:45"), ["07:45", null, "Bus"]);
eq("12am is midnight", t("Sleep 12am"), ["00:00", null, "Sleep"]);
eq("12pm is noon", t("Lunch 12pm"), ["12:00", null, "Lunch"]);
eq("plain number left alone", t("Read chapter 4"), [null, null, "Read chapter 4"]);
eq("range of plain numbers left alone", t("Pages 3-5"), [null, null, "Pages 3-5"]);
eq("13pm is not a time", t("Item 13pm"), [null, null, "Item 13pm"]);
eq("isTime", [isTime("09:05"), isTime("24:00"), isTime("9:05"), isTime(null)], [true, false, false, false]);
// Labels depend on the locale's clock; check the shape rather than exact text.
const one = timeLabel({ start_time: "15:00" }), two = timeLabel({ start_time: "15:00", end_time: "17:00" });
eq("label without start", timeLabel({ end_time: "17:00" }), "");
eq("label single has digits", /\d/.test(one), true);
eq("label range has a dash", two.includes("–"), true);

// Spans over several days
const day = (d) => d.slice(5);
eq("one day: day + window", spanLabel({ start: "2026-11-07", start_time: "15:00", end_time: "17:00" }, day), "11-07 3–5 PM");
eq("several days with times", spanLabel({ start: "2026-11-07", end: "2026-11-09", start_time: "15:00", end_time: "12:00" }, day), "11-07 3 PM → 11-09 12 PM");
eq("several days, no times", spanLabel({ start: "2026-11-07", end: "2026-11-09" }, day), "11-07 → 11-09");
eq("an end on the same day isn't a span", spanLabel({ start: "2026-11-07", end: "2026-11-07", start_time: "09:00" }, day), "11-07 9 AM");
eq("isMultiDay", [isMultiDay({ start: "2026-11-07", end: "2026-11-08" }), isMultiDay({ start: "2026-11-07", end: "2026-11-07" }), isMultiDay({ start: "2026-11-07" })], [true, false, false]);
eq("clockLabel", [clockLabel("15:30"), clockLabel("nope")], ["3:30 PM", ""]);
console.log(`${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
