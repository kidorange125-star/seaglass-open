// Paper Lock, on this device: the open locks it holds. A secret lives in memory only (never saved to the device), so
// reloading or closing the page loses it, which is the point: closing a page relocks it at once. The server ends the lock too
// (api.paperRelock); if that request can't be sent, the lock runs out on its own after ten idle minutes.
import { api } from "../api";

const secrets = new Map<string, string>();
const timers = new Map<string, number>();

export const grantOf = (noteId: string) => secrets.get(noteId);
export const holdGrant = (noteId: string, secret: string) => { secrets.set(noteId, secret); cancelRelock(noteId); };
export const dropGrant = (noteId: string) => { secrets.delete(noteId); };

/** Ends this device's lock on a page: forgets the secret and tells the server. `beacon` is for a page that is going away. */
export function relockNow(noteId: string, beacon = false) {
  const secret = secrets.get(noteId);
  cancelRelock(noteId);
  if (!secret) return;
  secrets.delete(noteId);
  const body = JSON.stringify({ secret });
  if (beacon && navigator.sendBeacon?.("/api/paper/relock", new Blob([body], { type: "application/json" }))) return;
  void fetch("/api/paper/relock", { method: "POST", credentials: "same-origin", keepalive: true, headers: { "Content-Type": "application/json" }, body }).catch(() => {});
}

/** A page that was showing the words has been left. Relock after a moment, unless a page for the same note opens straight
 *  away (a side peek becoming the full page), which keeps the lock open. */
export function relockSoon(noteId: string) {
  cancelRelock(noteId);
  timers.set(noteId, window.setTimeout(() => { timers.delete(noteId); relockNow(noteId); }, 1500));
}
export function cancelRelock(noteId: string) { const t = timers.get(noteId); if (t !== undefined) { clearTimeout(t); timers.delete(noteId); } }

if (typeof window !== "undefined") {
  // the tab or app is closed, or the page is left for another site
  addEventListener("pagehide", () => { for (const id of [...secrets.keys()]) relockNow(id, true); });
}

/** Keeps an open lock open while its page is showing, and says (false) when the server has locked it again. */
export async function keepOpen(noteId: string): Promise<boolean> {
  const secret = secrets.get(noteId);
  if (!secret) return false;
  try { await api.paperPing(noteId, secret); return true; }
  catch (e) { if ((e as { status?: number }).status === 423) { secrets.delete(noteId); return false; } return true; /* offline: try again */ }
}
