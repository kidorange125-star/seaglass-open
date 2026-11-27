import { cleanHtml, extractMentions, toText } from "./sanitize";
import * as Vault from "./vault";
import { HIDDEN_SQL, HiddenError, hiddenIds, type HiddenSet } from "./hidden";

export { HiddenError } from "./hidden";

export type Source = "user" | "agent" | "mcp";
/** `agent` says which agent made the change (identity.ts), e.g. "Waffle (Sonnet 5.5)" or "Claude (MCP)"; none for the user's own edits. */
export interface Ctx { source: Source; runId: string; agent?: string | null }

export interface Note {
  id: string;
  parent_id: string | null;
  kind: "page" | "database";
  title: string;
  html: string;
  text: string;
  icon: string | null;
  cover: string | null;
  favorite: number;
  position: number;
  full_width: number;
  small_text: number;
  font: string;
  locked: number;
  /** "Hide from AI": this page and everything under it is invisible to Waffle, MCP and AI features (hidden.ts). */
  ai_hidden: number;
  is_template: number;
  props: string;
  db_schema: string | null;
  share_slug: string | null;
  revision: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  /** JSON key/value metadata for outside tools (e.g. a sync's external ids). Not content, not in history. */
  meta: string;
}

// Everything a user/agent can change on a note. Snapshots of these power history and undo.
export const SNAP_FIELDS = [
  "parent_id", "kind", "title", "html", "icon", "cover", "favorite", "position", "full_width",
  "small_text", "font", "locked", "is_template", "props", "db_schema", "deleted_at",
] as const;
type SnapKey = (typeof SNAP_FIELDS)[number];
export type Snap = Pick<Note, SnapKey>;

export class ConflictError extends Error {
  constructor(public current: Note) { super("revision conflict"); }
}
export class LockedError extends Error { constructor() { super("page is locked"); } }
export class BadRequest extends Error {}

const now = () => Date.now();
const snap = (n: Note): Snap => Object.fromEntries(SNAP_FIELDS.map((k) => [k, n[k]])) as Snap;
const FONTS = new Set(["sans", "serif", "mono"]);
const KINDS = new Set(["page", "database"]);
const MAX_JSON = 800_000;
const COALESCE_MS = 5 * 60_000;

function jsonField(v: unknown, fallback: string | null): string | null {
  if (v === null) return null;
  if (v === undefined) return fallback;
  const s = typeof v === "string" ? v : JSON.stringify(v);
  if (s.length > MAX_JSON) throw new BadRequest("json field too large");
  try { JSON.parse(s); } catch { throw new BadRequest("invalid json"); }
  return s;
}
const flag = (v: unknown) => (v ? 1 : 0);

/** Waffle and MCP can't write to (or under) a page that's hidden from AI. The user's own edits are never blocked. */
async function guardAi(db: D1Database, ctx: Pick<Ctx, "source">, ...ids: (string | null | undefined)[]) {
  if (ctx.source === "user" || !ids.some(Boolean)) return;
  const hidden = await hiddenIds(db);
  if (ids.some((id) => id && hidden.has(id))) throw new HiddenError();
}
const clip = (s: unknown, n: number) => String(s ?? "").slice(0, n);

// ---------------------------------------------------------------- encryption (see vault.ts)
// Everything private in a note row is sealed on its way into D1 and opened on its way out. What stays readable is
// structure the database itself needs: ids, parent, kind, order, flags, timestamps, revision, share slug, and two
// derived flags (`system`: which built-in list this is; `dated`: whether a row has a date, for reminders).
export const NOTE_SEALED = ["title", "html", "text", "props", "db_schema", "icon", "cover", "meta"] as const;
export const openNote = <T extends Record<string, unknown>>(row: T): Promise<T> => Vault.openRow("notes", row, NOTE_SEALED);
export const openNotes = <T extends Record<string, unknown>>(rows: T[]): Promise<T[]> => Promise.all(rows.map((r) => openNote(r)));
const openMaybe = async <T extends Record<string, unknown>>(row: T | null | undefined): Promise<T | null> => (row ? openNote(row) : null);
const sealCol = (id: string, col: string, v: string | null | undefined) => Vault.seal("notes", id, col, v);
export const systemOf = (kind: string, schema: string | null): string | null => (kind === "database" ? /"system":"(tasks|grades|events)"/.exec(schema ?? "")?.[1] ?? null : null);
export const datedOf = (props: string | null | undefined): number => (props && props.includes('"start"') ? 1 : 0);
/** The sealed values of a full note row, in the order of NOTE_BINDS. */
async function sealedNote(id: string, v: { title: string; html: string; text: string; icon: string | null; cover: string | null; props: string; db_schema: string | null; meta?: string }) {
  const [title, html, text, icon, cover, props, db_schema, meta] = await Promise.all([
    sealCol(id, "title", v.title), sealCol(id, "html", v.html), sealCol(id, "text", v.text), sealCol(id, "icon", v.icon), sealCol(id, "cover", v.cover),
    sealCol(id, "props", v.props), sealCol(id, "db_schema", v.db_schema), sealCol(id, "meta", v.meta ?? "{}"),
  ]);
  return { title, html, text, icon, cover, props, db_schema, meta };
}

// ---------------------------------------------------------------- reads

// Columns the sidebar needs. `system` marks built-in databases (today: the "tasks" to-do list) so the app can
// find them without loading schemas. Use lightCols("n") inside joins.
const LIGHT_COLS = "id,parent_id,kind,title,icon,favorite,position,is_template,locked,ai_hidden,updated_at,created_at,meta,system";
const lightCols = (alias = "") => (alias ? LIGHT_COLS.split(",").map((c) => `${alias}.${c}`).join(",") : LIGHT_COLS);
const LIGHT = lightCols();

export async function listTree(db: D1Database) {
  return openNotes((await db.prepare(`SELECT ${LIGHT} FROM notes WHERE owner_id = {owner} AND (deleted_at IS NULL) ORDER BY position, created_at LIMIT 5000`).all()).results);
}

export async function getNote(db: D1Database, id: string, includeDeleted = false) {
  const sql = `SELECT * FROM notes WHERE owner_id = {owner} AND (id = ?${includeDeleted ? "" : " AND deleted_at IS NULL"})`;
  return (await openMaybe((await db.prepare(sql).bind(id).first<Note>()) as unknown as Record<string, unknown> | null)) as Note | null;
}

// Every word must appear in the title or text (so "cell energy" finds "Cells make energy"). The snippet is
// cut around the first match so search can show why a page matched. The text is encrypted, so this opens the
// titles first and only opens a page's text when the title alone didn't match every word.
export async function searchNotes(db: D1Database, q: string, limit = 30) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!words.length) return [];
  const rows = (await db.prepare(`SELECT ${LIGHT}, text FROM notes WHERE owner_id = {owner} AND (deleted_at IS NULL) ORDER BY updated_at DESC LIMIT 5000`).all<Record<string, unknown> & { id: string; title: string; text: string }>()).results;
  const hits: (Record<string, unknown> & { snippet: string; title_hit: number })[] = [];
  await Promise.all(rows.map(async (r) => {
    const title = ((await Vault.open("notes", r.id, "title", r.title)) ?? "").toLowerCase();
    let text = "", lower = "";
    if (!words.every((w) => title.includes(w))) {
      text = (await Vault.open("notes", r.id, "text", r.text)) ?? ""; lower = text.toLowerCase();
      if (!words.every((w) => title.includes(w) || lower.includes(w))) return;
    }
    if (!text && r.text) { text = (await Vault.open("notes", r.id, "text", r.text)) ?? ""; lower = text.toLowerCase(); }
    const pos = lower.indexOf(words[0]) + 1, start = Math.max(0, pos - 41); // same cut as the old SQL: 40 characters before the match, 170 long
    const { text: _drop, ...rest } = r;
    hits.push({ ...(await openNote(rest)), snippet: text.slice(start, start + 170), title_hit: title.includes(words[0]) ? 1 : 0 });
  }));
  hits.sort((x, y) => y.title_hit - x.title_hit || (y.updated_at as number) - (x.updated_at as number));
  return hits.slice(0, limit);
}

