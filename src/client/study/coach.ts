// The assistant's message after a study session: checks the session the app reports and the reply the model writes,
// and supplies a warm message and sensible next steps when the model can't be reached. Pure and DOM-free, shared by the
// Worker and the app: tests/unit/study-coach.test.mjs.
import type { StudySet } from "./generated.ts";
export type SessionMode = "cards" | "quiz" | "blanks" | "match" | "test" | "explain" | "chat" | "focus"; // focus: a focus-timer round on something to study (Home), unscored
export interface SessionMiss { q: string; a: string; yours?: string }
/** seconds: how long it took (absent on older sessions, or one left open for hours). */
export interface StudySession { mode: SessionMode; ids: string[]; title: string; right: number; total: number; missed: SessionMiss[]; seconds?: number }
/** What a button under the message does. harder / easier / focus rewrite the questions; the rest open a way to study. */
export type CoachDo = "harder" | "easier" | "focus" | "quiz" | "blanks" | "match" | "test" | "explain" | "cards" | "plan" | "chat";
export interface CoachOffer { label: string; do: CoachDo }
export interface CoachReply { text: string; offers: CoachOffer[] }

const MODES: SessionMode[] = ["cards", "quiz", "blanks", "match", "test", "explain", "chat", "focus"];
const DOS: CoachDo[] = ["harder", "easier", "focus", "quiz", "blanks", "match", "test", "explain", "cards", "plan", "chat"];
const MAX_SECONDS = 6 * 3600; // longer than this and it was left open, so the number would mislead
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const count = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 10_000 ? v : -1);

export const LABELS: Record<CoachDo, string> = {
  harder: "Make it harder", easier: "Make it easier", focus: "Quiz me on what I missed", quiz: "Try a quiz", blanks: "Try fill in the blanks",
  match: "Try match", test: "Take a practice test", explain: "Explain it in my words", cards: "Review flashcards", plan: "Make a study plan", chat: "Talk it through",
};
const NAMES: Record<SessionMode, string> = { cards: "flashcards", quiz: "a quiz", blanks: "fill in the blanks", match: "match", test: "a practice test", explain: "Explain it", chat: "a study chat", focus: "a focus session" };

/** A session as reported by the app, or null if it isn't one. Lists are capped so a row stays small. */
export function cleanSession(raw: unknown): StudySession | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const mode = MODES.find((m) => m === r.mode), right = count(r.right), total = count(r.total);
  const ids = [...new Set((Array.isArray(r.ids) ? r.ids : []).filter((x): x is string => typeof x === "string" && UUID.test(x)))].slice(0, 20);
  if (!mode || !ids.length || right < 0 || total < 0 || right > total || (!total && mode !== "chat" && mode !== "focus")) return null;
  const missed: SessionMiss[] = [];
  for (const m of (Array.isArray(r.missed) ? r.missed : []).slice(0, 30) as Record<string, unknown>[]) {
    const q = str(m?.q, 300), a = str(m?.a, 300), yours = str(m?.yours, 200);
    if (q && a) missed.push({ q, a, ...(yours ? { yours } : {}) });
  }
  const secs = typeof r.seconds === "number" && Number.isFinite(r.seconds) ? Math.round(r.seconds) : 0;
  return { mode, ids, title: str(r.title, 160) || "your notes", right, total, missed, ...(secs > 0 && secs <= MAX_SECONDS ? { seconds: secs } : {}) };
}

export const pctOf = (s: { right: number; total: number }) => (s.total ? Math.round((s.right / s.total) * 100) : 0);

/** Sensible next steps for a score: easier ground when it went badly, a real push when it went well. */
export function defaultOffers(s: StudySession): CoachOffer[] {
  const p = pctOf(s), of = (d: CoachDo): CoachOffer => ({ do: d, label: LABELS[d] });
  const other: CoachDo = s.mode === "quiz" || s.mode === "test" ? "blanks" : "quiz";
  const change: CoachDo[] = p >= 90 ? ["harder", other] : p >= 60 ? (s.missed.length ? ["focus", "harder"] : ["harder", other]) : (s.missed.length ? ["focus", "easier"] : ["easier", other]);
  return [...change.map(of), of("plan"), of("chat")];
}

