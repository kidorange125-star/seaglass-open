import type { Env } from "./env";

// Accounts (Seaglass Open): usernames and passwords. Passwords are stored only as salted PBKDF2-SHA256 hashes (WebCrypto;
// Cloudflare Workers allow at most 100,000 iterations). Signing in gives the browser an HttpOnly cookie holding a random
// token; the database keeps only that token's SHA-256, so a copy of the database can't be used to sign in. Sessions last
// 30 days from the last visit. Wrong passwords slow down: after 5 in a row the username waits, longer each time.
// The very first account is made by the setup screen (setup.ts).

export const COOKIE = "seaglass_session";
export const PBKDF2_ITER = 100_000;
const SESSION_DAYS = 30;
const enc = new TextEncoder();
const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...(b instanceof Uint8Array ? b : new Uint8Array(b)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

export const safeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

export async function hashPassword(password: string, salt: Uint8Array<ArrayBuffer> = crypto.getRandomValues(new Uint8Array(16)), iter = PBKDF2_ITER) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256);
  return { hash: b64(bits), salt: b64(salt), iter };
}

export async function checkPassword(password: string, u: { pass_hash: string; pass_salt: string; pass_iter: number }) {
  const { hash } = await hashPassword(password, fromB64(u.pass_salt), u.pass_iter);
  return safeEqual(hash, u.pass_hash);
}

/** What a password must be: long enough, and not containing the username. */
export function passwordProblem(password: unknown, username = "") {
  if (typeof password !== "string" || password.length < 10) return "Use at least 10 characters for the password.";
  if (password.length > 200) return "That password is too long.";
  if (username && password.toLowerCase().includes(username.toLowerCase())) return "Don't put your username in your password.";
  return null;
}
export function usernameProblem(username: unknown) {
  if (typeof username !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,31}$/.test(username)) return "Usernames are 3 to 32 letters, numbers, dots, dashes or underscores.";
  return null;
}

const sha = async (s: string) => b64(await crypto.subtle.digest("SHA-256", enc.encode(s)));

export type User = { id: string; username: string; display_name: string; role: string };

export async function createSession(db: D1Database, userId: string) {
  const token = b64(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  await db.prepare("INSERT INTO sessions (id, user_id, created_at, last_seen, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(await sha(token), userId, now, now, now + SESSION_DAYS * 864e5).run();
  return token;
}

export async function endSession(db: D1Database, token: string | undefined) {
  if (token) await db.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha(token)).run();
}

/** Ends every session of a user except (optionally) the one making the request. */
export async function endOtherSessions(db: D1Database, userId: string, keepToken?: string) {
  const keep = keepToken ? await sha(keepToken) : "";
  await db.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").bind(userId, keep).run();
}

/** The signed-in user for a session cookie, or null. Slides the session forward at most once a day. */
export async function sessionUser(db: D1Database, token: string | undefined): Promise<User | null> {
  if (!token || token.length > 100) return null;
  const id = await sha(token);
  const row = await db.prepare(`SELECT s.expires_at, s.last_seen, u.id, u.username, u.display_name, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`)
    .bind(id).first<User & { expires_at: number; last_seen: number }>();
  if (!row) return null;
  const now = Date.now();
  if (row.expires_at < now) { await db.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run(); return null; }
  if (now - row.last_seen > 864e5) await db.prepare("UPDATE sessions SET last_seen = ?, expires_at = ? WHERE id = ?").bind(now, now + SESSION_DAYS * 864e5, id).run();
  return { id: row.id, username: row.username, display_name: row.display_name, role: row.role };
}

export const isLocalHost = (host: string) => host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");

/** Local test suites only: AUTH_OPEN=1 in .dev.vars on a localhost address skips sign-in (as the first account). Ignored on
 *  any other address, so it can't open a deployed copy by mistake. */
export const devOpen = (env: Env, url: string) => env.AUTH_OPEN === "1" && isLocalHost(new URL(url).hostname);

export async function currentUser(env: Env, url: string, cookie: string | undefined): Promise<User | null> {
  const u = await sessionUser(env.DB, cookie);
  if (u || !devOpen(env, url)) return u;
  return (await env.DB.prepare("SELECT id, username, display_name, role FROM users ORDER BY created_at LIMIT 1").first<User>())
    ?? { id: "dev", username: "dev", display_name: "Dev", role: "owner" };
}

/** Sign-in throttling: 5 wrong passwords in a row lock the username for 1 minute, the next 5 for 5 minutes, then 15, then 60. */
const LOCKS = [60e3, 5 * 60e3, 15 * 60e3, 60 * 60e3];
export async function loginLocked(db: D1Database, username: string) {
  const r = await db.prepare("SELECT locked_until FROM login_attempts WHERE key = ?").bind(username.toLowerCase()).first<{ locked_until: number }>();
  return r && r.locked_until > Date.now() ? r.locked_until : 0;
}
export async function loginFailed(db: D1Database, username: string) {
  const key = username.toLowerCase(), now = Date.now();
  const r = await db.prepare("SELECT fails FROM login_attempts WHERE key = ?").bind(key).first<{ fails: number }>();
  const fails = (r?.fails ?? 0) + 1;
  const until = fails % 5 === 0 ? now + LOCKS[Math.min(LOCKS.length - 1, fails / 5 - 1)] : 0;
  await db.prepare("INSERT INTO login_attempts (key, fails, locked_until, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET fails = excluded.fails, locked_until = MAX(login_attempts.locked_until, excluded.locked_until), updated_at = excluded.updated_at")
    .bind(key, fails, until, now).run();
}
export async function loginOk(db: D1Database, username: string) {
  await db.prepare("DELETE FROM login_attempts WHERE key = ?").bind(username.toLowerCase()).run();
}

export const cookieOptions = (url: string) => ({
  httpOnly: true, sameSite: "Lax" as const, secure: url.startsWith("https"), path: "/", maxAge: SESSION_DAYS * 86400,
});
