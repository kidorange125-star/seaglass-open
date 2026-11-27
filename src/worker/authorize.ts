import type { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { AuthorizationError, CimdFetchError, type ConsentDescription } from "@cloudflare/workers-oauth-provider";
import { COOKIE, checkPassword, cookieOptions, createSession, currentUser, hashPassword, loginFailed, loginLocked, loginOk } from "./auth";
import type { Env } from "./env";

// ---------------------------------------------------------------------------------------------
// OAuth consent for MCP clients (claude.ai, Claude Desktop, Claude mobile). The OAuth provider
// library validates the request; this page signs the user in (username and password) and asks whether the client may
// act for them. The grant belongs to that account.
// ---------------------------------------------------------------------------------------------

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function shell(title: string, inner: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>
:root{color-scheme:light dark;--bg:#f3f8f7;--card:#fff;--ink:#15312f;--muted:#6f8e8b;--line:#dbe8e5;--accent:#12998b;--danger:#cf4338}
@media(prefers-color-scheme:dark){:root{--bg:#0a1a1c;--card:#112a2d;--ink:#e2f1ef;--muted:#86aaa6;--line:#1d3d41;--accent:#3fcfbf;--danger:#ff7b6f}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:15.5px/1.55 -apple-system,"Segoe UI",system-ui,sans-serif;padding:20px}
.card{width:min(440px,100%);background:var(--card);border:1px solid var(--line);border-radius:20px;padding:28px;box-shadow:0 18px 44px rgba(15,50,48,.16)}
.brand{display:flex;align-items:center;gap:10px;font-weight:650;font-size:17px;margin-bottom:18px}
.logo{width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,#4fe0cf,#0d8478)}
h1{font-size:21px;line-height:1.3;margin:0 0 10px}p{margin:0 0 12px;color:var(--muted)}strong{color:var(--ink)}
.warn{background:rgba(224,162,28,.14);border-radius:10px;padding:10px 12px;color:var(--ink)}
ul{margin:4px 0 16px;padding-left:20px}input[type=password],input[type=text]{width:100%;padding:11px 12px;border-radius:10px;border:1px solid var(--line);background:transparent;color:inherit;font:inherit;margin:4px 0 12px}
.row{display:flex;gap:10px}button{flex:1;font:inherit;font-weight:600;padding:11px;border-radius:11px;border:1px solid var(--line);background:transparent;color:inherit;cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}.err{color:var(--danger)}
a.button{display:block;text-align:center;text-decoration:none;font-weight:600;padding:11px;border-radius:11px;background:var(--accent);color:#fff}
form.sent button{opacity:.55;cursor:default}
</style></head><body><main class="card"><div class="brand"><span class="logo"></span>Seaglass</div>${inner}</main>
<script>
// Each consent can be used once. While Claude's page loads after "Allow", this page stays
// clickable; a second click would arrive after the one-time cookie is spent and fail. Ignore it.
document.querySelectorAll("form").forEach(function (f) {
  f.addEventListener("submit", function (e) {
    if (f.classList.contains("sent")) { e.preventDefault(); return; }
    f.classList.add("sent");
  });
});
// Coming back to this page with the Back button shows a spent form; reload it instead.
addEventListener("pageshow", function (e) { if (e.persisted) location.reload(); });
</script></body></html>`;
}

/** Only ever link back to our own /authorize request, never elsewhere. */
const restartPath = (v: unknown) => {
  const s = String(v ?? "");
  return s.startsWith("/authorize?") && !s.includes("//") ? s : "";
};

function consentPage(d: ConsentDescription, handle: string, restart: string) {
  const name = esc(d.clientName || "An app");
  const origin = d.clientDomain ? `Published by <strong>${esc(d.clientDomain)}</strong>.` : "This app registered itself, so its name isn't verified.";
  return shell(`Allow ${d.clientName || "this app"}?`, `
<h1>Allow ${name} to use your notes?</h1>
<p>${origin} Access goes to <strong>${esc(d.redirectHost)}</strong>.</p>
${d.redirectIsLoopback ? '<p class="warn">This sends access to an app on your computer. Continue only if you just started connecting from it.</p>' : ""}
<p>It will be able to <strong>read, create, edit and move pages to the trash</strong>, with no confirmation prompts. Every change can be undone from Seaglass with <strong>/undo</strong>, and locked pages stay protected.</p>
<form method="post" action="/authorize">
  <input type="hidden" name="handle" value="${esc(handle)}">
  <input type="hidden" name="restart" value="${esc(restart)}">
  <div class="row"><button name="decision" value="deny">Deny</button><button class="primary" name="decision" value="approve">Allow</button></div>
</form>`);
}

function signInPage(next: string, error = "") {
  return shell("Sign in to Seaglass", `
<h1>Sign in to connect</h1>
<p>An app wants to connect to your notes. Sign in to Seaglass first.</p>
${error ? `<p class="err">${esc(error)}</p>` : ""}
<form method="post" action="/authorize/sign-in">
  <input type="hidden" name="next" value="${esc(next)}">
  <input type="text" name="username" placeholder="Username" autofocus autocomplete="username" autocapitalize="none" spellcheck="false">
  <input type="password" name="password" placeholder="Password" autocomplete="current-password">
  <div class="row"><button class="primary">Continue</button></div>
</form>`);
}

// With a restart path (the original /authorize request), the error offers a fresh attempt: the
// client's request is still valid, only this browser's one-time consent was spent or expired.
const errorPage = (message: string, restart = "") => new Response(shell("Can't connect", `<h1>That didn't work</h1><p>${esc(message)}</p>${
  restart ? `<p>Start again and click Allow once.</p><a class="button" href="${esc(restart)}">Start again</a>` : "<p>Go back to the app and try connecting again.</p>"}`),
  { status: 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });

function handleError(e: unknown, restart = ""): Response {
  if (e instanceof AuthorizationError && e.redirectTo) return Response.redirect(e.redirectTo, 302);
  if (e instanceof AuthorizationError) return errorPage(e.description || "This sign-in request is invalid or has expired.", restart);
  if (e instanceof CimdFetchError) return errorPage("This app could not be verified.");
  throw e;
}

export function registerAuthorize(app: Hono<{ Bindings: Env }>) {
  app.get("/authorize", async (c) => {
    if (!(await currentUser(c.env, c.req.url, getCookie(c, COOKIE)))) {
      const url = new URL(c.req.url);
      return c.html(signInPage(url.pathname + url.search));
    }
    try {
      const oauth = c.env.OAUTH_PROVIDER;
      const request = await oauth.parseAuthRequest(c.req.raw);
      const details = await oauth.describeConsent(request); // first: a failed lookup leaves nothing stored
      const consent = await oauth.beginConsent(request);
      consent.headers.set("Content-Type", "text/html; charset=utf-8");
      const url = new URL(c.req.url);
      return new Response(consentPage(details, consent.handle, restartPath(url.pathname + url.search)), { headers: consent.headers });
    } catch (e) { return handleError(e); }
  });

  app.post("/authorize/sign-in", async (c) => {
    const form = await c.req.formData();
    const next = String(form.get("next") ?? "");
    // Only ever send the browser back to our own /authorize request, never elsewhere.
    const safeNext = next.startsWith("/authorize?") ? next : "/authorize";
    const username = String(form.get("username") ?? "").trim().slice(0, 32), password = String(form.get("password") ?? "");
    const wait = await loginLocked(c.env.DB, username);
    if (wait) return c.html(signInPage(safeNext, "Too many wrong passwords. Try again in a few minutes."), 429);
    const u = await c.env.DB.prepare("SELECT id, pass_hash, pass_salt, pass_iter FROM users WHERE username = ?").bind(username)
      .first<{ id: string; pass_hash: string; pass_salt: string; pass_iter: number }>();
    const ok = u ? await checkPassword(password, u) : (await hashPassword(password), false);
    if (!ok || !u) { if (username) await loginFailed(c.env.DB, username); return c.html(signInPage(safeNext, "Wrong username or password."), 401); }
    await loginOk(c.env.DB, username);
    setCookie(c, COOKIE, await createSession(c.env.DB, u.id), cookieOptions(c.req.url));
    return c.redirect(safeNext, 302);
  });

  app.post("/authorize", async (c) => {
    const form = await c.req.formData();
    const restart = restartPath(form.get("restart"));
    const user = await currentUser(c.env, c.req.url, getCookie(c, COOKIE));
    if (!user) return errorPage("Your session expired.", restart);
    try {
      const oauth = c.env.OAUTH_PROVIDER;
      const handle = String(form.get("handle") ?? "");
      if (form.get("decision") !== "approve") {
        const denied = await oauth.denyConsent(c.req.raw, handle);
        return new Response(null, { status: 302, headers: denied.headers });
      }
      const approved = await oauth.approveConsent(c.req.raw, handle, { scope: approvedScopes(approvedRequestScopes(form)) });
      const { redirectTo } = await oauth.completeAuthorization({
        request: approved.request,
        userId: user.id,
        metadata: {},
        scope: approved.request.scope,
        props: { via: "oauth", user: user.id },
      });
      approved.headers.set("Location", redirectTo);
      return new Response(null, { status: 302, headers: approved.headers });
    } catch (e) { return handleError(e, restart); }
  });
}

// The only scope this server has is "notes" (full access, as the user asked for). Grant it whatever the client asked for.
const approvedRequestScopes = (_form: FormData) => ["notes"];
const approvedScopes = (s: string[]) => s;