/** What's shown when the model can't be reached. It still has to be true, so it only uses the score. */
export function fallbackText(s: StudySession) {
  const p = pctOf(s), n = s.missed.length;
  if (p === 100) return `All ${s.total} right on ${s.title}. That's the kind of session that shows up on test day.`;
  if (p >= 80) return `${p}% on ${s.title}, that's strong.${n ? ` Just ${n} left to lock in.` : ""} Want to push it further?`;
  if (p >= 50) return `${p}% and you stuck with it, which is how this stuff sticks.${n ? ` Let's go after the ${n} you missed.` : ""}`;
  return "Tough round, and you finished it anyway. Now we know exactly what to work on, so let's make the next one easier to win.";
}

/** The model's reply, made safe: real text, buttons that do something here, and always a way to change the questions, plan and talk. */
export function cleanCoach(raw: unknown, s: StudySession): CoachReply {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const text = str(r.text, 600) || fallbackText(s);
  const usable = (d: CoachDo) => d !== (s.mode as string) && !(d === "focus" && !s.missed.length);
  const seen = new Set<CoachDo>(), given: CoachOffer[] = [];
  for (const o of (Array.isArray(r.offers) ? r.offers : []) as Record<string, unknown>[]) {
    const d = DOS.find((x) => x === o?.do);
    if (d && usable(d) && !seen.has(d)) { seen.add(d); given.push({ do: d, label: str(o.label, 34) || LABELS[d] }); }
  }
  const keeper = (o: CoachOffer) => o.do === "plan" || o.do === "chat";
  const defaults = defaultOffers(s).filter((o) => usable(o.do) && !keeper(o) && !seen.has(o.do));
  const change = [...given.filter((o) => !keeper(o)), ...defaults].slice(0, 2);
  const pick = (d: CoachDo) => given.find((o) => o.do === d) ?? { do: d, label: LABELS[d] };
  return { text, offers: [...change, pick("plan"), pick("chat")] };
}

/** The result in a sentence, for what the assistant is told when a button opens the chat. */
function resultLine(s: StudySession) {
  const missed = s.missed.slice(0, 12).map((m) => `- ${m.q} (answer: ${m.a}${m.yours ? `; I said: ${m.yours}` : ""})`).join("\n");
  return `I just did ${NAMES[s.mode]} on "${s.title}" and got ${s.right} of ${s.total} (${pctOf(s)}%).${missed ? `\nWhat I missed:\n${missed}` : ""}`;
}
export interface ChatOpener { message: string; label: string }
export const planOpener = (s: StudySession): ChatOpener => ({ label: "Make a study plan", message: `${resultLine(s)}\n\nHelp me make a study plan from here so I get the best grade I can. Ask me anything you need to know first (keep it to one quick question), then propose real study sessions with dates.` });
export const talkOpener = (s: StudySession, said: string): ChatOpener => ({ label: "Talk it through", message: `${resultLine(s)}\n\nYou said: "${said.slice(0, 600)}"\n\nLet's work through it together, starting with what I need most.` });

// ---------------------------------------------------------------- the whole session, to look back on or retake
/** One question as it was played. mcq: quiz and practice test; short: written answer; blank: fill in the blanks; pair: match. */
export interface PlayedItem {
  type: "mcq" | "short" | "blank" | "pair"; q: string; answer: string; right: boolean;
  yours?: string; why?: string; feedback?: string;
  options?: string[]; correct?: number;
  before?: string; after?: string; clue?: string;
  miss?: string; // a missed question brought back for review (worker misses.ts): which one
  secs?: number; // seconds spent on it, from showing the question to answering (studyInsights)
}
export type PlayedSession = StudySession & { played?: PlayedItem[] };
export interface TestQuestion { type: "mcq" | "short"; q: string; options?: string[]; answer: number | string; explanation?: string }

const PLAYS: Partial<Record<SessionMode, PlayedItem["type"][]>> = { quiz: ["mcq"], blanks: ["blank"], match: ["pair"], test: ["mcq", "short"], explain: ["short"] };
const spaced = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").slice(0, max) : ""); // the spaces around a gap matter

