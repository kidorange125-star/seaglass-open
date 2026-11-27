// Per-task reminder choices. Stored on the date value as `remind`: minutes before the task's time (for a task
// without a time, before 9:00 AM on its day), or "none". Unset means the default from Notifications settings.
// The server side of these rules is src/worker/reminders.ts.

export function remindOptions(timed: boolean): [string, string][] {
  return timed
    ? [["", "Default"], ["0", "At start time"], ["5", "5 min before"], ["10", "10 min before"], ["15", "15 min before"], ["30", "30 min before"],
       ["60", "1 hour before"], ["120", "2 hours before"], ["1440", "1 day before"], ["none", "No reminder"]]
    : [["", "Daily summary only"], ["0", "9:00 AM on the day"], ["1440", "9:00 AM the day before"], ["none", "No reminder"]];
}

/** The stored value as a select value ("" when unset or unknown). */
export function remindValue(v: unknown): string {
  if (v === "none") return "none";
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v : "";
  return /^\d{1,5}$/.test(s) ? s : "";
}

/** Choices for the default reminder in Notifications settings (timed tasks). */
export const DEFAULT_REMIND_OPTIONS: [string, string][] = [
  ["0", "At start time"], ["5", "5 min before"], ["10", "10 min before"], ["15", "15 min before"], ["30", "30 min before"], ["60", "1 hour before"], ["none", "Off"],
];

/** A reminder that still makes sense after a task gains or loses its time: tasks without a time only offer
 *  "on the day" (0), "the day before" (1440) and "none", so anything else goes back to the default. */
export function fitRemind(remind: string, timed: boolean): string {
  return timed || ["", "0", "1440", "none"].includes(remind) ? remind : "";
}
