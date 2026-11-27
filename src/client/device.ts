// Which device this is, for handwriting: The user writes with an Apple Pencil on their iPad and types on their iPhone and
// computer. So writing by hand (the pencil button, / Handwriting, handwritten Cornell notes, editing a drawing) is only
// offered on a tablet. Elsewhere drawings are shown, and text typed into a page with handwriting is kept as normal
// text, marked so the iPad outlines it as something to write in by hand (editor/inkTodo.ts).
// iPadOS Safari says it's a Mac, so a "Mac" with a touch screen is an iPad. `sg.device` ("tablet" | "other") overrides
// it on this device (tests, or a tablet that guesses wrong).

let cached: boolean | null = null;

export function isInkDevice(): boolean {
  try {
    const o = localStorage.getItem("sg.device");
    if (o === "tablet") return true;
    if (o === "other") return false;
  } catch { /* no storage: guess */ }
  if (cached !== null) return cached;
  if (typeof navigator === "undefined") return (cached = false);
  const ua = navigator.userAgent;
  const iPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1);
  const androidTablet = /Android/.test(ua) && !/Mobile/.test(ua);
  return (cached = iPad || androidTablet);
}

// The page knows which it is, for styles (notion.css: a drawing is for reading on the iPhone and the computer).
if (typeof document !== "undefined") { try { document.documentElement.dataset.ink = isInkDevice() ? "tablet" : "other"; } catch { /* no DOM */ } }

/** A phone (by user agent). `sg.device` =
 *  "phone" makes this device one (tests). A tablet is not a phone. */
export function isPhone(): boolean {
  try { if (localStorage.getItem("sg.device") === "phone") return true; } catch { /* no storage: guess */ }
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPod|Android.*Mobile|Mobile.*Android/i.test(navigator.userAgent);
}