/** The questions as reported by the app, or null if there are none. A malformed one is dropped: it couldn't be retaken. */
export function cleanPlayed(raw: unknown, mode: SessionMode): PlayedItem[] | null {
  const types = PLAYS[mode];
  if (!types || !Array.isArray(raw)) return null;
  const out: PlayedItem[] = [];
  for (const r of raw.slice(0, 100) as Record<string, unknown>[]) {
    const type = types.find((t) => t === r?.type), q = str(r?.q, 600), answer = str(r?.answer, 1000);
    if (!type || !q || !answer) continue;
    const item: PlayedItem = { type, q, answer, right: r.right === true };
    const yours = str(r.yours, 1000), why = str(r.why, 600), feedback = str(r.feedback, 600);
    if (yours) item.yours = yours;
    if (why) item.why = why;
    if (feedback) item.feedback = feedback;
    if (typeof r.miss === "string" && /^[0-9a-f-]{36}$/.test(r.miss)) item.miss = r.miss;
    const secs = cleanSecs(r.secs);
    if (secs !== undefined) item.secs = secs;
    if (type === "mcq") {
      const given = Array.isArray(r.options) ? r.options : [], options = given.map((o) => str(o, 400)).filter(Boolean), c = r.correct;
      if (options.length !== given.length || options.length < 2 || options.length > 6) continue;
      if (typeof c !== "number" || !Number.isInteger(c) || c < 0 || c >= options.length) continue;
      item.options = options; item.correct = c;
    } else if (type === "blank") {
      const before = spaced(r.before, 600), after = spaced(r.after, 600), clue = str(r.clue, 400);
      if (!before.trim() && !after.trim()) continue;
      item.before = before; item.after = after;
      if (clue) item.clue = clue;
    }
    out.push(item);
  }
  return out.length ? out : null;
}

/** A played question as a line in the review list. */
export const reviewOf = (x: PlayedItem) => ({
  q: x.q, right: x.right, answer: x.answer,
  yours: x.type === "pair" ? x.answer : x.yours ?? (x.type === "short" ? "(blank)" : undefined),
  note: x.feedback || (x.right ? undefined : x.why),
});

/** The same questions again, as a game. */
export function setFromPlayed(mode: "quiz" | "blanks" | "match", items: PlayedItem[]): StudySet {
  if (mode === "quiz") return { mode, items: items.filter((x) => x.type === "mcq").map((x) => ({ q: x.q, options: x.options ?? [], answer: x.correct ?? 0, ...(x.why ? { why: x.why } : {}), ...(x.miss ? { miss: x.miss } : {}) })) };
  if (mode === "blanks") return { mode, items: items.filter((x) => x.type === "blank").map((x) => ({ before: x.before ?? "", answer: x.answer, after: x.after ?? "", ...(x.clue ? { clue: x.clue } : {}) })) };
  return { mode, items: items.filter((x) => x.type === "pair").map((x) => ({ term: x.q, match: x.answer })) };
}

/** The same questions again, as a practice test. */
export const testFromPlayed = (items: PlayedItem[]): TestQuestion[] => items.filter((x) => x.type === "mcq" || x.type === "short").map((x) => ({
  type: x.type === "mcq" ? "mcq" : "short", q: x.q, ...(x.type === "mcq" ? { options: x.options, answer: x.correct ?? 0 } : { answer: x.answer }), ...(x.why ? { explanation: x.why } : {}),
}));

// ---------------------------------------------------------------- how it's going, from finished sessions
export interface PageProgress { sessions: number; last_at: number; last_mode: SessionMode; last_pct: number | null; score: number | null }

/**
 * How much a result says about being ready for the real test. A practice test is the closest thing to it; a quiz or blanks
 * make them recall; Match and flashcards are easier to do well on. Chat has no score.
 */
export const MODE_WEIGHT: Record<SessionMode, number> = { test: 3, explain: 3, quiz: 2, blanks: 2, match: 1, cards: 1, chat: 0, focus: 0 };
/** Without a quiz, blanks or practice test among the recent results, a page can't look more ready than this. */
export const UNTESTED_CAP = 85;
const TESTED = new Set<SessionMode>(["test", "explain", "quiz", "blanks"]);
export type Mark = number | { pct: number; mode: SessionMode };

/**
 * A page's score from its recent results, newest first: the last five, newer ones counting more, and harder ways of studying
 * counting more (MODE_WEIGHT), so "ready" means ready. A plain number counts as a test result.
 */
