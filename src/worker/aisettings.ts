// The household's AI choices, set during setup and in Settings > Setup & status (owners only): whether AI is on, saved
// for later, or not wanted at all; which Claude models may be used; and whether the assistant may search the web.
// Kept in the household-wide prefs row (owner ''). "off" is enforced on the server: every AI route and every model
// call refuses, so nothing reaches a model even from an old app or a script.
import { MODEL, MODELS } from "./agent";

export type AiMode = "on" | "later" | "off";
export type AiSettings = { mode: AiMode; models: string[]; web: boolean };
// A function, not a constant: agent.ts and this file import each other, so MODELS may not exist yet when this loads.
const defaults = (): AiSettings => ({ mode: "on", models: Object.keys(MODELS), web: true });

export async function get(db: D1Database): Promise<AiSettings> {
  const v = (await db.prepare("SELECT value FROM prefs WHERE owner_id = '' AND key = 'ai_settings' /*any-owner*/").first<{ value: string }>())?.value;
  try {
    const s = JSON.parse(v ?? "{}") as Partial<AiSettings>;
    const models = Array.isArray(s.models) ? s.models.filter((m) => m in MODELS) : defaults().models;
    return { mode: s.mode === "off" || s.mode === "later" ? s.mode : "on", models: models.length ? models : defaults().models, web: s.web !== false };
  } catch { return defaults(); }
}

export async function set(db: D1Database, patch: Record<string, unknown>): Promise<AiSettings> {
  const cur = await get(db);
  const next: AiSettings = {
    mode: patch.mode === "on" || patch.mode === "later" || patch.mode === "off" ? patch.mode : cur.mode,
    models: Array.isArray(patch.models) ? patch.models.filter((m): m is string => typeof m === "string" && m in MODELS) : cur.models,
    web: typeof patch.web === "boolean" ? patch.web : cur.web,
  };
  if (!next.models.length) throw new Error("Allow at least one model, or turn AI off instead.");
  await db.prepare("INSERT INTO prefs (owner_id, key, value) VALUES ('', 'ai_settings', ?) ON CONFLICT(owner_id, key) DO UPDATE SET value = excluded.value /*any-owner*/").bind(JSON.stringify(next)).run();
  return next;
}

/** The model to use: the one asked for if it's allowed, else the default if that is, else the first allowed one. */
export async function allowedModel(db: D1Database, wanted: string): Promise<string> {
  const { models } = await get(db);
  if (models.includes(wanted)) return wanted;
  if (models.includes(MODEL)) return MODEL;
  return models[0] ?? MODEL;
}

export const OFF_MESSAGE = "AI is turned off for this Seaglass. An owner can turn it on in Settings > Setup & status.";
export const LATER_MESSAGE = "AI isn't set up yet. An owner can connect Claude in Settings > Setup & status.";

/** Routes that use AI (the assistant, one-shot features, voice, search by meaning): refused while AI is off. */
export const AI_ROUTE = /^\/api\/(agent(?!\/(permissions|status|choice)$)|ai\/|quick$|voice\/(speak|hear)|search\/meaning|checkin\/|study\/(misses\/review|plan)|syllabus|tasks\/[^/]+\/steps\/draft|tidy$|notes\/[^/]+\/related|routines\/[^/]+\/run|daily\/[^/]+\/wrapup|study-exams\/[^/]+\/plan)/;
