// What the AI costs, per person, and the limits owners set (migration 0025). Every model call is recorded where it's
// made (the agent loop, ai.ts complete, voice and Workers AI), so a nested run counts once and nothing goes unrecorded.
// Limits are checked BEFORE a call: a call that would start past a limit doesn't happen. A person's rules live in
// person_rules, a system table only owner routes write, so nobody can raise their own limit or turn their own web on.
import { MODELS } from "./agent";
import { requireOwner } from "./scope";
import { userTz } from "./suggest";

export type Rules = { daily_usd: number | null; monthly_usd: number | null; web: boolean; teach: boolean };
/** A kid account's starting rules (an owner can change them). */
export const KID_RULES: Rules = { daily_usd: 0.25, monthly_usd: 3, web: false, teach: true };
const OPEN: Rules = { daily_usd: null, monthly_usd: null, web: true, teach: false };

const dayIn = (tz: string, t = Date.now()) => {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t)); }
  catch { return new Date(t).toISOString().slice(0, 10); }
};

/** Dollars for a call, from the model's price list (per million tokens). Workers AI and voice have no price here: 0. */
export function costOf(model: string, u: { input?: number; output?: number; cache_read?: number; cache_write?: number }, speed = 1) {
  const p = MODELS[model]?.price;
  if (!p) return 0;
  return ((u.input ?? 0) * p.input + (u.output ?? 0) * p.output + (u.cache_read ?? 0) * p.cache_read + (u.cache_write ?? 0) * p.cache_write) * speed / 1e6;
}

/** Adds one call to this person's record. Never throws: recording must not break the feature that was used. */
export async function record(db: D1Database, feature: string, model: string, u: { input?: number; output?: number; cache_read?: number; cache_write?: number } = {}, speed = 1) {
  try {
    const day = dayIn(await userTz(db));
    const cost = costOf(model, u, speed);
    await db.prepare(`INSERT INTO ai_usage (owner_id, day, feature, model, calls, input, output, cache_read, cache_write, cost_usd)
      VALUES ({owner}, ?, ?, ?, 1, ?, ?, ?, ?, ?)
      ON CONFLICT(owner_id, day, feature, model) DO UPDATE SET calls = calls + 1, input = input + excluded.input, output = output + excluded.output,
        cache_read = cache_read + excluded.cache_read, cache_write = cache_write + excluded.cache_write, cost_usd = cost_usd + excluded.cost_usd`)
      .bind(day, feature.slice(0, 40), model.slice(0, 60), u.input ?? 0, u.output ?? 0, u.cache_read ?? 0, u.cache_write ?? 0, cost).run();
  } catch (e) { console.error("usage not recorded", e); }
}

/** A person's rules: what an owner set for them, else a kid's defaults, else no limits. */
export async function rulesFor(db: D1Database, personId: string): Promise<Rules> {
  const r = await db.prepare("SELECT daily_usd, monthly_usd, web, teach FROM person_rules WHERE person_id = ?").bind(personId).first<{ daily_usd: number | null; monthly_usd: number | null; web: number; teach: number }>();
  if (r) return { daily_usd: r.daily_usd, monthly_usd: r.monthly_usd, web: !!r.web, teach: !!r.teach };
  const role = (await db.prepare("SELECT role FROM users WHERE id = ?").bind(personId).first<{ role: string }>())?.role;
  return role === "kid" ? KID_RULES : OPEN;
}
/** The rules for whoever's database this is. */
export const myRules = (db: D1Database) => rulesFor(db, requireOwner(db));

const money = (n: number) => `$${n < 10 ? n.toFixed(2) : n.toFixed(0)}`;

/** Spending so far: this person today and this month, and the whole household this month. */
export async function spent(db: D1Database) {
  const tz = await userTz(db), today = dayIn(tz), month = today.slice(0, 7);
  const mine = await db.prepare("SELECT COALESCE(SUM(CASE WHEN day = ? THEN cost_usd END), 0) AS today, COALESCE(SUM(cost_usd), 0) AS month FROM ai_usage WHERE owner_id = {owner} AND (day >= ?)")
    .bind(today, `${month}-01`).first<{ today: number; month: number }>();
  // Everyone's total this month: a number only, for the household limit.
  const all = await db.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS month FROM ai_usage WHERE day >= ? /*any-owner*/").bind(`${month}-01`).first<{ month: number }>();
  return { today: mine?.today ?? 0, month: mine?.month ?? 0, household_month: all?.month ?? 0 };
}

