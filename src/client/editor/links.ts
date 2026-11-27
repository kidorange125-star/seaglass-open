// Links in pages: what address is allowed, how it's shown, and what clicking it does. Pure (no editor), so it's tested in
// tests/unit/links.test.mts. The dialog that writes them is editor/LinkDialog.tsx.

/** What the user typed as an address, made safe and complete: "" if empty, null if it can't be a link.
 *  Web addresses get https:// when they have no scheme, an email address becomes mailto:, an address inside the app
 *  (#/p/…) or on this site (/files/…) stays as it is; scripts, data and file addresses are never links. */
export function normalizeHref(raw: string): string | null {
  const v = raw.trim();
  if (!v) return "";
  if (/\s/.test(v)) return null;
  if (/^(javascript|data|vbscript|file|blob|about):/i.test(v)) return null;
  if (/^(mailto|tel):/i.test(v)) return v;
  if (/^#\/|^\/(?!\/)/.test(v)) return v;
  if (/^[^@/:]+@[^@/:]+\.[a-z]{2,}$/i.test(v)) return `mailto:${v}`;
  const full = /^https?:\/\//i.test(v) ? v : `https://${v.replace(/^\/\//, "")}`;
  try { const u = new URL(full); return /^https?:$/.test(u.protocol) && u.hostname.includes(".") || u.hostname === "localhost" ? full : null; } catch { return null; }
}

/** Whether the cursor got into a link by a mouse or touch (a click that follows it): then the link card stays away, so it
 *  never covers the line under the link. A key press (the arrow keys) clears it and the card shows. */
export const nav = { byMouse: false };

/** The short form of an address to show in the link card: the site, or "this app" for a link inside Seaglass. */
export function hostOf(href: string): string {
  if (/^#\//.test(href)) return "a page in Seaglass";
  if (/^mailto:/i.test(href)) return href.slice(7);
  if (/^tel:/i.test(href)) return href.slice(4);
  try { const u = new URL(href, "https://seaglass.invalid"); return u.hostname === "seaglass.invalid" ? href : u.hostname.replace(/^www\./, "") + (u.pathname.length > 1 ? u.pathname : ""); } catch { return href; }
}

/** What clicking a link does: an address inside Seaglass goes there, a web address opens in a new tab (never this one,
 *  so the page and its unsaved edits stay), mail and phone links go to the device's app. Returns what it did. */
export function openLink(href: string, go: (to: string) => void, here: Location = location, open: (url: string) => void = (u) => void window.open(u, "_blank", "noopener,noreferrer")): "app" | "tab" | "device" | "none" {
  let u: URL;
  try { u = new URL(href, here.href); } catch { return "none"; }
  if (u.protocol === "mailto:" || u.protocol === "tel:") { here.href = u.href; return "device"; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "none";
  if (u.origin === here.origin && u.hash.startsWith("#/") && (u.pathname === "/" || u.pathname === here.pathname)) { go(u.hash.slice(1)); return "app"; }
  open(u.href);
  return "tab";
}
