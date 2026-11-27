// Breaking a big assignment into steps (#20): the assistant drafts them (worker steps.ts), the user looks them over, and they become
// tasks of their own with dates, linked to the assignment by a "Part of" relation. Pure, no imports: tests/unit/steps.test.mts.

export interface Step { title: string; date: string | null; time: string | null }
const DAY = /^\d{4}-\d{2}-\d{2}$/, CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
export const STEPS_MAX = 8;

/** The model's steps made safe: real titles, dates from today up to the due date (or none), in order, at most STEPS_MAX. */
export function cleanSteps(raw: unknown, today: string, due: string | null): Step[] {
  const out: Step[] = [];
  for (const r of (Array.isArray(raw) ? raw : []).slice(0, 20) as Record<string, unknown>[]) {
    const title = typeof r?.title === "string" ? r.title.replace(/\s+/g, " ").trim().slice(0, 200) : "";
    if (!title) continue;
    let date = typeof r.date === "string" && DAY.test(r.date) ? r.date : null;
    if (date && (date < today || (due && date > due))) date = null; // outside the window: keep the step, drop the date
    const time = date && typeof r.time === "string" && CLOCK.test(r.time) ? r.time : null;
    out.push({ title, date, time });
  }
  // in date order, undated ones where the model put them relative to their neighbours (stable sort on dated ones only)
  const dated = out.filter((s) => s.date).sort((a, b) => (a.date! + (a.time ?? "")).localeCompare(b.date! + (b.time ?? "")));
  let k = 0;
  return out.map((s) => (s.date ? dated[k++] : s)).slice(0, STEPS_MAX);
}

/** A row's "Part of" value: the assignment ids it's a step of. */
export const partOf = (props: Record<string, unknown>) => (Array.isArray(props.part_of) ? props.part_of.filter((x): x is string => typeof x === "string") : []);
