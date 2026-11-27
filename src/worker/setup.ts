// First run and accounts (Seaglass Open). A fresh copy has no accounts; the setup screen asks whether it's for one person
// or a household, then makes the owner's account. On any address but localhost, setup needs the SETUP_CODE secret (set when
// deploying), so a stranger who finds a new copy first can't claim it. Individual and household are the same underneath (an
// individual is a household of one); the mode only changes what the app shows, and can be switched in Settings.
import type { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Env } from "./env";
import {
  COOKIE, checkPassword, cookieOptions, createSession, currentUser, endOtherSessions, endSession, hashPassword, isLocalHost,
  loginFailed, loginLocked, loginOk, passwordProblem, safeEqual, usernameProblem, type User,
} from "./auth";
import { requireOwner } from "./scope";

export type Household = { mode: "individual" | "household"; name: string };

export async function household(db: D1Database): Promise<Household> {
  const v = (await db.prepare("SELECT value FROM prefs WHERE owner_id = '' AND key = 'household' /*any-owner*/").first<{ value: string }>())?.value;
  try { const h = JSON.parse(v ?? "{}") as Partial<Household>; return { mode: h.mode === "household" ? "household" : "individual", name: typeof h.name === "string" ? h.name : "" }; }
  catch { return { mode: "individual", name: "" }; }
}
const saveHousehold = (db: D1Database, h: Household) =>
  db.prepare("INSERT INTO prefs (owner_id, key, value) VALUES ('', 'household', ?) ON CONFLICT(owner_id, key) DO UPDATE SET value = excluded.value /*any-owner*/").bind(JSON.stringify(h));

export const userCount = async (db: D1Database) => (await db.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>())?.n ?? 0;

/** The name of the person whose database this is, for the assistant ("You're talking with Sam"). */
export async function ownerName(db: D1Database) {
  const id = requireOwner(db);
  return (await db.prepare("SELECT display_name FROM users WHERE id = ?").bind(id).first<{ display_name: string }>())?.display_name ?? "";
}

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max) : "");
type C = { env: Env; req: { url: string; json: () => Promise<unknown> } };
const body = async <T,>(c: C) => (await c.req.json().catch(() => ({}))) as T;
const publicUser = (u: User) => ({ id: u.id, username: u.username, display_name: u.display_name, role: u.role });

export function registerAccounts(app: Hono<{ Bindings: Env }>) {
  // What the app should show first: setup, sign-in, or the app.
  app.get("/api/session", async (c) => {
    // A new deploy whose database tables haven't been applied yet: say so instead of failing.
    const users = await userCount(c.env.DB).catch((e) => (/no such table/i.test(String(e)) ? -1 : Promise.reject(e)));
    if (users < 0) return c.json({ authed: false, setup: true, no_tables: true, code_required: true });
    if (!users && !c.env.AUTH_OPEN) {
      const local = isLocalHost(new URL(c.req.url).hostname);
      return c.json({ authed: false, setup: true, code_required: !local || !!c.env.SETUP_CODE, code_set: !!c.env.SETUP_CODE });
    }
    const u = await currentUser(c.env, c.req.url, getCookie(c, COOKIE));
    return c.json({ authed: !!u, setup: false, user: u ? publicUser(u) : null, household: await household(c.env.DB) });
  });

  app.post("/api/setup", async (c) => {
    const b = await body<{ code?: unknown; mode?: unknown; household_name?: unknown; display_name?: unknown; username?: unknown; password?: unknown }>(c);
    if (await userCount(c.env.DB)) return c.json({ error: "This Seaglass is already set up. Sign in instead." }, 409);
    const local = isLocalHost(new URL(c.req.url).hostname);
    if (!c.env.SETUP_CODE && !local) return c.json({ error: "Set the SETUP_CODE secret first (npx wrangler secret put SETUP_CODE), then reload this page." }, 503);
    if (c.env.SETUP_CODE && !(typeof b.code === "string" && safeEqual(b.code.trim(), c.env.SETUP_CODE.trim()))) return c.json({ error: "That setup code isn't right.", field: "code" }, 403);
    const username = clean(b.username, 32), display = clean(b.display_name, 60) || username;
    const uErr = usernameProblem(username); if (uErr) return c.json({ error: uErr, field: "username" }, 400);
    const pErr = passwordProblem(b.password, username); if (pErr) return c.json({ error: pErr, field: "password" }, 400);
    const mode = b.mode === "household" ? "household" : "individual";
    const pw = await hashPassword(b.password as string);
    const id = crypto.randomUUID(), now = Date.now();
    // Only the very first account: the INSERT does nothing if another request made one meanwhile.
    const r = await c.env.DB.prepare(`INSERT INTO users (id, username, display_name, pass_hash, pass_salt, pass_iter, role, created_at, password_changed_at)
      SELECT ?, ?, ?, ?, ?, ?, 'owner', ?, ? WHERE NOT EXISTS (SELECT 1 FROM users)`).bind(id, username, display, pw.hash, pw.salt, pw.iter, now, now).run();
    if (!r.meta.changes) return c.json({ error: "This Seaglass is already set up. Sign in instead." }, 409);
    await saveHousehold(c.env.DB, { mode, name: mode === "household" ? clean(b.household_name, 60) : "" }).run();
    setCookie(c, COOKIE, await createSession(c.env.DB, id), cookieOptions(c.req.url));
    return c.json({ ok: true }, 201);
  });

  app.post("/api/login", async (c) => {
    const b = await body<{ username?: unknown; password?: unknown }>(c);
    const username = clean(b.username, 32), password = typeof b.password === "string" ? b.password : "";
    const wait = await loginLocked(c.env.DB, username);
    if (wait) return c.json({ error: `Too many wrong passwords. Try again in ${Math.max(1, Math.ceil((wait - Date.now()) / 60e3))} minute(s).` }, 429);
    const u = await c.env.DB.prepare("SELECT id, username, pass_hash, pass_salt, pass_iter FROM users WHERE username = ?").bind(username)
      .first<{ id: string; username: string; pass_hash: string; pass_salt: string; pass_iter: number }>();
    // Same work and the same answer whether or not the username exists.
    const ok = u ? await checkPassword(password, u) : (await hashPassword(password), false);
    if (!ok || !u) { if (username) await loginFailed(c.env.DB, username); return c.json({ error: "Wrong username or password." }, 401); }
    await loginOk(c.env.DB, username);
    setCookie(c, COOKIE, await createSession(c.env.DB, u.id), cookieOptions(c.req.url));
    return c.json({ ok: true });
  });

  app.post("/api/logout", async (c) => {
    await endSession(c.env.DB, getCookie(c, COOKIE));
    deleteCookie(c, COOKIE, { path: "/" });
    return c.json({ ok: true });
  });
}

