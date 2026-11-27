// "Hide from AI": a page the user hides (and everything under it: sub-pages, database rows) is invisible to every
// AI: Waffle, Claude through MCP, and the background features (check-ins, tidy-ups, semantic search, quizzes...).
// Two layers enforce it:
//  1. notes.ts refuses agent and MCP writes to hidden pages (HiddenError), whatever tool made them.
//  2. Everything an AI is shown passes through scrub(): hidden pages are dropped from lists, links to them are
//     blanked out, and a tool input that names a hidden page is refused before the tool runs.
// The flag itself (notes.ai_hidden) can only be changed by the user in the app, never by Waffle or MCP.

/** Hidden page ids. From hiddenForAi() (notes.ts) it also carries, for each visible page that mentions a hidden one, the
 *  hidden titles it mentions: a mention turns into its title in a page's plain text and snippets. */
export type HiddenSet = Set<string> & { titles?: Map<string, string[]> };

export class HiddenError extends Error {
  constructor() { super("This page is hidden from AI: The user turned on \"Hide from AI\" for it (or for a page it sits under), so it can't be read or changed. Don't try to work around it; tell the user if you need it."); }
}

/** SQL for every hidden page id: pages with the flag and everything beneath them, trashed or not.
 *  Use it as a subquery: `n.id NOT IN (${HIDDEN_SQL})`. */
export const HIDDEN_SQL = "WITH RECURSIVE hid(id) AS (SELECT id FROM notes WHERE owner_id = {owner} AND (ai_hidden = 1) UNION SELECT n.id FROM notes n JOIN hid ON n.parent_id = hid.id WHERE n.owner_id = {owner}) SELECT id FROM hid";

export async function hiddenIds(db: D1Database): Promise<Set<string>> {
  const rows = (await db.prepare(HIDDEN_SQL).all<{ id: string }>()).results;
  return new Set(rows.map((r) => r.id));
}

/** A visible page's plain text with the titles of hidden pages it mentions blanked out (for AI prompts). */
export const blankMentions = (text: string, pageId: string, hidden: HiddenSet) =>
  (hidden.titles?.get(pageId) ?? []).slice().sort((a, b) => b.length - a.length).reduce((s, t) => s.split(t).join(PLACEHOLDER), text);

export const isHidden = async (db: D1Database, id: string | null | undefined) => !!id && (await hiddenIds(db)).has(id);

const UUID_G = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** True when any string anywhere in the value names a hidden page (used to refuse tool inputs). */
export function namesHidden(value: unknown, hidden: Set<string>, depth = 0): boolean {
  if (!hidden.size || depth > 12) return false;
  if (typeof value === "string") return [...value.matchAll(UUID_G)].some((m) => hidden.has(m[0].toLowerCase()));
  if (Array.isArray(value)) return value.some((v) => namesHidden(v, hidden, depth + 1));
  if (value && typeof value === "object") return Object.values(value).some((v) => namesHidden(v, hidden, depth + 1));
  return false;
}

// Keys that say which page an object is about.
const ID_KEYS = ["id", "page_id", "note_id", "row_id", "database_id", "parent_id", "from_id", "to_id", "to"];
const IDS_KEYS = ["ids", "page_ids", "note_ids"]; // lists of page ids (a study session's pages, a test's pages)
const PLACEHOLDER = "[hidden page]";

const aboutHidden = (o: Record<string, unknown>, hidden: Set<string>) => {
  if (ID_KEYS.some((k) => typeof o[k] === "string" && hidden.has((o[k] as string).toLowerCase()))) return true;
  // An object about a list of pages (a study session, a test) is hidden when every one of its pages is.
  return IDS_KEYS.some((k) => {
    const v = o[k];
    return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string" && hidden.has(x.toLowerCase()));
  });
};

/** Blanks out mentions, sub-page blocks and links that point at hidden pages, then any bare id left over. */
export function scrubText(s: string, hidden: Set<string>): string {
  if (!hidden.size || !UUID_G.test(s)) return s;
  UUID_G.lastIndex = 0;
  const has = (chunk: string) => [...chunk.matchAll(UUID_G)].some((m) => hidden.has(m[0].toLowerCase()));
  // Walk opening tags; one that points at a hidden page loses everything up to its closing tag (its title).
  // Mentions, sub-page blocks and links never nest their own tag, so the next closing tag is theirs.
  const open = /<(span|div|a)\b[^>]*>/gi;
  let out = "", at = 0;
  for (let m = open.exec(s); m; m = open.exec(s)) {
    if (!has(m[0])) continue;
    const close = s.toLowerCase().indexOf(`</${m[1].toLowerCase()}>`, open.lastIndex);
    const end = close < 0 ? open.lastIndex : close + m[1].length + 3;
    out += `${s.slice(at, m.index)}<span>${PLACEHOLDER}</span>`;
    at = end; open.lastIndex = end;
  }
  return (out + s.slice(at)).replace(UUID_G, (id) => (hidden.has(id.toLowerCase()) ? "hidden" : id));
}

/** A copy of the value with everything about hidden pages removed. Safe to show to an AI. */
export function scrub<T>(value: T, hidden: HiddenSet, depth = 0, blank: string[] = []): T {
  if (!hidden.size || depth > 20) return value;
  if (typeof value === "string") {
    let s = scrubText(value, hidden);
    for (const t of blank) s = s.split(t).join(PLACEHOLDER);
    return s as T;
  }
  if (Array.isArray(value)) {
    return value
      .filter((v) => !(typeof v === "string" && hidden.has(v.toLowerCase())))
      .filter((v) => !(v && typeof v === "object" && !Array.isArray(v) && aboutHidden(v as Record<string, unknown>, hidden)))
      .map((v) => scrub(v, hidden, depth + 1, blank)) as T;
  }
  if (value && typeof value === "object") {
    // A page that mentions hidden pages: their titles are blanked in everything about it (its text, its snippet).
    const own = ID_KEYS.slice(0, 3).map((k) => (value as Record<string, unknown>)[k]).find((v): v is string => typeof v === "string" && !!hidden.titles?.has(v));
    const titles = own ? [...blank, ...hidden.titles!.get(own)!].sort((a, b) => b.length - a.length) : blank;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = v && typeof v === "object" && !Array.isArray(v) && aboutHidden(v as Record<string, unknown>, hidden) ? PLACEHOLDER : scrub(v, hidden, depth + 1, titles);
    }
    return out as T;
  }
  return value;
}
