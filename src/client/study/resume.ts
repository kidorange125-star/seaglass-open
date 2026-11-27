// Unfinished quizzes, fill-in-the-blanks and practice tests, kept on this device after every answer so closing one
// halfway doesn't lose it. Reopening the same one offers to pick up where the user left off, and the Study tab lists them.
// Match is a race against the clock, so it just starts again. Flashcards keep their own schedule anyway.
// Kept in localStorage (like the offline queue), at most MAX of them, for DAYS days. No imports: the unit test loads it.

export type ResumeKind = "quiz" | "blanks" | "test";
export interface Unfinished<T = unknown> {
  key: string;
  kind: ResumeKind;
  ids: string[];
  title: string;
  /** the questions came with the session (History retake, missed-question review), not from the assistant for these pages */
  replay: boolean;
  /** the question set it was playing, so resuming needs no model call */
  set?: unknown;
  at: number;
  /** questions answered and in total, for the Study tab */
  done: number;
  total: number;
  /** seconds spent so far, so the saved session's time is the time actually studied */
  elapsed: number;
  state: T;
}

const KEY = "sg.study.unfinished";
export const MAX = 5;
export const DAYS = 7;
export const CHANGED = "seaglass:unfinished";

/** Which unfinished session this is. One whose questions came with it (a History retake, a missed-question review) is told
 *  apart by a fingerprint of those questions, so a retake of an old quiz never offers to resume a different one on the same page. */
export function resumeKey(kind: ResumeKind, ids: string[], replay?: unknown) {
  return `${kind}:${replay ? `replay-${fingerprint(JSON.stringify(replay))}` : "notes"}:${ids.join(",")}`;
}
function fingerprint(s: string) {
  let a = 0x811c9dc5, b = 5381;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193); b = (Math.imul(b, 33) + c) | 0; }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}

function read(): Unfinished[] {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => x && typeof x.key === "string" && typeof x.at === "number") : [];
  } catch { return []; }
}
function write(list: Unfinished[]) {
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(list)); } catch { /* full or blocked: it just won't be kept */ }
  try { globalThis.dispatchEvent?.(new Event(CHANGED)); } catch { /* not in a browser */ }
}

/** Newest first, without the ones older than DAYS. */
export function unfinished(now = Date.now()): Unfinished[] {
  return read().filter((x) => now - x.at < DAYS * 86_400_000).sort((a, b) => b.at - a.at);
}

export function getUnfinished<T>(key: string, now = Date.now()): Unfinished<T> | null {
  return (unfinished(now).find((x) => x.key === key) as Unfinished<T> | undefined) ?? null;
}

export function keepUnfinished(entry: Unfinished, now = Date.now()) {
  write([{ ...entry, at: now }, ...unfinished(now).filter((x) => x.key !== entry.key)].slice(0, MAX));
}

export function dropUnfinished(key: string) {
  const list = read();
  if (list.some((x) => x.key === key)) write(list.filter((x) => x.key !== key));
}

/** "question 4 of 10": the one they'll land on. */
export const resumeAt = (u: Pick<Unfinished, "done" | "total">) => `question ${Math.min(u.done + 1, u.total)} of ${u.total}`;