export function readiness(marks: Mark[]): number | null {
  const recent = marks.map((m) => (typeof m === "number" ? { pct: m, mode: "test" as SessionMode } : m)).filter((m) => MODE_WEIGHT[m.mode] > 0).slice(0, 5);
  if (!recent.length) return null;
  let sum = 0, weight = 0;
  recent.forEach((m, i) => { const w = (5 - i) * MODE_WEIGHT[m.mode]; sum += m.pct * w; weight += w; });
  const score = Math.round(sum / weight);
  return recent.some((m) => TESTED.has(m.mode)) ? score : Math.min(score, UNTESTED_CAP);
}

// ---------------------------------------------------------------- missed questions coming back (worker misses.ts)
export const MISS_FIRST_DAYS = 2, MISS_AGAIN_DAYS = 4, MISS_RIGHTS = 2;
export interface MissState { rights: number; misses: number; due_at: number }

/**
 * What one answer does to a question the user once missed. Wrong: it comes back in two days. Right once it's due: one step closer,
 * back in four days; right twice: "gone". Right before it's due: no change (the same object), since spacing is the point.
 * Right on a question never missed: null (nothing to keep).
 */
export function missAfter<T extends MissState>(prev: T | null, right: boolean, now: number): MissState | T | "gone" | null {
  if (!right) return { rights: 0, misses: (prev?.misses ?? 0) + 1, due_at: now + MISS_FIRST_DAYS * 864e5 };
  if (!prev) return null;
  if (prev.due_at > now) return prev;
  const rights = prev.rights + 1;
  return rights >= MISS_RIGHTS ? "gone" : { rights, misses: prev.misses, due_at: now + MISS_AGAIN_DAYS * 864e5 };
}

/** `exam`: the test this page is being studied for. id is null when the date is on the subject itself. */
export interface NextPage { id: string; title: string; score: number | null; last_at: number | null; exam: { id: string | null; name: string; exam_date: string | null } | null }
export interface NextStudy { id: string; title: string; mode: "quiz" | "test"; text: string; exam_id: string | null }

const dayGap = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 864e5);
const WEEK2 = 14, DAY_MS = 864e5;

/** The one thing most worth doing now: what's graded soonest and weakest, then low scores, then anything never tried or gone stale. */
export function nextStudy(pages: NextPage[], today: string, now: number): NextStudy | null {
  const rows = pages.map((p) => {
    const gap = p.exam?.exam_date ? dayGap(today, p.exam.exam_date) : null;
    return { p, test: gap !== null && gap >= 0 && gap <= WEEK2 ? gap : null, age: p.last_at === null ? Infinity : (now - p.last_at) / DAY_MS };
  }).filter((r) => !(r.p.score !== null && r.p.score >= 90 && r.age < 2)); // just nailed it: leave it alone
  const low = (s: number | null) => s ?? -1;
  const pick = (list: typeof rows, by: (a: (typeof rows)[number], b: (typeof rows)[number]) => number) => [...list].sort(by)[0];
  const say = (r: (typeof rows)[number], text: string, mode: "quiz" | "test" = "quiz"): NextStudy => ({ id: r.p.id, title: r.p.title, mode, text, exam_id: r.p.exam?.id ?? null });

  const soon = rows.filter((r) => r.test !== null);
  if (soon.length) {
    const r = pick(soon, (a, b) => a.test! - b.test! || low(a.p.score) - low(b.p.score));
    const when = r.test === 0 ? "today" : r.test === 1 ? "tomorrow" : `in ${r.test} days`, name = r.p.exam!.name;
    if (r.p.score === null) return say(r, `${name} is ${when}, and you haven't practised "${r.p.title}" yet.`);
    return say(r, `${name} is ${when}. "${r.p.title}" is at ${r.p.score}%, so that's the one to work on.`, r.test! <= 3 && r.p.score >= 70 ? "test" : "quiz");
  }
  const weak = rows.filter((r) => r.p.score !== null && r.p.score < 70);
  if (weak.length) { const r = pick(weak, (a, b) => a.p.score! - b.p.score!); return say(r, `Your recent scores on "${r.p.title}" average ${r.p.score}%. It's the best place to pick up points.`); }
  const fresh = rows.find((r) => r.p.score === null && r.p.last_at === null);
  if (fresh) return say(fresh, `You haven't practised "${fresh.p.title}" yet. A quick quiz will show you where you stand.`);
  const stale = rows.filter((r) => r.age >= 5);
  if (stale.length) { const r = pick(stale, (a, b) => b.age - a.age); return say(r, `It's been a while since "${r.p.title}". A quick round will keep it fresh.`); }
  return null;
}

