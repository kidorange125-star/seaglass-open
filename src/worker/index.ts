import { Hono } from "hono";
import * as M from "./memory";
import * as Push from "./push";
import * as AI from "./ai";
import * as Coach from "./coach";
import * as Misses from "./misses";
import * as Backup from "./backup";
import * as Steps from "./steps";
import * as Tidy from "./tidy";
import * as Daily from "./daily";
import * as Hub from "./hub";
import * as Syllabus from "./syllabus";
import * as Lecture from "./lecture";
import { localNow } from "./reminders";
import { cleanChange } from "../client/study/generated";
import * as Sem from "./semantic";
import { isState } from "../client/study/srs";
import * as Study from "./study";
import * as Voice from "./voice";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import * as N from "./notes";
import { isHidden } from "./hidden";
import type { Env } from "./env";
import { COOKIE, currentUser, devOpen } from "./auth";
import { registerAccounts, registerAccountRoutes, userCount } from "./setup";
import * as Approvals from "./approvals";
import { MODEL, MODELS, runAgent, ToolError, type AgentEvent } from "./agent";
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import * as Vault from "./vault";
import * as Seal from "./seal";
import * as Suggest from "./suggest";
import * as Pro from "./proactive";
import * as Thread from "./thread";
import { handleMcp } from "./mcp";
import { agentCtx } from "./identity";
import { registerAuthorize } from "./authorize";
import { authMode, claudeClient, issuerUrl, openidConfiguration, publicJwks, wifMissing } from "./claude-auth";

type HEnv = { Bindings: Env };
const app = new Hono<HEnv>();

// Setup, sign-in and sign-out (setup.ts): reachable without an account.
registerAccounts(app);

app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/session" || c.req.path === "/api/login" || c.req.path === "/api/logout" || c.req.path === "/api/setup") return next();
  // Quick capture has its own revocable token (it can only add a task or an Inbox line), checked in the handler.
  if (c.req.path === "/api/capture" && c.req.method === "POST" && (c.req.header("Authorization") ?? "").includes("sgc_")) return next();
  if (!(await currentUser(c.env, c.req.url, getCookie(c, COOKIE)))) return c.json({ error: "unauthorized" }, 401);
  return next();
});

// The signed-in account: name, password, household (setup.ts).
registerAccountRoutes(app);

app.onError((e, c) => {
  if (e instanceof N.ConflictError) return c.json({ error: "conflict", current: e.current }, 409);
  if (e instanceof N.LockedError) return c.json({ error: "page is locked" }, 423);
  if (e instanceof N.HiddenError) return c.json({ error: HIDDEN_MSG }, 403);
  if (e instanceof N.BadRequest) return c.json({ error: e.message }, 400);
  console.error(e);
  return c.json({ error: "server error" }, 500);
});

const ctx = (): N.Ctx => ({ source: "user", runId: crypto.randomUUID() });
const body = <T = Record<string, unknown>>(c: { req: { json: () => Promise<unknown> } }) => c.req.json().catch(() => ({})) as Promise<T>;
const notFound = (c: { json: (o: unknown, s: 404) => Response }) => c.json({ error: "not found" }, 404);

// ---------------------------------------------------------------- notes

app.get("/api/tree", async (c) => c.json(await N.listTree(c.env.DB)));
app.post("/api/grades/ensure", async (c) => c.json(await N.ensureGradesDb(c.env.DB, ctx())));
app.post("/api/calendar/ensure", async (c) => c.json(await N.ensureEventsDb(c.env.DB, ctx())));
app.post("/api/tasks/ensure", async (c) => c.json(await N.ensureTasksDb(c.env.DB, ctx(), String((await body<{ today?: string }>(c)).today ?? ""))));
// Lightweight multi-device sync: clients poll for notes changed since the last server timestamp.
app.get("/api/changes", async (c) => {
  const now = Date.now();
  const since = Number(c.req.query("since"));
  if (!Number.isFinite(since) || since <= 0) return c.json({ now, changes: [] });
  const r = await c.env.DB.prepare("SELECT id, revision, updated_at, deleted_at FROM notes WHERE updated_at > ? ORDER BY updated_at LIMIT 500").bind(since).all();
  return c.json({ now, changes: r.results });
});
app.get("/api/recent", async (c) => c.json(await N.recentNotes(c.env.DB)));
app.get("/api/home", async (c) => c.json(await N.homeData(c.env.DB)));
app.get("/api/search", async (c) => c.json(await N.searchNotes(c.env.DB, c.req.query("q") ?? "")));

