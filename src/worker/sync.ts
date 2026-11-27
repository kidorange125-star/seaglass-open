// Helpers for keeping Seaglass in sync with another app through MCP: ISO timestamps, a content hash, trash
// state, page metadata, cursors for paging, the change feed and database creation. The tools themselves live in
// agent.ts (runTool) and mcp.ts.
import * as N from "./notes";
import * as Vault from "./vault";

export const iso = (ms: number | null | undefined) => (ms === null || ms === undefined ? null : new Date(ms).toISOString());

/** Parses an ISO 8601 timestamp (as this server returns them) to epoch ms, or throws `err`. */
export function parseIso(v: unknown, err: () => Error): number {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})$/.test(v)) throw err();
  const t = Date.parse(v);
  if (!Number.isFinite(t)) throw err();
  return t;
}

/**
 * SHA-256 (hex) of what a page shows: title, icon, content HTML without the editor's internal block ids, the
 * property values of a database row, and a database's schema. Metadata, position, favorite and lock state
 * aren't part of it.
 */
export async function contentHash(n: Pick<N.Note, "title" | "icon" | "html" | "props" | "db_schema">): Promise<string> {
  const body = JSON.stringify([n.title ?? "", n.icon ?? "", N.stripBlockIds(n.html ?? ""), n.props || "{}", n.db_schema ?? null]);
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Light = Pick<N.Note, "created_at" | "updated_at" | "deleted_at" | "position" | "locked" | "icon" | "parent_id"> & { meta?: string | null };

/** The sync fields added to every page result. `metadata` only appears when set. */
export function syncFields(n: Light) {
  const meta = N.parseMeta(n.meta);
  return {
    parent_id: n.parent_id, icon: n.icon, position: n.position, locked: !!n.locked,
    created_at: iso(n.created_at), updated_at: iso(n.updated_at), is_trashed: n.deleted_at !== null && n.deleted_at !== undefined, trashed_at: iso(n.deleted_at),
    ...(Object.keys(meta).length ? { metadata: meta } : {}),
  };
}

// ---------------------------------------------------------------- cursors
// Opaque to callers. {o} is an offset (tree order), {u,i} a position in (updated_at, id) order, {s} a feed seq.
type Cursor = { o?: number; u?: number; i?: string; s?: number };
export const encodeCursor = (c: Cursor) => btoa(JSON.stringify(c)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export function decodeCursor(v: unknown, err: () => Error): Cursor {
  if (typeof v !== "string" || !v || v.length > 300) throw err();
  try {
    const t = v.replace(/-/g, "+").replace(/_/g, "/");
    const c = JSON.parse(atob(t + "=".repeat((4 - (t.length % 4)) % 4))) as Cursor;
    if (c && typeof c === "object") return c;
  } catch { /* fall through */ }
  throw err();
}

/**
 * One page of notes matching `where`. With `since`, items changed after it, oldest change first (keyset on
 * updated_at, id: stable while pages change). Otherwise sibling order (position) with an offset cursor.
 */
export async function pageOfNotes(db: D1Database, opts: { where: string; binds: unknown[]; since?: number; cursor?: Cursor; limit: number; cols?: string }) {
  const cols = opts.cols ?? "n.*";
  const binds = [...opts.binds];
  let sql: string;
  if (opts.since !== undefined) {
    let where = `${opts.where} AND n.updated_at > ?`;
    binds.push(opts.since);
    if (opts.cursor?.u !== undefined && typeof opts.cursor.i === "string") {
      where += " AND (n.updated_at > ? OR (n.updated_at = ? AND n.id > ?))";
      binds.push(opts.cursor.u, opts.cursor.u, opts.cursor.i);
    }
    sql = `SELECT ${cols} FROM notes n LEFT JOIN notes p ON p.id = n.parent_id WHERE ${where} ORDER BY n.updated_at, n.id LIMIT ?`;
    binds.push(opts.limit + 1);
  } else {
    const offset = Math.max(0, Math.floor(opts.cursor?.o ?? 0));
    sql = `SELECT ${cols} FROM notes n LEFT JOIN notes p ON p.id = n.parent_id WHERE ${opts.where} ORDER BY n.position, n.created_at, n.id LIMIT ? OFFSET ?`;
    binds.push(opts.limit + 1, offset);
  }
  const rows = (await N.openNotes((await db.prepare(sql).bind(...binds).all<N.Note>()).results as unknown as Record<string, unknown>[])) as unknown as N.Note[];
  const more = rows.length > opts.limit;
  const items = rows.slice(0, opts.limit);
  const last = items[items.length - 1];
  const next = !more || !last ? null
    : opts.since !== undefined ? encodeCursor({ u: last.updated_at, i: last.id })
    : encodeCursor({ o: Math.max(0, Math.floor(opts.cursor?.o ?? 0)) + items.length });
  return { items, next_cursor: next };
}

// ---------------------------------------------------------------- change feed
export async function changeFeed(db: D1Database, opts: { after?: number; since?: number; limit: number }) {
  const pruned = Number((await db.prepare("SELECT value FROM prefs WHERE key = 'changes_pruned_through'").first<{ value: string }>())?.value ?? 0);
  if (opts.after !== undefined && opts.after < pruned) return { expired: true as const };
  const where: string[] = [], binds: unknown[] = [];
  if (opts.after !== undefined) { where.push("c.seq > ?"); binds.push(opts.after); }
  if (opts.since !== undefined) { where.push("c.created_at > ?"); binds.push(opts.since); }
  // With neither a cursor nor a time: the latest `limit` changes (a sync's starting point), oldest first.
  const tail = opts.after === undefined && opts.since === undefined;
  type Row = { seq: number; note_id: string; type: string; source: string; agent: string | null; created_at: number; title: string | null; kind: string | null; parent_id: string | null; deleted_at: number | null };
  let rows = (await db.prepare(
    `SELECT c.seq, c.note_id, c.type, c.source, c.agent, c.created_at, n.title, n.kind, n.parent_id, n.deleted_at
     FROM changes c LEFT JOIN notes n ON n.id = c.note_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY c.seq ${tail ? "DESC" : ""} LIMIT ?`,
  ).bind(...binds, tail ? opts.limit : opts.limit + 1).all<Row>()).results;
  if (tail) rows = rows.reverse();
  const more = !tail && rows.length > opts.limit;
  const items = rows.slice(0, opts.limit);
  const BY: Record<string, string> = { user: "app", agent: "jeff", mcp: "mcp" };
  const titles = new Map<string, string>();
  await Promise.all(items.map(async (r) => { if (r.kind) titles.set(r.note_id, (await Vault.open("notes", r.note_id, "title", r.title)) ?? ""); }));
  return {
    expired: false as const,
    changes: items.map((r) => ({
      seq: r.seq, page_id: r.note_id, type: r.type, at: iso(r.created_at), by: BY[r.source] ?? r.source, ...(r.agent ? { agent: r.agent } : {}),
      // The page as it is now (null once permanently deleted).
      ...(r.kind ? { title: titles.get(r.note_id) || "Untitled", kind: r.kind, parent_id: r.parent_id, is_trashed: r.deleted_at !== null } : { exists: false }),
    })),
    // Always a cursor: pass it next time to get only newer changes (when nothing came back, it's your cursor as given).
    next_cursor: items.length ? String(items[items.length - 1].seq) : opts.after !== undefined ? String(opts.after) : String((await db.prepare("SELECT COALESCE(MAX(seq), 0) AS s FROM changes").first<{ s: number }>())?.s ?? 0),
    has_more: more,
  };
}

// ---------------------------------------------------------------- databases
export const CREATABLE_TYPES = ["text", "number", "select", "multi_select", "status", "date", "checkbox", "url", "email", "phone", "created_time", "last_edited_time"] as const;
const COLORS = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];

/** A full database schema (property ids, options with colors, a default table view) from a simple description. */
export function buildSchema(props: unknown, err: (m: string) => Error) {
  if (props !== undefined && !Array.isArray(props)) throw err('"properties" must be an array of {name, type, options?}');
  const list = (props ?? []) as { name?: unknown; type?: unknown; options?: unknown }[];
  if (list.length > 50) throw err("A database can have at most 50 properties here");
  const properties: Record<string, unknown>[] = [];
  const names = new Set<string>();
  let titleName = "Name";
  for (const [i, p] of list.entries()) {
    const name = typeof p?.name === "string" ? p.name.trim().slice(0, 100) : "";
    const type = String(p?.type ?? "");
    if (!name) throw err(`Property ${i + 1} needs a name`);
    if (names.has(name.toLowerCase())) throw err(`Two properties are named "${name}"`);
    names.add(name.toLowerCase());
    if (type === "title") { titleName = name; continue; }
    if (!(CREATABLE_TYPES as readonly string[]).includes(type)) throw err(`Property "${name}": type must be title or one of ${CREATABLE_TYPES.join(", ")}`);
    const prop: Record<string, unknown> = { id: `p${i + 1}-${crypto.randomUUID().slice(0, 6)}`, name, type };
    if (type === "number") prop.number_format = "number";
    if (type === "select" || type === "multi_select" || type === "status") {
      const given = p.options === undefined ? [] : p.options;
      if (!Array.isArray(given)) throw err(`Property "${name}": options must be an array`);
      const opts = given.map((o, j) => {
        const label = typeof o === "string" ? o : typeof o === "object" && o && typeof (o as { name?: unknown }).name === "string" ? (o as { name: string }).name : "";
        if (!label.trim()) throw err(`Property "${name}": option ${j + 1} needs a name`);
        const color = typeof o === "object" && o && COLORS.includes(String((o as { color?: unknown }).color)) ? String((o as { color: string }).color) : COLORS[j % COLORS.length];
        return { id: crypto.randomUUID().slice(0, 7), name: label.trim().slice(0, 100), color };
      });
      prop.options = type === "status" && !opts.length
        ? [{ id: "todo", name: "Not started", color: "gray" }, { id: "doing", name: "In progress", color: "blue" }, { id: "done", name: "Done", color: "green" }]
        : opts;
    }
    properties.push(prop);
  }
  return {
    properties: [{ id: "title", name: titleName, type: "title" }, ...properties],
    views: [{ id: "v-table", name: "Table", type: "table", filters: [], filter_mode: "and", sorts: [], hidden: [] }],
  };
}
