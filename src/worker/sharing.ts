// Sharing a page with one person in the household (0.2.3). The page and its sub-pages stay in the owner's things; the
// person reaches them only at /api/s/share/<share id>/..., and every such request goes through gate() below: the share
// must be theirs, the route must be one a shared page allows at its level, and every page it names must be inside the
// shared branch. Then the request runs in the OWNER's scope (scope.ts), so nothing else of the owner's is reachable:
// the page list is cut to the branch, and routes that would show more (search, recent, home, history of other pages,
// undo, the assistant) aren't allowed at all.
import type { Env } from "./env";
import * as N from "./notes";
import { asPerson } from "./scope";

export type Level = "view" | "edit";
export const LEVELS: Level[] = ["view", "edit"];
export type Share = { id: string; owner_id: string; note_id: string; person_id: string; level: Level; created_at: number };

const NOTE = "[0-9a-f-]{36}";
/** What a shared page allows, by level. Paths are the normal /api/... ones. */
const ROUTES: [string, RegExp, Level][] = [
  ["GET", new RegExp(`^/api/notes/${NOTE}(/(children|comments|history|history/[\\w-]+))?$`), "view"],
  ["GET", /^\/api\/unfurl$/, "view"],
  ["PATCH", new RegExp(`^/api/notes/${NOTE}$`), "edit"],
  ["POST", /^\/api\/notes$/, "edit"],
  ["POST", new RegExp(`^/api/notes/${NOTE}/comments$`), "edit"],
  ["POST", /^\/api\/upload$/, "edit"],
];
/** What someone with edit access may change on a shared page: its words and looks, never where it lives or who sees it. */
const EDITABLE = new Set(["title", "html", "icon", "cover", "props", "full_width", "small_text", "font", "revision"]);

/** The pages in a shared branch: the page and everything under it. */
export async function branch(ownerDb: D1Database, rootId: string): Promise<Set<string>> {
  const tree = (await N.listTree(ownerDb)) as unknown as { id: string; parent_id: string | null }[];
  const kids = new Map<string, string[]>();
  for (const n of tree) if (n.parent_id) (kids.get(n.parent_id) ?? kids.set(n.parent_id, []).get(n.parent_id)!).push(n.id);
  const out = new Set<string>();
  if (!tree.some((n) => n.id === rootId)) return out;
  const stack = [rootId];
  while (stack.length && out.size < 5000) { const id = stack.pop()!; if (out.has(id)) continue; out.add(id); stack.push(...(kids.get(id) ?? [])); }
  return out;
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const lockAll = (v: unknown): unknown => (Array.isArray(v) ? v.map(lockAll) : v && typeof v === "object" && "id" in v ? { ...(v as object), locked: 1 } : v);

type Ctx = { env: Env; req: { method: string; path: string; json: () => Promise<unknown> }; res: Response };
/**
 * The check for /api/s/share/<id>/... Returns a Response to send instead (a refusal, or the answers it gives itself), or
 * null to go on, with c.env scoped to the page's owner. `after` (when returned) adjusts the route's response.
 */
export async function gate(c: Ctx & { env: Env & { SHARE?: string } }, user: { id: string; display_name: string; username: string }): Promise<{ stop: Response } | { after?: (r: Response) => Promise<Response> }> {
  const share = await c.env.DB.prepare("SELECT * FROM page_shares WHERE id = ? AND person_id = ?").bind(c.env.SHARE, user.id).first<Share>();
  if (!share) return { stop: json({ error: "This page isn't shared with you (any more)." }, 404) };
  const owner = asPerson(c.env, share.owner_id);
  const ids = await branch(owner.DB, share.note_id);
  if (!ids.size) return { stop: json({ error: "This page was deleted or moved to the trash." }, 404) };
  const { method, path } = c.req;
  const ownerName = (await c.env.DB.prepare("SELECT display_name FROM users WHERE id = ?").bind(share.owner_id).first<{ display_name: string }>())?.display_name ?? "";

  // Answered here, from the branch only.
  if (method === "GET" && path === "/api/share-info") {
    const root = await N.getNote(owner.DB, share.note_id);
    return { stop: json({ id: share.id, level: share.level, root_id: share.note_id, title: root?.title ?? "", icon: root?.icon ?? null, owner_name: ownerName }) };
  }
  if (method === "GET" && path === "/api/tree") {
    const tree = ((await N.listTree(owner.DB)) as unknown as { id: string; parent_id: string | null }[])
      .filter((n) => ids.has(n.id)).map((n) => (n.id === share.note_id ? { ...n, parent_id: null } : n));
    return { stop: json(share.level === "edit" ? tree : lockAll(tree)) };
  }
  if (method === "GET" && path === "/api/changes") return { stop: json({ now: Date.now(), changes: [] }) };

  const route = ROUTES.find(([m, re]) => m === method && re.test(path));
  if (!route) return { stop: json({ error: "That isn't available on a shared page." }, 403) };
  if (route[2] === "edit" && share.level !== "edit") return { stop: json({ error: `${ownerName || "The owner"} shared this page with you to view, not edit.` }, 403) };
  const named = new RegExp(`^/api/notes/(${NOTE})`).exec(path)?.[1];
  if (named && !ids.has(named)) return { stop: json({ error: "not found" }, 404) };
  if (method === "PATCH") {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (Object.keys(b).some((k) => !EDITABLE.has(k))) return { stop: json({ error: "On a shared page you can change its words and look, not where it lives or who sees it." }, 403) };
    // The shared page's own title can change, but it can't be made a database row or moved.
  }
  if (method === "POST" && path === "/api/notes") {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof b.parent_id !== "string" || !ids.has(b.parent_id)) return { stop: json({ error: "New pages go inside the shared page." }, 403) };
  }
  c.env = { ...owner, ACTOR: user.display_name || user.username };
  // A view-only share shows its pages read-only.
  return share.level === "edit" || method !== "GET" ? {} : {
    after: async (r) => {
      if (!r.ok || !(r.headers.get("Content-Type") ?? "").includes("json")) return r;
      return json(lockAll(await r.json()), r.status);
    },
  };
}