/** Routes for the signed-in user (behind the sign-in check in index.ts). */
export function registerAccountRoutes(app: Hono<{ Bindings: Env }>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const me = (c: any) => currentUser(c.env as Env, c.req.url as string, getCookie(c, COOKIE));

  app.get("/api/account", async (c) => {
    const u = await me(c);
    if (!u) return c.json({ error: "unauthorized" }, 401);
    const members = (await c.env.DB.prepare("SELECT id, username, display_name, role FROM users ORDER BY created_at").all<User>()).results;
    return c.json({ user: publicUser(u), household: await household(c.env.DB), members });
  });

  app.patch("/api/account", async (c) => {
    const u = await me(c);
    if (!u) return c.json({ error: "unauthorized" }, 401);
    const name = clean((await body<{ display_name?: unknown }>(c)).display_name, 60);
    if (!name) return c.json({ error: "Type a name." }, 400);
    await c.env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?").bind(name, u.id).run();
    return c.json({ ok: true });
  });

  app.post("/api/account/password", async (c) => {
    const u = await me(c);
    if (!u) return c.json({ error: "unauthorized" }, 401);
    const b = await body<{ current?: unknown; next?: unknown }>(c);
    const row = await c.env.DB.prepare("SELECT pass_hash, pass_salt, pass_iter FROM users WHERE id = ?").bind(u.id).first<{ pass_hash: string; pass_salt: string; pass_iter: number }>();
    if (!row || typeof b.current !== "string" || !(await checkPassword(b.current, row))) return c.json({ error: "Your current password isn't right.", field: "current" }, 403);
    const err = passwordProblem(b.next, u.username); if (err) return c.json({ error: err, field: "next" }, 400);
    const pw = await hashPassword(b.next as string);
    await c.env.DB.prepare("UPDATE users SET pass_hash = ?, pass_salt = ?, pass_iter = ?, password_changed_at = ? WHERE id = ?").bind(pw.hash, pw.salt, pw.iter, Date.now(), u.id).run();
    await endOtherSessions(c.env.DB, u.id, getCookie(c, COOKIE));
    return c.json({ ok: true });
  });

  app.post("/api/account/sign-out-everywhere", async (c) => {
    const u = await me(c);
    if (!u) return c.json({ error: "unauthorized" }, 401);
    await endOtherSessions(c.env.DB, u.id, getCookie(c, COOKIE));
    return c.json({ ok: true });
  });

  // Individual or household, and the household's name. Only the owner can change it; going back to individual needs
  // everyone else to have left first (nothing is ever deleted by switching).
  app.put("/api/household", async (c) => {
    const u = await me(c);
    if (!u) return c.json({ error: "unauthorized" }, 401);
    if (u.role !== "owner") return c.json({ error: "Only the owner can change this." }, 403);
    const b = await body<{ mode?: unknown; name?: unknown }>(c);
    const cur = await household(c.env.DB);
    const mode = b.mode === "household" || b.mode === "individual" ? b.mode : cur.mode;
    if (mode === "individual" && (await userCount(c.env.DB)) > 1) return c.json({ error: "Everyone else needs to leave the household before it can be just you." }, 400);
    await saveHousehold(c.env.DB, { mode, name: b.name === undefined ? cur.name : clean(b.name, 60) }).run();
    return c.json({ ok: true, household: await household(c.env.DB) });
  });

  // Family members come with the next release, once every part of Seaglass keeps each person's things separate.
  app.post("/api/household/members", (c) => c.json({ error: "Adding family members arrives in Seaglass Open 0.2. Until then, this Seaglass has one account." }, 501));
}
