// Quizzes offline (#8): the question sets and practice tests the user has fetched are kept on the device, so with no connection
// the same ones still play; a session finished offline waits in an outbox and is sent when the connection returns
// (started with the other offline syncing, client offline.ts). Plaintext on the device like the rest of the offline copy,
// and cleared on log out. Pure apart from localStorage and one api call: tests/browser/study-offline.cjs.
import { api } from "../api";
import type { StudySet } from "./generated";
import type { PlayedSession, TestQuestion } from "./coach";

const SETS = "sg.study.sets", TESTS = "sg.study.tests", OUTBOX = "sg.study.outbox";
const MAX_SETS = 30, MAX_TESTS = 15, MAX_OUT = 50;
export const OFFLINE_KEYS = [SETS, TESTS, OUTBOX];
type Kept<T> = Record<string, { v: T; at: number }>;
const read = <T>(k: string): Kept<T> => { try { const v = JSON.parse(localStorage.getItem(k) ?? "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full or blocked */ } };
const keyOf = (ids: string[], mode = "") => `${mode}|${[...ids].sort().join(",")}`;
function keep<T>(store: string, key: string, v: T, max: number) {
  const all = read<T>(store);
  all[key] = { v, at: Date.now() };
  const keys = Object.keys(all).sort((a, b) => all[b].at - all[a].at);
  for (const k of keys.slice(max)) delete all[k];
  write(store, all);
}

/** A question set as fetched, kept for offline. */
export const keepSet = (mode: string, ids: string[], set: StudySet) => keep(SETS, keyOf(ids, mode), set, MAX_SETS);
export const savedSet = (mode: string, ids: string[]): StudySet | null => read<StudySet>(SETS)[keyOf(ids, mode)]?.v ?? null;
/** A practice test's questions, kept for offline. */
export const keepTest = (ids: string[], qs: TestQuestion[]) => keep(TESTS, keyOf(ids), qs, MAX_TESTS);
export const savedTest = (ids: string[]): TestQuestion[] | null => read<TestQuestion[]>(TESTS)[keyOf(ids)]?.v ?? null;

/** True for "no connection" (fetch failed), not for an error the server sent. */
export const offlineError = (e: unknown) => !navigator.onLine || e instanceof TypeError || (e instanceof DOMException && e.name === "NetworkError");

// ---- sessions finished offline
const outbox = (): PlayedSession[] => { try { const v = JSON.parse(localStorage.getItem(OUTBOX) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };
export const queuedSessions = () => outbox().length;
export function queueSession(s: PlayedSession) { write(OUTBOX, [...outbox(), s].slice(-MAX_OUT)); }

let sending = false;
/** Sends sessions finished offline, oldest first; stops at the first network failure. Returns how many were sent. */
export async function flushSessions(): Promise<number> {
  if (sending || !navigator.onLine || !outbox().length) return 0;
  sending = true;
  let sent = 0;
  try {
    for (const s of outbox()) {
      try { await api.studySession(s, false); sent++; }
      catch (e) { if (offlineError(e)) break; } // a session the server refuses is dropped, not retried forever
      write(OUTBOX, outbox().slice(1));
    }
  } finally { sending = false; }
  if (sent) dispatchEvent(new CustomEvent("seaglass:agent-changed"));
  return sent;
}