export type BestMode = "quiz" | "test" | "blanks" | "chat";
/** The way of studying that would help most right now, and why, from the score and how soon the test is. */
export function bestMode(score: number | null, days: number | null): { mode: BestMode; why: string } {
  if (score === null) return { mode: "quiz", why: "Find out where you stand first." };
  if (days !== null && days >= 0 && days <= 3 && score >= 70) return { mode: "test", why: "It's close, so practise it the way it will be asked." };
  if (score < 50) return { mode: "chat", why: "Work through what isn't clicking, one question at a time." };
  if (score < 70) return { mode: "blanks", why: "Pull the key terms out of memory. That's what makes them stick." };
  if (score < 85) return { mode: "quiz", why: "One more round to lock it in." };
  return { mode: "test", why: "See if it holds up in a full test." };
}

// ---------------------------------------------------------------- what the time data says (#7, worker coach.ts insights)
export type DayPart = "morning" | "afternoon" | "evening" | "night";
export const dayPart = (hour: number): DayPart => (hour < 5 ? "night" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night");
export interface Insights {
  /** the questions the user gets wrong are answered much faster than the ones the user gets right */
  rushing: { wrong: number; right: number; n: number } | null;
  /** the part of the day their scores are best, clearly above the rest */
  bestTime: { part: DayPart; avg: number; others: number; n: number } | null;
}
export const RUSH_MIN = 6, RUSH_RATIO = 0.6, PART_MIN = 3, PART_GAP = 8;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const round1 = (x: number) => Math.round(x * 10) / 10;

/** Only says something once there's enough to go on: at least RUSH_MIN timed right and wrong answers, and PART_MIN sessions in
 *  a part of the day and in the rest. */
export function studyInsights(items: { right: boolean; secs: number }[], sessions: { pct: number; hour: number }[]): Insights {
  const wrong = items.filter((x) => !x.right).map((x) => x.secs), right = items.filter((x) => x.right).map((x) => x.secs);
  let rushing: Insights["rushing"] = null;
  if (wrong.length >= RUSH_MIN && right.length >= RUSH_MIN) {
    const w = median(wrong), r = median(right);
    if (r >= 3 && w < r * RUSH_RATIO) rushing = { wrong: round1(w), right: round1(r), n: wrong.length };
  }
  let bestTime: Insights["bestTime"] = null;
  const parts = new Map<DayPart, number[]>();
  for (const s of sessions) parts.set(dayPart(s.hour), [...(parts.get(dayPart(s.hour)) ?? []), s.pct]);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  for (const [part, pcts] of parts) {
    const rest = sessions.filter((s) => dayPart(s.hour) !== part).map((s) => s.pct);
    if (pcts.length < PART_MIN || rest.length < PART_MIN) continue;
    const a = avg(pcts), o = avg(rest);
    if (a - o >= PART_GAP && (!bestTime || a > bestTime.avg)) bestTime = { part, avg: Math.round(a), others: Math.round(o), n: pcts.length };
  }
  return { rushing, bestTime };
}

/** The insights in plain sentences, for the Study tab and the assistant. */
export function insightLines(i: Insights): string[] {
  const out: string[] = [];
  if (i.rushing) out.push(`You answer the questions you miss faster than the ones you get right (about ${i.rushing.wrong} s against ${i.rushing.right} s). Slowing down on the ones that feel easy could win back points.`);
  if (i.bestTime) out.push(`You score best in the ${i.bestTime.part} (${i.bestTime.avg}% on average, against ${i.bestTime.others}% at other times). That's a good time for hard topics.`);
  return out;
}
/** Seconds spent on one question, kept only when it's believable. */
export const cleanSecs = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 3600 ? round1(v) : undefined);

