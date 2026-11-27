import type { Note, SearchHit, TreeNode } from "./types";
/** One message in the ongoing conversation with the assistant (src/worker/thread.ts). */
export interface ThreadMessage {
  seq: number; id: string; role: "user" | "assistant" | "divider"; kind: "chat" | "proactive" | "routine" | "divider"; text: string; created_at: number;
  meta: { label?: string; page_id?: string | null; run_id?: string; changes?: number; cost?: number; error?: string; undone?: boolean; tools?: { id: string; name: string; label: string; ok: boolean; note_ids: string[]; game?: GameLink }[]; inbox_id?: string; title?: string; urgent?: boolean };
}
/** The proactive assistant (src/worker/proactive.ts). */
export type Proposal = { type: "add_task"; title: string; due: string | null; time: string | null } | { type: "flashcards"; page_id: string; cards: { q: string; a: string }[] } | { type: "study_plan"; title: string; sessions: { title: string; date: string; time?: string | null }[] } | TidyProposal;
export interface InboxItem { id: string; source: "checkin" | "routine"; kind: "note" | "proposal"; title: string; body: string; action: { prompt?: string; proposal?: Proposal; run_id?: string; note_ids?: string[] } | null; status: "new" | "accepted" | "dismissed" | "done"; urgent: boolean; feedback: number; created_at: number }
export interface SavedPrompt { id: string; name: string; text: string }
export interface Routine { id: string; name: string; prompt: string; days: number; time: string; notify: boolean; enabled: boolean; last_run: string | null }
import { enqueue, isNetworkError, OfflineQueued } from "./offline";
export interface Memory { id: string; text: string; source: string; created_at: number; updated_at: number }
/** A chat with Jeff as stored on the server (messages are the panel's own format). */
export interface SyncedChat { id: string; title: string; updated: number; msgs: unknown[] }
import type { CardState } from "./study/srs";
import type { GenQuiz, SetMode, StudySet, StudyChange } from "./study/generated";
import type { Spot } from "./study/weak";
import type { Step } from "./steps";
import type { Anchor, Comment } from "./comments";
import type { TidyProposal } from "./tidy";
import type { CoachReply, ExamGrade, ExplainCheck, ExplainPrompt, PageProgress, PlanSession, PlayedItem, PlayedSession, StudySession } from "./study/coach";
export type PastSummary = Pick<StudySession, "mode" | "ids" | "title" | "right" | "total"> & { id: string; created_at: number };
export interface StudyProgress { pages: Record<string, PageProgress>; week: { sessions: number; avg: number | null }; recent: PastSummary[] }
export type PastSession = StudySession & { id: string; created_at: number; played: PlayedItem[] | null };
/** A page in the Study tab ("cards" is approximate until the page is opened). */
export interface StudyDeck {
  id: string; title: string; icon: string | null; cards: number; due: number; new: number; learning: number; mastered: number;
  exam_ids: string[]; last_studied: number | null; updated_at: number; subject_id: string | null; excluded: boolean; pinned: boolean; done_at: number | null;
}
export interface StudyExam { id: string; subject_id: string; name: string; exam_date: string | null; position: number; done_at: number | null; created_at: number; page_ids: string[]; grade?: ExamGrade | null }
/** A syllabus as read from a photo (worker syllabus.ts). */
export interface SyllabusRead { subject: { name: string; icon: string | null }; tests: { name: string; date: string | null }[]; assignments: { title: string; due: string | null }[] }
export interface StudySubject { id: string; name: string; color: string; icon: string | null; exam_date: string | null; position: number; done_at: number | null; created_at: number; grade_class?: string | null }
/** Automatic backups (worker backup.ts). */
export interface BackupStatus { at: number; ok: boolean; name?: string; bytes?: number; rows?: number; tables?: number; error?: string; checked?: string }
export interface BackupItem { name: string; at: number; bytes: number }
/** Task notifications: the server's public key, preferences and the devices that have them on. */
export interface PushInfo {
  key: string | null;
  prefs: { digest: string; remind: string; weekly: string; quiet: string };
  devices: { endpoint: string; label: string; tz: string; created_at: number; seen_at: number; last_error: string | null }[];
}

export class Conflict extends Error { constructor(public current: Note) { super("conflict"); } }
export class ApiError extends Error { constructor(public status: number, message: string, public data: Record<string, unknown> = {}) { super(message); } }

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", ...init, headers: { "Content-Type": "application/json", ...init.headers } });
  if (res.status === 401) { onUnauthorized(); throw new ApiError(401, "unauthorized"); }
  if (res.status === 409) throw new Conflict(((await res.json()) as { current: Note }).current);
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, data.error ?? String(res.status), data as Record<string, unknown>);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}
const j = (o: unknown) => JSON.stringify(o);