export async function recentNotes(db: D1Database, limit = 12) {
  return openNotes((await db.prepare(`SELECT ${LIGHT} FROM notes WHERE owner_id = {owner} AND (deleted_at IS NULL AND kind='page') ORDER BY updated_at DESC LIMIT ?`).bind(limit).all()).results);
}

export async function listChildren(db: D1Database, parentId: string) {
  return openNotes((await db.prepare("SELECT * FROM notes WHERE owner_id = {owner} AND (parent_id = ? AND deleted_at IS NULL) ORDER BY position, created_at").bind(parentId).all<Note>()).results as unknown as Record<string, unknown>[]) as unknown as Promise<Note[]>;
}

export async function backlinks(db: D1Database, id: string) {
  return openNotes((
    await db.prepare(
      `SELECT ${lightCols("n")} FROM links l JOIN notes n ON n.owner_id = {owner} AND n.id = l.from_id
       WHERE l.owner_id = {owner} AND (l.to_id = ? AND n.deleted_at IS NULL) ORDER BY n.updated_at DESC`,
    ).bind(id).all()
  ).results);
}

export async function listTrash(db: D1Database) {
  // Only roots of a deleted subtree: children trashed at the same moment stay hidden under them.
  return openNotes((
    await db.prepare(
      `SELECT ${lightCols("n")}, n.deleted_at FROM notes n
       LEFT JOIN notes p ON p.owner_id = {owner} AND p.id = n.parent_id
       WHERE n.owner_id = {owner} AND (n.deleted_at IS NOT NULL AND (p.id IS NULL OR p.deleted_at IS NULL OR p.deleted_at != n.deleted_at))
       ORDER BY n.deleted_at DESC LIMIT 200`,
    ).all()
  ).results);
}

async function subtreeIds(db: D1Database, id: string): Promise<string[]> {
  const r = await db.prepare(
    `WITH RECURSIVE d(id) AS (SELECT ?1 UNION ALL SELECT n.id FROM notes n JOIN d ON n.parent_id = d.id WHERE n.owner_id = {owner})
     SELECT id FROM d`,
  ).bind(id).all<{ id: string }>();
  return r.results.map((x) => x.id);
}

// ---------------------------------------------------------------- change feed
// One row per change to a page, from every source, for outside tools (MCP list_recent_changes). Written in
// the same batch as the change itself. Consecutive edits to one page within COALESCE_MS replace the previous
// "edited" row (delete + insert, so it moves to the end of the feed) instead of piling up while you type.

export type ChangeType = "created" | "edited" | "moved" | "trashed" | "restored" | "deleted";
const CONTENT_KEYS = ["title", "html", "icon", "cover", "props", "db_schema", "kind", "locked", "is_template", "favorite", "full_width", "small_text", "font"] as const;

export function changeType(before: Snap | null, after: Snap | null): ChangeType {
  if (!before) return "created";
  if (!after) return "deleted";
  if (!before.deleted_at && after.deleted_at) return "trashed";
  if (before.deleted_at && !after.deleted_at) return "restored";
  if (before.parent_id !== after.parent_id) return "moved";
  if (before.position !== after.position && !CONTENT_KEYS.some((k) => before[k] !== after[k])) return "moved";
  return "edited";
}

function changeStmts(db: D1Database, noteId: string, type: ChangeType, source: string, t: number, agent: string | null = null) {
  const out: D1PreparedStatement[] = [];
  if (type === "edited") {
    out.push(db.prepare(
      `DELETE FROM changes WHERE owner_id = {owner} AND (seq = (SELECT MAX(seq) FROM changes WHERE owner_id = {owner} AND (note_id = ?1)) AND type = 'edited' AND created_at > ?2)`,
    ).bind(noteId, t - COALESCE_MS));
  }
  out.push(db.prepare("INSERT INTO changes (owner_id, note_id, type, source, agent, created_at) VALUES ({owner}, ?, ?, ?, ?, ?)").bind(noteId, type, source, agent, t));
  return out;
}

// ---------------------------------------------------------------- action log helpers

async function logStmts(db: D1Database, ctx: Ctx, tool: string, noteId: string, before: Snap | null, after: Snap | null, t: number) {
  // Coalesce rapid autosaves by me into one history entry so history stays readable.
  if (ctx.source === "user" && tool === "update") {
    const last = await db.prepare(
      "SELECT id, source, tool, created_at, undone_at FROM actions WHERE owner_id = {owner} AND (note_id = ?) ORDER BY id DESC LIMIT 1",
    ).bind(noteId).first<{ id: number; source: string; tool: string; created_at: number; undone_at: number | null }>();
    if (last && last.source === "user" && last.tool === "update" && !last.undone_at && t - last.created_at < COALESCE_MS) {
      return [db.prepare("UPDATE actions SET after_json = ?, created_at = ? WHERE owner_id = {owner} AND (id = ?)").bind(await Vault.seal("actions", noteId, "after_json", JSON.stringify(after)), t, last.id), ...changeStmts(db, noteId, changeType(before, after), ctx.source, t, ctx.agent ?? null)];
    }
  }
  return [
    db.prepare(
      "INSERT INTO actions (owner_id, run_id,source,agent,tool,note_id,before_json,after_json,created_at) VALUES ({owner}, ?,?,?,?,?,?,?,?)",
    ).bind(ctx.runId, ctx.source, ctx.agent ?? null, tool, noteId, before ? await Vault.seal("actions", noteId, "before_json", JSON.stringify(before)) : null, after ? await Vault.seal("actions", noteId, "after_json", JSON.stringify(after)) : null, t),
    ...changeStmts(db, noteId, changeType(before, after), ctx.source, t, ctx.agent ?? null),
  ];
}

function linkStmts(db: D1Database, id: string, html: string) {
  return [
    db.prepare("DELETE FROM links WHERE owner_id = {owner} AND (from_id = ?)").bind(id),
    ...extractMentions(html).filter((to) => to !== id).map((to) => db.prepare("INSERT OR IGNORE INTO links (owner_id, from_id,to_id) VALUES ({owner}, ?,?)").bind(id, to)),
  ];
}

// ---------------------------------------------------------------- writes

export interface CreateInput {
  title?: string; html?: string; parent_id?: string | null; kind?: string; icon?: string | null;
  cover?: string | null; props?: unknown; db_schema?: unknown; is_template?: boolean; template_id?: string;
  position?: number; id?: string;
}

export async function createNote(db: D1Database, input: CreateInput, ctx: Ctx) {
  await guardAi(db, ctx, input.parent_id, input.template_id);
  const tpl = input.template_id ? await getNote(db, input.template_id) : null;
  const kind = KINDS.has(input.kind ?? "") ? (input.kind as "page" | "database") : tpl?.kind ?? "page";
  const parent = input.parent_id ? await getNote(db, input.parent_id) : null;
  if (input.parent_id && !parent) throw new BadRequest("parent not found");
  if (parent?.locked) throw new LockedError();

  const id = input.id ?? crypto.randomUUID();
  const t = now();
  const html = cleanHtml(input.html ?? tpl?.html ?? "");
  let position = input.position;
  if (position === undefined) {
    const m = await db.prepare("SELECT COALESCE(MAX(position),0) AS m FROM notes WHERE owner_id = {owner} AND (parent_id IS ?)").bind(input.parent_id ?? null).first<{ m: number }>();
    position = (m?.m ?? 0) + 1;
  }
  const row = {
    parent_id: input.parent_id ?? null, kind, title: clip(input.title ?? tpl?.title, 300),
    html, icon: input.icon ?? tpl?.icon ?? null, cover: input.cover ?? tpl?.cover ?? null, favorite: 0, position,
    full_width: tpl?.full_width ?? 0, small_text: tpl?.small_text ?? 0, font: tpl?.font ?? "sans", locked: 0,
    is_template: flag(input.is_template), props: jsonField(input.props, tpl?.props ?? "{}") ?? "{}",
    db_schema: jsonField(input.db_schema, tpl?.db_schema ?? null), deleted_at: null,
  } satisfies Snap;

  const log = await logStmts(db, ctx, "create", id, null, row, t);
  const sv = await sealedNote(id, { ...row, text: toText(html) });
  await db.batch([
    db.prepare(
      `INSERT INTO notes (owner_id, id,parent_id,kind,title,html,text,icon,cover,favorite,position,full_width,small_text,font,locked,is_template,props,db_schema,meta,system,dated,revision,created_at,updated_at)
       VALUES ({owner}, ?,?,?,?,?,?,?,?,0,?,?,?,?,0,?,?,?,?,?,?,1,?,?)`,
    ).bind(id, row.parent_id, row.kind, sv.title, sv.html, sv.text, sv.icon, sv.cover, row.position, row.full_width, row.small_text, row.font, row.is_template, sv.props, sv.db_schema, sv.meta, systemOf(row.kind, row.db_schema), datedOf(row.props), t, t),
    ...linkStmts(db, id, html),
    ...log,
  ]);
  return (await getNote(db, id))!;
}