// ---- Quick capture, voice notes, search by meaning (src/worker/semantic.ts, migration 0006).
app.post("/api/capture", async (c) => {
  const auth = c.req.header("Authorization") ?? "";
  if (auth.includes("sgc_") && !(await Sem.checkCaptureToken(c.env.DB, auth.replace(/^Bearer\s+/i, "").trim()))) return c.json({ error: "unauthorized" }, 401);
  const len = Number(c.req.header("Content-Length") ?? 0);
  if (len > 100_000) return c.json({ error: "too large" }, 413);
  const type = (c.req.header("Content-Type") ?? "").toLowerCase();
  const b = type.includes("json") ? await body(c) : type.includes("form") ? Object.fromEntries(await c.req.formData().then((f) => [...f.entries()].map(([k, v]) => [k, String(v)]))) : { text: await c.req.text() };
  return c.json(await Sem.capture(c.env, b as Record<string, unknown>), 201);
});
// Automatic backups (#15): nightly, kept 14, each checked after it's written. The download is the backup opened (sealed
// columns stay sealed), for scripts/restore-backup.mjs.
app.get("/api/backups", async (c) => c.json({ status: await Backup.status(c.env.DB), backups: await Backup.list(c.env), keep: Backup.KEEP }));
app.post("/api/backups", async (c) => { const s = await Backup.run(c.env); return c.json(s, s.ok ? 200 : 500); });
app.get("/api/backups/:name", async (c) => {
  const name = c.req.param("name");
  if (!Backup.validName(name)) return c.json({ error: "not found" }, 404);
  const d = await Backup.load(c.env, name);
  if (!d) return c.json({ error: "not found" }, 404);
  c.header("Content-Disposition", `attachment; filename="seaglass-database-${name.replace(/\.sgb$/, "")}.json"`);
  c.header("Cache-Control", "no-store");
  return c.json(d);
});
app.get("/api/capture/status", async (c) => c.json({ enabled: await Sem.captureEnabled(c.env.DB) }));
app.post("/api/capture/token", async (c) => c.json({ token: await Sem.makeCaptureToken(c.env.DB) }));
app.delete("/api/capture/token", async (c) => { await Sem.revokeCaptureToken(c.env.DB); return c.json({ ok: true }); });
// One sentence of a spoken reply (live voice). 501 tells the app to use the device's own voice.
app.post("/api/voice/speak", async (c) => {
  if (!Voice.voiceProvider(c.env)) return c.json({ error: "no_voice" }, 501);
  const b = await body<{ text?: unknown }>(c);
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!text || text.length > Voice.MAX_SPEAK_CHARS) return c.json({ error: "bad text" }, 400);
  try { return await Voice.speak(c.env, text); }
  catch (e) {
    if (e instanceof Voice.VoiceError) return c.json({ error: e.message }, 502);
    console.error("voice failed");
    return c.json({ error: "The voice service can't be reached." }, 502);
  }
});
// Temporary diagnostics for live voice: technical facts only (see client/voice/trace.ts).
app.post("/api/voice/trace", async (c) => {
  const b = await body<{ e?: unknown; d?: unknown }>(c);
  const event = String(b.e ?? "").slice(0, 40), line = `${new Date().toISOString().slice(11, 23)} ${event} ${String(b.d ?? "").slice(0, 200)}\n`;
  await c.env.DB.prepare("INSERT INTO prefs (key, value) VALUES ('voice_trace', ?1) ON CONFLICT(key) DO UPDATE SET value = substr(value || excluded.value, -30000)").bind(line).run();
  return c.body(null, 204);
});
// Live voice where the device can't tell when the user stops talking: the recording so far in, the words and the quiet time since out.
// Nothing is stored.
app.post("/api/voice/hear", async (c) => {
  const type = (c.req.header("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
  if (!/^audio\/(webm|mp4|mpeg|wav|ogg|x-m4a|aac|m4a)$/.test(type)) return c.json({ error: `unsupported audio type: ${type || "unknown"}` }, 415);
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength < 800) return c.json({ text: "", duration: 0, quiet: 0 });
  if (buf.byteLength > 4 * 1024 * 1024) return c.json({ error: "too long" }, 413);
  if (!Sem.aiAvailable(c.env)) return c.json({ error: "Live voice needs Workers AI here, which isn't available" }, 503);
  const lang = /^[a-z]{2}$/.test(c.req.query("lang") ?? "") ? c.req.query("lang") : undefined;
  try { return c.json(await Sem.hear(c.env, buf, lang)); }
  catch (e) { console.error("hear failed", (e as Error).message); return c.json({ error: "Couldn't listen just then." }, 503); }
});
app.post("/api/ai/transcribe", async (c) => {
  const type = (c.req.header("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
  if (!/^audio\/(webm|mp4|mpeg|wav|ogg|x-m4a|aac|m4a)$/.test(type)) return c.json({ error: `unsupported audio type: ${type || "unknown"}` }, 415);
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength < 800) return c.json({ error: "that recording is empty" }, 400);
  if (buf.byteLength > 12 * 1024 * 1024) return c.json({ error: "that recording is too long (about 10 minutes at most)" }, 413);
  if (!Sem.aiAvailable(c.env)) return c.json({ error: "Voice notes need Workers AI, which isn't available here" }, 503);
  const key = `${crypto.randomUUID()}/voice-note.${type.includes("webm") ? "webm" : type.includes("ogg") ? "ogg" : type.includes("wav") ? "wav" : type.includes("mpeg") ? "mp3" : "m4a"}`;
  try {
    const text = await Sem.transcribe(c.env, buf);
    await putFile(c.env, key, buf, type);
    return c.json({ text, url: `/files/${key}`, size: buf.byteLength });
  } catch (e) { console.error("transcribe", e); return c.json({ error: "Couldn't transcribe that recording. Try again." }, 503); }
});
app.post("/api/search/meaning", async (c) => {
  const b = await body<{ query?: unknown; limit?: unknown }>(c);
  const q = String(b.query ?? "").trim();
  if (!q) return c.json({ error: "empty query" }, 400);
  if (!Sem.aiAvailable(c.env)) return c.json({ error: "Search by meaning needs Workers AI, which isn't available here" }, 503);
  try { return c.json(await Sem.searchByMeaning(c.env, q, Math.max(1, Math.min(15, Number(b.limit) || 6)))); } catch (e) { console.error("semantic", e); return c.json({ error: "Search by meaning failed. Try again." }, 503); }
});

// ---- One-shot Claude features (src/worker/ai.ts): Ask Waffle on selected text, photo to notes, practice tests.
const HIDDEN_MSG = "This page is hidden from AI. Turn off \"Hide from AI\" in the page's ••• menu to use AI on it.";
const aiError = (c: { json: (o: unknown, s: 400 | 403 | 503) => Response }, e: unknown) => {
  if (e instanceof ToolError) return c.json({ error: e.message }, 400);
  if (e instanceof N.HiddenError) return c.json({ error: HIDDEN_MSG }, 403);
  const msg = String((e as Error)?.message ?? e);
  console.error("ai", e);
  return c.json({ error: /429|rate/i.test(msg) ? "Rate limited by the API. Try again in a moment." : `Claude hit an error: ${msg.slice(0, 160)}` }, 503);
};
app.post("/api/ai/selection", async (c) => {
  const b = await body<{ action?: unknown; html?: unknown; model?: unknown; page_id?: unknown }>(c);
  if (typeof b.page_id === "string" && (await isHidden(c.env.DB, b.page_id))) return c.json({ error: HIDDEN_MSG }, 403);
  const html = String(b.html ?? "");
  if (!html.trim()) return c.json({ error: "nothing selected" }, 400);
  if (html.length > 30_000) return c.json({ error: "That selection is too long (select less)" }, 413);
  try { return c.json(await AI.rewriteSelection(c.env, String(b.action ?? ""), html, b.model)); } catch (e) { return aiError(c, e); }
});
app.post("/api/ai/write", async (c) => {
  const b = await body<{ instruction?: unknown; title?: unknown; before?: unknown; after?: unknown; model?: unknown; page_id?: unknown }>(c);
  if (typeof b.page_id === "string" && (await isHidden(c.env.DB, b.page_id))) return c.json({ error: HIDDEN_MSG }, 403);
  const instruction = String(b.instruction ?? "").slice(0, 2000), before = String(b.before ?? ""), after = String(b.after ?? "");
  if (!instruction.trim() && !before.trim()) return c.json({ error: "Tell Waffle what to write, or put some text on the page first so Waffle can continue it." }, 400);
  try { return c.json(await AI.writeForPage(c.env, { instruction, title: String(b.title ?? ""), before, after, model: b.model })); } catch (e) { return aiError(c, e); }
});
app.post("/api/ai/photo", async (c) => {
  const b = await body<{ image?: unknown; media_type?: unknown; parent_id?: unknown; flashcards?: unknown; model?: unknown }>(c);
  const parent = typeof b.parent_id === "string" && /^[0-9a-f-]{36}$/.test(b.parent_id) ? b.parent_id : null;
  try { return c.json(await AI.photoToNotes(c.env, { image: String(b.image ?? ""), mediaType: String(b.media_type ?? ""), parentId: parent, flashcards: b.flashcards === true, model: b.model })); } catch (e) { return aiError(c, e); }
});
app.post("/api/ai/quiz", async (c) => {
  const b = await body<{ ids?: unknown; count?: unknown; model?: unknown }>(c);
  const ids = (Array.isArray(b.ids) ? b.ids : []).filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/.test(x));
  if (!ids.length) return c.json({ error: "pick a page" }, 400);
  try { return c.json(await AI.makeQuiz(c.env, { ids, count: Number(b.count) || 8, model: b.model })); } catch (e) { return aiError(c, e); }
});
// Explain it: ideas to explain from the notes, then their explanation checked against their key points.
const pageIds = (v: unknown) => (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/.test(x)).slice(0, 20);
app.post("/api/ai/explain", async (c) => {
  const b = await body<{ ids?: unknown; count?: unknown; model?: unknown }>(c);
  const ids = pageIds(b.ids);
  if (!ids.length) return c.json({ error: "pick a page" }, 400);
  try { return c.json(await AI.explainPrompts(c.env, { ids, count: Number(b.count) || 4, model: b.model })); } catch (e) { return aiError(c, e); }
});
app.post("/api/ai/explain/check", async (c) => {
  const b = await body<{ ids?: unknown; q?: unknown; points?: unknown; answer?: unknown; model?: unknown }>(c);
  const ids = pageIds(b.ids), q = typeof b.q === "string" ? b.q.trim() : "", answer = typeof b.answer === "string" ? b.answer.trim() : "";
  const points = (Array.isArray(b.points) ? b.points : []).filter((x): x is string => typeof x === "string" && !!x.trim());
  if (!ids.length || !q || !points.length) return c.json({ error: "nothing to check against" }, 400);
  if (!answer) return c.json({ error: "Write your explanation first." }, 400);
  try { return c.json(await AI.checkExplain(c.env, { ids, q, points, answer, model: b.model })); } catch (e) { return aiError(c, e); }
});
const STUDY_MODES = ["quiz", "blanks", "match"] as const;
app.post("/api/ai/study-set", async (c) => {
  const b = await body<{ ids?: unknown; mode?: unknown; fresh?: unknown; change?: unknown; model?: unknown }>(c);
  const ids = (Array.isArray(b.ids) ? b.ids : []).filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/.test(x));
  const mode = STUDY_MODES.find((m) => m === b.mode);
  if (!ids.length || !mode) return c.json({ error: "pick a page and a game" }, 400);
  try { return c.json(await AI.studySet(c.env, { ids, mode, fresh: b.fresh === true, change: cleanChange(b.change), model: b.model })); } catch (e) { return aiError(c, e); }
});
// A finished study session: saved, and (unless coach is false) what the assistant says about it, with next steps.
app.post("/api/study/session", async (c) => {
  const b = await body<{ session?: unknown; coach?: unknown }>(c);
  try { return c.json(await Coach.finishSession(c.env, b.session, await Suggest.userTz(c.env.DB), b.coach !== false)); }
  catch (e) { if (e instanceof Coach.BadSession) return c.json({ error: e.message }, 400); throw e; }
});
// Daily notes (#19): today's page (made on first open), one day's page if there is one, and the wrap-up on demand.
app.post("/api/daily", async (c) => c.json(await Daily.day(c.env.DB, String((await body<{ date?: unknown }>(c)).date ?? ""))));
app.get("/api/daily/:date", async (c) => { const n = await Daily.findDay(c.env.DB, c.req.param("date")); return c.json(n ? { id: n.id, title: n.title } : null); });
app.post("/api/daily/:id/wrapup", async (c) => { try { return c.json(await Daily.writeWrapUp(c.env, c.req.param("id"), String((await body<{ date?: unknown }>(c)).date ?? ""))); } catch (e) { return aiError(c, e); } });
// The weekly tidy-up (#25), now: a proposal in the conversation if there's anything to tidy.
app.post("/api/tidy", async (c) => { try { return c.json({ proposed: await Tidy.propose(c.env) }); } catch (e) { return aiError(c, e); } });
// Break an assignment into steps (#20): a draft to look over, then the kept steps as linked tasks; and the steps of one.
app.post("/api/tasks/:id/steps/draft", async (c) => { try { return c.json(await Steps.draft(c.env, c.req.param("id"), (await body<{ model?: unknown }>(c)).model)); } catch (e) { return aiError(c, e); } });
app.post("/api/tasks/:id/steps", async (c) => { try { return c.json(await Steps.add(c.env, c.req.param("id"), (await body<{ steps?: unknown }>(c)).steps)); } catch (e) { return aiError(c, e); } });
app.get("/api/tasks/:id/steps", async (c) => c.json({ steps: await Steps.list(c.env.DB, c.req.param("id")) }));
// Lectures into study material (#12): the recording's transcript (sent in pieces as it went) into notes under a subject.
app.post("/api/ai/lecture", async (c) => {
  const b = await body<{ transcript?: unknown; title?: unknown; subject_id?: unknown; minutes?: unknown; model?: unknown }>(c);
  if (typeof b.transcript !== "string") return c.json({ error: "nothing was recorded" }, 400);
  try {
    return c.json(await Lecture.makeNotes(c.env, { transcript: b.transcript, title: typeof b.title === "string" ? b.title : "", subject_id: typeof b.subject_id === "string" && /^[0-9a-f-]{36}$/.test(b.subject_id) ? b.subject_id : null, minutes: Number(b.minutes) || undefined, model: b.model }, (p) => c.executionCtx.waitUntil(p)), 201);
  } catch (e) { return aiError(c, e); }
});
// Snap a syllabus (#11): read a photo (nothing written), add what the user kept, or undo that.
app.post("/api/syllabus/read", async (c) => {
  const b = await body<{ image?: unknown; mediaType?: unknown; model?: unknown }>(c);
  if (typeof b.image !== "string" || !b.image) return c.json({ error: "send a photo" }, 400);
  try { return c.json(await Syllabus.read(c.env, { image: b.image, mediaType: String(b.mediaType ?? ""), model: b.model })); } catch (e) { return aiError(c, e); }
});
app.post("/api/syllabus", (c) => studyErr(c, async () => c.json(await Syllabus.add(c.env, await body(c)), 201)));
app.post("/api/syllabus/undo", async (c) => c.json(await Syllabus.undo(c.env, await body(c))));
// Handwriting to text (#46): a drawing read by the assistant.
app.post("/api/ai/handwriting", async (c) => {
  const b = await body<{ image?: unknown; mediaType?: unknown; model?: unknown }>(c);
  if (typeof b.image !== "string" || !b.image) return c.json({ error: "send the drawing" }, 400);
  try { return c.json(await AI.handwritingToText(c.env, { image: b.image, mediaType: String(b.mediaType ?? ""), model: b.model })); } catch (e) { return aiError(c, e); }
});
// "You wrote about this before" (#18): notes close in meaning to a page, or to what the user's writing in it now.
app.post("/api/notes/:id/related", async (c) => {
  const b = await body<{ text?: unknown }>(c);
  try { return c.json({ hits: await Sem.related(c.env, c.req.param("id"), typeof b.text === "string" ? b.text.slice(0, 4000) : null) }); }
  catch (e) { console.error("related failed", e); return c.json({ hits: [] }); } // a nice-to-have: never an error on the page
});
// A page's weak spots: questions about it the user has missed at least twice, for the editor's highlight.
app.get("/api/notes/:id/weak-spots", async (c) => c.json({ spots: await Misses.forPage(c.env.DB, c.req.param("id")) }));
// What the time data says: rushing on missed questions, and the best time of day (needs a few weeks of sessions).
app.get("/api/study-insights", async (c) => c.json(await Coach.insights(c.env.DB, await Suggest.userTz(c.env.DB))));
// Missed questions coming back: a reworded quiz of the due ones (the soonest, if none are due yet).
app.post("/api/study/misses/review", async (c) => { try { return c.json(await Misses.review(c.env)); } catch (e) { return aiError(c, e); } });
// History: finished quizzes and tests, to look back on or retake. The list carries no questions; one session does.
app.get("/api/study-history", async (c) => {
  const ids = (c.req.query("ids") ?? "").split(",").filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 200);
  return c.json({ sessions: await Coach.history(c.env.DB, { ids }) });
});
app.get("/api/study-history/:id", async (c) => {
  const s = await Coach.pastSession(c.env.DB, c.req.param("id"));
  return s ? c.json(s) : c.json({ error: "not found" }, 404);
});
app.post("/api/ai/cards", async (c) => {
  const b = await body<{ id?: unknown; model?: unknown }>(c);
  if (typeof b.id !== "string" || !/^[0-9a-f-]{36}$/.test(b.id)) return c.json({ error: "pick a page" }, 400);
  try { return c.json(await AI.makeCards(c.env, { id: b.id, model: b.model })); } catch (e) { return aiError(c, e); }
});
app.post("/api/ai/grade", async (c) => {
  const b = await body<{ items?: unknown; model?: unknown }>(c);
  const items = (Array.isArray(b.items) ? b.items : []).map((x) => x as { q?: unknown; expected?: unknown; answer?: unknown }).map((x) => ({ q: String(x.q ?? ""), expected: String(x.expected ?? ""), answer: String(x.answer ?? "") }));
  try { return c.json(await AI.gradeAnswers(c.env, items, b.model)); } catch (e) { return aiError(c, e); }
});

