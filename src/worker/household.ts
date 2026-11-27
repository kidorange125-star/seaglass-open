// Seaglass Open 0.2: family members. The owner invites someone with a one-time code (and a link holding it); joining
// with it makes their own account, and from then on their things are theirs alone (scope.ts). Roles: owner (can invite,
// change roles, remove members, run backups) and adult. Removing a member deletes their account and everything they had:
// pages, the assistant's conversation and memory, study history, settings, uploaded files and connected apps.
import type { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { Env } from "./env";
import {
  COOKIE, cookieOptions, createSession, currentUser, hashPassword, loginFailed, loginLocked, loginOk, passwordProblem, usernameProblem, type User,
} from "./auth";
import { household } from "./setup";
import { PERSONAL, asPerson } from "./scope";
import * as Usage from "./usage";

const DAY = 86_400_000;
const INVITE_DAYS = 7;
const ROLES = new Set(["owner", "adult", "kid"]);
// No 0/O, 1/I/L: a code read aloud or typed from a phone stays right. 12 of 32 symbols: 60 bits.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max) : "");
const normal = (code: unknown) => (typeof code === "string" ? code.toUpperCase().replace(/[^A-Z0-9]/g, "") : "");
async function hashCode(code: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`seaglass-invite:${code}`));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function newCode() {
  const r = crypto.getRandomValues(new Uint8Array(12));
  const s = [...r].map((b) => ALPHABET[b % ALPHABET.length]).join("");
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}
const publicUser = (u: User) => ({ id: u.id, username: u.username, display_name: u.display_name, role: u.role });
type Invite = { id: string; role: string; label: string; created_by: string; created_at: number; expires_at: number; used_by: string | null; used_at: number | null };
type C = { env: Env; req: { url: string; json: () => Promise<unknown>; header: (n: string) => string | undefined } };
const body = async <T,>(c: C) => (await c.req.json().catch(() => ({}))) as T;
const ipKey = (c: C) => `invite:${c.req.header("CF-Connecting-IP") ?? "local"}`;

/** An invite that can still be used, from its code. */
async function openInvite(db: D1Database, code: string) {
  if (normal(code).length !== 12) return null;
  const inv = await db.prepare("SELECT * FROM invites WHERE id = ?").bind(await hashCode(normal(code))).first<Invite>();
  return inv && !inv.used_at && inv.expires_at > Date.now() ? inv : null;
}

/** Deletes a member and everything that was theirs. The caller has checked who may do this. */
export async function removeMember(env: Env, id: string) {
  const db = asPerson(env, id).DB;
  // Their things, table by table, through their own scope (so nothing of anyone else's can be touched).
  await db.batch(PERSONAL.map((t) => db.prepare(`DELETE FROM ${t} WHERE owner_id = {owner}`)));
  // Their uploaded files and the text kept from them.
  let cursor: string | undefined;
  do {
    const page = await env.FILES.list({ cursor, include: ["customMetadata"], limit: 500 });
    const theirs = page.objects.filter((o) => o.customMetadata?.owner === id).map((o) => o.key);
    if (theirs.length) await env.FILES.delete([...theirs, ...theirs.map((k) => `filetext/${k}.md`)]);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  // Apps they connected over MCP.
  try {
    const grants = await env.OAUTH_PROVIDER?.listUserGrants(id);
    for (const g of grants?.items ?? []) await env.OAUTH_PROVIDER.revokeGrant(g.id, id);
  } catch (e) { console.error("couldn't revoke a removed member's apps", e); }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id),
    env.DB.prepare("DELETE FROM person_rules WHERE person_id = ?").bind(id),
    env.DB.prepare("UPDATE invites SET used_by = NULL WHERE used_by = ?").bind(id),
    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id),
  ]);
}