export type Patch = Partial<Record<SnapKey, unknown>> & { revision?: number };

// Optimistic concurrency: a write carrying a stale revision is rejected, so me,
// the agent and MCP can never silently overwrite one another.
export async function patchNote(db: D1Database, id: string, patch: Patch, ctx: Ctx, opts: { includeDeleted?: boolean } = {}) {
  const before = await getNote(db, id, opts.includeDeleted);
  if (!before) return null;
  await guardAi(db, ctx, id, typeof patch.parent_id === "string" ? patch.parent_id : null);
  if (patch.revision !== undefined && before.revision !== patch.revision) throw new ConflictError(before);

  const touchesContent = ["title", "html", "parent_id", "kind", "props", "db_schema", "deleted_at"].some((k) => k in patch);
  if (before.locked && touchesContent && patch.locked !== 0 && patch.locked !== false) throw new LockedError();

  const next: Snap = { ...snap(before) };
  if ("title" in patch) next.title = clip(patch.title, 300);
  if ("html" in patch) next.html = cleanHtml(String(patch.html ?? ""));
  if ("icon" in patch) next.icon = patch.icon ? clip(patch.icon, 16) : null;
  if ("cover" in patch) next.cover = patch.cover ? clip(patch.cover, 600) : null;
  if ("parent_id" in patch) {
    const pid = (patch.parent_id as string | null) || null;
    if (pid) {
      if (pid === id || (await subtreeIds(db, id)).includes(pid)) throw new BadRequest("cannot move a page into itself");
      const parent = await getNote(db, pid);
      if (!parent) throw new BadRequest("parent not found");
      if (parent.locked) throw new LockedError();
    }
    next.parent_id = pid;
  }
  if ("kind" in patch && KINDS.has(String(patch.kind))) next.kind = patch.kind as "page" | "database";
  if ("favorite" in patch) next.favorite = flag(patch.favorite);
  if ("position" in patch && Number.isFinite(patch.position)) next.position = Number(patch.position);
  if ("full_width" in patch) next.full_width = flag(patch.full_width);
  if ("small_text" in patch) next.small_text = flag(patch.small_text);
  if ("font" in patch && FONTS.has(String(patch.font))) next.font = String(patch.font);
  if ("locked" in patch) next.locked = flag(patch.locked);
  if ("is_template" in patch) next.is_template = flag(patch.is_template);
  if ("props" in patch) next.props = jsonField(patch.props, before.props) ?? "{}";
  if ("db_schema" in patch) next.db_schema = jsonField(patch.db_schema, before.db_schema);
  if ("deleted_at" in patch) next.deleted_at = patch.deleted_at ? Number(patch.deleted_at) : null;

  const changed = SNAP_FIELDS.some((k) => next[k] !== before[k]);
  if (!changed) return before;

  const t = now();
  const log = await logStmts(db, ctx, "update", id, snap(before), next, t);
  const sv = await sealedNote(id, { ...next, text: next.html === before.html ? before.text : toText(next.html), meta: before.meta });
  const [upd] = await db.batch([
    db.prepare(
      `UPDATE notes SET parent_id=?,kind=?,title=?,html=?,text=?,icon=?,cover=?,favorite=?,position=?,full_width=?,small_text=?,font=?,locked=?,is_template=?,props=?,db_schema=?,meta=?,system=?,dated=?,deleted_at=?,
              revision=revision+1, updated_at=? WHERE owner_id = {owner} AND (id=? AND revision=?)`,
    ).bind(next.parent_id, next.kind, sv.title, sv.html, sv.text, sv.icon, sv.cover, next.favorite, next.position, next.full_width, next.small_text, next.font, next.locked, next.is_template, sv.props, sv.db_schema, sv.meta, systemOf(next.kind, next.db_schema), datedOf(next.props), next.deleted_at, t, id, before.revision),
    ...(next.html !== before.html ? linkStmts(db, id, next.html) : []),
    ...log,
  ]);
  if (!upd.meta.changes) throw new ConflictError((await getNote(db, id, true)) ?? before);
  return (await getNote(db, id, true))!;
}

export async function trashNote(db: D1Database, id: string, ctx: Ctx) {
  const root = await getNote(db, id);
  if (!root) return false;
  await guardAi(db, ctx, id);
  if (root.locked) throw new LockedError();
  const t = now();
  const ids = await subtreeIds(db, id);
  const rows = (await openNotes((await db.prepare(`SELECT * FROM notes WHERE owner_id = {owner} AND (id IN (${ids.map(() => "?").join(",")}) AND deleted_at IS NULL)`).bind(...ids).all<Note>()).results as unknown as Record<string, unknown>[])) as unknown as Note[];
  const stmts: D1PreparedStatement[] = [];
  for (const n of rows) {
    const after = { ...snap(n), deleted_at: t, favorite: 0 };
    stmts.push(db.prepare("UPDATE notes SET deleted_at=?, revision=revision+1, updated_at=?, share_slug=NULL, favorite=0 WHERE owner_id = {owner} AND (id=?)").bind(t, t, n.id));
    stmts.push(...(await logStmts(db, ctx, "delete", n.id, snap(n), after, t)));
  }
  await db.batch(stmts);
  return true;
}

export async function restoreNote(db: D1Database, id: string, ctx: Ctx) {
  const root = await getNote(db, id, true);
  if (!root || !root.deleted_at) return null;
  await guardAi(db, ctx, id);
  const stamp = root.deleted_at;
  const ids = await subtreeIds(db, id);
  const rows = (await openNotes((await db.prepare(`SELECT * FROM notes WHERE owner_id = {owner} AND (id IN (${ids.map(() => "?").join(",")}) AND deleted_at = ?)`).bind(...ids, stamp).all<Note>()).results as unknown as Record<string, unknown>[])) as unknown as Note[];
  const t = now();
  // If the old parent is gone or still in the trash, bring the page back at the top level.
  let parent_id = root.parent_id;
  if (parent_id && !(await getNote(db, parent_id))) parent_id = null;
  const stmts: D1PreparedStatement[] = [];
  for (const n of rows) {
    const after = { ...snap(n), deleted_at: null, parent_id: n.id === id ? parent_id : n.parent_id };
    stmts.push(db.prepare("UPDATE notes SET deleted_at=NULL, parent_id=?, revision=revision+1, updated_at=? WHERE owner_id = {owner} AND (id=?)").bind(after.parent_id, t, n.id));
    stmts.push(...(await logStmts(db, ctx, "restore", n.id, snap(n), after, t)));
  }
  await db.batch(stmts);
  return getNote(db, id);
}

export async function purgeNote(db: D1Database, id: string) {
  const root = await getNote(db, id, true);
  if (!root) return false;
  const ids = await subtreeIds(db, id);
  const ph = ids.map(() => "?").join(",");
  await db.batch([
    db.prepare(`DELETE FROM notes WHERE owner_id = {owner} AND (id IN (${ph}))`).bind(...ids),
    db.prepare(`DELETE FROM links WHERE owner_id = {owner} AND (from_id IN (${ph}) OR to_id IN (${ph}))`).bind(...ids, ...ids),
    db.prepare(`DELETE FROM comments WHERE owner_id = {owner} AND (note_id IN (${ph}))`).bind(...ids),
    db.prepare(`DELETE FROM actions WHERE owner_id = {owner} AND (note_id IN (${ph}))`).bind(...ids),
    ...ids.flatMap((x) => changeStmts(db, x, "deleted", "user", now())),
  ]);
  return true;
}