// ---- Task notifications (migrations/0004_push.sql, src/worker/push.ts).
app.get("/api/push", async (c) => {
  const devices = (await Push.listSubs(c.env.DB)).map(({ endpoint, label, tz, created_at, seen_at, last_error }) => ({ endpoint, label, tz, created_at, seen_at, last_error }));
  return c.json({ key: Push.vapidPublic(c.env), prefs: await Push.getPrefs(c.env.DB), devices });
});
app.post("/api/push/subscribe", async (c) => c.json(await Push.saveSub(c.env.DB, await body(c))));
app.post("/api/push/unsubscribe", async (c) => c.json({ ok: await Push.deleteSub(c.env.DB, String((await body<{ endpoint?: unknown }>(c)).endpoint ?? "")) }));
app.put("/api/push/prefs", async (c) => c.json(await Push.setPrefs(c.env.DB, await body(c))));
app.post("/api/push/test", async (c) => {
  const { endpoint } = await body<{ endpoint?: unknown }>(c);
  const subs = (await Push.listSubs(c.env.DB)).filter((s) => !endpoint || s.endpoint === endpoint);
  if (!subs.length) return c.json({ error: "no devices have notifications turned on" }, 400);
  return c.json(await Push.sendAll(c.env, subs, { title: "Seaglass notifications are on", body: "Task reminders will show up like this.", tag: "test", url: "/#/tasks" }));
});
app.post("/api/push/action", async (c) => {
  const b = await body<{ id?: unknown; action?: unknown; today?: unknown }>(c);
  const r = await Push.notificationAction(c.env, String(b.id ?? ""), String(b.action ?? ""), String(b.today ?? ""));
  return c.json(r, r.ok ? 200 : 400);
});

// ---- Waffle's memory and synced chats (migrations/0003_memory_chats.sql).
app.get("/api/memories", async (c) => c.json(await M.listMemories(c.env.DB)));
app.post("/api/memories", async (c) => {
  try { return c.json(await M.addMemory(c.env.DB, String((await body<{ text?: unknown }>(c)).text ?? ""), "user")); }
  catch (e) { return c.json({ error: (e as Error).message }, 400); }
});
app.patch("/api/memories/:id", async (c) => {
  try { return (await M.updateMemory(c.env.DB, c.req.param("id"), String((await body<{ text?: unknown }>(c)).text ?? ""))) ? c.json({ ok: true }) : c.json({ error: "not found" }, 404); }
  catch (e) { return c.json({ error: (e as Error).message }, 400); }
});
app.delete("/api/memories/:id", async (c) => c.json({ ok: await M.deleteMemory(c.env.DB, c.req.param("id")) }));
app.get("/api/chats", async (c) => c.json((await M.listChats(c.env.DB)).map((r) => ({ id: r.id, title: r.title, updated: r.updated_at, msgs: JSON.parse(r.messages) }))));
app.put("/api/chats/:id", async (c) => {
  const id = c.req.param("id"), b = await body<{ title?: unknown; msgs?: unknown; updated?: unknown }>(c);
  if (!/^[a-z0-9-]{4,40}$/i.test(id) || !Array.isArray(b.msgs) || !Number.isFinite(Number(b.updated))) return c.json({ error: "bad chat" }, 400);
  try { await M.putChat(c.env.DB, id, String(b.title ?? ""), b.msgs, Number(b.updated)); return c.json({ ok: true }); }
  catch (e) { return c.json({ error: (e as Error).message }, 413); }
});
app.delete("/api/chats/:id", async (c) => { await M.deleteChat(c.env.DB, c.req.param("id")); return c.json({ ok: true }); });