export interface GameLink { mode: "quiz" | "blanks" | "match"; ids: string[]; title: string }
export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "tool_start"; id: string; name: string; label: string }
  | { type: "approval"; id: string; tool_id: string; detail: string }
  | { type: "approval_done"; id: string; tool_id: string; ok: boolean }
  | { type: "working"; name: string }
  | { type: "tool_result"; id: string; name: string; ok: boolean; label: string; note_ids: string[]; game?: GameLink }
  | { type: "done"; run_id: string; changes: number; usage: { input: number; output: number; cache_read: number; cache_write: number; cost_usd: number }; stop: string }
  | { type: "error"; message: string }
  /** The server saved a message of the thread (The user's first, then the reply with reply: true). */
  | { type: "saved"; id: string; seq: number; reply?: boolean };
export interface SetupData {
  checks: { id: string; label: string; ok: boolean; detail: string }[];
  mode: string;
  mcp: { url: string; claude_code: string };
  wif: { issuer: string; discovery: string; jwks: string; subject: string; audience: string; key_set: boolean; missing: string[] };
}
export type PermLevel = "allow" | "ask" | "never";
export type AgentPermissions = Record<"add" | "edit" | "delete" | "memory" | "routines" | "web", PermLevel>;
export interface Account { id: string; username: string; display_name: string; role: string }
/** An invite still waiting to be used (its code is only shown once, when it's made). */
export interface PendingInvite { id: string; role: string; label: string; created_at: number; expires_at: number }
/** AI limits an owner sets for a person (or, as "household", for everyone together). null = no limit. */
export interface Rules { daily_usd: number | null; monthly_usd: number | null; web: boolean; teach: boolean }
export interface UsageLine { name: string; label?: string; calls: number; cost_usd: number }
export interface MyUsage { date: string; today: number; month: number; household_month: number; by_feature: UsageLine[]; by_model: UsageLine[]; days: { day: string; cost_usd: number; calls: number }[]; rules: Rules }
export interface HouseholdUsage { people: { id: string; name: string; username: string; role: string; today: number; month: number; calls: number; rules: Rules }[]; household: { month: number; rules: Rules } }
/** The household's AI choices and keys (Setup and Settings > Setup & status). Key values are never sent back. */
export interface AiSetup {
  settings: { mode: "on" | "later" | "off"; models: string[]; web: boolean };
  mode: string; connected: boolean; owner: boolean; default_model: string;
  models: { id: string; label: string; blurb: string }[];
  keys: { name: string; label: string; example: string; source: "secret" | "saved" | null; saved: boolean; hint: string; updated_at: number | null }[];
}
/** Someone a page is shared with, and a page shared with you (sharing.ts). */
export interface PagePerson { id: string; person_id: string; level: "view" | "edit"; display_name: string; username: string }
export interface SharedWithMe { id: string; note_id: string; title: string; icon: string | null; level: "view" | "edit"; owner_name: string }
export interface NewInvite { code: string; link: string; role: string; expires_at: number }
export interface Household { mode: "individual" | "household"; name: string }
export interface SessionInfo { ai?: { mode: "on" | "later" | "off"; connected: boolean }; authed: boolean; setup?: boolean; no_tables?: boolean; code_required?: boolean; code_set?: boolean; user?: Account | null; household?: Household }
export interface RunSummary { run_id: string; source: string; agents: string[]; started_at: number; n: number; undone: number; state: "applied" | "undone" | "partial"; summary: string[] }
export type RunResult = { ok: true; run_id: string; changed: number } | { ok: false; error: string; conflicts?: { id: string; title: string }[] };

/** Streams the agent's newline-delimited JSON events. Throws ApiError("no_key") if the key isn't configured. */
async function agentStream(body: unknown, onEvent: (e: AgentEvent) => void, signal: AbortSignal) {
  const res = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal, credentials: "same-origin" });
  if (res.status === 401) { onUnauthorized(); throw new ApiError(401, "unauthorized"); }
  if (res.status === 503) throw new ApiError(503, "no_key");
  if (!res.ok || !res.body) throw new ApiError(res.status, ((await res.json().catch(() => ({}))) as { error?: string }).error ?? "agent failed");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line) { try { onEvent(JSON.parse(line) as AgentEvent); } catch { /* ignore a malformed line */ } }
    }
  }
}