export async function emptyTrash(db: D1Database) {
  const roots = (await listTrash(db)) as { id: string }[];
  for (const r of roots) await purgeNote(db, r.id);
  return roots.length;
}

export async function duplicateNote(db: D1Database, id: string, ctx: Ctx) {
  const root = await getNote(db, id);
  if (!root) return null;
  await guardAi(db, ctx, id);
  const ids = await subtreeIds(db, id);
  const rows = (await openNotes((await db.prepare(`SELECT * FROM notes WHERE owner_id = {owner} AND (id IN (${ids.map(() => "?").join(",")}) AND deleted_at IS NULL)`).bind(...ids).all<Note>()).results as unknown as Record<string, unknown>[])) as unknown as Note[];
  const map = new Map(rows.map((r) => [r.id, crypto.randomUUID()]));
  const byDepth = [...rows].sort((a, b) => Number(a.id !== id) - Number(b.id !== id));
  for (const n of byDepth) {
    const isRoot = n.id === id;
    await createNote(db, {
      id: map.get(n.id), parent_id: isRoot ? n.parent_id : map.get(n.parent_id!) ?? null, kind: n.kind,
      title: isRoot ? `${n.title || "Untitled"} (copy)` : n.title, html: n.html, icon: n.icon, cover: n.cover,
      props: n.props, db_schema: n.db_schema, is_template: !!n.is_template, position: n.position + (isRoot ? 0.5 : 0),
    }, ctx);
  }
  // A copy of a hidden page stays hidden (its sub-pages follow it).
  if (root.ai_hidden) await setAiHidden(db, map.get(id)!, true);
  return getNote(db, map.get(id)!);
}

/** hiddenIds plus the titles each visible page mentions (see HiddenSet). Use it for anything shown to an AI. */
export async function hiddenForAi(db: D1Database): Promise<HiddenSet> {
  const ids: HiddenSet = await hiddenIds(db);
  if (!ids.size) return ids;
  const rows = (await db.prepare(`SELECT l.from_id, n.id, n.title FROM links l JOIN notes n ON n.owner_id = {owner} AND n.id = l.to_id WHERE l.owner_id = {owner} AND (l.to_id IN (${HIDDEN_SQL}))`).all<{ from_id: string; id: string; title: string | null }>()).results;
  const titles = new Map<string, string[]>();
  for (const r of rows) {
    const t = ((await Vault.open("notes", r.id, "title", r.title)) ?? "").trim();
    if (t.length < 2 || ids.has(r.from_id)) continue;
    titles.set(r.from_id, [...(titles.get(r.from_id) ?? []), t]);
  }
  ids.titles = titles;
  return ids;
}

/** Turns "Hide from AI" on or off. Only the app's own routes call this: Waffle and MCP can never change it.
 *  Bumps updated_at (so other devices pick it up) but not revision (so open editors don't see a conflict). */
export async function setAiHidden(db: D1Database, id: string, hidden: boolean) {
  const r = await db.prepare("UPDATE notes SET ai_hidden = ?, updated_at = ? WHERE owner_id = {owner} AND (id = ?)").bind(flag(hidden), now(), id).run();
  if (!r.meta.changes) return null;
  // Drop its search vectors (and its sub-pages'), so semantic search can't surface it.
  if (hidden) await db.prepare(`DELETE FROM embeddings WHERE owner_id = {owner} AND (note_id IN (WITH RECURSIVE d(id) AS (SELECT ?1 UNION ALL SELECT n.id FROM notes n JOIN d ON n.parent_id = d.id WHERE n.owner_id = {owner}) SELECT id FROM d))`).bind(id).run();
  return getNote(db, id, true);
}

// ---------------------------------------------------------------- history

export async function listHistory(db: D1Database, id: string) {
  return (
    await db.prepare(
      `SELECT id, run_id, source, agent, tool, created_at, undone_at FROM actions WHERE owner_id = {owner} AND (note_id = ?) ORDER BY id DESC LIMIT 100`,
    ).bind(id).all()
  ).results;
}

export async function getVersion(db: D1Database, id: string, actionId: number) {
  const row = await db.prepare("SELECT after_json, created_at FROM actions WHERE owner_id = {owner} AND (id = ? AND note_id = ?)").bind(actionId, id).first<{ after_json: string | null; created_at: number }>();
  return row?.after_json ? { snapshot: JSON.parse((await Vault.open("actions", id, "after_json", row.after_json))!) as Snap, created_at: row.created_at } : null;
}

export async function restoreVersion(db: D1Database, id: string, actionId: number, ctx: Ctx) {
  const v = await getVersion(db, id, actionId);
  if (!v) return null;
  const { deleted_at: _d, ...rest } = v.snapshot;
  return patchNote(db, id, { ...rest, locked: 0 }, ctx);
}

// ---------------------------------------------------------------- sharing, comments

export async function setShare(db: D1Database, id: string, enabled: boolean) {
  const n = await getNote(db, id);
  if (!n) return null;
  const slug = enabled ? n.share_slug ?? crypto.randomUUID().replace(/-/g, "").slice(0, 14) : null;
  await db.prepare("UPDATE notes SET share_slug = ? WHERE owner_id = {owner} AND (id = ?)").bind(slug, id).run();
  return { share_slug: slug };
}

/** Whose shared page this is (system database): the public page is then read through that person's scope. */
export const sharedOwner = async (sys: D1Database, slug: string) =>
  (await sys.prepare("SELECT owner_id FROM notes WHERE share_slug = ? AND deleted_at IS NULL /*any-owner*/").bind(slug).first<{ owner_id: string }>())?.owner_id ?? null;
export const getShared = async (db: D1Database, slug: string) =>
  (await openMaybe((await db.prepare("SELECT * FROM notes WHERE owner_id = {owner} AND (share_slug = ? AND deleted_at IS NULL)").bind(slug).first<Note>()) as unknown as Record<string, unknown> | null)) as Note | null;

// Comments, on a page or on specific words (#22: anchor = {quote, nth}, client comments.ts), and suggested edits from the
// assistant (kind "suggestion": the words to change are the anchor's quote, replace_with the new text). A suggestion changes
// nothing until it's accepted, and accepting is an ordinary edit in the editor (so Ctrl+Z undoes it).
export interface Anchor { quote: string; nth: number }
type CommentRow = { id: string; note_id: string; body: string; resolved: number; created_at: number; kind: string; author: string; anchor: string | null; replace_with: string | null; outcome: string | null };
export const cleanAnchor = (v: unknown): Anchor | null => {
  if (!v || typeof v !== "object") return null;
  const a = v as Record<string, unknown>;
  const quote = typeof a.quote === "string" ? a.quote.trim() : "";
  const nth = Math.floor(Number(a.nth));
  return quote && quote.length <= 500 && !/[\n\r]/.test(quote) && Number.isFinite(nth) && nth >= 0 && nth < 10_000 ? { quote, nth } : null;
};
async function openComment(r: CommentRow) {
  let anchor: Anchor | null = null;
  try { anchor = cleanAnchor(JSON.parse((await Vault.open("comments", r.id, "anchor", r.anchor)) ?? "null")); } catch { /* none */ }
  return { ...r, body: (await Vault.open("comments", r.id, "body", r.body)) ?? "", anchor, replace_with: await Vault.open("comments", r.id, "replace_with", r.replace_with) };
}
export async function listComments(db: D1Database, id: string) {
  const rows = (await db.prepare("SELECT * FROM comments WHERE owner_id = {owner} AND (note_id = ?) ORDER BY created_at").bind(id).all<CommentRow>()).results;
  return Promise.all(rows.map(openComment));
}
export async function addComment(db: D1Database, id: string, body: string, o: { anchor?: unknown; kind?: "comment" | "suggestion"; author?: Source; replace?: string } = {}) {
  await guardAi(db, { source: o.author ?? "user" }, id);
  const kind = o.kind ?? "comment", anchor = cleanAnchor(o.anchor);
  const c = { id: crypto.randomUUID(), note_id: id, body: clip(body, 4000), resolved: 0, created_at: now(), kind, author: o.author ?? "user", anchor, replace_with: kind === "suggestion" ? clip(o.replace ?? "", 4000) : null, outcome: null };
  if (kind === "comment" && !c.body.trim()) throw new BadRequest("empty comment");
  if (kind === "suggestion" && !anchor) throw new BadRequest("a suggestion needs the words it changes");
  if (o.anchor !== undefined && o.anchor !== null && !anchor) throw new BadRequest("bad anchor");
  await db.prepare("INSERT INTO comments (owner_id, id,note_id,body,resolved,created_at,kind,author,anchor,replace_with) VALUES ({owner}, ?,?,?,0,?,?,?,?,?)").bind(
    c.id, c.note_id, await Vault.seal("comments", c.id, "body", c.body), c.created_at, kind, c.author,
    anchor ? await Vault.seal("comments", c.id, "anchor", JSON.stringify(anchor)) : null,
    c.replace_with === null ? null : await Vault.seal("comments", c.id, "replace_with", c.replace_with),
  ).run();
  return c;
}
export const resolveComment = (db: D1Database, cid: string, resolved: boolean, outcome?: unknown) =>
  db.prepare("UPDATE comments SET resolved = ?, outcome = ? WHERE owner_id = {owner} AND (id = ?)").bind(flag(resolved), resolved && (outcome === "accepted" || outcome === "rejected") ? outcome : null, cid).run();