// ---- Study mode (flashcards). Progress only; the cards live in page content. See migrations/0002_study.sql.
const CARD_ID = /^[a-z0-9]{1,16}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
app.get("/api/study/:id", async (c) => {
  const r = await c.env.DB.prepare("SELECT card_id, ease, interval, reps, lapses, due FROM study WHERE note_id = ?").bind(c.req.param("id")).all();
  return c.json(r.results);
});
app.put("/api/study/:id/:card", async (c) => {
  const id = c.req.param("id"), card = c.req.param("card"), s = await body(c);
  if (!CARD_ID.test(card) || !isState(s)) return c.json({ error: "bad card or state" }, 400);
  if (!(await N.getNote(c.env.DB, id))) return c.json({ error: "not found" }, 404);
  await c.env.DB.prepare(
    `INSERT INTO study (note_id, card_id, ease, interval, reps, lapses, due, updated_at) VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(note_id, card_id) DO UPDATE SET ease=excluded.ease, interval=excluded.interval, reps=excluded.reps, lapses=excluded.lapses, due=excluded.due, updated_at=excluded.updated_at`,
  ).bind(id, card, s.ease, Math.round(s.interval), Math.round(s.reps), Math.round(s.lapses), s.due, Date.now()).run();
  return c.json({ ok: true });
});
// Cards whose question was edited or deleted leave stale progress behind; the study screen sends the cards it found.
app.post("/api/study/:id/prune", async (c) => {
  const keep = ((await body<{ keep?: unknown }>(c)).keep ?? []) as unknown[];
  if (!Array.isArray(keep) || keep.length > 2000 || !keep.every((k) => typeof k === "string" && CARD_ID.test(k))) return c.json({ error: "bad list" }, 400);
  const id = c.req.param("id");
  if (!keep.length) await c.env.DB.prepare("DELETE FROM study WHERE note_id = ?").bind(id).run();
  else await c.env.DB.prepare(`DELETE FROM study WHERE note_id = ? AND card_id NOT IN (${keep.map(() => "?").join(",")})`).bind(id, ...keep).run();
  return c.json({ ok: true });
});
// Study streak: consecutive days (in your time zone) with a finished session or a flashcard review, ending today or yesterday.
app.get("/api/study-streak", async (c) => {
  const today = c.req.query("today") ?? "", off = Number(c.req.query("tz_offset") ?? 0);
  if (!DAY.test(today) || !Number.isFinite(off) || Math.abs(off) > 900) return c.json({ error: "today must be YYYY-MM-DD and tz_offset minutes" }, 400);
  const days = (await c.env.DB.prepare(
    "SELECT d FROM (SELECT date((updated_at / 1000) - (?1 * 60), 'unixepoch') AS d FROM study WHERE reps > 0 OR lapses > 0 UNION SELECT date((created_at / 1000) - (?1 * 60), 'unixepoch') FROM study_sessions) ORDER BY d DESC LIMIT 400",
  ).bind(off).all<{ d: string }>()).results.map((r) => r.d);
  const set = new Set(days);
  const step = (d: string) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); };
  let day = set.has(today) ? today : step(today), streak = 0;
  while (set.has(day)) { streak++; day = step(day); }
  return c.json({ streak, today: set.has(today), days: days.length, dates: days.slice(0, 14) });
});
app.get("/api/study-due", async (c) => {
  const today = c.req.query("today") ?? "";
  if (!DAY.test(today)) return c.json({ error: "today must be YYYY-MM-DD" }, 400);
  const r = await c.env.DB.prepare(
    `SELECT s.note_id AS id, n.title, n.icon, COUNT(*) AS due FROM study s JOIN notes n ON n.id = s.note_id
     WHERE n.deleted_at IS NULL AND s.due <= ? GROUP BY s.note_id ORDER BY due DESC LIMIT 20`,
  ).bind(today).all<{ id: string; title: string; icon: string | null; due: number }>();
  return c.json(await Promise.all(r.results.map(async (x) => ({ ...x, title: (await Vault.open("notes", x.id, "title", x.title)) ?? "", icon: await Vault.open("notes", x.id, "icon", x.icon) }))));
});
// The Study tab: subjects, and every page with flashcards with its subject, done / excluded state and progress.
const studyErr = <T,>(c: { json: (b: unknown, s: 400) => Response }, f: () => Promise<T>) => f().catch((e) => { if (e instanceof Study.StudyError) return c.json({ error: e.message }, 400); throw e; });
app.get("/api/study-overview", (c) => studyErr(c, async () => {
  const progress = await Coach.progress(c.env.DB); // scores, recent work and the week come from finished sessions
  return c.json({ ...await Study.overview(c.env.DB, c.req.query("today") ?? "", new Set(Object.keys(progress.pages))), progress, misses: await Misses.count(c.env.DB) });
}));
app.post("/api/study-exams", (c) => studyErr(c, async () => c.json(await Study.createExam(c.env.DB, await body(c)), 201)));
app.patch("/api/study-exams/:id", (c) => studyErr(c, async () => c.json(await Study.updateExam(c.env.DB, c.req.param("id"), await body(c)))));
// A study plan for a test, to look over (nothing written), then the sessions the user kept added as dated tasks (one undoable change).
app.post("/api/study-exams/:id/plan", (c) => studyErr(c, async () => c.json(await Coach.planForExam(c.env, c.req.param("id"), await Suggest.userTz(c.env.DB)))));
// The real grade after a test: saved to Grades and compared with practice; DELETE undoes it.
app.post("/api/study-exams/:id/grade", (c) => studyErr(c, async () => c.json(await Coach.logExamGrade(c.env.DB, c.req.param("id"), await body(c), await Suggest.userTz(c.env.DB)))));
app.delete("/api/study-exams/:id/grade", (c) => studyErr(c, async () => c.json(await Study.clearGrade(c.env.DB, c.req.param("id")))));
app.post("/api/study/plan", async (c) => {
  const items = Coach.cleanPlan((await body<{ sessions?: unknown }>(c)).sessions).slice(0, 12);
  if (!items.length) return c.json({ error: "no study sessions to add" }, 400);
  const ctx = await agentCtx(c.env.DB, "study plan you accepted");
  const note_ids = await Coach.addPlan(c.env.DB, items, ctx, localNow(Date.now(), await Suggest.userTz(c.env.DB)).date);
  return c.json({ run_id: ctx.runId, note_ids });
});
app.delete("/api/study-exams/:id", (c) => studyErr(c, async () => c.json(await Study.deleteExam(c.env.DB, c.req.param("id")))));
app.post("/api/study-subjects", (c) => studyErr(c, async () => c.json(await Study.createSubject(c.env.DB, await body(c)), 201)));
// A subject as a class hub (#9, #10): its class in Grades and the grades, what the next test needs, its open tasks.
app.get("/api/study-subjects/:id/hub", (c) => studyErr(c, async () => c.json(await Hub.hub(c.env.DB, c.req.param("id"), c.req.query("today") ?? localNow(Date.now(), await Suggest.userTz(c.env.DB)).date))));
app.patch("/api/study-subjects/:id", (c) => studyErr(c, async () => c.json(await Study.updateSubject(c.env.DB, c.req.param("id"), await body(c)))));
app.delete("/api/study-subjects/:id", (c) => studyErr(c, async () => c.json(await Study.deleteSubject(c.env.DB, c.req.param("id")))));
app.put("/api/study-pages/:id", (c) => studyErr(c, async () => c.json(await Study.setPage(c.env.DB, c.req.param("id"), await body(c)))));
app.get("/api/trash", async (c) => c.json(await N.listTrash(c.env.DB)));
app.delete("/api/trash", async (c) => c.json({ purged: await N.emptyTrash(c.env.DB) }));

app.post("/api/notes", async (c) => c.json(await N.createNote(c.env.DB, await body(c), ctx()), 201));

app.get("/api/notes/:id", async (c) => {
  const n = await N.getNote(c.env.DB, c.req.param("id"), c.req.query("deleted") === "1");
  // ai_hidden_inherited: hidden from AI because a page above it is (its own switch then can't un-hide it).
  return n ? c.json({ ...n, ai_hidden_inherited: !n.ai_hidden && (await isHidden(c.env.DB, n.id)) }) : notFound(c);
});

app.patch("/api/notes/:id", async (c) => {
  const n = await N.patchNote(c.env.DB, c.req.param("id"), await body<N.Patch>(c), ctx());
  return n ? c.json(n) : notFound(c);
});

app.delete("/api/notes/:id", async (c) => ((await N.trashNote(c.env.DB, c.req.param("id"), ctx())) ? c.body(null, 204) : notFound(c)));
app.post("/api/notes/:id/restore", async (c) => {
  const n = await N.restoreNote(c.env.DB, c.req.param("id"), ctx());
  return n ? c.json(n) : notFound(c);
});
app.delete("/api/notes/:id/purge", async (c) => ((await N.purgeNote(c.env.DB, c.req.param("id"))) ? c.body(null, 204) : notFound(c)));
app.post("/api/notes/:id/duplicate", async (c) => {
  const n = await N.duplicateNote(c.env.DB, c.req.param("id"), ctx());
  return n ? c.json(n, 201) : notFound(c);
});

app.get("/api/notes/:id/children", async (c) => c.json(await N.listChildren(c.env.DB, c.req.param("id"))));
app.get("/api/notes/:id/backlinks", async (c) => c.json(await N.backlinks(c.env.DB, c.req.param("id"))));

app.get("/api/notes/:id/history", async (c) => c.json(await N.listHistory(c.env.DB, c.req.param("id"))));
app.get("/api/notes/:id/history/:aid", async (c) => {
  const v = await N.getVersion(c.env.DB, c.req.param("id"), Number(c.req.param("aid")));
  return v ? c.json(v) : notFound(c);
});
app.post("/api/notes/:id/history/:aid/restore", async (c) => {
  const n = await N.restoreVersion(c.env.DB, c.req.param("id"), Number(c.req.param("aid")), ctx());
  return n ? c.json(n) : notFound(c);
});

// "Hide from AI" (hidden.ts). Only this route changes it: Waffle and MCP can't, in either direction.
app.post("/api/notes/:id/ai-hidden", async (c) => {
  const { hidden } = await body<{ hidden?: boolean }>(c);
  const n = await N.setAiHidden(c.env.DB, c.req.param("id"), hidden === true);
  return n ? c.json({ ai_hidden: n.ai_hidden }) : notFound(c);
});

app.post("/api/notes/:id/share", async (c) => {
  const { enabled } = await body<{ enabled?: boolean }>(c);
  const r = await N.setShare(c.env.DB, c.req.param("id"), !!enabled);
  return r ? c.json(r) : notFound(c);
});

app.get("/api/notes/:id/comments", async (c) => c.json(await N.listComments(c.env.DB, c.req.param("id"))));
app.post("/api/notes/:id/comments", async (c) => { const b = await body<{ body?: string; anchor?: unknown }>(c); return c.json(await N.addComment(c.env.DB, c.req.param("id"), String(b.body ?? ""), { anchor: b.anchor }), 201); });
app.patch("/api/comments/:cid", async (c) => { const b = await body<{ resolved?: boolean; outcome?: string }>(c); await N.resolveComment(c.env.DB, c.req.param("cid"), !!b.resolved, b.outcome); return c.body(null, 204); });
app.delete("/api/comments/:cid", async (c) => { await N.deleteComment(c.env.DB, c.req.param("cid")); return c.body(null, 204); });

