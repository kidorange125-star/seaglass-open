// Client side of the proactive assistant: the inbox's unread count (for the badge) and the saved prompts (for the /
// menus), shared by every component without going through the big store. Server: src/worker/proactive.ts.
import { useSyncExternalStore } from "react";
import { api, type SavedPrompt } from "./api";

let unread = 0;
let prompts: SavedPrompt[] = [];
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => { subs.add(f); return () => subs.delete(f); };

export const useUnread = () => useSyncExternalStore(subscribe, () => unread);
export const useSavedPrompts = () => useSyncExternalStore(subscribe, () => prompts);
export const savedPromptsNow = () => prompts;

/** The badge: messages the assistant sent on its own (check-ins, routine reports) since you last looked at the thread. */
export async function refreshUnread() {
  try { const r = await api.threadUnread(); if (r.unread !== unread) { unread = r.unread; emit(); } return r.unread; } catch { return null; }
}
export function setUnread(n: number) { if (n !== unread) { unread = n; emit(); } }
export async function refreshPrompts() {
  try { prompts = await api.prompts(); emit(); } catch { /* offline */ }
}
/** Keeps the badge current: on start, every 2 minutes, and whenever the app comes back to the foreground. */
export function startProactive() {
  void refreshUnread(); void refreshPrompts();
  const t = setInterval(() => void refreshUnread(), 120_000);
  const vis = () => { if (document.visibilityState === "visible") void refreshUnread(); };
  document.addEventListener("visibilitychange", vis);
  return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); };
}
/** A saved prompt typed as "/name extra words": the prompt's text, plus the extra words. */
export function expandSaved(text: string): { text: string; label: string } | null {
  const m = /^\/([a-z0-9][a-z0-9-]*)(?:\s+([\s\S]*))?$/i.exec(text.trim());
  const p = m && prompts.find((x) => x.name === m[1].toLowerCase());
  if (!p) return null;
  return { text: m![2]?.trim() ? `${p.text}\n\n${m![2].trim()}` : p.text, label: `/${p.name}` };
}