export const deleteComment = (db: D1Database, cid: string) => db.prepare("DELETE FROM comments WHERE owner_id = {owner} AND (id = ?)").bind(cid).run();

// ---------------------------------------------------------------- backup

export async function exportAll(db: D1Database) {
  // The export file is plaintext by design (it's your own backup, downloaded over your signed-in session).
  const notes = await openNotes((await db.prepare("SELECT * FROM notes WHERE owner_id = {owner}").all()).results);
  const comments = await Promise.all((await db.prepare("SELECT * FROM comments WHERE owner_id = {owner}").all<CommentRow>()).results.map(openComment));
  return { app: "seaglass", version: 1, exported_at: now(), notes, comments };
}

/** Which of these ids someone else in this Seaglass already uses, each paired with a new id to use instead. */
async function foreignIds(db: D1Database, table: "notes" | "comments", ids: string[]) {
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    if (!chunk.length) continue;
    const sql = table === "notes"
      ? `SELECT id FROM notes WHERE owner_id != {owner} AND id IN (${chunk.map(() => "?").join(",")})`
      : `SELECT id FROM comments WHERE owner_id != {owner} AND id IN (${chunk.map(() => "?").join(",")})`;
    for (const r of (await db.prepare(sql).bind(...chunk).all<{ id: string }>()).results) out.set(r.id, crypto.randomUUID());
  }
  return out;
}

export async function importAll(db: D1Database, data: { notes?: Note[]; comments?: Record<string, unknown>[] }) {
  // An import replaces pages by id, so ids someone else already has (a family member's export brought in here, or a file
  // made to collide) get new ids: an import can never overwrite another person's page or comment.
  const renamed = await foreignIds(db, "notes", (data.notes ?? []).map((n) => String(n.id)));
  const newId = (id: string | null | undefined) => (id ? renamed.get(id) ?? id : id ?? null);
  const notes = (data.notes ?? []).map((n) => (renamed.size ? { ...n, id: newId(n.id)!, parent_id: newId(n.parent_id) } : n));
  const renamedC = await foreignIds(db, "comments", (data.comments ?? []).map((c) => String(c.id)));
  data = { ...data, comments: (data.comments ?? []).map((c) => ({ ...c, id: renamedC.get(String(c.id)) ?? c.id, note_id: newId(String(c.note_id)) })) };
  for (let i = 0; i < notes.length; i += 40) {
    const chunk = notes.slice(i, i + 40);
    const ids = chunk.map((n) => n.id);
    const existing = new Set((await db.prepare(`SELECT id FROM notes WHERE owner_id = {owner} AND (id IN (${ids.map(() => "?").join(",")}))`).bind(...ids).all<{ id: string }>()).results.map((r) => r.id));
    const t = now();
    const sealed = await Promise.all(chunk.map((n) => { const html = cleanHtml(n.html ?? ""); return sealedNote(n.id, { title: clip(n.title, 300), html, text: toText(html), icon: n.icon ?? null, cover: n.cover ?? null, props: n.props || "{}", db_schema: n.db_schema ?? null, meta: cleanMeta(n.meta) }); }));
    await db.batch(chunk.flatMap((n, i) => {
      const html = cleanHtml(n.html ?? "");
      const sv = sealed[i];
      return [
        db.prepare(
          `INSERT OR REPLACE INTO notes (owner_id, id,parent_id,kind,title,html,text,icon,cover,favorite,position,full_width,small_text,font,locked,is_template,props,db_schema,meta,system,dated,share_slug,revision,created_at,updated_at,deleted_at)
           VALUES ({owner}, ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?)`,
        ).bind(n.id, n.parent_id ?? null, n.kind ?? "page", sv.title, sv.html, sv.text, sv.icon, sv.cover, flag(n.favorite), Number(n.position) || 0, flag(n.full_width), flag(n.small_text), FONTS.has(n.font) ? n.font : "sans", flag(n.locked), flag(n.is_template), sv.props, sv.db_schema, sv.meta, systemOf(n.kind ?? "page", n.db_schema ?? null), datedOf(n.props || "{}"), (n.revision ?? 1) + 1, n.created_at ?? now(), n.updated_at ?? now(), n.deleted_at ?? null),
        ...linkStmts(db, n.id, html),
        ...changeStmts(db, n.id, existing.has(n.id) ? "edited" : "created", "user", t),
      ];
    }));
  }
  for (const c of data.comments ?? []) {
    const cid = String(c.id), anchor = cleanAnchor(c.anchor), kind = c.kind === "suggestion" && anchor ? "suggestion" : "comment";
    await db.prepare("INSERT OR REPLACE INTO comments (owner_id, id,note_id,body,resolved,created_at,kind,author,anchor,replace_with,outcome) VALUES ({owner}, ?,?,?,?,?,?,?,?,?,?)")
      .bind(cid, String(c.note_id), await Vault.seal("comments", cid, "body", clip(c.body, 4000)), flag(c.resolved), Number(c.created_at) || now(), kind,
        c.author === "agent" || c.author === "mcp" ? c.author : "user", anchor ? await Vault.seal("comments", cid, "anchor", JSON.stringify(anchor)) : null,
        kind === "suggestion" ? await Vault.seal("comments", cid, "replace_with", clip(c.replace_with, 4000)) : null, c.outcome === "accepted" || c.outcome === "rejected" ? c.outcome : null).run();
  }
  return { notes: notes.length };
}

// ---------------------------------------------------------------- runs: undo / redo
// A "run" is every change made for one agent prompt (or one MCP call). Undo restores the
// "before" snapshot of each change, newest first. If a page was edited by someone else after
// the run, we report a conflict instead of silently overwriting that later work.

interface ActionRow { id: number; run_id: string; source: string; agent?: string | null; tool: string; note_id: string; before_json: string | null; after_json: string | null; undone_at: number | null; created_at: number }
const openAction = async (a: ActionRow): Promise<ActionRow> => ({ ...a, before_json: await Vault.open("actions", a.note_id, "before_json", a.before_json), after_json: await Vault.open("actions", a.note_id, "after_json", a.after_json) });
const AGENT_SOURCES = "('agent','mcp')";

// The editor adds invisible block ids (data-id) when it opens a page. Those are not edits, so ignore them
// when deciding whether a page changed since the agent touched it. Mention and child-page ids are real links, so keep those.
export const stripBlockIds = (html: string) =>
  html.replace(/<[a-z0-9]+\b[^>]*>/gi, (tag) => (/data-type="(mention|child-page)"/.test(tag) ? tag : tag.replace(/ data-id="[0-9a-f-]{36}"/g, "")));
const sameState = (a: Snap, b: Snap) => SNAP_FIELDS.every((k) => (k === "html" ? stripBlockIds(a.html) === stripBlockIds(b.html) : a[k] === b[k]));