app.get("/api/export", async (c) => {
  c.header("Content-Disposition", `attachment; filename="seaglass-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  return c.json(await N.exportAll(c.env.DB));
});
app.post("/api/import", async (c) => c.json(await N.importAll(c.env.DB, await body(c))));

// ---------------------------------------------------------------- agent + runs (undo / redo)
// The agent streams newline-delimited JSON events. Every change it makes is logged under one run id,
// so a whole prompt's worth of edits can be undone (or redone) with a single call.

// The model and web switch the user last picked in the chat, kept in prefs so every device starts from the same choice.
// "" = the default model.
const readChoice = async (env: Env) => {
  const rows = (await env.DB.prepare("SELECT key, value FROM prefs WHERE key IN ('agent_model', 'agent_web')").all<{ key: string; value: string }>()).results;
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  const m = get("agent_model") ?? "";
  return { model: m in MODELS ? m : "", web: get("agent_web") !== "0" };
};
app.get("/api/agent/status", async (c) => {
  const mode = authMode(c.env);
  const models = Object.entries(MODELS).map(([id, m]) => ({ id, label: m.label, blurb: m.blurb }));
  return c.json({ configured: mode !== "none", mode, model: MODEL, models, mock: mode === "mock", choice: await readChoice(c.env) });
});
app.put("/api/agent/choice", async (c) => {
  const b = await body<{ model?: unknown; web?: unknown }>(c);
  const set = (k: string, v: string) => c.env.DB.prepare("INSERT INTO prefs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(k, v);
  const stmts = [];
  if (b.model !== undefined) {
    if (typeof b.model !== "string" || (b.model !== "" && !(b.model in MODELS))) return c.json({ error: "unknown model" }, 400);
    stmts.push(set("agent_model", b.model === MODEL ? "" : b.model));
  }
  if (b.web !== undefined) {
    if (typeof b.web !== "boolean") return c.json({ error: "web must be true or false" }, 400);
    stmts.push(set("agent_web", b.web ? "1" : "0"));
  }
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json(await readChoice(c.env));
});

// Setup & status: what is configured, what is missing, and the values to paste into Claude / the Console.
app.get("/api/setup", async (c) => {
  const env = c.env;
  const origin = new URL(c.req.url).origin;
  const base = (env.PUBLIC_URL || origin).replace(/\/+$/, "");
  const probe = async (fn: () => Promise<unknown>) => { try { await fn(); return true; } catch { return false; } };
  const tables = await probe(async () => { const r = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('notes','actions','links','comments')").all(); if (r.results.length < 4) throw new Error("migrations"); });
  const r2 = await probe(() => env.FILES.head("__seaglass_probe"));
  const kv = await probe(() => env.OAUTH_KV.get("__seaglass_probe"));
  const mode = authMode(env);
  const missing = wifMissing(env);
  const https = origin.startsWith("https://");
  const sealed = await Seal.status(env).catch(() => null);
  const left = sealed ? sealed.tables.reduce((n, t) => n + t.remaining, 0) + sealed.files.remaining : 0;
  const checks = [
    { id: "vault", label: "Encryption at rest (DATA_KEY)", ok: !!sealed?.enabled && sealed.complete,
      detail: !sealed?.enabled ? "No data key: nothing can be read. Run: npm run data:keygen -- --out <file> --put"
        : sealed.complete ? `Everything private is encrypted (AES-256-GCM, key ${sealed.key_id})${sealed.strict ? ", plaintext refused" : ""}.`
        : `Encrypting stored data in the background: ${left} items left (it finishes by itself within a few minutes).` },
    { id: "accounts", label: "Accounts", ok: (await userCount(env.DB)) > 0, detail: `${await userCount(env.DB)} account(s). Sign-in needs a username and password${env.SETUP_CODE ? "; the setup code is set" : ""}.` },
    { id: "db", label: "Database (D1)", ok: tables, detail: tables ? "Connected and migrated." : "Missing tables. Run: npm run db:remote" },
    { id: "r2", label: "File storage (R2)", ok: r2, detail: r2 ? "Connected." : "Bucket not reachable. Check the FILES binding in wrangler.jsonc." },
    { id: "kv", label: "OAuth storage (KV)", ok: kv, detail: kv ? "Connected." : "Namespace not reachable. Check the OAUTH_KV binding in wrangler.jsonc." },
    { id: "url", label: "Public URL (PUBLIC_URL)", ok: !!env.PUBLIC_URL && env.PUBLIC_URL.replace(/\/+$/, "") === origin, detail: !env.PUBLIC_URL ? `Not set. Set it to ${origin} in wrangler.jsonc vars.` : env.PUBLIC_URL.replace(/\/+$/, "") === origin ? "Matches this address." : `Set to ${env.PUBLIC_URL} but you're on ${origin}.` },
    { id: "claude", label: "Claude API for Waffle", ok: mode === "wif" || mode === "api_key", detail: mode === "wif" ? "Workload identity federation (no stored API key)." : mode === "api_key" ? "Using an API key. Switch to workload identity federation when you're ready." : mode === "mock" ? "Mock model (testing only)." : `Not configured. Missing for federation: ${missing.join(", ")}` },
  ];
  return c.json({
    checks,
    mode,
    mcp: { url: `${base}/mcp`, claude_code: `claude mcp add --transport http seaglass ${base}/mcp` },
    wif: { issuer: issuerUrl({ ...env, PUBLIC_URL: base }), discovery: `${issuerUrl({ ...env, PUBLIC_URL: base })}/.well-known/openid-configuration`, jwks: `${issuerUrl({ ...env, PUBLIC_URL: base })}/jwks.json`, subject: env.WIF_SUBJECT || "seaglass", audience: env.WIF_AUDIENCE || "https://api.anthropic.com", key_set: !!env.WIF_SIGNING_KEY, missing },
  });
});

