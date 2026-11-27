// Repeating tasks. A task's `repeat` property is one of REPEATS; completing it doesn't close it, it moves
// the due date to the next occurrence after today (like Todoist), keeping any time window.

export const REPEATS = ["daily", "weekdays", "weekly", "biweekly", "monthly"] as const;
export type Repeat = (typeof REPEATS)[number];
export const REPEAT_LABEL: Record<Repeat, string> = { daily: "Daily", weekdays: "Weekdays", weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly" };
export const isRepeat = (v: unknown): v is Repeat => typeof v === "string" && (REPEATS as readonly string[]).includes(v);

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s: string) => new Date(`${s.slice(0, 10)}T12:00:00`);

/** One step forward from `day` (YYYY-MM-DD). Monthly keeps the day of the month, clamped (Jan 31 -> Feb 28). */
export function step(day: string, rule: Repeat): string {
  const d = parse(day);
  switch (rule) {
    case "daily": d.setDate(d.getDate() + 1); break;
    case "weekdays": do d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6); break;
    case "weekly": d.setDate(d.getDate() + 7); break;
    case "biweekly": d.setDate(d.getDate() + 14); break;
    case "monthly": {
      const want = parse(day).getDate();
      d.setDate(1); d.setMonth(d.getMonth() + 1);
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(want, last));
      break;
    }
  }
  return iso(d);
}

/** The next due date after completing a task due `due` on `today`: step at least once, then until it's after today. */
export function nextDue(due: string, rule: Repeat, today: string): string {
  let next = step(due, rule);
  for (let i = 0; next <= today && i < 1000; i++) next = step(next, rule);
  return next;
}

type DueValue = { start: string; end?: string; start_time?: string; end_time?: string };

/**
 * If these props mark a repeating task done, return the props for its next occurrence instead (status back
 * to "todo", due moved on). Otherwise null. Only applies to the built-in tasks list (`system: "tasks"`).
 */
export function rollRepeat(schema: { system?: string } | null | undefined, props: Record<string, unknown>, today: string):
  { props: Record<string, unknown>; next: string } | null {
  if (schema?.system !== "tasks" || props.status !== "done" || !isRepeat(props.repeat)) return null;
  const due = props.due as DueValue | undefined;
  const from = due?.start?.slice(0, 10) || today;
  const next = nextDue(from, props.repeat, today);
  // A task over several days keeps its length: the end day moves by as much as the start.
  const span = due?.end && due.start ? Math.round((Date.parse(`${due.end.slice(0, 10)}T12:00:00Z`) - Date.parse(`${due.start.slice(0, 10)}T12:00:00Z`)) / 86_400_000) : 0;
  const end = span > 0 ? new Date(Date.parse(`${next}T12:00:00Z`) + span * 86_400_000).toISOString().slice(0, 10) : undefined;
  return { props: { ...props, status: "todo", due: { ...(due ?? {}), start: next, ...(due?.end ? { end } : {}) } }, next };
}

/** Quick-add phrases: "every day", "daily", "every weekday", "every week", "every 2 weeks", "every month",
 *  "every mon" (weekly, starting that weekday). Returns the rule, an optional weekday (0-6), and the rest. */
export function takeRepeat(text: string): { text: string; repeat: Repeat | null; weekday: number | null } {
  const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const m = /\s(every\s+(day|weekday|week|2\s+weeks|other\s+week|month|(sun|mon|tue|wed|thu|fri|sat)[a-z]*)|daily|weekly|biweekly|monthly)(?=\s)/i.exec(text);
  if (!m) return { text, repeat: null, weekday: null };
  const w = m[1].toLowerCase().replace(/\s+/g, " ");
  let repeat: Repeat = "weekly", weekday: number | null = null;
  if (w === "daily" || w === "every day") repeat = "daily";
  else if (w === "every weekday") repeat = "weekdays";
  else if (w === "weekly" || w === "every week") repeat = "weekly";
  else if (w === "biweekly" || w === "every 2 weeks" || w === "every other week") repeat = "biweekly";
  else if (w === "monthly" || w === "every month") repeat = "monthly";
  else { weekday = days.indexOf(w.replace("every ", "").slice(0, 3)); repeat = "weekly"; }
  return { text: text.slice(0, m.index) + " " + text.slice(m.index + m[0].length), repeat, weekday };
}
