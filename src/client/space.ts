// Which space this page is showing: the person's own, or the household's shared Family space (?space=family in the
// page address, src/shared/space.ts). In the Family space, requests for pages, databases, tasks and the calendar go to
// /api/s/family/...; everything personal (the assistant, study, settings, notifications) still goes to the person's own
// space, so it keeps working the same. Switching spaces loads the page fresh, so nothing of one shows in the other.
import { familyAllows, FAMILY, SHARE_PARAM, shareAllows, SPACE_PARAM, SPACE_PREFIX } from "../shared/space";

export const space: typeof FAMILY | null = new URLSearchParams(location.search).get(SPACE_PARAM) === FAMILY ? FAMILY : null;
export const inFamily = space === FAMILY;
/** A page someone shared with you (?share=<id>): only that page and its sub-pages show. */
const sid = new URLSearchParams(location.search).get(SHARE_PARAM);
export const shareId = sid && /^[0-9a-f-]{36}$/.test(sid) ? sid : null;
export const inShare = !!shareId;
/** Anywhere but your own space: personal things (the assistant, study, settings pages) don't show there. */
export const awayFromMine = inFamily || inShare;

/** A device storage key for this space (recent pages, open folders and the offline queue are kept per space). */
export const spaceKey = (key: string) => (inFamily ? `${key}@family` : inShare ? `${key}@share-${shareId}` : key);

/** The address of a space: the Family space or your own. */
export const spaceHref = (family: boolean) => {
  const u = new URL(location.href);
  if (family) u.searchParams.set(SPACE_PARAM, FAMILY); else u.searchParams.delete(SPACE_PARAM);
  u.searchParams.delete(SHARE_PARAM);
  u.hash = "#/";
  return u.toString();
};

/** Sends the Family space's requests to it. Called once, before anything else runs. */
/** The address of a page shared with you. */
export const shareHref = (id: string, noteId: string) => {
  const u = new URL(location.href);
  u.searchParams.delete(SPACE_PARAM);
  u.searchParams.set(SHARE_PARAM, id);
  u.hash = `#/p/${noteId}`;
  return u.toString();
};

export function installSpaceFetch() {
  if (!inFamily && !inShare) return;
  const prefix = inShare ? `/api/s/share/${shareId}` : SPACE_PREFIX;
  const allows = inShare ? shareAllows : familyAllows;
  const base = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, location.href);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (url.origin === location.origin && url.pathname.startsWith("/api/") && allows(method, url.pathname)) {
      url.pathname = `${prefix}/${url.pathname.slice(5)}`;
      return base(input instanceof Request ? new Request(url, input) : url.toString(), init);
    }
    return base(input, init);
  };
}