async function writeSnapshot(db: D1Database, id: string, next: Snap, ctx: Ctx, tool: string) {
  const cur = await getNote(db, id, true);
  if (!cur) return false;
  const t = now();
  const htmlChanged = next.html !== cur.html;
  const sv = await sealedNote(id, { ...next, text: htmlChanged ? toText(next.html) : cur.text, meta: cur.meta });
  await db.batch([
    db.prepare(
      `UPDATE notes SET parent_id=?,kind=?,title=?,html=?,text=?,icon=?,cover=?,favorite=?,position=?,full_width=?,small_text=?,font=?,locked=?,is_template=?,props=?,db_schema=?,meta=?,system=?,dated=?,deleted_at=?,
              revision=revision+1, updated_at=? WHERE owner_id = {owner} AND (id=?)`,
    ).bind(next.parent_id, next.kind, sv.title, sv.html, sv.text, sv.icon, sv.cover, next.favorite, next.position, next.full_width, next.small_text, next.font, next.locked, next.is_template, sv.props, sv.db_schema, sv.meta, systemOf(next.kind, next.db_schema), datedOf(next.props), next.deleted_at, t, id),
    ...(htmlChanged ? linkStmts(db, id, next.html) : []),
    db.prepare("INSERT INTO actions (owner_id, run_id,source,agent,tool,note_id,before_json,after_json,created_at) VALUES ({owner}, ?,?,?,?,?,?,?,?)")
      .bind(ctx.runId, ctx.source, ctx.agent ?? null, tool, id, await Vault.seal("actions", id, "before_json", JSON.stringify(snap(cur))), await Vault.seal("actions", id, "after_json", JSON.stringify(next)), t),
    ...changeStmts(db, id, changeType(snap(cur), next), ctx.source, t, ctx.agent ?? null),
  ]);
  return true;
}

/** Recent agent/MCP runs. `hidden`: page ids whose titles must not show (when the list is going to an AI). */
export async function listRuns(db: D1Database, limit = 20, hidden?: Set<string>) {
  const rows = (
    await db.prepare(
      `SELECT run_id, MIN(source) AS source, MIN(created_at) AS started_at, COUNT(*) AS n,
              SUM(CASE WHEN undone_at IS NOT NULL THEN 1 ELSE 0 END) AS undone
       FROM actions WHERE owner_id = {owner} AND (source IN ${AGENT_SOURCES}) GROUP BY run_id ORDER BY MAX(id) DESC LIMIT ?`,
    ).bind(limit).all<{ run_id: string; source: string; started_at: number; n: number; undone: number }>()
  ).results;
  // The page titles live inside the sealed snapshots, so the summaries are built here.
  const summaries = new Map<string, string[]>(), agents = new Map<string, string[]>();
  if (rows.length) {
    const acts = (await db.prepare(`SELECT id, run_id, agent, tool, note_id, before_json, after_json FROM actions WHERE owner_id = {owner} AND (run_id IN (${rows.map(() => "?").join(",")})) ORDER BY id`).bind(...rows.map((r) => r.run_id)).all<ActionRow>()).results;
    for (const a of acts) {
      const o = await openAction(a);
      const title = (o.after_json ? (JSON.parse(o.after_json) as { title?: string }).title : undefined) ?? (o.before_json ? (JSON.parse(o.before_json) as { title?: string }).title : undefined) ?? "";
      if (!summaries.has(a.run_id)) summaries.set(a.run_id, []);
      if (a.agent) { const s = agents.get(a.run_id) ?? []; if (!s.includes(a.agent)) agents.set(a.run_id, [...s, a.agent]); }
      summaries.get(a.run_id)!.push(`${a.tool}:${hidden?.has(a.note_id) ? "[hidden page]" : title}`);
    }
  }
  return rows.map((r) => ({ ...r, state: r.undone === 0 ? "applied" : r.undone === r.n ? "undone" : "partial", agents: agents.get(r.run_id) ?? [], summary: summaries.get(r.run_id) ?? [] }));
}

/** True when a run changed a page that's now hidden from AI (so MCP mustn't undo or redo it). */
export async function runTouchesHidden(db: D1Database, runId: string) {
  const hidden = await hiddenIds(db);
  if (!hidden.size) return false;
  const ids = (await db.prepare("SELECT DISTINCT note_id FROM actions WHERE owner_id = {owner} AND (run_id = ?)").bind(runId).all<{ note_id: string }>()).results;
  return ids.some((r) => hidden.has(r.note_id));
}

export type RunResult = { ok: true; run_id: string; changed: number } | { ok: false; error: string; conflicts?: { id: string; title: string }[] };

export async function undoRun(db: D1Database, runId: string, opts: { force?: boolean; agent?: string } = {}): Promise<RunResult> {
  const acts = await Promise.all((await db.prepare(`SELECT * FROM actions WHERE owner_id = {owner} AND (run_id = ? AND undone_at IS NULL AND source IN ${AGENT_SOURCES}) ORDER BY id DESC`).bind(runId).all<ActionRow>()).results.map(openAction));
  if (!acts.length) return { ok: false, error: "Nothing to undo for that run." };

  const conflicts: { id: string; title: string }[] = [];
  const seen = new Set<string>();
  for (const a of acts) {
    if (seen.has(a.note_id)) continue;
    seen.add(a.note_id);
    const cur = await getNote(db, a.note_id, true);
    const expected = a.after_json ? (JSON.parse(a.after_json) as Snap) : null;
    if (!cur || !expected || !sameState(snap(cur), expected)) conflicts.push({ id: a.note_id, title: cur?.title || "Untitled" });
  }
  if (conflicts.length && !opts.force) {
    return { ok: false, error: "Some pages were edited after the agent changed them.", conflicts };
  }
  const skip = new Set(conflicts.map((c) => c.id));
  const ctx: Ctx = { source: "user", runId: crypto.randomUUID(), agent: opts.agent ?? null };
  let changed = 0;
  for (const a of acts) {
    if (skip.has(a.note_id) && !opts.force) continue;
    const cur = await getNote(db, a.note_id, true);
    if (!cur) continue;
    // A note the agent created did not exist before: undoing it moves it to the trash (recoverable).
    const target: Snap = a.before_json ? (JSON.parse(a.before_json) as Snap) : { ...snap(cur), deleted_at: cur.deleted_at ?? now(), favorite: 0 };
    if (await writeSnapshot(db, a.note_id, target, ctx, "undo")) changed++;
  }
  await db.prepare(`UPDATE actions SET undone_at = ? WHERE owner_id = {owner} AND (run_id = ? AND undone_at IS NULL AND source IN ${AGENT_SOURCES})`).bind(now(), runId).run();
  return { ok: true, run_id: runId, changed };
}

export async function redoRun(db: D1Database, runId: string, opts: { force?: boolean; agent?: string } = {}): Promise<RunResult> {
  const acts = await Promise.all((await db.prepare(`SELECT * FROM actions WHERE owner_id = {owner} AND (run_id = ? AND undone_at IS NOT NULL AND source IN ${AGENT_SOURCES}) ORDER BY id ASC`).bind(runId).all<ActionRow>()).results.map(openAction));
  if (!acts.length) return { ok: false, error: "Nothing to redo for that run." };

  const conflicts: { id: string; title: string }[] = [];
  const seen = new Set<string>();
  for (const a of acts) {
    if (seen.has(a.note_id)) continue;
    seen.add(a.note_id);
    const cur = await getNote(db, a.note_id, true);
    if (!cur) { conflicts.push({ id: a.note_id, title: "Untitled" }); continue; }
    if (a.before_json) {
      if (!sameState(snap(cur), JSON.parse(a.before_json) as Snap)) conflicts.push({ id: a.note_id, title: cur.title || "Untitled" });
    } else if (!cur.deleted_at) conflicts.push({ id: a.note_id, title: cur.title || "Untitled" }); // created pages are trashed by undo
  }
  if (conflicts.length && !opts.force) return { ok: false, error: "Some pages changed since the undo.", conflicts };
  const skip = new Set(conflicts.map((c) => c.id));
  const ctx: Ctx = { source: "user", runId: crypto.randomUUID(), agent: opts.agent ?? null };
  let changed = 0;
  for (const a of acts) {
    if (skip.has(a.note_id) && !opts.force) continue;
    if (a.after_json && (await writeSnapshot(db, a.note_id, JSON.parse(a.after_json) as Snap, ctx, "redo"))) changed++;
  }
  await db.prepare(`UPDATE actions SET undone_at = NULL WHERE owner_id = {owner} AND (run_id = ? AND undone_at IS NOT NULL AND source IN ${AGENT_SOURCES})`).bind(runId).run();
  return { ok: true, run_id: runId, changed };
}