// Which assistant the app shows: Waffle (default) or Waffle. Only the name and picture change; the agent uses the name too.
// What the assistant may do on its own, and the answers to its questions (approvals.ts).
app.get("/api/agent/permissions", async (c) => c.json({ permissions: await Approvals.permissions(c.env.DB), presets: Approvals.PRESETS }));
app.put("/api/agent/permissions", async (c) => c.json({ permissions: await Approvals.savePermissions(c.env.DB, await body(c)) }));
app.post("/api/agent/approvals/:id", async (c) => {
  const ok = (await body<{ ok?: unknown }>(c)).ok === true;
  return (await Approvals.decide(c.env.DB, c.req.param("id"), ok)) ? c.json({ ok: true }) : c.json({ error: "That question was already answered or has expired." }, 410);
});
app.get("/api/persona", (c) => c.json({ persona: "waffle" }));
app.put("/api/persona", async (c) => {
  const p = (await body<{ persona?: unknown }>(c)).persona;
  if (p !== "jeff" && p !== "waffle") return c.json({ error: "persona must be jeff or waffle" }, 400);
  await c.env.DB.prepare("INSERT INTO prefs (key, value) VALUES ('persona', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(p).run();
  return c.json({ persona: p });
});

// ---------------------------------------------------------------- proactive assistant (proactive.ts)
const pro = async <T>(c: { json: (o: unknown, s?: 400 | 404) => Response }, fn: () => Promise<T>) => {
  try { return c.json(await fn()); } catch (e) { if (e instanceof Pro.Bad) return c.json({ error: e.message }, e.message === "not found" ? 404 : 400); throw e; }
};
app.get("/api/inbox", async (c) => c.json({ items: await Pro.listInbox(c.env.DB, { status: c.req.query("status") === "new" ? "new" : undefined, limit: Number(c.req.query("limit")) || 50 }), unread: await Pro.unreadCount(c.env.DB) }));
app.post("/api/inbox/:id", async (c) => { const b = await body<{ action?: string; today?: string }>(c); const a = b.action; if (a !== "accept" && a !== "dismiss" && a !== "done" && a !== "read") return c.json({ error: "action must be accept, dismiss, done or read" }, 400); return pro(c, () => Pro.actOn(c.env, c.req.param("id"), a, b.today)); });
app.post("/api/inbox/:id/feedback", async (c) => pro(c, async () => Pro.setFeedback(c.env.DB, c.req.param("id"), Number((await body<{ value?: number }>(c)).value) || 0)));
app.get("/api/assistant-mode", async (c) => c.json({ mode: await Pro.assistantMode(c.env.DB) }));
app.put("/api/assistant-mode", async (c) => {
  const m = (await body<{ mode?: unknown }>(c)).mode;
  if (m !== "on_demand" && m !== "proactive") return c.json({ error: "mode must be on_demand or proactive" }, 400);
  await Pro.setAssistantMode(c.env.DB, m);
  return c.json({ mode: m });
});
app.post("/api/checkin/run", async (c) => { try { return c.json({ messages: await Pro.checkIn(c.env) }); } catch (e) { return aiError(c, e); } });
app.get("/api/prompts", async (c) => c.json(await Pro.listPrompts(c.env.DB)));
app.put("/api/prompts", async (c) => pro(c, async () => Pro.savePrompt(c.env.DB, await body(c))));
app.delete("/api/prompts/:id", async (c) => c.json({ ok: await Pro.deletePrompt(c.env.DB, c.req.param("id")) }));
app.get("/api/routines", async (c) => c.json(await Pro.listRoutines(c.env.DB)));
app.put("/api/routines", async (c) => pro(c, async () => Pro.saveRoutine(c.env.DB, await body(c))));
app.delete("/api/routines/:id", async (c) => c.json({ ok: await Pro.deleteRoutine(c.env.DB, c.req.param("id")) }));
app.post("/api/routines/:id/run", async (c) => {
  const r = (await Pro.listRoutines(c.env.DB)).find((x) => x.id === c.req.param("id"));
  if (!r) return c.json({ error: "not found" }, 404);
  if (authMode(c.env) === "none") return c.json({ error: "no_key" }, 503);
  return c.json(await Pro.runRoutine(c.env, r));
});

// Encryption at rest: counts only (never content), and a button to encrypt anything still stored in plaintext.
app.get("/api/security/status", async (c) => c.json(await Seal.status(c.env)));
app.post("/api/security/seal-all", async (c) => c.json(await Seal.sealNow(c.env)));

// One tiny real request to prove the Claude API credentials work (used by the setup check).
app.post("/api/agent/test", async (c) => {
  const mode = authMode(c.env);
  if (mode === "none") return c.json({ ok: false, mode, error: "Not configured: set up workload identity federation or ANTHROPIC_API_KEY." });
  if (mode === "mock") return c.json({ ok: true, mode, reply: "(mock model, no request sent)" });
  try {
    const r = await claudeClient(c.env).messages.create({ model: MODEL, max_tokens: 200, output_config: { effort: "low" }, messages: [{ role: "user", content: "Reply with just the word: ok" }] });
    const text = r.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    return c.json({ ok: true, mode, model: r.model, reply: text.slice(0, 80) });
  } catch (e) {
    const err = e as { status?: number; statusCode?: number; message?: string };
    return c.json({ ok: false, mode, status: err.status ?? err.statusCode ?? null, error: String(err.message ?? e).slice(0, 400) });
  }
});

// Workload identity federation: this Worker is its own OIDC issuer for the Claude API.
// Register <PUBLIC_URL>/wif as a "Custom OIDC" issuer in the Claude Console (JWKS source: discovery).
app.get("/wif/.well-known/openid-configuration", (c) => (c.env.WIF_SIGNING_KEY && c.env.PUBLIC_URL ? c.json(openidConfiguration(c.env)) : c.json({ error: "workload identity federation is not configured" }, 404)));
app.get("/wif/jwks.json", async (c) => (c.env.WIF_SIGNING_KEY ? c.json(await publicJwks(c.env), 200, { "Cache-Control": "public, max-age=300" }) : c.json({ error: "workload identity federation is not configured" }, 404)));

// The assistant: one ongoing conversation (thread.ts). The server keeps the thread: it saves the user's message, builds
// what the model sees (recent window + rolling summary), streams the reply, saves it, and tops up the summary after.
// Quick actions (#43): an instruction typed into Ctrl+K, done by the assistant on Haiku with its normal tools (so Undo and
// the write checks apply), without the conversation, memory or web. Nothing is saved to the thread; the answer is what
// changed (tool labels), its one line, and the run id for Undo.
app.post("/api/quick", async (c) => {
  if (authMode(c.env) === "none") return c.json({ error: "no_key", message: "Set up the assistant first (Settings > Setup & status)." }, 503);
  const b = await body<{ text?: string; page_id?: string | null }>(c);
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!text) return c.json({ error: "empty" }, 400);
  if (text.length > 2000) return c.json({ error: "That's too long for a quick action. Ask in the chat instead." }, 413);
  const run_id = crypto.randomUUID(), tz = await Suggest.userTz(c.env.DB);
  let said = "", error = "", changes = 0;
  const done: string[] = [], failed: string[] = [], pages: string[] = [];
  try {
    await runAgent(c.env, { message: text, history: [], page_id: b.page_id ?? null, run_id, tz, quick: true, web: false }, (e) => {
      if (e.type === "text") said += e.delta;
      else if (e.type === "tool_start") said = ""; // only the last turn's words are its line
      else if (e.type === "error") error = e.message;
      else if (e.type === "done") changes = e.changes;
      else if (e.type === "tool_result") {
        if (!e.ok) failed.push(e.label);
        else if (!/^(search_notes|search_by_meaning|list_pages|read_note|read_notes|read_file|list_database_rows|study_overview|study_results|study_session|flashcard_progress|grades_overview)$/.test(e.name)) { done.push(e.label); pages.push(...e.note_ids); }
      }
    }, () => false);
  } catch (e) { return c.json({ error: e instanceof ToolError ? e.message : "The quick action failed. Try again, or ask in the chat." }, 502); }
  return c.json({ run_id, changes, done, failed, pages: [...new Set(pages)], line: said.trim().split("\n").filter(Boolean).pop()?.slice(0, 240) ?? "", error: error || undefined });
});

app.post("/api/agent", async (c) => {
  if (authMode(c.env) === "none") return c.json({ error: "no_key", message: "Set up workload identity federation or the ANTHROPIC_API_KEY secret to turn on Waffle." }, 503);
  const b = await body<{ message?: string; label?: string; page_id?: string | null; model?: string; web?: boolean; voice?: boolean; deep?: string; study?: { ids?: unknown; title?: unknown; after?: unknown } }>(c);
  const message = typeof b.message === "string" ? b.message.trim() : "";
  if (!message) return c.json({ error: "empty message" }, 400);
  if (message.length > 20_000) return c.json({ error: "message too long" }, 413);
  const db = c.env.DB, tz = await Suggest.userTz(db);
  await Thread.importOldChats(db);
  const studyIds = (Array.isArray(b.study?.ids) ? b.study.ids : []).filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/.test(x)).slice(0, 20);
  const study = studyIds.length ? { ids: studyIds, title: typeof b.study?.title === "string" ? b.study.title : "your notes" } : null;
  const after = typeof b.study?.after === "number" && b.study.after >= 0 ? b.study.after : undefined;
  const ctxNow = await Thread.context(db, tz, study && after !== undefined ? { afterSeq: after } : {}); // before this message is saved, so it isn't in the history twice
  const label = typeof b.label === "string" && b.label.trim() ? b.label.trim().slice(0, 120) : undefined;
  const userMsg = await Thread.add(db, { role: "user", text: message, meta: { ...(label ? { label } : {}), page_id: b.page_id ?? null } });
  const runId = crypto.randomUUID();
  const enc = new TextEncoder();
  let aborted = false;
  // What gets saved for the reply, collected from the same events the browser sees.
  let text = "", error = "";
  const tools: NonNullable<Thread.ThreadMeta["tools"]> = [];
  let changes = 0, cost = 0;
  const save = async () => {
    const reply = await Thread.add(db, { role: "assistant", text, meta: { run_id: runId, changes, cost, tools, ...(error ? { error } : {}) } });
    return reply;
  };
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: AgentEvent) => {
        if (e.type === "text") text += e.delta;
        else if (e.type === "tool_result") tools.push({ id: e.id, name: e.name, label: e.label, ok: e.ok, note_ids: e.note_ids, ...(e.game ? { game: e.game } : {}) });
        else if (e.type === "error") error = e.message;
        else if (e.type === "done") { changes = e.changes; cost = e.usage.cost_usd; }
        if (aborted) return;
        try { controller.enqueue(enc.encode(JSON.stringify(e) + "\n")); } catch { aborted = true; }
      };
      try {
        send({ type: "saved", id: userMsg.id, seq: userMsg.seq } as unknown as AgentEvent);
        await runAgent(c.env, { message, history: ctxNow.history, summary: ctxNow.summary, thread_before: ctxNow.windowStart, voice: b.voice === true, deep: typeof b.deep === "string" ? b.deep : undefined, tz, page_id: b.page_id ?? null, run_id: runId, model: typeof b.model === "string" ? b.model : undefined, web: b.web !== false, study }, send, () => aborted);
      } catch (e) {
        const msg = e instanceof ToolError ? e.message : (e as Error)?.message ?? "Agent error";
        console.error("agent error", e);
        send({ type: "error", message: /401|authentication|invalid x-api-key/i.test(msg) ? "The Claude API refused the Worker's credentials. Check the federation rule in the Claude Console (Workload identity > Authentication events)." : /429|rate/i.test(msg) ? "Rate limited by the API. Try again in a moment." : msg });
      } finally {
        // Saved even when the user stops it part way, so the thread shows what the user saw.
        try { const r = await save(); if (!aborted) controller.enqueue(enc.encode(JSON.stringify({ type: "saved", id: r.id, seq: r.seq, reply: true }) + "\n")); } catch (e) { console.error("thread save failed", e); }
        try { controller.close(); } catch { /* already closed */ }
        c.executionCtx.waitUntil(Thread.compact(c.env, tz).catch((e) => console.error("summary failed", e)));
      }
    },
    cancel() { aborted = true; },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Run-Id": runId } });
});

