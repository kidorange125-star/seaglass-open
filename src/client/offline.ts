// Offline mode. Reading: the service worker (public/sw.js) keeps recently opened pages, the page list, tasks and
// flashcards, and Seaglass warms that cache in the background. Writing: edits to existing pages and tasks made
// while offline are kept in a durable queue on this device and sent when the connection is back. If a page was
// changed somewhere else in the meantime, the offline edit is never thrown away or allowed to overwrite: it is
// saved as a copy page ("… (offline edit)") next to the original.
import { flushSessions, OFFLINE_KEYS, queuedSessions } from "./study/offline";
import { api, Conflict } from "./api";

export class OfflineQueued extends Error { constructor() { super("saved offline"); } }

const KEY = "sg.offline.queue";
export interface Queued { id: string; patch: Record<string, unknown>; revision?: number; at: number }

const read = (): Queued[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Queued[]; } catch { return []; } };
const write = (q: Queued[]) => { try { if (q.length) localStorage.setItem(KEY, JSON.stringify(q)); else localStorage.removeItem(KEY); } catch { /* storage full or unavailable */ } window.dispatchEvent(new CustomEvent("seaglass:queue")); };
export const queuedCount = () => read().length;
export const hasQueued = (id: string) => read().some((x) => x.id === id);

/** Keeps a patch for later. Edits to the same page are merged (later fields win); the first base revision is kept,
 *  so a change made elsewhere meanwhile is detected when it is sent. */
export function enqueue(id: string, patch: Record<string, unknown>) {
  const { revision, ...rest } = patch as { revision?: number } & Record<string, unknown>;
  const q = read();
  const hit = q.find((x) => x.id === id);
  if (hit) { hit.patch = { ...hit.patch, ...rest }; if (hit.revision === undefined && typeof revision === "number") hit.revision = revision; hit.at = Date.now(); }
  else q.push({ id, patch: rest, ...(typeof revision === "number" ? { revision } : {}), at: Date.now() });
  write(q);
}

/** A network failure (as opposed to the server answering with an error). */
export const isNetworkError = (e: unknown) => e instanceof TypeError || (e instanceof DOMException && e.name === "NetworkError");

let flushing = false;
/** Sends queued edits, oldest first. Stops at the first network failure. Returns how many were sent. */
export async function flushQueue(toast?: (m: string) => void): Promise<number> {
  if (flushing || !navigator.onLine) return 0;
  flushing = true;
  let sent = 0;
  try {
    for (const item of read()) {
      try {
        await api.patchNow(item.id, { ...item.patch, ...(item.revision !== undefined ? { revision: item.revision } : {}) });
        write(read().filter((x) => x.id !== item.id || x.at !== item.at)); sent++;
      } catch (e) {
        if (isNetworkError(e)) break;
        if (e instanceof Conflict) {
          // Changed elsewhere while you were offline: keep your version as a copy page instead of overwriting.
          try {
            const cur = e.current;
            const html = typeof item.patch.html === "string" ? item.patch.html : cur.html;
            const title = typeof item.patch.title === "string" ? item.patch.title : cur.title;
            await api.create({ title: `${title || "Untitled"} (offline edit)`, html, parent_id: cur.parent_id, icon: cur.icon });
            toast?.(`“${cur.title || "A page"}” changed elsewhere, so your offline edit was saved as a copy`);
          } catch { break; }
        } else if (e instanceof Error && /not found|locked/i.test(e.message)) {
          toast?.("An offline change couldn't be applied (the page is gone or locked)");
        } else break; // unknown server error: keep it and try again later
        write(read().filter((x) => x.id !== item.id || x.at !== item.at));
      }
    }
  } finally { flushing = false; }
  if (sent) { window.dispatchEvent(new CustomEvent("seaglass:agent-changed")); toast?.(`Synced ${sent} change${sent === 1 ? "" : "s"} made offline`); }
  return sent;
}

/** Starts background syncing: on load, when the connection returns, and every 20 seconds while edits are waiting. */
export function startOfflineSync(toast: (m: string) => void) {
  const go = () => { void flushQueue(toast); void flushSessions().then((n) => { if (n) toast(`Synced ${n} study session${n === 1 ? "" : "s"} done offline`); }); };
  addEventListener("online", go);
  const t = setInterval(() => { if (queuedCount() || queuedSessions()) go(); }, 20_000);
  go();
  return () => { removeEventListener("online", go); clearInterval(t); };
}

/** Quietly fetches pages you're likely to want offline so the service worker keeps them. */
export async function warmCache(ids: string[], tasksDb: string | null) {
  if (!navigator.onLine || !("caches" in window)) return;
  const wanted = [...new Set(ids)].slice(0, 30);
  const urls = [...wanted.map((id) => `/api/notes/${id}`), ...(tasksDb ? [`/api/notes/${tasksDb}`, `/api/notes/${tasksDb}/children`] : []), "/api/home", "/api/tree"];
  for (const u of urls) { try { await fetch(u, { credentials: "same-origin" }); } catch { return; } await new Promise((r) => setTimeout(r, 120)); }
}

// What stays on a device when someone else signs in on it: how the device looks and works, never anyone's things.
const DEVICE_KEYS = /^sg\.(theme|glass|device|voice|sbw|lecture\.piece|ink\.(pen|width|snap|auto))(\.|$)/;

/** On a shared device (a family tablet), a different person signing in starts clean: the last person's offline copies,
 *  unsent edits, unfinished quizzes, recent pages and the service worker's cache go. Returns true when it cleared. */
export async function forgetOtherPerson(userId: string) {
  let prev: string | null = null;
  try { prev = localStorage.getItem("sg.user"); } catch { return false; }
  if (prev === userId) return false;
  try { localStorage.setItem("sg.user", userId); } catch { /* storage unavailable */ }
  if (prev === null) return false; // first sign-in on this device (or before 0.2): nothing of anyone else's to clear
  await clearOffline();
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("sg.") && k !== "sg.user" && !DEVICE_KEYS.test(k)) localStorage.removeItem(k);
    sessionStorage.clear();
  } catch { /* storage unavailable */ }
  return true;
}

/** Forget everything kept for offline use (on log out). */
export async function clearOffline() {
  try { localStorage.removeItem(KEY); localStorage.removeItem("sg.study.unfinished"); for (const k of OFFLINE_KEYS) localStorage.removeItem(k); } catch { /* storage unavailable */ } // + unfinished quizzes (study/resume.ts) and quizzes kept for offline (study/offline.ts)
  try { for (const k of await caches.keys()) if (k.startsWith("sg-")) await caches.delete(k); } catch { /* no cache storage */ }
}
