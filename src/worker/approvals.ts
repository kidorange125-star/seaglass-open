// What the assistant may do on its own (Settings > Assistant permissions). Every tool that changes something belongs to a
// kind; each kind is Allow, Ask or Never. Ask pauses the run: the chat shows the action ("Move “Biology” to the trash") with
// Approve and Deny, and the run waits (up to 5 minutes) for the answer. Runs with nobody to ask (routines, Ctrl+K quick
// actions, live voice) refuse those actions instead. Web search runs on Claude's side, so it can only be allowed or off.
// MCP apps (Claude) are not affected: they ask in their own way.
import * as N from "./notes";

export type Level = "allow" | "ask" | "never";
export type Kind = "add" | "edit" | "delete" | "memory" | "routines" | "web";
export type Permissions = Record<Kind, Level>;

export const KINDS: Kind[] = ["add", "edit", "delete", "memory", "routines", "web"];
export const PRESETS: Record<"careful" | "balanced" | "free", Permissions> = {
  careful: { add: "ask", edit: "ask", delete: "ask", memory: "allow", routines: "ask", web: "allow" },
  balanced: { add: "allow", edit: "allow", delete: "ask", memory: "allow", routines: "ask", web: "allow" },
  free: { add: "allow", edit: "allow", delete: "allow", memory: "allow", routines: "allow", web: "allow" },
};
export const DEFAULT = PRESETS.careful;

const TOOL_KIND: Record<string, Kind> = {
  create_note: "add", create_database: "add", add_database_row: "add", append_to_note: "add", plan_study_sessions: "add",
  update_note: "edit", replace_in_note: "edit", update_database_row: "edit", set_page_metadata: "edit", manage_subject: "edit",
  manage_exam: "edit", update_study_page: "edit",
  delete_note: "delete",
  remember: "memory", forget: "memory",
  manage_routine: "routines",
};
export const kindOf = (tool: string): Kind | null => TOOL_KIND[tool] ?? null;

/** The settings, or the copy's starting point: DEFAULT_AGENT_PERMISSIONS (careful, balanced or free), else careful. */
export const startingPoint = (env: { DEFAULT_AGENT_PERMISSIONS?: string }): Permissions =>
  PRESETS[(env.DEFAULT_AGENT_PERMISSIONS ?? "") as keyof typeof PRESETS] ?? DEFAULT;

export async function permissions(db: D1Database, base: Permissions = DEFAULT): Promise<Permissions> {
  const v = (await db.prepare("SELECT value FROM prefs WHERE owner_id = {owner} AND (key = 'agent_permissions')").first<{ value: string }>())?.value;
  try {
    const p = JSON.parse(v ?? "{}") as Partial<Permissions>;
    return Object.fromEntries(KINDS.map((k) => [k, p[k] === "allow" || p[k] === "ask" || p[k] === "never" ? p[k] : base[k]])) as Permissions;
  } catch { return { ...base }; }
}

export async function savePermissions(db: D1Database, raw: unknown, base: Permissions = DEFAULT) {
  const cur = await permissions(db, base), b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const next = Object.fromEntries(KINDS.map((k) => [k, b[k] === "allow" || b[k] === "ask" || b[k] === "never" ? b[k] : cur[k]])) as Permissions;
  if (next.web === "ask") next.web = "allow"; // can't pause a search that runs on Claude's side
  await db.prepare("INSERT INTO prefs (owner_id, key, value) VALUES ({owner}, 'agent_permissions', ?) ON CONFLICT(owner_id, key) DO UPDATE SET value = excluded.value").bind(JSON.stringify(next)).run();
  return next;
}

/** One line for the assistant's context about what it may do, so it doesn't plan around something that's off. */
export function permissionNote(p: Permissions) {
  const off = KINDS.filter((k) => p[k] === "never"), ask = KINDS.filter((k) => p[k] === "ask" && k !== "web");
  const name: Record<Kind, string> = { add: "adding pages, rows and tasks", edit: "editing pages and study items", delete: "moving pages to the trash", memory: "remembering and forgetting", routines: "setting up routines", web: "searching the web" };
  let s = "";
  if (ask.length) s += ` The user wants to approve these before you do them: ${ask.map((k) => name[k]).join("; ")}. When you use one of those tools the app asks them; if they decline, don't try another way.`;
  if (off.length) s += ` The user has turned these off: ${off.map((k) => name[k]).join("; ")}. Don't use those tools; say what you'd do instead.`;
  return s;
}