export const api = {
  agentStatus: () => call<{ configured: boolean; model: string; mock: boolean; mode: string; models?: { id: string; label: string; blurb: string }[]; choice?: { model: string; web: boolean } }>("/api/agent/status"),
  /** Saves the chat's model / web switch for every device. */
  agentChoice: (c: { model?: string; web?: boolean }) => call<{ model: string; web: boolean }>("/api/agent/choice", { method: "PUT", body: JSON.stringify(c) }),
  agentTest: () => call<{ ok: boolean; mode: string; reply?: string; model?: string; status?: number | null; error?: string }>("/api/agent/test", { method: "POST" }),
  setup: () => call<SetupData>("/api/setup"),
  changes: (since: number) => call<{ now: number; changes: { id: string; revision: number; updated_at: number; deleted_at: number | null }[] }>(`/api/changes?since=${since}`),
  agentStream,
  runs: () => call<RunSummary[]>("/api/runs"),
  undoLatest: (force = false) => call<RunResult>("/api/runs/undo", { method: "POST", body: j({ force }) }),
  redoLatest: (force = false) => call<RunResult>("/api/runs/redo", { method: "POST", body: j({ force }) }),
  quick: (text: string, page_id?: string | null) => call<{ run_id: string; changes: number; done: string[]; failed: string[]; pages: string[]; line: string; error?: string }>("/api/quick", { method: "POST", body: j({ text, page_id }) }),
  undoRun: (id: string, force = false) => call<RunResult>(`/api/runs/${id}/undo`, { method: "POST", body: j({ force }) }),
  redoRun: (id: string, force = false) => call<RunResult>(`/api/runs/${id}/redo`, { method: "POST", body: j({ force }) }),
  session: () => call<SessionInfo>("/api/session"),
  login: (username: string, password: string) => call<{ ok: boolean }>("/api/login", { method: "POST", body: j({ username, password }) }),
  account: () => call<{ user: Account; household: Household; members: Account[] }>("/api/account"),
  renameMe: (display_name: string) => call<{ ok: boolean }>("/api/account", { method: "PATCH", body: j({ display_name }) }),
  changePassword: (current: string, next: string) => call<{ ok: boolean }>("/api/account/password", { method: "POST", body: j({ current, next }) }),
  signOutEverywhere: () => call<{ ok: boolean }>("/api/account/sign-out-everywhere", { method: "POST" }),
  setHousehold: (h: Partial<Household>) => call<{ ok: boolean; household: Household }>("/api/household", { method: "PUT", body: j(h) }),
  logout: () => call<{ ok: boolean }>("/api/logout", { method: "POST" }),
  members: () => call<Account[]>("/api/household/members"),
  invites: () => call<PendingInvite[]>("/api/household/invites"),
  invite: (role: "adult" | "owner" | "kid", label: string) => call<NewInvite>("/api/household/invites", { method: "POST", body: j({ role, label }) }),
  cancelInvite: (id: string) => call<{ ok: boolean }>(`/api/household/invites/${id}`, { method: "DELETE" }),
  setRole: (id: string, role: "adult" | "owner" | "kid") => call<{ ok: boolean }>(`/api/household/members/${id}`, { method: "PATCH", body: j({ role }) }),
  resetPassword: (id: string, password: string) => call<{ ok: boolean }>(`/api/household/members/${id}/password`, { method: "POST", body: j({ password }) }),
  usage: () => call<MyUsage>("/api/usage"),
  pagePeople: (id: string) => call<PagePerson[]>(`/api/notes/${id}/people`),
  sharePage: (id: string, person: string, level: "view" | "edit") => call<PagePerson[]>(`/api/notes/${id}/people/${person}`, { method: "PUT", body: j({ level }) }),
  unsharePage: (id: string, person: string) => call<PagePerson[]>(`/api/notes/${id}/people/${person}`, { method: "DELETE" }),
  sharedWithMe: () => call<SharedWithMe[]>("/api/shared-with-me"),
  shareInfo: () => call<{ id: string; level: "view" | "edit"; root_id: string; title: string; icon: string | null; owner_name: string }>("/api/share-info"),
  setupAi: () => call<AiSetup>("/api/setup/ai"),
  saveAiSettings: (p: Partial<AiSetup["settings"]>) => call<AiSetup["settings"]>("/api/setup/ai", { method: "PUT", body: j(p) }),
  saveKey: (name: string, value: string) => call<{ ok: boolean }>(`/api/setup/keys/${name}`, { method: "PUT", body: j({ value }) }),
  removeKey: (name: string) => call<{ ok: boolean }>(`/api/setup/keys/${name}`, { method: "DELETE" }),
  householdUsage: () => call<HouseholdUsage>("/api/household/usage"),
  setRules: (id: string, rules: Partial<Rules>) => call<Rules>(`/api/household/rules/${id}`, { method: "PUT", body: j(rules) }),
  removeMember: (id: string, confirm: string) => call<{ ok: boolean; left: boolean }>(`/api/household/members/${id}`, { method: "DELETE", body: j({ confirm }) }),

  tree: () => call<TreeNode[]>("/api/tree"),
  recent: () => call<TreeNode[]>("/api/recent"),
  home: () => call<{
    recent: (TreeNode & { cover: string | null; parent_title: string | null; parent_icon: string | null })[];
    upcoming: { id: string; title: string; icon: string | null; due: string; end?: string | null; start_time: string | null; end_time: string | null; db_id: string; db_title: string; db_icon: string | null; status: { name: string; color: string } | null }[];
  }>("/api/home"),
  search: (q: string) => call<SearchHit[]>(`/api/search?q=${encodeURIComponent(q)}`),
  // Jeff's memory and synced chats.
  memories: () => call<Memory[]>("/api/memories"),
  addMemory: (text: string) => call<Memory>("/api/memories", { method: "POST", body: j({ text }) }),
  updateMemory: (id: string, text: string) => call<{ ok: true }>(`/api/memories/${id}`, { method: "PATCH", body: j({ text }) }),
  deleteMemory: (id: string) => call<{ ok: boolean }>(`/api/memories/${id}`, { method: "DELETE" }),
  chats: () => call<SyncedChat[]>("/api/chats"),
  putChat: (c: SyncedChat) => call<{ ok: true }>(`/api/chats/${c.id}`, { method: "PUT", body: j(c) }),
  deleteChat: (id: string) => call<{ ok: true }>(`/api/chats/${id}`, { method: "DELETE" }),
  ensureGrades: () => call<{ id: string; created: boolean; trashed: boolean }>("/api/grades/ensure", { method: "POST", body: "{}" }),
  studyStreak: (today: string, tzOffset: number) => call<{ streak: number; today: boolean; days: number; dates: string[] }>(`/api/study-streak?today=${today}&tz_offset=${tzOffset}`),
  // Quick capture, voice notes, search by meaning (src/worker/semantic.ts).
  capture: (b: { text?: string; title?: string; url?: string; type?: string; today?: string; tz?: string }) => call<{ ok: boolean; kind: string; id: string; title?: string }>("/api/capture", { method: "POST", body: j(b) }),
  captureStatus: () => call<{ enabled: boolean }>("/api/capture/status"),
  captureMakeToken: () => call<{ token: string }>("/api/capture/token", { method: "POST", body: "{}" }),
  captureRevoke: () => call<{ ok: true }>("/api/capture/token", { method: "DELETE" }),
  /** Live voice: the recording so far in, the words and the quiet time since the last one out. Nothing is stored. */
  hear: async (audio: Blob, type: string) => {
    const lang = (navigator.language || "").slice(0, 2).toLowerCase();
    const res = await fetch(`/api/voice/hear${/^[a-z]{2}$/.test(lang) ? `?lang=${lang}` : ""}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": type }, body: audio });
    if (res.status === 401) { onUnauthorized(); throw new ApiError(401, "unauthorized"); }
    const out = (await res.json().catch(() => ({}))) as { text?: string; duration?: number; quiet?: number; error?: string };
    if (!res.ok) throw new ApiError(res.status, out.error ?? String(res.status));
    return { text: String(out.text ?? "").trim(), duration: Number(out.duration) || 0, quiet: Number(out.quiet) || 0 };
  },
  transcribe: async (audio: Blob, type: string) => {
    const res = await fetch("/api/ai/transcribe", { method: "POST", credentials: "same-origin", headers: { "Content-Type": type }, body: audio });
    if (res.status === 401) { onUnauthorized(); throw new ApiError(401, "unauthorized"); }
    const out = (await res.json().catch(() => ({}))) as { text?: string; url?: string; error?: string };
    if (!res.ok) throw new ApiError(res.status, out.error ?? String(res.status));
    return out as { text: string; url: string };
  },
  // One-shot Jeff tools (src/worker/ai.ts).
  inbox: (newOnly = false) => call<{ items: InboxItem[]; unread: number }>(`/api/inbox${newOnly ? "?status=new" : "?limit=100"}`),
  inboxAct: (id: string, action: "accept" | "dismiss" | "done" | "read", today?: string) => call<{ ok: boolean; run_id?: string; note_ids?: string[] }>(`/api/inbox/${id}`, { method: "POST", body: j({ action, today }) }),
  inboxFeedback: (id: string, value: number) => call<{ ok: boolean }>(`/api/inbox/${id}/feedback`, { method: "POST", body: j({ value }) }),
  checkinNow: () => call<{ messages: number }>("/api/checkin/run", { method: "POST" }),
  prompts: () => call<SavedPrompt[]>("/api/prompts"),
  savePrompt: (p: Partial<SavedPrompt>) => call<SavedPrompt>("/api/prompts", { method: "PUT", body: j(p) }),
  deletePrompt: (id: string) => call<{ ok: boolean }>(`/api/prompts/${id}`, { method: "DELETE" }),
  assistantMode: () => call<{ mode: "on_demand" | "proactive" }>("/api/assistant-mode"),
  setAssistantMode: (mode: "on_demand" | "proactive") => call<{ mode: "on_demand" | "proactive" }>("/api/assistant-mode", { method: "PUT", body: j({ mode }) }),
  routines: () => call<Routine[]>("/api/routines"),
  saveRoutine: (r: Partial<Routine>) => call<Routine>("/api/routines", { method: "PUT", body: j(r) }),
  deleteRoutine: (id: string) => call<{ ok: boolean }>(`/api/routines/${id}`, { method: "DELETE" }),
  runRoutine: (id: string) => call<{ id: string; run_id: string; error: string | null }>(`/api/routines/${id}/run`, { method: "POST" }),
  thread: (opts: { before?: number; after?: number; limit?: number } = {}) => call<{ messages: ThreadMessage[]; unread: number; last: number }>(`/api/thread?tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}${opts.before !== undefined ? `&before=${opts.before}` : ""}${opts.after !== undefined ? `&after=${opts.after}` : ""}${opts.limit ? `&limit=${opts.limit}` : ""}`),
  threadUnread: () => call<{ unread: number }>("/api/thread/unread"),
  threadRead: (seq: number) => call<{ unread: number }>("/api/thread/read", { method: "POST", body: j({ seq }) }),
  threadDivider: () => call<{ id: string; seq: number }>("/api/thread/divider", { method: "POST" }),
  threadPatch: (id: string, patch: { undone: boolean }) => call<{ ok: boolean }>(`/api/thread/${id}`, { method: "PATCH", body: j(patch) }),
  aiWrite: (o: { instruction: string; title: string; before: string; after: string; model?: string; page_id?: string }) => call<{ html: string }>("/api/ai/write", { method: "POST", body: j(o) }),
  aiSelection: (action: string, html: string, model?: string, page_id?: string) => call<{ html?: string; explanation?: string }>("/api/ai/selection", { method: "POST", body: j({ action, html, model, page_id }) }),
  aiPhoto: (b: { image: string; media_type: string; parent_id: string | null; flashcards: boolean; model?: string }) => call<{ id: string; title: string }>("/api/ai/photo", { method: "POST", body: j(b) }),
  aiQuiz: (ids: string[], count: number, model?: string) => call<{ questions: { type: "mcq" | "short"; q: string; options?: string[]; answer: number | string; explanation?: string }[] }>("/api/ai/quiz", { method: "POST", body: j({ ids, count, model }) }),
  studySet: (ids: string[], mode: SetMode, fresh: boolean, model?: string, change?: StudyChange) => call<StudySet & { cached: boolean; created_at: number }>("/api/ai/study-set", { method: "POST", body: j({ ids, mode, fresh, model, change }) }),
  /** A finished session: saved, and what the assistant says about it (unless coach is false). */
  studySession: (session: PlayedSession, coach = true) => call<{ saved: true; coach?: CoachReply }>("/api/study/session", { method: "POST", body: j({ session, coach }) }),
  /** History: finished quizzes and tests, newest first, optionally only those on these pages. */
  studyHistory: (ids?: string[]) => call<{ sessions: PastSummary[] }>(`/api/study-history${ids?.length ? `?ids=${ids.join(",")}` : ""}`),
  studyPast: (id: string) => call<PastSession>(`/api/study-history/${id}`),
  aiCards: (id: string, model?: string) => call<{ added: number; run_id: string | null; title: string }>("/api/ai/cards", { method: "POST", body: j({ id, model }) }),
  aiGrade: (items: { q: string; expected: string; answer: string }[], model?: string) => call<{ results: { correct: boolean; feedback: string }[] }>("/api/ai/grade", { method: "POST", body: j({ items, model }) }),
  // Task notifications (Web Push).
  push: () => call<PushInfo>("/api/push"),
  pushSubscribe: (sub: { endpoint: string; keys: { p256dh: string; auth: string }; tz: string; label: string }) => call<{ ok: true }>("/api/push/subscribe", { method: "POST", body: j(sub) }),
  pushUnsubscribe: (endpoint: string) => call<{ ok: boolean }>("/api/push/unsubscribe", { method: "POST", body: j({ endpoint }) }),
  pushPrefs: (p: Partial<PushInfo["prefs"]>) => call<PushInfo["prefs"]>("/api/push/prefs", { method: "PUT", body: j(p) }),
  pushTest: (endpoint?: string) => call<{ sent: number; failed: number; errors: string[] }>("/api/push/test", { method: "POST", body: j({ endpoint }) }),
  // Study mode (flashcards): progress per card, keyed by page and a hash of the question.
  studyStates: (id: string) => call<({ card_id: string } & CardState)[]>(`/api/study/${id}`),
  studySave: (id: string, card: string, s: CardState) => call<{ ok: true }>(`/api/study/${id}/${card}`, { method: "PUT", body: j(s) }),
  studyPrune: (id: string, keep: string[]) => call<{ ok: true }>(`/api/study/${id}/prune`, { method: "POST", body: j({ keep }) }),
  studyOverview: (today: string) => call<{ subjects: StudySubject[]; exams: StudyExam[]; decks: StudyDeck[]; progress: StudyProgress; misses?: { open: number; due: number } }>(`/api/study-overview?today=${today}`),
  explainPrompts: (ids: string[], count: number, model?: string) => call<{ prompts: ExplainPrompt[] }>("/api/ai/explain", { method: "POST", body: j({ ids, count, model }) }),
  checkExplain: (b: { ids: string[]; q: string; points: string[]; answer: string; model?: string }) => call<ExplainCheck>("/api/ai/explain/check", { method: "POST", body: j(b) }),
  logGrade: (id: string, b: { score: string; outof: string } | { skip: true }) => call<{ exam: StudyExam; gap: { n: number; avg: number } | null }>(`/api/study-exams/${id}/grade`, { method: "POST", body: j(b) }),
  clearGrade: (id: string) => call<StudyExam>(`/api/study-exams/${id}/grade`, { method: "DELETE" }),
  daily: (date: string) => call<{ id: string; title: string; created: boolean }>("/api/daily", { method: "POST", body: j({ date }) }),
  dailyWrap: (id: string, date: string) => call<{ run_id: string; lines: string[] } | null>(`/api/daily/${id}/wrapup`, { method: "POST", body: j({ date }) }),
  tidyNow: () => call<{ proposed: number }>("/api/tidy", { method: "POST" }),
  stepsDraft: (id: string, model?: string) => call<{ title: string; due: string | null; steps: Step[] }>(`/api/tasks/${id}/steps/draft`, { method: "POST", body: j({ model }) }),
  stepsAdd: (id: string, steps: Step[]) => call<{ run_id: string; note_ids: string[] }>(`/api/tasks/${id}/steps`, { method: "POST", body: j({ steps }) }),
  steps: (id: string) => call<{ steps: { id: string; title: string; done: boolean; due: string | null }[] }>(`/api/tasks/${id}/steps`),
  lecture: (b: { transcript: string; title: string; subject_id: string | null; minutes: number; model?: string }) => call<{ id: string; title: string; run_id: string }>("/api/ai/lecture", { method: "POST", body: j(b) }),
  syllabusRead: async (file: Blob, model?: string) => {
    const b64 = await new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] ?? ""); r.onerror = () => no(new Error("couldn't read the photo")); r.readAsDataURL(file); });
    return call<SyllabusRead>("/api/syllabus/read", { method: "POST", body: j({ image: b64, mediaType: file.type, model }) });
  },
  syllabusAdd: (b: SyllabusRead & { color: string }) => call<{ subject_id: string; created_subject: boolean; exam_ids: string[]; run_id: string | null; tasks: number }>("/api/syllabus", { method: "POST", body: j(b) }),
  syllabusUndo: (b: { subject_id: string; created_subject: boolean; exam_ids: string[]; run_id: string | null }) => call<{ ok: true }>("/api/syllabus/undo", { method: "POST", body: j(b) }),
  handwriting: async (png: Blob, model?: string) => {
    const b64 = await new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] ?? ""); r.onerror = () => no(new Error("couldn't read the drawing")); r.readAsDataURL(png); });
    return call<{ html: string }>("/api/ai/handwriting", { method: "POST", body: j({ image: b64, mediaType: "image/png", model }) });
  },
  related: (id: string, text?: string) => call<{ hits: { id: string; title: string; icon: string | null; score: number; snippet: string }[] }>(`/api/notes/${id}/related`, { method: "POST", body: j({ text }) }),
  weakSpots: (id: string) => call<{ spots: Spot[] }>(`/api/notes/${id}/weak-spots`),
  studyInsights: () => call<{ lines: string[]; timed_answers: number; sessions: number }>("/api/study-insights"),
  backups: () => call<{ status: BackupStatus | null; backups: BackupItem[]; keep: number }>("/api/backups"),
  backupNow: () => call<BackupStatus>("/api/backups", { method: "POST" }),
  examPlan: (id: string) => call<{ test: string; exam_date: string; sessions: PlanSession[]; drafted: boolean }>(`/api/study-exams/${id}/plan`, { method: "POST" }),
  addPlan: (sessions: PlanSession[]) => call<{ run_id: string; note_ids: string[] }>("/api/study/plan", { method: "POST", body: j({ sessions }) }),
  missReview: () => call<{ mode: "quiz"; items: GenQuiz[]; ids: string[]; title: string; due: number }>("/api/study/misses/review", { method: "POST" }),
  createExam: (b: { subject: string; name: string; exam_date?: string | null; pages?: string[] }) => call<StudyExam>("/api/study-exams", { method: "POST", body: j(b) }),
  updateExam: (id: string, b: { name?: string; exam_date?: string | null; done?: boolean; pages?: string[] }) => call<StudyExam>(`/api/study-exams/${id}`, { method: "PATCH", body: j(b) }),
  deleteExam: (id: string) => call<StudyExam>(`/api/study-exams/${id}`, { method: "DELETE" }),
  createSubject: (b: { name: string; color?: string; icon?: string | null; exam_date?: string | null }) => call<StudySubject>("/api/study-subjects", { method: "POST", body: j(b) }),
  subjectHub: (id: string, today: string) => call<{
    class: { id: string; name: string } | null; classes: { id: string; name: string }[]; linked: boolean;
    average: { pct: number | null; letter: string | null; graded: number } | null;
    grades: { id: string; title: string; pct: number; date: string | null; category: string | null }[];
    next: { id: string; name: string; exam_date: string | null; outlook: { line: string; keep: { letter: string; need: number } | null; up: { letter: string; need: number } | null } | null } | null;
    tasks: { id: string; title: string; due: string | null; done: boolean }[]; tag: string | null;
  }>(`/api/study-subjects/${id}/hub?today=${today}`),
  updateSubject: (id: string, b: { name?: string; color?: string; icon?: string | null; exam_date?: string | null; done?: boolean; position?: number; grade_class?: string | null }) => call<StudySubject>(`/api/study-subjects/${id}`, { method: "PATCH", body: j(b) }),
  deleteSubject: (id: string) => call<StudySubject>(`/api/study-subjects/${id}`, { method: "DELETE" }),
  setStudyPage: (id: string, b: { subject?: string | null; exam?: string | null; done?: boolean; excluded?: boolean; pinned?: boolean }) => call<{ page_id: string }>(`/api/study-pages/${id}`, { method: "PUT", body: j(b) }),
  studyDue: (today: string) => call<{ id: string; title: string; icon: string | null; due: number }[]>(`/api/study-due?today=${today}`),
  get: (id: string) => call<Note>(`/api/notes/${id}`),
  agentPermissions: () => call<{ permissions: AgentPermissions; presets: Record<string, AgentPermissions> }>("/api/agent/permissions"),
  setAgentPermissions: (p: Partial<AgentPermissions>) => call<{ permissions: AgentPermissions }>("/api/agent/permissions", { method: "PUT", body: j(p) }),
  answerApproval: (id: string, ok: boolean) => call<{ ok: boolean }>(`/api/agent/approvals/${id}`, { method: "POST", body: j({ ok }) }),
  ensureCalendar: () => call<{ id: string; created: boolean; trashed: boolean }>("/api/calendar/ensure", { method: "POST" }),
  ensureTasks: () => { const d = new Date(); const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; return call<{ id: string; created: boolean; trashed: boolean }>("/api/tasks/ensure", { method: "POST", body: j({ today }) }); },
  children: (id: string) => call<Note[]>(`/api/notes/${id}/children`),
  create: (input: Omit<Partial<Note>, "props" | "db_schema" | "is_template"> & { template_id?: string; props?: unknown; db_schema?: unknown; is_template?: boolean | number } = {}) =>
    call<Note>("/api/notes", { method: "POST", body: j(input) }).catch((e) => { throw isNetworkError(e) ? new ApiError(0, "You're offline. New pages need a connection.") : e; }),
  /** Saves an edit. If the network is down the edit is kept in a durable queue on this device (offline.ts) and
   *  OfflineQueued is thrown, so callers keep their optimistic state instead of reporting a failure. */
  patch: async (id: string, patch: Record<string, unknown>) => {
    if (!navigator.onLine) { enqueue(id, patch); throw new OfflineQueued(); }
    try { return await api.patchNow(id, patch); }
    catch (e) { if (isNetworkError(e)) { enqueue(id, patch); throw new OfflineQueued(); } throw e; }
  },
  patchNow: async (id: string, patch: Record<string, unknown>) => {
    const note = await call<Note>(`/api/notes/${id}`, { method: "PATCH", body: j(patch) });
    // Tell the open page (if any) so it adopts the new revision instead of tripping a false conflict.
    window.dispatchEvent(new CustomEvent("seaglass:note-patched", { detail: { id, note } }));
    return note;
  },
  trash: (id: string) => call<void>(`/api/notes/${id}`, { method: "DELETE" }),
  restore: (id: string) => call<Note>(`/api/notes/${id}/restore`, { method: "POST" }),
  purge: (id: string) => call<void>(`/api/notes/${id}/purge`, { method: "DELETE" }),
  emptyTrash: () => call<{ purged: number }>("/api/trash", { method: "DELETE" }),
  trashList: () => call<(TreeNode & { deleted_at: number })[]>("/api/trash"),
  duplicate: (id: string) => call<Note>(`/api/notes/${id}/duplicate`, { method: "POST" }),
  backlinks: (id: string) => call<TreeNode[]>(`/api/notes/${id}/backlinks`),
  history: (id: string) => call<{ id: number; source: string; agent?: string | null; tool: string; created_at: number }[]>(`/api/notes/${id}/history`),
  version: (id: string, aid: number) => call<{ snapshot: Partial<Note>; created_at: number }>(`/api/notes/${id}/history/${aid}`),
  restoreVersion: (id: string, aid: number) => call<Note>(`/api/notes/${id}/history/${aid}/restore`, { method: "POST" }),
  aiHidden: (id: string, hidden: boolean) => call<{ ai_hidden: number }>(`/api/notes/${id}/ai-hidden`, { method: "POST", body: j({ hidden }) }),
  share: (id: string, enabled: boolean) => call<{ share_slug: string | null }>(`/api/notes/${id}/share`, { method: "POST", body: j({ enabled }) }),
  comments: (id: string) => call<Comment[]>(`/api/notes/${id}/comments`),
  addComment: (id: string, body: string, anchor?: Anchor | null) => call<Comment>(`/api/notes/${id}/comments`, { method: "POST", body: j({ body, anchor: anchor ?? undefined }) }),
  resolveComment: (cid: string, resolved: boolean, outcome?: "accepted" | "rejected") => call<void>(`/api/comments/${cid}`, { method: "PATCH", body: j({ resolved, outcome }) }),
  deleteComment: (cid: string) => call<void>(`/api/comments/${cid}`, { method: "DELETE" }),
  unfurl: (url: string) => call<{ url: string; title: string; description: string; image: string; host: string }>(`/api/unfurl?url=${encodeURIComponent(url)}`),
  exportAll: () => call<unknown>("/api/export"),
  importAll: (data: unknown) => call<{ notes: number }>("/api/import", { method: "POST", body: j(data) }),

  async upload(file: File | Blob, name = (file as File).name || "file") {
    const res = await fetch(`/api/upload?name=${encodeURIComponent(name)}`, { method: "POST", body: file, headers: { "Content-Type": file.type } });
    if (res.status === 401) { onUnauthorized(); throw new ApiError(401, "unauthorized"); }
    const data = (await res.json()) as { url?: string; error?: string };
    if (!res.ok || !data.url) throw new ApiError(res.status, data.error ?? "upload failed");
    return data.url;
  },
};