/** Why the next AI call can't happen, or null when it can. */
export async function blocked(db: D1Database): Promise<string | null> {
  const [me, home, s] = await Promise.all([myRules(db), rulesFor(db, ""), spent(db)]);
  if (me.daily_usd !== null && s.today >= me.daily_usd) return `You've used today's AI allowance (${money(me.daily_usd)}). It starts again tomorrow.`;
  if (me.monthly_usd !== null && s.month >= me.monthly_usd) return `You've used this month's AI allowance (${money(me.monthly_usd)}). Ask the household's owner, or wait for next month.`;
  if (home.monthly_usd !== null && s.household_month >= home.monthly_usd) return `This household has reached its AI limit for the month (${money(home.monthly_usd)}). An owner can raise it in Settings > AI usage.`;
  return null;
}

/** This person's usage for Settings > AI usage: today, this month, and the last 30 days by feature and by model. */
export async function mine(db: D1Database) {
  const tz = await userTz(db), today = dayIn(tz), since = dayIn(tz, Date.now() - 29 * 86_400_000);
  const rows = (await db.prepare("SELECT day, feature, model, calls, input, output, cost_usd FROM ai_usage WHERE owner_id = {owner} AND (day >= ?) ORDER BY day").bind(since).all<{ day: string; feature: string; model: string; calls: number; input: number; output: number; cost_usd: number }>()).results;
  const sum = (key: "feature" | "model") => Object.values(rows.reduce<Record<string, { name: string; calls: number; cost_usd: number }>>((m, r) => {
    const k = r[key]; (m[k] ??= { name: k, calls: 0, cost_usd: 0 }); m[k].calls += r.calls; m[k].cost_usd += r.cost_usd; return m;
  }, {})).sort((a, b) => b.cost_usd - a.cost_usd || b.calls - a.calls);
  const days = Object.values(rows.reduce<Record<string, { day: string; cost_usd: number; calls: number }>>((m, r) => { (m[r.day] ??= { day: r.day, cost_usd: 0, calls: 0 }); m[r.day].cost_usd += r.cost_usd; m[r.day].calls += r.calls; return m; }, {}));
  return { date: today, ...(await spent(db)), by_feature: sum("feature"), by_model: sum("model").map((m) => ({ ...m, label: MODELS[m.name]?.label ?? m.name })), days, rules: await myRules(db) };
}

/** The owner's view: each person's spending (numbers only, never what they asked) and their rules. */
export async function household(db: D1Database) {
  const tz = await userTz(db), today = dayIn(tz), month = `${today.slice(0, 7)}-01`;
  const people = (await db.prepare("SELECT id, display_name, username, role FROM users ORDER BY created_at").all<{ id: string; display_name: string; username: string; role: string }>()).results;
  const totals = (await db.prepare("SELECT owner_id, COALESCE(SUM(CASE WHEN day = ? THEN cost_usd END), 0) AS today, SUM(cost_usd) AS month, SUM(calls) AS calls FROM ai_usage WHERE day >= ? /*any-owner*/ GROUP BY owner_id")
    .bind(today, month).all<{ owner_id: string; today: number; month: number; calls: number }>()).results;
  const by = new Map(totals.map((t) => [t.owner_id, t]));
  return {
    people: await Promise.all(people.map(async (p) => ({ id: p.id, name: p.display_name, username: p.username, role: p.role, today: by.get(p.id)?.today ?? 0, month: by.get(p.id)?.month ?? 0, calls: by.get(p.id)?.calls ?? 0, rules: await rulesFor(db, p.id) }))),
    household: { month: totals.reduce((n, t) => n + t.month, 0), rules: await rulesFor(db, "") },
  };
}

const limit = (v: unknown) => (v === null || v === "" || v === undefined ? null : Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v) * 100) / 100 : undefined);
/** An owner sets someone's rules ('' = the household's monthly limit). */
export async function setRules(db: D1Database, personId: string, b: Record<string, unknown>) {
  const cur = await rulesFor(db, personId);
  const daily = "daily_usd" in b ? limit(b.daily_usd) : cur.daily_usd, monthly = "monthly_usd" in b ? limit(b.monthly_usd) : cur.monthly_usd;
  if (daily === undefined || monthly === undefined) throw new Error("A limit is a number of dollars, or empty for none.");
  const next: Rules = { daily_usd: daily, monthly_usd: monthly, web: typeof b.web === "boolean" ? b.web : cur.web, teach: typeof b.teach === "boolean" ? b.teach : cur.teach };
  await db.prepare(`INSERT INTO person_rules (person_id, daily_usd, monthly_usd, web, teach, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(person_id) DO UPDATE SET daily_usd = excluded.daily_usd, monthly_usd = excluded.monthly_usd, web = excluded.web, teach = excluded.teach, updated_at = excluded.updated_at`)
    .bind(personId, next.daily_usd, next.monthly_usd, next.web ? 1 : 0, next.teach ? 1 : 0, Date.now()).run();
  return next;
}