/** The most recent run that still has applied changes (what "/undo" targets). */
export async function latestUndoable(db: D1Database, source?: "agent" | "mcp") {
  const only = source ? ` AND source = '${source === "mcp" ? "mcp" : "agent"}'` : "";
  const r = await db.prepare(`SELECT run_id FROM actions WHERE owner_id = {owner} AND (source IN ${AGENT_SOURCES}${only} AND undone_at IS NULL) ORDER BY id DESC LIMIT 1`).first<{ run_id: string }>();
  return r?.run_id ?? null;
}
/** The most recently undone run (what "/redo" targets). */
export async function latestRedoable(db: D1Database, source?: "agent" | "mcp") {
  const only = source ? ` AND source = '${source === "mcp" ? "mcp" : "agent"}'` : "";
  const r = await db.prepare(`SELECT run_id FROM actions WHERE owner_id = {owner} AND (source IN ${AGENT_SOURCES}${only} AND undone_at IS NOT NULL) ORDER BY undone_at DESC, id DESC LIMIT 1`).first<{ run_id: string }>();
  return r?.run_id ?? null;
}

// ---------------------------------------------------------------- page metadata
// Key/value data outside tools keep on a page (a sync's external ids). It isn't content: no history entry, no
// change-feed row, no updated_at bump, not in the content hash, and undo never touches it. Allowed on locked and
// trashed pages too, since it doesn't change what the page shows.

export const META_MAX_CHARS = 4000;
const META_KEY = /^[A-Za-z0-9_.:-]{1,64}$/;

/** Parses stored/imported metadata, dropping anything malformed. */
export function cleanMeta(raw: unknown): string {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!v || typeof v !== "object" || Array.isArray(v)) return "{}";
    const s = JSON.stringify(v);
    return s.length <= META_MAX_CHARS ? s : "{}";
  } catch { return "{}"; }
}
export const parseMeta = (raw: string | null | undefined): Record<string, unknown> => { try { const v = JSON.parse(raw || "{}"); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; } };

/** Merges `patch` into a page's metadata (null removes a key), or replaces it all. Returns the new metadata. */
export async function setMeta(db: D1Database, id: string, patch: Record<string, unknown>, replace = false) {
  const n = await getNote(db, id, true);
  if (!n) return null;
  const next: Record<string, unknown> = replace ? {} : parseMeta(n.meta);
  for (const [k, v] of Object.entries(patch)) {
    if (!META_KEY.test(k)) throw new BadRequest(`metadata key "${k.slice(0, 70)}" must be 1-64 letters, digits, _ . : or -`);
    if (v === null) delete next[k]; else next[k] = v;
  }
  if (Object.keys(next).length > 32) throw new BadRequest("metadata can have at most 32 keys");
  const s = JSON.stringify(next);
  if (s.length > META_MAX_CHARS) throw new BadRequest(`metadata is limited to ${META_MAX_CHARS} characters of JSON`);
  await db.prepare("UPDATE notes SET meta = ? WHERE owner_id = {owner} AND (id = ?)").bind(await sealCol(id, "meta", s), id).run();
  return next;
}

// ---------------------------------------------------------------- home dashboard
// Recently edited pages (not database rows) plus upcoming dated rows from every database.
// Dates are returned raw; the client decides "today" in the user's own time zone.

export async function homeData(db: D1Database) {
  type RecentRow = { id: string; title: string; icon: string | null; kind: string; cover: string | null; parent_id: string | null; updated_at: number; parent_title: string | null; parent_icon: string | null };
  const recent = await Promise.all((
    await db.prepare(
      `SELECT n.id, n.title, n.icon, n.kind, n.cover, n.parent_id, n.updated_at, p.title AS parent_title, p.icon AS parent_icon
       FROM notes n LEFT JOIN notes p ON p.owner_id = {owner} AND p.id = n.parent_id
       WHERE n.owner_id = {owner} AND (n.deleted_at IS NULL AND n.is_template = 0 AND (p.id IS NULL OR p.kind != 'database'))
       ORDER BY n.updated_at DESC LIMIT 9`,
    ).all<RecentRow>()
  ).results.map(async (r) => ({
    ...r,
    title: await Vault.open("notes", r.id, "title", r.title), icon: await Vault.open("notes", r.id, "icon", r.icon), cover: await Vault.open("notes", r.id, "cover", r.cover),
    parent_title: r.parent_id ? await Vault.open("notes", r.parent_id, "title", r.parent_title) : null, parent_icon: r.parent_id ? await Vault.open("notes", r.parent_id, "icon", r.parent_icon) : null,
  })));

  type DatedRow = { id: string; title: string; icon: string | null; props: string; db_id: string; db_title: string; db_icon: string | null; db_schema: string | null };
  const rows = await Promise.all((
    await db.prepare(
      `SELECT n.id, n.title, n.icon, n.props, p.id AS db_id, p.title AS db_title, p.icon AS db_icon, p.db_schema
       FROM notes n JOIN notes p ON p.owner_id = {owner} AND p.id = n.parent_id
       WHERE n.owner_id = {owner} AND (n.deleted_at IS NULL AND p.deleted_at IS NULL AND p.kind = 'database' AND n.is_template = 0 AND n.dated = 1)
       LIMIT 800`,
    ).all<DatedRow>()
  ).results.map(async (r): Promise<DatedRow> => ({
    ...r, title: (await Vault.open("notes", r.id, "title", r.title)) ?? "", icon: await Vault.open("notes", r.id, "icon", r.icon), props: (await Vault.open("notes", r.id, "props", r.props)) ?? "{}",
    db_title: (await Vault.open("notes", r.db_id, "title", r.db_title)) ?? "", db_icon: await Vault.open("notes", r.db_id, "icon", r.db_icon), db_schema: await Vault.open("notes", r.db_id, "db_schema", r.db_schema),
  })));

  type P = { id: string; name: string; type: string; options?: { id: string; name: string; color: string }[] };
  const upcoming: unknown[] = [];
  for (const r of rows) {
    let schema: { properties?: P[] } = {};
    let props: Record<string, unknown> = {};
    try { schema = JSON.parse(r.db_schema ?? "{}"); props = JSON.parse(r.props || "{}"); } catch { continue; }
    const ps = schema.properties ?? [];
    const dateProp = ps.find((p) => p.type === "date" && (props[p.id] as { start?: string } | undefined)?.start);
    if (!dateProp) continue;
    const dv = props[dateProp.id] as { start: string; end?: unknown; start_time?: unknown; end_time?: unknown };
    const due = String(dv.start).slice(0, 10);
    const hhmm = (x: unknown) => (typeof x === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(x) ? x : null);
    const start_time = hhmm(dv.start_time), end_time = start_time ? hhmm(dv.end_time) : null;
    const endDay = typeof dv.end === "string" ? dv.end.slice(0, 10) : "";
    const end = endDay > due ? endDay : null;
    // Status: the first status/select value. Rows marked done (status "Done"/"Complete" or a checked "Done" box) are skipped.
    const statusProp = ps.find((p) => p.type === "status") ?? ps.find((p) => p.type === "select" && /status|state/i.test(p.name));
    const opt = statusProp?.options?.find((o) => o.id === props[statusProp.id]);
    const doneBox = ps.find((p) => p.type === "checkbox" && /done|complete/i.test(p.name));
    if ((opt && /^(done|complete|completed|finished)$/i.test(opt.name)) || (doneBox && props[doneBox.id] === true)) continue;
    upcoming.push({ id: r.id, title: r.title || "Untitled", icon: r.icon, due, end, start_time, end_time, db_id: r.db_id, db_title: r.db_title || "Untitled", db_icon: r.db_icon, status: opt ? { name: opt.name, color: opt.color } : null });
  }
  const at = (u: unknown) => { const x = u as { due: string; start_time: string | null }; return `${x.due} ${x.start_time ?? "99:99"}`; };
  upcoming.sort((a, b) => (at(a) < at(b) ? -1 : 1));
  return { recent, upcoming: upcoming.slice(0, 40) };
}