/** Joining with a code: reachable without an account (registered before the sign-in check). */
export function registerJoin(app: Hono<{ Bindings: Env }>) {
  // Is this code good? Says whose household it's for, so the person knows they're in the right place.
  app.post("/api/join/check", async (c) => {
    const key = ipKey(c);
    if (await loginLocked(c.env.DB, key)) return c.json({ error: "Too many wrong codes. Wait a few minutes and try again." }, 429);
    const inv = await openInvite(c.env.DB, (await body<{ code?: unknown }>(c)).code as string);
    if (!inv) { await loginFailed(c.env.DB, key); return c.json({ error: "That code isn't right, or it was already used or ran out. Ask for a new one." }, 404); }
    const h = await household(c.env.DB);
    const by = await c.env.DB.prepare("SELECT display_name FROM users WHERE id = ?").bind(inv.created_by).first<{ display_name: string }>();
    return c.json({ ok: true, household: h.name, invited_by: by?.display_name ?? "", label: inv.label });
  });

  app.post("/api/join", async (c) => {
    const key = ipKey(c);
    if (await loginLocked(c.env.DB, key)) return c.json({ error: "Too many wrong codes. Wait a few minutes and try again." }, 429);
    const b = await body<{ code?: unknown; display_name?: unknown; username?: unknown; password?: unknown }>(c);
    const inv = await openInvite(c.env.DB, b.code as string);
    if (!inv) { await loginFailed(c.env.DB, key); return c.json({ error: "That code isn't right, or it was already used or ran out. Ask for a new one.", field: "code" }, 404); }
    const username = clean(b.username, 32), display = clean(b.display_name, 60) || username;
    const uErr = usernameProblem(username); if (uErr) return c.json({ error: uErr, field: "username" }, 400);
    const pErr = passwordProblem(b.password, username); if (pErr) return c.json({ error: pErr, field: "password" }, 400);
    const pw = await hashPassword(b.password as string);
    const id = crypto.randomUUID(), now = Date.now();
    // Claim the invite first, so two people racing with one code can't both join.
    const claim = await c.env.DB.prepare("UPDATE invites SET used_by = ?, used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?").bind(id, now, inv.id, now).run();
    if (!claim.meta.changes) return c.json({ error: "That code was just used. Ask for a new one.", field: "code" }, 409);
    const r = await c.env.DB.prepare(`INSERT INTO users (id, username, display_name, pass_hash, pass_salt, pass_iter, role, created_at, password_changed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, username, display, pw.hash, pw.salt, pw.iter, ROLES.has(inv.role) ? inv.role : "adult", now, now).run().catch(() => null);
    if (!r) {
      await c.env.DB.prepare("UPDATE invites SET used_by = NULL, used_at = NULL WHERE id = ?").bind(inv.id).run();
      return c.json({ error: "That username is taken. Pick another.", field: "username" }, 409);
    }
    await loginOk(c.env.DB, key);
    setCookie(c as never, COOKIE, await createSession(c.env.DB, id), cookieOptions(c.req.url));
    return c.json({ ok: true, user: { id, username, display_name: display, role: inv.role } }, 201);
  });
}

/** The owner's household controls (behind the sign-in check). */
export function registerHousehold(app: Hono<{ Bindings: Env }>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const owner = async (c: any): Promise<User | Response> => {
    const u = await currentUser(c.env as Env, c.req.url as string, getCookie(c, COOKIE));
    if (!u) return c.json({ error: "unauthorized" }, 401);
    if (u.role !== "owner") return c.json({ error: "Only the household's owner can do this." }, 403);
    return u;
  };

  app.get("/api/household/invites", async (c) => {
    const u = await owner(c); if (u instanceof Response) return u;
    const rows = (await c.env.DB.prepare("SELECT id, role, label, created_at, expires_at FROM invites WHERE used_at IS NULL AND expires_at > ? ORDER BY created_at DESC").bind(Date.now()).all<Invite>()).results;
    return c.json(rows.map((r) => ({ id: r.id.slice(0, 16), role: r.role, label: r.label, created_at: r.created_at, expires_at: r.expires_at })));
  });

  // A new invite. The code is shown once, here; only its hash is kept.
  app.post("/api/household/invites", async (c) => {
    const u = await owner(c); if (u instanceof Response) return u;
    if ((await household(c.env.DB)).mode !== "household") return c.json({ error: "Switch this Seaglass to a household first (above)." }, 400);
    const b = await body<{ role?: unknown; label?: unknown }>(c);
    const role = b.role === "owner" || b.role === "kid" ? b.role : "adult";
    const open = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM invites WHERE used_at IS NULL AND expires_at > ?").bind(Date.now()).first<{ n: number }>();
    if ((open?.n ?? 0) >= 20) return c.json({ error: "There are 20 invites waiting. Cancel some first." }, 400);
    const code = newCode(), now = Date.now();
    await c.env.DB.prepare("INSERT INTO invites (id, role, label, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(await hashCode(normal(code)), role, clean(b.label, 60), u.id, now, now + INVITE_DAYS * DAY).run();
    const base = (c.env.PUBLIC_URL || new URL(c.req.url).origin).replace(/\/+$/, "");
    return c.json({ code, link: `${base}/#/join/${code}`, role, expires_at: now + INVITE_DAYS * DAY }, 201);
  });

  app.delete("/api/household/invites/:id", async (c) => {
    const u = await owner(c); if (u instanceof Response) return u;
    const id = c.req.param("id");
    if (!/^[0-9a-f]{16}$/.test(id)) return c.json({ error: "not found" }, 404);
    await c.env.DB.prepare("DELETE FROM invites WHERE substr(id, 1, 16) = ? AND used_at IS NULL").bind(id).run();
    return c.json({ ok: true });
  });

  // Make someone an owner or an adult. There's always at least one owner.
  app.patch("/api/household/members/:id", async (c) => {
    const u = await owner(c); if (u instanceof Response) return u;
    const role = (await body<{ role?: unknown }>(c)).role;
    if (typeof role !== "string" || !ROLES.has(role)) return c.json({ error: "Pick owner, adult or kid." }, 400);
    const id = c.req.param("id");
    const m = await c.env.DB.prepare("SELECT id, role FROM users WHERE id = ?").bind(id).first<{ id: string; role: string }>();
    if (!m) return c.json({ error: "not found" }, 404);
    if (m.role === "owner" && role !== "owner") {
      const owners = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner'").first<{ n: number }>();
      if ((owners?.n ?? 0) <= 1) return c.json({ error: "Someone has to stay the owner. Make someone else an owner first." }, 400);
    }
    await c.env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, id).run();
    return c.json({ ok: true });
  });

  // Remove a member (the owner), or leave (anyone but the last owner). Their things are deleted for good.
  app.delete("/api/household/members/:id", async (c) => {
    const u = await currentUser(c.env, c.req.url, getCookie(c, COOKIE));
    if (!u) return c.json({ error: "unauthorized" }, 401);
    const id = c.req.param("id");
    if (id !== u.id && u.role !== "owner") return c.json({ error: "Only the household's owner can do this." }, 403);
    // A kid can't delete their own account (and everything in it); a parent can.
    if (id === u.id && u.role === "kid") return c.json({ error: "Ask a parent (the household's owner) to do this." }, 403);
    const m = await c.env.DB.prepare("SELECT id, username, role FROM users WHERE id = ?").bind(id).first<{ id: string; username: string; role: string }>();
    if (!m) return c.json({ error: "not found" }, 404);
    // Typing their username is the confirmation: the server checks it too, so a stray request can't delete someone.
    if (clean((await body<{ confirm?: unknown }>(c)).confirm, 64).toLowerCase() !== m.username.toLowerCase()) return c.json({ error: "Type the username to confirm.", field: "confirm" }, 400);
    if (m.role === "owner") {
      const owners = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner'").first<{ n: number }>();
      if ((owners?.n ?? 0) <= 1) return c.json({ error: "The only owner can't be removed. Make someone else an owner first." }, 400);
    }
    await removeMember(c.env, id);
    return c.json({ ok: true, left: id === u.id });
  });

  // A forgotten password: an owner sets a new one for an adult or kid (never another owner), and their devices sign out.
  app.post("/api/household/members/:id/password", async (c) => {
    const u = await owner(c); if (u instanceof Response) return u;
    const id = c.req.param("id");
    const m = await c.env.DB.prepare("SELECT id, username, role FROM users WHERE id = ?").bind(id).first<{ id: string; username: string; role: string }>();
    if (!m) return c.json({ error: "not found" }, 404);
    if (m.role === "owner" || m.id === u.id) return c.json({ error: "Owners change their own password in their account settings." }, 403);
    const password = (await body<{ password?: unknown }>(c)).password;
    const err = passwordProblem(password, m.username); if (err) return c.json({ error: err, field: "password" }, 400);
    const pw = await hashPassword(password as string);
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE users SET pass_hash = ?, pass_salt = ?, pass_iter = ?, password_changed_at = ? WHERE id = ?").bind(pw.hash, pw.salt, pw.iter, Date.now(), id),
      c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id),
    ]);
    return c.json({ ok: true });
  });

  app.get("/api/household/usage", async (c) => {
    const u = await owner(c); if (u instanceof Response) return u;
    return c.json(await Usage.household(c.env.DB));
  });
  // An owner sets someone's limits and rules; "household" is the whole household's monthly limit.
  app.put("/api/household/rules/:id", async (c) => {
    const u = await owner(c); if (u instanceof Response) return u;
    const id = c.req.param("id") === "household" ? "" : c.req.param("id");
    if (id && !(await c.env.DB.prepare("SELECT 1 FROM users WHERE id = ?").bind(id).first())) return c.json({ error: "not found" }, 404);
    try { return c.json(await Usage.setRules(c.env.DB, id, await body<Record<string, unknown>>(c))); }
    catch (e) { return c.json({ error: (e as Error).message }, 400); }
  });

  app.get("/api/household/members", async (c) => {
    const u = await currentUser(c.env, c.req.url, getCookie(c, COOKIE));
    if (!u) return c.json({ error: "unauthorized" }, 401);
    const members = (await c.env.DB.prepare("SELECT id, username, display_name, role FROM users ORDER BY created_at").all<User>()).results;
    return c.json(members.map(publicUser));
  });
}
