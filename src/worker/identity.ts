// Who made an edit. Every change an agent makes carries a short label (actions.agent, changes.agent) so version history,
// the change feed and MCP can say which agent it was: the assistant by its chosen name, with the model and what it was
// doing ("Waffle (Sonnet 5.5)", "Waffle (Haiku 5.5, live voice)", "Waffle (Haiku 5.5, daily wrap-up)"), or the app connected
// over MCP by the name it registered with ("Claude (MCP)"). No imports beyond types, so any module can use it.
import type { Ctx } from "./notes";

/** "claude-sonnet-5-5" -> "Sonnet 5.5". */
export function modelName(id: string) {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(id);
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : id;
}

export const assistantName = (_persona?: string | null) => "Waffle";

export async function personaOf(db: D1Database) {
  return (await db.prepare("SELECT value FROM prefs WHERE key = 'persona'").first<{ value: string }>())?.value ?? null;
}

/** "Waffle (Sonnet 5.5, routine "Morning brief")": the name, then whatever is known, in order. */
export function agentLabel(persona: string | null | undefined, parts: (string | false | null | undefined)[]) {
  const p = parts.filter((x): x is string => !!x);
  return `${assistantName(persona)}${p.length ? ` (${p.join(", ")})` : ""}`;
}

/** The context for one of the assistant's one-shot writes (flashcards, a wrap-up, a plan the user accepted…). `model` only
 *  when a model wrote what's being saved; things the user accepted or typed themselves are labelled by what they are. */
export async function agentCtx(db: D1Database, what: string, model?: string): Promise<Ctx> {
  return { source: "agent", runId: crypto.randomUUID(), agent: agentLabel(await personaOf(db), [model && modelName(model), what]) };
}

/** A name an app gave itself (untrusted): plain, one line, short. */
export const cleanName = (s: string) =>
  s.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);

/** An MCP app's label. Always marked "(MCP)", so an app that calls itself "Waffle" can't pass for the assistant. */
export const mcpLabel = (name: string | null | undefined, how?: string) => `${cleanName(name ?? "") || "An app"} (MCP${how ? `, ${how}` : ""})`;

const KNOWN: Record<string, string> = { "claude-code": "Claude Code", "claude-user": "Claude", claude: "Claude" };

/** Who's calling /mcp: the OAuth client's registered name, else (the access token, used by Claude Code) the product
 *  its User-Agent names. Both are what the app says about itself. */
export async function mcpAgent(request: Request, lookup: ((id: string) => Promise<{ clientName?: string } | null>) | undefined, clientId: string | undefined) {
  if (clientId && lookup) {
    try { const c = await lookup(clientId); if (c?.clientName && cleanName(c.clientName)) return mcpLabel(c.clientName); } catch { /* fall through */ }
  }
  const ua = /^([A-Za-z][\w.-]{0,39})\//.exec(request.headers.get("User-Agent") ?? "")?.[1];
  const name = ua ? KNOWN[ua.toLowerCase()] ?? ua : null;
  return mcpLabel(name, clientId ? undefined : "access token");
}
