// Whose data a query may touch. Every request (and every per-person cron run) works through a scoped database: queries
// on a personal table write {owner} where the person's id goes, and the scoped database fills it in. A query on a personal
// table without {owner} is refused, so a forgotten filter fails loudly instead of showing one person another's things.
// System work that really spans everyone (backups, encryption upkeep, the cron's list of people) uses the system database
// and marks such queries /*any-owner*/; the system database refuses {owner}, so the two can't be mixed up.
// See docs/HOUSEHOLDS.md.

export const PERSONAL = ["notes", "actions", "links", "comments", "changes", "study", "memories", "chats", "push_subs", "push_sent",
  "push_snooze", "prefs", "embeddings", "inbox", "prompts", "routines", "thread", "study_subjects", "study_pages", "study_sets",
  "study_sessions", "study_exams", "study_exam_pages", "study_misses", "agent_approvals", "ai_usage"];
/** Tables that belong to the whole copy, not to one person. Every table is in exactly one of the two lists (npm run
 *  check:scope fails on a table in neither, so a new one can't slip past both guards). */
export const SYSTEM_TABLES = ["users", "sessions", "login_attempts", "invites", "person_rules"];
// A table name may be quoted ("notes", `notes`, [notes]) or carry its schema (main.notes).
const TOUCHES = new RegExp(String.raw`\b(?:FROM|INTO|UPDATE|JOIN|TABLE)\s+(?:main\.)?["\x60\[]?(?:${PERSONAL.join("|")})["\x60\]]?(?![\w])`, "i");
// A person's id, the test user "dev", the shared Family space ("family", src/shared/space.ts), or '' for the household.
const ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|dev|family|)$/;

export class ScopeError extends Error {}

const OWNER = new WeakMap<object, string>();

function wrap(raw: D1Database, check: (sql: string) => string, owner: string | null): D1Database {
  const db = {
    prepare: (sql: string) => raw.prepare(check(sql)),
    batch: <T = unknown>(stmts: D1PreparedStatement[]) => raw.batch<T>(stmts),
    exec: (sql: string) => raw.exec(check(sql)),
    dump: () => raw.dump(),
    // A session would hand back the unwrapped database, so it isn't offered.
    withSession: () => { throw new ScopeError("withSession isn't available on a scoped database"); },
  } as unknown as D1Database;
  if (owner !== null) OWNER.set(db, owner);
  return db;
}

/** One person's database: {owner} becomes their id, and personal tables can only be reached with it. */
export function scoped(raw: D1Database, owner: string): D1Database {
  if (!ID.test(owner)) throw new ScopeError("bad owner id");
  const lit = `'${owner}'`;
  return wrap(raw, (sql) => {
    if (TOUCHES.test(sql) && !sql.includes("{owner}") && !sql.includes("/*any-owner*/")) throw new ScopeError(`A query on a personal table has no owner: ${sql.slice(0, 140)}`);
    return sql.replaceAll("{owner}", lit);
  }, owner);
}

/** The system's database: spans everyone, so any query on a personal table must carry the any-owner marker comment. */
export function system(raw: D1Database): D1Database {
  return wrap(raw, (sql) => {
    if (sql.includes("{owner}")) throw new ScopeError(`A per-person query ran without a person: ${sql.slice(0, 140)}`);
    if (TOUCHES.test(sql) && !sql.includes("/*any-owner*/")) throw new ScopeError(`A system query on a personal table must be marked /*any-owner*/: ${sql.slice(0, 140)}`);
    return sql;
  }, null);
}

/** Whose database this is (the id {owner} stands for), or null for the system database. */
export const ownerOf = (db: D1Database): string | null => OWNER.get(db) ?? null;
export function requireOwner(db: D1Database): string {
  const o = ownerOf(db);
  if (o === null) throw new ScopeError("This needs a person's database, not the system's.");
  return o;
}

/** env with its database scoped to one person (for routes, MCP and per-person cron runs). */
export function asPerson<E extends { DB: D1Database; RAW?: D1Database }>(env: E, owner: string): E {
  if (!env.RAW) throw new ScopeError("No unwrapped database to scope from (fetch/scheduled keep it as env.RAW).");
  return { ...env, DB: scoped(env.RAW, owner) };
}

/** env for the system: the database wrapped by system(), the raw one kept for asPerson. */
export const asSystem = <E extends { DB: D1Database; RAW?: D1Database }>(env: E): E => ({ ...env, RAW: env.RAW ?? env.DB, DB: system(env.RAW ?? env.DB) });

/** Everyone the cron works for: each account, or the test user "dev" on a copy with none yet. */
export async function people(sys: D1Database, devOpen: boolean): Promise<string[]> {
  const ids = (await sys.prepare("SELECT id FROM users ORDER BY created_at").all<{ id: string }>()).results.map((r) => r.id);
  return ids.length ? ids : devOpen ? ["dev"] : [];
}