// ---------------------------------------------------------------- Explain it (ExplainView.tsx, worker ai.ts explainPrompts / checkExplain)
/** Something to explain in their own words, with the key points from their notes a good explanation covers. */
export interface ExplainPrompt { q: string; points: string[] }
/** What the assistant says about one explanation. right: covers every key point correctly; partly: some missing or fuzzy; off: wrong or mostly missing. */
export interface ExplainCheck { verdict: "right" | "partly" | "off"; got: string[]; missing: string[]; wrong: { said: string; fix: string }[]; tip: string }
export const VERDICTS = ["right", "partly", "off"] as const;
const list = (v: unknown, n: number, max: number) => (Array.isArray(v) ? v : []).map((x) => str(x, max)).filter(Boolean).slice(0, n);

/** The prompts as written by the model: a real question and 1 to 6 key points each, at most `count`, no repeats. */
export function cleanPrompts(raw: unknown, count = 8): ExplainPrompt[] {
  const out: ExplainPrompt[] = [], seen = new Set<string>();
  for (const r of (Array.isArray(raw) ? raw : []) as Record<string, unknown>[]) {
    const q = str(r?.q, 300), points = list(r?.points, 6, 300);
    if (!q || !points.length || seen.has(q.toLowerCase())) continue;
    seen.add(q.toLowerCase()); out.push({ q, points });
    if (out.length >= count) break;
  }
  return out;
}

/** The model's feedback, made safe. A reply with no usable verdict says so rather than guessing a grade. */
export function cleanCheck(raw: unknown): ExplainCheck | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const verdict = VERDICTS.find((v) => v === r.verdict);
  if (!verdict) return null;
  const wrong = ((Array.isArray(r.wrong) ? r.wrong : []) as Record<string, unknown>[]).map((w) => ({ said: str(w?.said, 300), fix: str(w?.fix, 400) })).filter((w) => w.fix).slice(0, 4);
  return { verdict, got: list(r.got, 6, 300), missing: list(r.missing, 6, 300), wrong, tip: str(r.tip, 400) };
}

/** The feedback in one line, for History and the coach. */
export const checkLine = (c: ExplainCheck) => [c.wrong.length ? `Off: ${c.wrong.map((w) => w.fix).join("; ")}` : "", c.missing.length ? `Missing: ${c.missing.join("; ")}` : ""].filter(Boolean).join(" ") || (c.verdict === "right" ? "Covered every key point." : c.tip);
export const POINTS_SEP = " | ";
/** A past Explain it session's prompts, to retake from History (the key points were saved as the answer). */
export const explainFromPlayed = (items: PlayedItem[]): ExplainPrompt[] => items.filter((x) => x.type === "short").map((x) => ({ q: x.q, points: x.answer.split(POINTS_SEP).map((p) => p.trim()).filter(Boolean) }));

// ---------------------------------------------------------------- a plan for a test (worker coach.ts `planForExam`)
export interface PlanPage { title: string; score: number | null }
export interface PlanSession { title: string; date: string; time: string | null }
export const PLAN_MAX = 8;
const addDays = (day: string, n: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const daysUntil = dayGap;

/** Study sessions before a test without the model: weakest pages first and most often, a practice test a few days out, a
 *  light review the day before, spread from today. Nothing on the test day. No times (the model picks those). */
export function draftPlan(test: string, examDate: string, pages: PlanPage[], today: string): PlanSession[] {
  const days = dayGap(today, examDate); // sessions go on today .. the day before
  if (days < 1) return [];
  const n = Math.min(days, 6);
  const at = (k: number) => (n === 1 ? days - 1 : Math.round((k * (days - 1)) / (n - 1)));
  const order = [...pages].sort((a, b) => (a.score ?? -1) - (b.score ?? -1));
  const name = test.slice(0, 50), short = (t: string) => (t || "New page").slice(0, 60);
  return Array.from({ length: n }, (_, k) => {
    const title = k === n - 1 ? `${name}: light review of everything (20 min)`
      : n >= 4 && k === n - 2 ? `${name}: practice test (30 min)`
      : order.length ? (Math.floor(k / order.length) % 2 ? `${name}: fill in the blanks on ${short(order[k % order.length].title)} (20 min)` : `${name}: quiz on ${short(order[k % order.length].title)} (25 min)`) // a page coming round again gets a different way to study
      : `${name}: practice quiz (25 min)`;
    return { title, date: addDays(today, at(k)), time: null };
  });
}

/** The model's sessions, kept to the days from today (not a time already gone) to the day before the test, in order, at most PLAN_MAX. */
export function fitPlan(items: PlanSession[], today: string, examDate: string, nowTime = "00:00"): PlanSession[] {
  return items.filter((x) => x.date >= today && x.date < examDate && !(x.date === today && x.time && x.time <= nowTime))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "99").localeCompare(b.time ?? "99"))
    .slice(0, PLAN_MAX);
}