// ---------------------------------------------------------------- the owner's side

/** Who a page is shared with (for the page's Share menu). */
export async function forPage(db: D1Database, ownerId: string, noteId: string) {
  return (await db.prepare(`SELECT s.id, s.person_id, s.level, s.created_at, u.display_name, u.username FROM page_shares s JOIN users u ON u.id = s.person_id
    WHERE s.owner_id = ? AND s.note_id = ? ORDER BY s.created_at`).bind(ownerId, noteId).all<{ id: string; person_id: string; level: Level; created_at: number; display_name: string; username: string }>()).results;
}

export async function setShare(db: D1Database, ownerId: string, noteId: string, personId: string, level: Level) {
  await db.prepare(`INSERT INTO page_shares (id, owner_id, note_id, person_id, level, created_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(note_id, person_id) DO UPDATE SET level = excluded.level WHERE page_shares.owner_id = excluded.owner_id`)
    .bind(crypto.randomUUID(), ownerId, noteId, personId, level, Date.now()).run();
}

export const unshare = (db: D1Database, ownerId: string, noteId: string, personId: string) =>
  db.prepare("DELETE FROM page_shares WHERE owner_id = ? AND note_id = ? AND person_id = ?").bind(ownerId, noteId, personId).run();

/** Pages others have shared with this person (for the sidebar), with the page's current title. */
export async function sharedWith(env: Env, personId: string) {
  const rows = (await env.DB.prepare(`SELECT s.*, u.display_name AS owner_name FROM page_shares s JOIN users u ON u.id = s.owner_id WHERE s.person_id = ? ORDER BY s.created_at DESC`)
    .bind(personId).all<Share & { owner_name: string }>()).results;
  const out = [];
  for (const r of rows) {
    const n = await N.getNote(asPerson(env, r.owner_id).DB, r.note_id);
    if (n) out.push({ id: r.id, note_id: r.note_id, title: n.title, icon: n.icon, level: r.level, owner_name: r.owner_name });
  }
  return out;
}

/** Whether a file of `ownerId`'s is on a page they've shared with `viewerId`. */
export async function fileShared(env: Env, ownerId: string, viewerId: string, needle: string) {
  const shares = (await env.DB.prepare("SELECT note_id FROM page_shares WHERE owner_id = ? AND person_id = ?").bind(ownerId, viewerId).all<{ note_id: string }>()).results;
  if (!shares.length) return false;
  const db = asPerson(env, ownerId).DB;
  for (const s of shares) {
    for (const id of await branch(db, s.note_id)) {
      const n = await N.getNote(db, id);
      if (n && (`${n.html ?? ""}${n.cover ?? ""}`).includes(needle)) return true;
    }
  }
  return false;
}