// The thread itself: pages of messages, the unread badge, new-topic breaks, and small metadata changes (undone).
app.get("/api/thread", async (c) => {
  const db = c.env.DB;
  await Suggest.rememberTz(db, c.req.query("tz"));
  await Thread.importOldChats(db);
  const q = (k: string) => (c.req.query(k) !== undefined && Number.isFinite(Number(c.req.query(k))) ? Number(c.req.query(k)) : undefined);
  const messages = await Thread.list(db, { before: q("before"), after: q("after"), limit: q("limit") });
  return c.json({ messages, unread: await Thread.unread(db), last: await Thread.lastSeq(db) });
});
app.get("/api/thread/unread", async (c) => c.json({ unread: await Thread.unread(c.env.DB) }));
app.post("/api/thread/read", async (c) => { const seq = Number((await body<{ seq?: number }>(c)).seq); if (Number.isFinite(seq)) await Thread.markRead(c.env.DB, seq); return c.json({ unread: await Thread.unread(c.env.DB) }); });
app.post("/api/thread/divider", async (c) => c.json(await Thread.add(c.env.DB, { role: "divider", text: "New topic" })));
app.patch("/api/thread/:id", async (c) => {
  const b = await body<{ undone?: unknown }>(c);
  if (typeof b.undone !== "boolean") return c.json({ error: "nothing to change" }, 400);
  return (await Thread.patchMeta(c.env.DB, c.req.param("id"), { undone: b.undone })) ? c.json({ ok: true }) : c.json({ error: "not found" }, 404);
});

app.get("/api/runs", async (c) => c.json(await N.listRuns(c.env.DB)));
// Static paths first so "undo" / "redo" aren't read as a run id.
app.post("/api/runs/undo", async (c) => {
  const id = await N.latestUndoable(c.env.DB);
  return id ? c.json(await N.undoRun(c.env.DB, id, { force: !!(await body<{ force?: boolean }>(c)).force })) : c.json({ ok: false, error: "There is nothing to undo." });
});
app.post("/api/runs/redo", async (c) => {
  const id = await N.latestRedoable(c.env.DB);
  return id ? c.json(await N.redoRun(c.env.DB, id, { force: !!(await body<{ force?: boolean }>(c)).force })) : c.json({ ok: false, error: "There is nothing to redo." });
});
app.post("/api/runs/:id/undo", async (c) => c.json(await N.undoRun(c.env.DB, c.req.param("id"), { force: !!(await body<{ force?: boolean }>(c)).force })));
app.post("/api/runs/:id/redo", async (c) => c.json(await N.redoRun(c.env.DB, c.req.param("id"), { force: !!(await body<{ force?: boolean }>(c)).force })));

// ---------------------------------------------------------------- files (R2)
// Uploads need auth. Reads are public capability URLs (random uuid in the path), which is what
// lets <img> tags and shared pages work. Only safe, non-scriptable types are accepted.

const ALLOWED = /^(image\/(png|jpe?g|gif|webp|avif)|application\/(pdf|json)|video\/(mp4|webm)|audio\/(mpeg|mp4|wav|ogg))$/; // json: a drawing's strokes (handwriting/ink.ts)
const MAX_UPLOAD = 25 * 1024 * 1024;

app.post("/api/upload", async (c) => {
  const type = (c.req.header("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED.test(type)) return c.json({ error: `unsupported file type: ${type || "unknown"}` }, 415);
  const len = Number(c.req.header("Content-Length") ?? 0);
  if (len > MAX_UPLOAD) return c.json({ error: "file too large (25MB max)" }, 413);
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength > MAX_UPLOAD) return c.json({ error: "file too large (25MB max)" }, 413);
  const name = (c.req.query("name") ?? "file").replace(/[^\w.\-]+/g, "_").slice(0, 80) || "file";
  const key = `${crypto.randomUUID()}/${name}`;
  await putFile(c.env, key, buf, type);
  return c.json({ url: `/files/${key}`, name, type, size: buf.byteLength }, 201);
});

// The on-device speech model's files (client voice/localEar.ts), copied from Hugging Face into R2 by `npm run voice:model`.
// Served from here so nothing on the phone can block them as another site's downloads. Public model files, not sealed; the
// URL's revision segment is ignored because only the pinned one is kept. Ranges are supported (the library probes with them).
app.get("/api/voice/model/*", async (c) => {
  const parts = c.req.path.slice("/api/voice/model/".length).split("/");
  if (parts.length < 4 || parts.some((p) => !/^[\w.-]+$/.test(p) || p === "..")) return c.text("not found", 404);
  const key = `voice-model/${parts[0]}/${parts[1]}/${parts.slice(3).join("/")}`;
  const obj = await c.env.FILES.get(key, { range: c.req.raw.headers });
  if (!obj) return c.text("not found", 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("ETag", obj.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "private, max-age=31536000, immutable");
  const r = obj.range as { offset?: number; length?: number; suffix?: number } | undefined;
  if (r && c.req.header("Range")) {
    const offset = r.suffix !== undefined ? obj.size - r.suffix : r.offset ?? 0, length = r.length ?? obj.size - offset;
    headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set("Content-Length", String(length));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(obj.size));
  return new Response(obj.body, { headers });
});

// Files are sealed before they go into R2 (vault.ts) and opened here on the way out.
async function putFile(env: Env, key: string, data: ArrayBuffer, type: string) {
  await env.FILES.put(key, await Vault.sealBytes("files", key, "body", new Uint8Array(data)), { httpMetadata: { contentType: type }, customMetadata: { sealed: await Vault.currentKeyId() } });
}

app.get("/files/:id/:name", async (c) => {
  const key = `${c.req.param("id")}/${c.req.param("name")}`;
  const obj = await c.env.FILES.get(key);
  if (!obj) return c.text("not found", 404);
  const plain = await Vault.openBytes("files", key, "body", new Uint8Array(await obj.arrayBuffer()));
  const type = obj.httpMetadata?.contentType ?? "application/octet-stream";
  // Browsers won't show a PDF under a sandbox policy, so a PDF (never HTML: uploads only take the ALLOWED types) gets
  // "only framed by Seaglass itself" instead, and opens inline under its own name.
  const pdf = type === "application/pdf";
  return new Response(plain as BodyInit, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": pdf ? "frame-ancestors 'self'" : "sandbox; default-src 'none'",
      ...(pdf ? { "X-Frame-Options": "SAMEORIGIN", "Content-Disposition": `inline; filename="${c.req.param("name").replace(/[^\w.\-]/g, "_")}"` } : {}),
    },
  });
});

// ---------------------------------------------------------------- link previews (bookmarks)

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").trim();
const meta = (html: string, key: string) => {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, "i");
  const tag = re.exec(html)?.[0];
  return tag ? decode(/content=["']([^"']*)["']/i.exec(tag)?.[1] ?? "") : "";
};

app.get("/api/unfurl", async (c) => {
  let u: URL;
  try { u = new URL(c.req.query("url") ?? ""); } catch { return c.json({ error: "bad url" }, 400); }
  if (!/^https?:$/.test(u.protocol) || /^(localhost|.*\.local|\d+\.\d+\.\d+\.\d+|\[.*\])$/i.test(u.hostname)) return c.json({ error: "url not allowed" }, 400);
  try {
    const res = await fetch(u, { redirect: "follow", signal: AbortSignal.timeout(6000), headers: { "User-Agent": "Mozilla/5.0 (compatible; SeaglassBot/1.0)", Accept: "text/html" } });
    const html = (await res.text()).slice(0, 200_000);
    const title = meta(html, "og:title") || decode(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? "") || u.hostname;
    const image = meta(html, "og:image");
    return c.json({
      url: u.toString(), title: title.slice(0, 200), description: (meta(html, "og:description") || meta(html, "description")).slice(0, 300),
      image: /^https:\/\//.test(image) ? image : "", host: u.hostname,
    });
  } catch {
    return c.json({ url: u.toString(), title: u.hostname, description: "", image: "", host: u.hostname });
  }
});