// ---------------------------------------------------------------- real grades vs practice (worker study.ts logGrade)
export type ExamGrade = { score: number; outof: number; pct: number; practice: number | null; row_id: string | null; run_id: string | null; at: number } | { skipped: true; at: number };
export const isGraded = (g: ExamGrade | null | undefined): g is Extract<ExamGrade, { pct: number }> => !!g && "pct" in g;

/** A score typed after a test: a number, what it's out of (100 if left empty), and the percent. Null if it doesn't make sense. */
export function cleanGrade(score: unknown, outof: unknown): { score: number; outof: number; pct: number } | null {
  const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.trim().replace(/%$/, "")) : NaN);
  const s = num(score), o = outof === undefined || outof === null || outof === "" ? 100 : num(outof);
  if (!Number.isFinite(s) || !Number.isFinite(o) || s < 0 || o <= 0 || s > o * 1.5) return null; // extra credit, but not a typo
  return { score: s, outof: o, pct: Math.round((s / o) * 1000) / 10 };
}

/** How real grades compare with practice: the average gap in points over the tests that had a practice score. */
export function practiceGap(grades: (ExamGrade | null | undefined)[]): { n: number; avg: number } | null {
  const both = grades.filter(isGraded).filter((g) => g.practice !== null);
  if (!both.length) return null;
  return { n: both.length, avg: Math.round(both.reduce((a, g) => a + (g.pct - g.practice!), 0) / both.length) };
}

/** One sentence on a real grade next to what practice said. */
export function gradeVsPractice(pct: number, practice: number | null) {
  if (practice === null) return "There was no practice score to compare it with.";
  const d = Math.round(pct - practice);
  return Math.abs(d) <= 3 ? `Practice said ${practice}%, so it predicted this well.`
    : d > 0 ? `Practice said ${practice}%, so you did ${d} points better than practice.`
    : `Practice said ${practice}%, so you did ${-d} points worse than practice.`;
}

// ---------------------------------------------------------------- totals, for what outside assistants can read
/** Totals across sessions (newest first): overall, per way of studying, per local day, and the questions missed most. */
export function summarizeSessions(list: (StudySession & { created_at: number })[], dayOf: (at: number) => string) {
  const add = (m: Map<string, { sessions: number; seconds: number; marks: number[] }>, k: string, s: StudySession) => {
    const x = m.get(k) ?? { sessions: 0, seconds: 0, marks: [] };
    x.sessions++; x.seconds += s.seconds ?? 0;
    if (s.total) x.marks.push(pctOf(s));
    m.set(k, x);
  };
  const avg = (marks: number[]) => (marks.length ? Math.round(marks.reduce((a, b) => a + b, 0) / marks.length) : null);
  const modes = new Map<string, { sessions: number; seconds: number; marks: number[] }>(), days = new Map<string, { sessions: number; seconds: number; marks: number[] }>();
  const misses = new Map<string, { question: string; answer: string; times: number }>();
  for (const s of list) {
    add(modes, s.mode, s); add(days, dayOf(s.created_at), s);
    for (const m of s.missed) {
      const k = m.q.toLowerCase(), x = misses.get(k) ?? { question: m.q, answer: m.a, times: 0 };
      x.times++; misses.set(k, x);
    }
  }
  const row = ([key, x]: [string, { sessions: number; seconds: number; marks: number[] }]) => ({ key, sessions: x.sessions, seconds: x.seconds, average_percent: avg(x.marks) });
  const marks = list.filter((s) => s.total).map(pctOf);
  return {
    sessions: list.length, average_percent: avg(marks), seconds: list.reduce((n, s) => n + (s.seconds ?? 0), 0), sessions_without_time: list.filter((s) => !s.seconds).length,
    by_mode: [...modes].map(row).map(({ key, ...x }) => ({ mode: key, ...x })),
    by_day: [...days].map(row).map(({ key, ...x }) => ({ date: key, ...x })),
    most_missed: [...misses.values()].sort((a, b) => b.times - a.times).slice(0, 20),
  };
}
