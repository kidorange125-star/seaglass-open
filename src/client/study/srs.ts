// Spaced repetition, a small SM-2 variant (the algorithm behind Anki). Pure functions so they can be tested
// in Node: tests/unit/study.test.mjs.

export interface CardState { ease: number; interval: number; reps: number; lapses: number; due: string }
export type Grade = "again" | "hard" | "good" | "easy";
export const GRADES: Grade[] = ["again", "hard", "good", "easy"];

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const newState = (today: string): CardState => ({ ease: 2.5, interval: 0, reps: 0, lapses: 0, due: today });

/**
 * The state after answering. "Again" keeps the card due today (it comes back later in the session) and
 * lowers its ease; the others push it further out, Easy the most. Intervals grow by the card's ease.
 */
export function review(s: CardState, g: Grade, today: string): CardState {
  let { ease, interval, reps, lapses } = s;
  if (g === "again") {
    if (reps > 0) lapses++;
    ease = Math.max(1.3, ease - 0.2); interval = 0; reps = 0;
    return { ease: round(ease), interval, reps, lapses, due: today };
  }
  if (reps === 0) interval = g === "hard" ? 1 : g === "good" ? 1 : 4;
  else if (reps === 1) interval = g === "hard" ? 2 : g === "good" ? 3 : 5;
  else {
    const base = Math.max(1, interval);
    interval = g === "hard" ? base * 1.2 : g === "good" ? base * ease : base * ease * 1.3;
  }
  if (g === "hard") ease = Math.max(1.3, ease - 0.15);
  if (g === "easy") ease = ease + 0.15;
  interval = Math.max(1, Math.round(interval));
  return { ease: round(ease), interval, reps: reps + 1, lapses, due: addDays(today, interval) };
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Button hint: "Now" for Again, otherwise "1d", "4d", "3w", "2mo". */
export function hint(s: CardState, g: Grade, today: string): string {
  const n = review(s, g, today).interval;
  if (g === "again" || n === 0) return "Now";
  if (n < 14) return `${n}d`;
  if (n < 60) return `${Math.round(n / 7)}w`;
  if (n < 365) return `${Math.round(n / 30)}mo`;
  return `${Math.round(n / 365)}y`;
}

export const isState = (v: unknown): v is CardState => {
  const s = v as CardState;
  return !!s && typeof s === "object" && [s.ease, s.interval, s.reps, s.lapses].every((x) => typeof x === "number" && Number.isFinite(x) && x >= 0)
    && typeof s.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.due);
};