// ---------------------------------------------------------------- public shared pages

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// An @ mention on a shared page: the name stays (styled like in the app), and when the page it points at is shared too it
// becomes a link to that shared page. A page that isn't shared stays plain text: its address would only say "not shared".
async function linkMentions(db: D1Database, html: string): Promise<string> {
  const tag = /<span\b[^>]*data-type="(?:mention|child-page)"[^>]*>/g;
  const ids = [...new Set([...html.matchAll(tag)].map((m) => /data-id="([0-9a-f-]{36})"/.exec(m[0])?.[1]).filter((x): x is string => !!x))].slice(0, 100);
  if (!ids.length) return html;
  const rows = (await db.prepare(`SELECT id, share_slug FROM notes WHERE share_slug IS NOT NULL AND deleted_at IS NULL AND id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all<{ id: string; share_slug: string }>()).results;
  const slug = new Map(rows.map((r) => [r.id, r.share_slug]));
  return html.replace(/(<span\b[^>]*data-type="mention"[^>]*>)([\s\S]*?)<\/span>/g, (all, open: string, inner: string) => {
    const id = /data-id="([0-9a-f-]{36})"/.exec(open)?.[1];
    const s = id ? slug.get(id) : undefined;
    return s ? `<a class="mention shared" href="/p/${encodeURIComponent(s)}">${inner}</a>` : all;
  });
}

app.get("/p/:slug", async (c) => {
  const n = await N.getShared(c.env.DB, c.req.param("slug"));
  if (!n) return c.text("This page is not shared.", 404);
  let body = n.html;
  if (n.kind === "database") {
    const rows = await N.listChildren(c.env.DB, n.id);
    body = `<ul>${rows.map((r) => `<li>${esc(r.icon ?? "")} ${esc(r.title || "Untitled")}</li>`).join("")}</ul>`;
  }
  body = await linkMentions(c.env.DB, body);
  const cover = n.cover && /^(linear-gradient|#[0-9a-f]{3,8}$|\/files\/|\/covers\/[\w.-]+$)/i.test(n.cover) ? n.cover : "";
  const coverCss = /^\/(files|covers)\//.test(cover) ? `url(${esc(cover)}) center/cover` : esc(cover);
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(n.title || "Untitled")}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.18.10/dist/katex.min.css">
<style>
:root{color-scheme:light dark;--bg:#f4faf9;--ink:#12302f;--muted:#5d7f7c;--line:#cfe3e0;--panel:#e6f2f0;--accent:#2aa198}
@media(prefers-color-scheme:dark){:root{--bg:#0b1f22;--ink:#dff3f0;--muted:#86aaa6;--line:#1b3f45;--panel:#0e2a2f;--accent:#4fd1c5}}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 -apple-system,"Segoe UI",system-ui,sans-serif}
.cover{height:200px;background:${coverCss || "var(--panel)"}}
main{max-width:${n.full_width ? "1100px" : "720px"};margin:0 auto;padding:24px 20px 80px;${n.small_text ? "font-size:14px;" : ""}${n.font === "serif" ? "font-family:Georgia,serif;" : n.font === "mono" ? "font-family:ui-monospace,monospace;" : ""}}
h1.t{font-size:2.2rem;margin:.3em 0}.icon{font-size:3rem}
pre{background:var(--panel);padding:12px;border-radius:8px;overflow:auto}code{background:var(--panel);padding:1px 5px;border-radius:4px}
blockquote{border-left:3px solid var(--accent);margin-left:0;padding-left:14px;color:var(--muted)}
table{border-collapse:collapse}td,th{border:1px solid var(--line);padding:6px 10px}img{max-width:100%;border-radius:6px}
[data-type=callout]{display:flex;gap:10px;background:var(--panel);padding:12px 14px;border-radius:8px}
[data-type=columns]{display:flex;gap:16px}[data-type=column]{flex:1;min-width:0}
ul[data-type=taskList]{list-style:none;padding-left:4px}ul[data-type=taskList] li{display:flex;gap:8px}
mark{background-color:color-mix(in srgb,#facc15 45%,transparent);color:inherit;border-radius:3px;padding:0 1px}mark[style*=background-color]{color:inherit}
.mention{color:inherit;font-weight:500;padding:0 2px;border-radius:3px;text-decoration:underline;text-decoration-color:var(--muted);text-underline-offset:2px;white-space:nowrap}
.mention[data-id^="date:"]{color:var(--muted);font-weight:400;text-decoration:none}
a.mention.shared{color:var(--accent);text-decoration-color:var(--accent)}a.mention.shared:hover{background:var(--panel)}
a{color:var(--accent)}
details{border-left:2px solid var(--line);padding-left:10px}
details[data-heading]{border-left:0;padding-left:0}details[data-heading]>summary{font-weight:600;line-height:1.3}details[data-heading="1"]>summary{font-size:1.875em}details[data-heading="2"]>summary{font-size:1.5em}details[data-heading="3"]>summary{font-size:1.25em}
</style></head><body>${cover || !n.cover ? `<div class="cover"></div>` : ""}<main>
${n.icon ? `<div class="icon">${esc(n.icon)}</div>` : ""}<h1 class="t">${esc(n.title || "Untitled")}</h1>${body}
<p style="color:var(--muted);font-size:13px;margin-top:48px">Shared from Seaglass</p></main>
<script src="https://cdn.jsdelivr.net/npm/katex@0.18.10/dist/katex.min.js"></script>
<script>document.querySelectorAll("[data-latex]").forEach(function(e){try{katex.render(e.getAttribute("data-latex"),e,{throwOnError:false,displayMode:e.getAttribute("data-type")==="block-math"})}catch(x){}})</script>
</body></html>`;
  return c.html(page, 200, {
    "Content-Security-Policy": "default-src 'none'; img-src 'self' https: data:; style-src 'unsafe-inline' https://cdn.jsdelivr.net; font-src https://cdn.jsdelivr.net; script-src 'unsafe-inline' https://cdn.jsdelivr.net; frame-src https://www.youtube-nocookie.com https://www.youtube.com https://player.vimeo.com; media-src 'self'",
    "Referrer-Policy": "no-referrer",
  });
});

// ---------------------------------------------------------------- OAuth consent + MCP

registerAuthorize(app);

// The Worker is its own OAuth authorization server for /mcp (dynamic client registration, PKCE,
// tokens stored hashed in KV). Claude's apps connect with OAuth; Claude Code can instead send the
// OAuth too (it signs in with an account). Everything else is the normal app.
// The provider needs the public URL of the /mcp resource, which comes from PUBLIC_URL (or the
// request's own origin in local dev), so it is built on first use and cached per origin.
const providers = new Map<string, OAuthProvider<Env>>();

function providerFor(base: string) {
  let provider = providers.get(base);
  if (provider) return provider;
  const resource = `${base}/mcp`;
  provider = new OAuthProvider<Env>({
    apiRoute: "/mcp",
    apiHandler: { fetch: (request: Request, env: Env, ctx: ExecutionContext) => handleMcp(request, env, ctx) },
    defaultHandler: { fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx) },
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/oauth/token",
    clientRegistrationEndpoint: "/oauth/register",
    scopesSupported: ["notes"],
    accessTokenTTL: 60 * 60,
    resourceMetadata: { resource },
    // MCP apps connect with OAuth and an account (authorize.ts). Only the local test suites (AUTH_OPEN on localhost) may skip it.
    resolveExternalToken: async ({ token, env, request }) => (token && devOpen(env, request.url) ? { props: { via: "dev" }, audience: resource } : null),
  });
  providers.set(base, provider);
  return provider;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    // Everything private is encrypted, so without a valid DATA_KEY nothing can be read or written: fail closed.
    try { await Vault.configure(env); } catch (e) {
      const detail = e instanceof Vault.VaultError && e.message !== "no_data_key" ? e.message : "No data key is set. Make one with: npm run data:keygen -- --out <file> --put";
      return Response.json({ error: "no_data_key", detail }, { status: 503 });
    }
    const base = (env.PUBLIC_URL || new URL(request.url).origin).replace(/\/+$/, "");
    return providerFor(base).fetch(request, env, ctx);
  },
  // Every minute (see triggers in wrangler.jsonc): task notifications. Once a day, at 04:17 UTC, also drop
  // expired OAuth tokens and grants from KV.
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    try { await Vault.configure(env); } catch (e) { console.error("no usable DATA_KEY: skipping this run", e instanceof Error ? e.message : e); return; }
    const at = new Date(event.scheduledTime);
    if (at.getUTCHours() === 4 && at.getUTCMinutes() === 17) {
      const base = (env.PUBLIC_URL || "https://localhost").replace(/\/+$/, "");
      ctx.waitUntil(providerFor(base).purgeExpiredData(env).then((r) => console.log("oauth purge", JSON.stringify(r))));
      // The change feed keeps 180 days; record how far it was pruned so stale cursors get a clear error.
      const cutoff = event.scheduledTime - 180 * 86_400_000;
      ctx.waitUntil((async () => {
        const top = await env.DB.prepare("SELECT MAX(seq) AS s FROM changes WHERE created_at < ?").bind(cutoff).first<{ s: number | null }>();
        if (!top?.s) return;
        await env.DB.batch([
          env.DB.prepare("DELETE FROM changes WHERE seq <= ?").bind(top.s),
          env.DB.prepare("INSERT INTO prefs (key, value) VALUES ('changes_pruned_through', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(top.s)),
        ]);
      })().catch((e) => console.error("feed prune failed", e)));
      ctx.waitUntil(Backup.run(env).then((s) => console.log("backup", s.ok ? s.checked : s.error)));
    } else ctx.waitUntil(Backup.firstRun(env).then((s) => { if (s) console.log("first backup", s.ok ? s.checked : s.error); }).catch((e) => console.error("first backup failed", e)));
    try { const n = await Seal.maybeBackfill(env); if (n) console.log("sealed", n, "stored values"); } catch (e) { console.error("sealing failed", e); }
    try { await Sem.indexPending(env, 15); } catch (e) { console.error("indexing failed", e); }
    try {
      const r = await Push.runReminders(env, event.scheduledTime);
      if ("sent" in r && r.sent) console.log("reminders", JSON.stringify(r));
    } catch (e) { console.error("reminders failed", e); }
    // The proactive assistant: routines due now, and the hourly check-in (which also refreshes the suggestions).
    // Only when the user has turned proactive mode on (Settings > Routines); the default is on demand only.
    if (authMode(env) !== "none" && (await Pro.assistantMode(env.DB)) === "proactive") {
      try { const n = await Pro.dueRoutines(env, event.scheduledTime); if (n) console.log("routines ran", n); } catch (e) { console.error("routines failed", e); }
      try { const n = await Pro.hourly(env, event.scheduledTime); if (n !== null) console.log("check-in", n, "messages"); } catch (e) { console.error("check-in failed", e); }
      try { const n = await Tidy.weekly(env, event.scheduledTime); if (n !== null) console.log("tidy-up", n); } catch (e) { console.error("tidy-up failed", e); }
      try { const n = await Daily.wrapUp(env, event.scheduledTime); if (n) console.log("daily wrap-up"); } catch (e) { console.error("daily wrap-up failed", e); }
    }
  },
} satisfies ExportedHandler<Env>;