// ---------------------------------------------------------------------------------------------
// Built-in to-do list. Created once, on request from the app (never implicitly, so the API stays
// predictable). If it exists, even in the trash, it is returned instead of making another one.
// ---------------------------------------------------------------------------------------------
const TASK_STATUS = [
  { id: "todo", name: "Not started", color: "gray" },
  { id: "doing", name: "In progress", color: "blue" },
  { id: "done", name: "Done", color: "green" },
];
/** Repeating tasks: completing one moves its due date to the next occurrence (see src/client/recur.ts). */
const REPEAT_PROP = { id: "repeat", name: "Repeat", type: "select", options: [
  { id: "daily", name: "Daily", color: "purple" }, { id: "weekdays", name: "Weekdays", color: "purple" }, { id: "weekly", name: "Weekly", color: "purple" },
  { id: "biweekly", name: "Every 2 weeks", color: "purple" }, { id: "monthly", name: "Monthly", color: "purple" },
] };

export const TASKS_SCHEMA = {
  system: "tasks",
  properties: [
    { id: "title", name: "Task", type: "title" },
    { id: "status", name: "Status", type: "status", options: TASK_STATUS },
    { id: "due", name: "Due", type: "date" },
    { id: "priority", name: "Priority", type: "select", options: [
      { id: "high", name: "High", color: "red" }, { id: "medium", name: "Medium", color: "yellow" }, { id: "low", name: "Low", color: "gray" },
    ] },
    { id: "tags", name: "Tags", type: "multi_select", options: [
      { id: "school", name: "School", color: "blue" }, { id: "personal", name: "Personal", color: "green" }, { id: "errands", name: "Errands", color: "orange" },
    ] },
    REPEAT_PROP,
  ],
  views: [
    { id: "v-todo", name: "To do", type: "table", filters: [{ id: "f1", prop: "status", op: "is_not", value: "done" }], filter_mode: "and",
      sorts: [{ prop: "due", dir: "asc" }], hidden: [] },
    { id: "v-board", name: "Board", type: "board", filters: [], filter_mode: "and", sorts: [{ prop: "due", dir: "asc" }], group_by: "status", hidden: [] },
    { id: "v-cal", name: "Calendar", type: "calendar", filters: [], filter_mode: "and", sorts: [], hidden: [], date_prop: "due" },
    { id: "v-done", name: "Done", type: "table", filters: [{ id: "f2", prop: "status", op: "is", value: "done" }], filter_mode: "and", sorts: [], hidden: [] },
  ],
};

/** `today` is the user's local date (YYYY-MM-DD); the Worker runs in UTC, so it can't know it. */
export async function ensureTasksDb(db: D1Database, ctx: Ctx, today?: string) {
  const found = await db.prepare(`SELECT id, deleted_at FROM notes WHERE owner_id = {owner} AND (kind = 'database' AND system = 'tasks') ORDER BY created_at LIMIT 1`)
    .first<{ id: string; deleted_at: number | null }>();
  if (found) {
    // Lists made before a property existed get it added once (today: Repeat).
    if (found.deleted_at === null) {
      const row = await getNote(db, found.id);
      try {
        const schema = JSON.parse(row?.db_schema ?? "{}") as { properties?: { id: string }[] };
        if (schema.properties && !schema.properties.some((x) => x.id === "repeat")) {
          await patchNote(db, found.id, { db_schema: { ...schema, properties: [...schema.properties, REPEAT_PROP] } }, ctx);
        }
      } catch { /* leave a list we can't read alone */ }
    }
    return { id: found.id, created: false, trashed: found.deleted_at !== null };
  }
  const list = await createNote(db, { kind: "database", title: "My tasks", icon: "✅", db_schema: TASKS_SCHEMA, html: "" }, ctx);
  const base = /^\d{4}-\d{2}-\d{2}$/.test(today ?? "") ? new Date(`${today}T12:00:00Z`) : new Date();
  const day = (n: number) => { const d = new Date(base); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const starters = [
    { title: "Tick this box when you're done", props: { status: "todo", due: { start: day(0) }, priority: "medium" } },
    { title: "Plan this week's study sessions", props: { status: "doing", due: { start: day(2) }, priority: "high", tags: ["school"] } },
    { title: "Ask Waffle to add a task for you", props: { status: "todo", tags: ["personal"] } },
  ];
  for (const [i, t] of starters.entries()) await createNote(db, { parent_id: list.id, title: t.title, props: t.props, position: i + 1 }, ctx);
  return { id: list.id, created: true, trashed: false };
}

// ---------------------------------------------------------------------------------------------
// Calendar: a database of events (system: "events"), made the first time one is added. The Calendar screen shows these with
// the dated rows of My tasks.
export const EVENTS_SCHEMA = {
  system: "events",
  properties: [
    { id: "title", name: "Event", type: "title" },
    { id: "when", name: "When", type: "date" },
    { id: "where", name: "Where", type: "text" },
  ],
  views: [
    { id: "v-month", name: "Month", type: "calendar", filters: [], filter_mode: "and", sorts: [], hidden: [], date_prop: "when" },
    { id: "v-all", name: "All events", type: "table", filters: [], filter_mode: "and", sorts: [{ prop: "when", dir: "asc" }], hidden: [] },
  ],
};

export async function ensureEventsDb(db: D1Database, ctx: Ctx) {
  const found = await db.prepare(`SELECT id, deleted_at FROM notes WHERE owner_id = {owner} AND (kind = 'database' AND system = 'events') ORDER BY created_at LIMIT 1`)
    .first<{ id: string; deleted_at: number | null }>();
  if (found) return { id: found.id, created: false, trashed: found.deleted_at !== null };
  const cal = await createNote(db, { kind: "database", title: "Calendar", icon: "📅", db_schema: EVENTS_SCHEMA, html: "" }, ctx);
  return { id: cal.id, created: true, trashed: false };
}

// ---------------------------------------------------------------------------------------------
// Grade tracker: a database with Class, Category, Score, Out of, Weight and Date. The app shows each class's
// weighted average above it (system: "grades"). Created once, on request; an existing one is returned.
// ---------------------------------------------------------------------------------------------
export const GRADES_SCHEMA = {
  system: "grades",
  properties: [
    { id: "title", name: "Assignment", type: "title" },
    { id: "class", name: "Class", type: "select", options: [] as { id: string; name: string; color: string }[] },
    { id: "category", name: "Category", type: "select", options: [
      { id: "test", name: "Test", color: "red" }, { id: "quiz", name: "Quiz", color: "orange" }, { id: "homework", name: "Homework", color: "blue" },
      { id: "project", name: "Project", color: "purple" }, { id: "classwork", name: "Classwork", color: "green" },
    ] },
    { id: "score", name: "Score", type: "number", number_format: "number" },
    { id: "outof", name: "Out of", type: "number", number_format: "number" },
    { id: "weight", name: "Weight", type: "number", number_format: "number" },
    { id: "percent", name: "Percent", type: "formula", formula: 'if(prop("Out of") > 0, round(prop("Score") / prop("Out of") * 100, 1), "")' },
    { id: "date", name: "Date", type: "date" },
  ],
  views: [
    { id: "v-all", name: "By class", type: "table", filters: [], filter_mode: "and", sorts: [{ prop: "date", dir: "desc" }], group_by: "class", hidden: [] },
    { id: "v-recent", name: "Recent", type: "table", filters: [], filter_mode: "and", sorts: [{ prop: "date", dir: "desc" }], hidden: [] },
    { id: "v-chart", name: "Over time", type: "chart", filters: [], filter_mode: "and", sorts: [], hidden: [], chart: { kind: "line", x: "date", y: "percent", agg: "avg", series: "class" } },
  ],
};

export async function ensureGradesDb(db: D1Database, ctx: Ctx) {
  const found = await db.prepare(`SELECT id, deleted_at FROM notes WHERE owner_id = {owner} AND (kind = 'database' AND system = 'grades') ORDER BY created_at LIMIT 1`)
    .first<{ id: string; deleted_at: number | null }>();
  if (found) return { id: found.id, created: false, trashed: found.deleted_at !== null };
  const list = await createNote(db, { kind: "database", title: "Grades", icon: "🎓", db_schema: GRADES_SCHEMA, html: "" }, ctx);
  return { id: list.id, created: true, trashed: false };
}
