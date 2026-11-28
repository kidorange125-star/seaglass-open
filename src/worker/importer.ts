// Importing from other apps (0.2.4). The browser does the reading (client/import/: Notion, Obsidian and Markdown folders,
// Apple Notes, Google Keep, Evernote), uploads the pictures and files through /api/upload, and sends the pages here in
// order, parents first, a few at a time, all inside one new top-level page. They're made with notes.ts createMany: in
// one database batch per request (the free plan allows 50 database calls per request), sanitized, logged in history
// and the change feed like any page, under one run id for the whole import.
import * as N from "./notes";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const MAX_PAGES = 25;
/** A page's HTML is kept under this many UTF-8 bytes: sealed (about 4/3 bigger) with its plain text beside it, the row
 *  stays under D1's 2 MB, and so does its history entry. */
export const MAX_HTML = 600_000;
const enc = new TextEncoder();
const bytes = (s: string) => enc.encode(s).length;

export type ImportPage = {
  id: string; parent_id: string | null; title?: string; html?: string; icon?: string | null; kind?: string;
  db_schema?: unknown; props?: unknown; created_at?: number; updated_at?: number;
};

/** Cuts very long HTML at the last whole block that fits, and says so at the end of the page. */
export function fit(html: string): { html: string; cut: boolean } {
  if (html.length <= MAX_HTML / 4 || bytes(html) <= MAX_HTML) return { html, cut: false };
  let room = html.slice(0, Math.floor(html.length * (MAX_HTML - 300) / bytes(html)));
  while (bytes(room) > MAX_HTML - 300) room = room.slice(0, Math.floor(room.length * 0.95));
  const end = Math.max(...["</p>", "</li>", "</ul>", "</ol>", "</h1>", "</h2>", "</h3>", "</table>", "</div>", "</blockquote>", "</pre>"].map((t) => { const i = room.lastIndexOf(t); return i < 0 ? -1 : i + t.length; }));
  return { html: `${end > 0 ? room.slice(0, end) : ""}<p><em>The rest of this page was too long to import.</em></p>`, cut: true };
}

/**
 * Makes the pages, in the order given. A page whose parent couldn't be made goes inside the import's own page (`root`)
 * instead, so one bad page never loses the ones under it. Returns how many were made, which weren't (with why), and
 * which were too long and kept only in part.
 */
export async function makePages(db: D1Database, list: unknown, root: unknown, ctx: N.Ctx) {
  if (!Array.isArray(list) || !list.length || list.length > MAX_PAGES) throw new N.BadRequest(`send between 1 and ${MAX_PAGES} pages at a time`);
  const fallback = typeof root === "string" && UUID.test(root) ? root : null;
  const failed: { id: string; title: string; error: string }[] = [];
  const cut: string[] = [];
  const inputs: (N.CreateInput & { id: string })[] = [];
  const titles = new Map<string, string>();
  for (const raw of list as ImportPage[]) {
    const p = raw && typeof raw === "object" ? raw : ({} as ImportPage);
    const title = String(p.title ?? "").slice(0, 300);
    if (typeof p.id !== "string" || !UUID.test(p.id) || (p.parent_id != null && (typeof p.parent_id !== "string" || !UUID.test(p.parent_id)))) {
      failed.push({ id: String(p.id ?? ""), title, error: "bad page id" }); continue;
    }
    const f = fit(String(p.html ?? ""));
    if (f.cut) cut.push(title || "A page");
    titles.set(p.id, title);
    inputs.push({
      id: p.id, parent_id: p.parent_id ?? null, title, kind: p.kind === "database" ? "database" : "page", html: f.html,
      icon: typeof p.icon === "string" ? p.icon.slice(0, 64) : null,
      db_schema: p.kind === "database" ? p.db_schema : undefined, props: p.props ?? {},
      created_at: Number(p.created_at) || undefined, updated_at: Number(p.updated_at) || undefined,
    });
  }
  let r: Awaited<ReturnType<typeof N.createMany>>;
  try { r = await N.createMany(db, inputs, ctx, fallback); }
  catch (e) {
    // Ids are made fresh by the browser, so this only happens to a request built to reuse one; nothing was written.
    if (!/UNIQUE|constraint/i.test((e as Error).message)) throw e;
    r = { made: [], refused: inputs.map((i) => ({ id: i.id, error: "a page with this id already exists" })) };
  }
  for (const x of r.refused) failed.push({ id: x.id, title: titles.get(x.id) ?? "", error: x.error });
  return { made: r.made.length, failed, cut };
}
