// Which build this is (set by vite.config.ts), and a quiet check for a newer one. A Home Screen app on iPhone or iPad
// can stay open for days, so it looks for a newer version when it comes back to the foreground and every few minutes
// while it's open, and reloads itself when one is live. It waits for a calm moment: not while the user's typing or has a
// menu, sheet or dialog open (edits are saved as you type, and offline edits are kept in the queue, so nothing is lost).
declare const __BUILD__: string;
export const BUILD = typeof __BUILD__ === "string" ? __BUILD__ : "dev";

const EVERY_MS = 3 * 60_000;
const currentScript = () => document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]')?.getAttribute("src") ?? null;

async function liveScript(): Promise<string | null> {
  try {
    const html = await (await fetch("/", { cache: "no-store", credentials: "same-origin" })).text();
    return /<script[^>]+type="module"[^>]+src="([^"]*\/assets\/[^"]+)"/.exec(html)?.[1] ?? null;
  } catch { return null; }
}

/** Nothing would be interrupted: no text field focused, no menu, sheet, dialog or full-screen tool open. */
function calm() {
  const a = document.activeElement as HTMLElement | null;
  if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return false;
  return !document.querySelector(".popover, .fixed-pop, .block-menu, .modal-back, .spot-back, .study, .live-voice, .handwriting, .peek");
}

export function watchForUpdates() {
  const mine = currentScript();
  if (!mine) return () => {}; // dev server: nothing to compare
  let checking = false, waiting = false;
  const check = async (fromForeground = false) => {
    if (document.visibilityState !== "visible" || !navigator.onLine) return;
    if (!waiting) {
      if (checking) return;
      checking = true;
      const live = await liveScript();
      checking = false;
      waiting = !!live && live !== mine;
    }
    // Coming back to the app is always a fine moment; otherwise wait until nothing is open.
    if (waiting && (fromForeground || calm())) location.reload();
  };
  const onVis = () => { if (document.visibilityState === "visible") void check(true); };
  document.addEventListener("visibilitychange", onVis);
  const timer = setInterval(() => void check(), EVERY_MS);
  const soon = setInterval(() => { if (waiting) void check(); }, 5_000);
  void check(true);
  return () => { document.removeEventListener("visibilitychange", onVis); clearInterval(timer); clearInterval(soon); };
}
