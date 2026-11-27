// Waffle's memory (short facts about the user) and synced chat history. See migrations/0003_memory_chats.sql.
// Memory text and chat titles/messages/text are sealed (vault.ts); searching them happens here, after opening.
import * as Vault from "./vault";

export interface Memory { id: string; text: string; source: string; created_at: number; updated_at: number }
export interface ChatRow { id: string; title: string; messages: string; updated_at: number }

export const MAX_MEMORIES = 200;
const MEMORY_LEN = 500;

export async function listMemories(db: D1Database, limit = MAX_MEMORIES): Promise<Memory[]> {
  return openMemories((await db.prepare("SELECT * FROM memories WHERE owner_id = {owner} ORDER BY updated_at DESC LIMIT ?").bind(limit).all<Memory>()).results);
}
const openMemory = async (m: Memory): Promise<Memory> => ({ ...m, text: (await Vault.open("memories", m.id, "text", m.text)) ?? "" });
const openMemories = (rows: Memory[]) => Promise.all(rows.map(openMemory));

/** Saves a memory unless the same text is already there. Returns the memory (new or existing). */
export async function addMemory(db: D1Database, text: string, source: string): Promise<Memory> {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, MEMORY_LEN);
  if (!clean) throw new Error("A memory can't be empty.");
  const dup = (await openMemories((await db.prepare("SELECT * FROM memories WHERE owner_id = {owner}").all<Memory>()).results)).find((m) => m.text.toLowerCase() === clean.toLowerCase());
  if (dup) return dup;
  const count = (await db.prepare("SELECT COUNT(*) AS n FROM memories WHERE owner_id = {owner}").first<{ n: number }>())?.n ?? 0;
  if (count >= MAX_MEMORIES) throw new Error(`Memory is full (${MAX_MEMORIES}). Forget something first.`);
  const now = Date.now();
  const m: Memory = { id: crypto.randomUUID().slice(0, 8), text: clean, source, created_at: now, updated_at: now };
  await db.prepare("INSERT INTO memories (owner_id, id, text, source, created_at, updated_at) VALUES ({owner}, ?,?,?,?,?)").bind(m.id, await Vault.seal("memories", m.id, "text", m.text), m.source, now, now).run();
  return m;
}

export async function updateMemory(db: D1Database, id: string, text: string) {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, MEMORY_LEN);
  if (!clean) throw new Error("A memory can't be empty.");
  const r = await db.prepare("UPDATE memories SET text = ?, updated_at = ? WHERE owner_id = {owner} AND (id = ?)").bind(await Vault.seal("memories", id, "text", clean), Date.now(), id).run();
  return r.meta.changes > 0;
}

export async function deleteMemory(db: D1Database, id: string) {
  return (await db.prepare("DELETE FROM memories WHERE owner_id = {owner} AND (id = ?)").bind(id).run()).meta.changes > 0;
}

// ---------------------------------------------------------------- chats

const MAX_CHAT_BYTES = 400_000;
type StoredMsg = { role?: unknown; text?: unknown };

/** Plain text of a chat for search: "The user: ... / Waffle: ...". */
function chatText(messages: unknown[]): string {
  return messages.map((m) => {
    const x = m as StoredMsg;
    if ((x.role !== "user" && x.role !== "assistant") || typeof x.text !== "string") return "";
    return `${x.role === "user" ? "The user" : "Waffle"}: ${x.text}`;
  }).filter(Boolean).join("\n").slice(0, 200_000);
}

export async function listChats(db: D1Database, limit = 50): Promise<ChatRow[]> {
  const rows = (await db.prepare("SELECT id, title, messages, updated_at FROM chats WHERE owner_id = {owner} ORDER BY updated_at DESC LIMIT ?").bind(limit).all<ChatRow>()).results;
  return Promise.all(rows.map(async (r) => ({ ...r, title: (await Vault.open("chats", r.id, "title", r.title)) ?? "", messages: (await Vault.open("chats", r.id, "messages", r.messages)) ?? "[]" })));
}

/** Saves a chat if it's newer than what's stored (last write wins per chat). */
export async function putChat(db: D1Database, id: string, title: string, messages: unknown[], updated_at: number) {
  const json = JSON.stringify(messages);
  if (json.length > MAX_CHAT_BYTES) throw new Error("This chat is too long to sync.");
  await db.prepare(
    `INSERT INTO chats (owner_id, id, title, messages, text, updated_at) VALUES ({owner}, ?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET title=excluded.title, messages=excluded.messages, text=excluded.text, updated_at=excluded.updated_at
     WHERE excluded.updated_at >= chats.updated_at AND chats.owner_id = excluded.owner_id`,
  ).bind(id, await Vault.seal("chats", id, "title", title.slice(0, 200)), await Vault.seal("chats", id, "messages", json), await Vault.seal("chats", id, "text", chatText(messages)), updated_at).run();
}

export async function deleteChat(db: D1Database, id: string) {
  await db.prepare("DELETE FROM chats WHERE owner_id = {owner} AND (id = ?)").bind(id).run();
}

/** Earlier conversations mentioning every word of the query, with a short excerpt around the first match. */
export async function searchChats(db: D1Database, query: string, excludeId?: string | null, limit = 6) {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1).slice(0, 6);
  if (!words.length) return [];
  const rows = (await db.prepare("SELECT id, title, text, updated_at FROM chats WHERE owner_id = {owner} AND (id IS NOT ?) ORDER BY updated_at DESC LIMIT 400").bind(excludeId ?? null).all<{ id: string; title: string; text: string; updated_at: number }>()).results;
  const out: { id: string; title: string; date: string; excerpt: string }[] = [];
  for (const r of rows) {
    if (out.length >= limit) break;
    const text = (await Vault.open("chats", r.id, "text", r.text)) ?? "";
    const lower = text.toLowerCase();
    if (!words.every((w) => lower.includes(w))) continue;
    const i = Math.max(0, lower.indexOf(words[0]));
    const start = Math.max(0, i - 220);
    out.push({ id: r.id, title: (await Vault.open("chats", r.id, "title", r.title)) || "Untitled chat", date: new Date(r.updated_at).toISOString().slice(0, 10), excerpt: (start ? "…" : "") + text.slice(start, i + 420) + "…" });
  }
  return out;
}

export async function recentChatTitles(db: D1Database, excludeId?: string | null, limit = 6) {
  const rows = (await db.prepare("SELECT id, title, updated_at FROM chats WHERE owner_id = {owner} AND (id IS NOT ? AND title != '') ORDER BY updated_at DESC LIMIT ?")
    .bind(excludeId ?? null, limit).all<{ id: string; title: string; updated_at: number }>()).results;
  return Promise.all(rows.map(async (r) => ({ title: (await Vault.open("chats", r.id, "title", r.title)) ?? "", updated_at: r.updated_at })));
}