const quote = (s: string, n = 60) => `“${s.length > n ? `${s.slice(0, n - 1)}…` : s}”`;
async function titleOf(db: D1Database, id: unknown) {
  if (typeof id !== "string") return "a page";
  try { const n = await N.getNote(db, id); return n ? quote(n.title || "Untitled") : "a page"; } catch { return "a page"; }
}

/** The action in plain words, for the approval card. Never more than a short preview of new text. */
export async function describe(db: D1Database, tool: string, input: unknown): Promise<string> {
  const a = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  switch (tool) {
    case "create_note": return `Create the page ${quote(str(a.title) || "Untitled")}${a.parent_id ? ` inside ${await titleOf(db, a.parent_id)}` : ""}`;
    case "create_database": return `Create the database ${quote(str(a.title) || "Untitled")}`;
    case "add_database_row": return `Add ${quote(str(a.title) || "a row")} to ${await titleOf(db, a.database_id)}`;
    case "append_to_note": return `Add to the end of ${await titleOf(db, a.id)}`;
    case "plan_study_sessions": return `Add study sessions to My tasks`;
    case "update_note": return `${a.html !== undefined ? "Rewrite" : "Change"} ${await titleOf(db, a.id)}${a.title ? ` (new title ${quote(str(a.title))})` : ""}`;
    case "replace_in_note": return `In ${await titleOf(db, a.id)}, replace ${quote(str(a.find), 40)} with ${quote(str(a.replace), 40)}`;
    case "update_database_row": return `Change the row ${await titleOf(db, a.id)}`;
    case "set_page_metadata": return `Change the sync details of ${await titleOf(db, a.id)}`;
    case "manage_subject": return `${str(a.action) === "delete" ? "Delete" : str(a.action) === "create" ? "Create" : "Change"} a study subject${a.name ? ` ${quote(str(a.name))}` : ""}`;
    case "manage_exam": return `${str(a.action) === "delete" ? "Delete" : str(a.action) === "create" ? "Create" : "Change"} a test${a.name ? ` ${quote(str(a.name))}` : ""}`;
    case "update_study_page": return `Change how ${await titleOf(db, a.id)} is studied`;
    case "delete_note": return `Move ${await titleOf(db, a.id)} to the trash`;
    case "remember": return `Remember: ${quote(str(a.text), 80)}`;
    case "forget": return "Forget something it remembered";
    case "manage_routine": return `${str(a.action) === "delete" ? "Delete" : str(a.action) === "create" ? "Set up" : "Change"} a routine${a.name ? ` ${quote(str(a.name))}` : ""}`;
    default: return tool.replace(/_/g, " ");
  }
}

export async function ask(db: D1Database, runId: string, tool: string) {
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO agent_approvals (owner_id, id, run_id, tool, status, created_at) VALUES ({owner}, ?, ?, ?, 'pending', ?)").bind(id, runId, tool, Date.now()).run();
  // old questions go after a day
  await db.prepare("DELETE FROM agent_approvals WHERE owner_id = {owner} AND (created_at < ?)").bind(Date.now() - 864e5).run();
  return id;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Waits for the answer: true for Approve; false for Deny, 5 minutes without one, or the chat being stopped. */
export async function waitFor(db: D1Database, id: string, isAborted: () => boolean, ms = 5 * 60e3) {
  const until = Date.now() + ms;
  while (Date.now() < until && !isAborted()) {
    const r = await db.prepare("SELECT status FROM agent_approvals WHERE owner_id = {owner} AND (id = ?)").bind(id).first<{ status: string }>();
    if (r?.status === "approved") return true;
    if (r?.status === "denied") return false;
    await sleep(700);
  }
  await db.prepare("UPDATE agent_approvals SET status = 'expired', decided_at = ? WHERE owner_id = {owner} AND (id = ? AND status = 'pending')").bind(Date.now(), id).run();
  return false;
}

export async function decide(db: D1Database, id: string, ok: boolean) {
  const r = await db.prepare("UPDATE agent_approvals SET status = ?, decided_at = ? WHERE owner_id = {owner} AND (id = ? AND status = 'pending')").bind(ok ? "approved" : "denied", Date.now(), id).run();
  return !!r.meta.changes;
}
