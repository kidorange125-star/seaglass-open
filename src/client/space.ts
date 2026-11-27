// Which space this page is showing: the person's own, or the household's shared Family space (?space=family in the
// page address, src/shared/space.ts). In the Family space, requests for pages, databases, tasks and the calendar go to
// /api/s/family/...; everything personal (the assistant, study, settings, notifications) still goes to the person's own
// space, so it keeps working the same. Switching spaces loads the page fresh, so nothing of one shows in the other.
import { familyAllows, FAMILY, SPACE_PARAM, SPACE_PREFIX } from "../shared/space";

export const space: typeof FAMILY | null = new URLSearchParams(location.search).get(SPACE_PARAM) === FAMILY ? FAMILY : null;
export const inFamily = space === FAMILY;

/** A device storage key for this space (recent pages, open folders and the offline queue are kept per space). */
export const spaceKey = (key: string) => (inFamily ? `${key}@family` : key);

/** The address of a space: the Family space or your own. */
export const spaceHref = (family: boolean) => {
  const u = new URL(location.href);
  if (family) u.searchParams.set(SPACE_PARAM, FAMILY); else u.searchParams.delete(SPACE_PARAM);
  u.hash = "#/";
  return u.toString();
};

/** Sends the Family space's requests to it. Called once, before anything else runs. */
export function installSpaceFetch() {
  if (!inFamily) return;
  const base = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, location.href);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (url.origin === location.origin && url.pathname.startsWith("/api/") && familyAllows(method, url.pathname)) {
      url.pathname = `${SPACE_PREFIX}/${url.pathname.slice(5)}`;
      return base(input instanceof Request ? new Request(url, input) : url.toString(), init);
    }
    return base(input, init);
  };
}
