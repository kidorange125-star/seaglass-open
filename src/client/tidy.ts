// The weekly tidy-up (#25): empty pages, exact duplicates and notes left loose at the top level, proposed as one cleanup the user
// accepts (or not), undoable. These are the rules that need no model; the worker (tidy.ts) asks Haiku where loose notes belong.
// Pure, no imports: tests/unit/tidy.test.mts.

export interface TidyNote { id: string; title: string; parent_id: string | null; kind: "page" | "database"; is_template: number; system?: string | null; created_at: number; updated_at: number; text?: string }
export interface TidyTrash { id: string; title: string; why: string }
export interface TidyMove { id: string; title: string; to: string; to_title: string }
export interface TidyProposal { type: "tidy"; trash: TidyTrash[]; moves: TidyMove[] }

const DAY = 864e5;
const PLACEHOLDER = /^(untitled|new page|)$/i;
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Pages that can go: no text, no sub-pages, not a template or a database row, and left alone for a day. */
export function findEmpty(notes: TidyNote[], now: number): TidyTrash[] {
  const parents = new Set(notes.map((n) => n.parent_id).filter(Boolean));
  const kinds = new Map(notes.map((n) => [n.id, n.kind]));
  return notes.filter((n) => n.kind === "page" && !n.is_template && !n.system && !parents.has(n.id) && !(n.parent_id && kinds.get(n.parent_id) === "database")
    && !norm(n.text ?? "") && now - n.updated_at >= DAY)
    .map((n) => ({ id: n.id, title: n.title || "New page", why: "empty" }));
}

/** Copies: the same title and the same text as an older page (the oldest stays). */
export function findDuplicates(notes: TidyNote[]): TidyTrash[] {
  const parents = new Set(notes.map((n) => n.parent_id).filter(Boolean));
  const kinds = new Map(notes.map((n) => [n.id, n.kind]));
  const seen = new Map<string, TidyNote>(), out: TidyTrash[] = [];
  for (const n of [...notes].sort((a, b) => a.created_at - b.created_at)) {
    const text = norm(n.text ?? "");
    if (n.kind !== "page" || n.is_template || n.system || !text || PLACEHOLDER.test(norm(n.title)) || parents.has(n.id) || (n.parent_id && kinds.get(n.parent_id) === "database")) continue;
    const k = `${norm(n.title)}\u0000${text}`, first = seen.get(k);
    if (first) out.push({ id: n.id, title: n.title, why: `a copy of “${first.title}”` });
    else seen.set(k, n);
  }
  return out;
}

/** Top-level pages with something in them, a few days old, and the top-level pages with sub-pages they could go in. */
export function looseNotes(notes: TidyNote[], now: number) {
  const parents = new Set(notes.map((n) => n.parent_id).filter(Boolean));
  const top = notes.filter((n) => !n.parent_id && n.kind === "page" && !n.is_template && !n.system);
  const folders = top.filter((n) => parents.has(n.id));
  const loose = top.filter((n) => !parents.has(n.id) && norm(n.text ?? "") && now - n.created_at >= 3 * DAY);
  return { folders, loose };
}

/** The model's suggested moves, kept to real loose notes and real folders, one each. */
export function cleanMoves(raw: unknown, loose: TidyNote[], folders: TidyNote[]): TidyMove[] {
  const L = new Map(loose.map((n) => [n.id, n])), F = new Map(folders.map((n) => [n.id, n])), done = new Set<string>(), out: TidyMove[] = [];
  for (const m of (Array.isArray(raw) ? raw : []) as Record<string, unknown>[]) {
    const n = typeof m?.id === "string" ? L.get(m.id) : undefined, f = typeof m?.to === "string" ? F.get(m.to) : undefined;
    if (!n || !f || done.has(n.id) || n.id === f.id) continue;
    done.add(n.id); out.push({ id: n.id, title: n.title || "New page", to: f.id, to_title: f.title || "New page" });
  }
  return out.slice(0, 15);
}

/** What the message says. */
export function tidySummary(p: TidyProposal) {
  const empty = p.trash.filter((x) => x.why === "empty").length, copies = p.trash.length - empty;
  const parts = [empty ? `${empty} empty page${empty === 1 ? "" : "s"}` : "", copies ? `${copies} duplicate${copies === 1 ? "" : "s"}` : "", p.moves.length ? `${p.moves.length} loose note${p.moves.length === 1 ? "" : "s"} to file` : ""].filter(Boolean);
  // several copies of the same page read as one line ("Move 3 pages called “X” to the trash (copies of “X”)")
  const same = new Map<string, { title: string; why: string; n: number }>();
  for (const x of p.trash) { const k = `${x.title}\u0000${x.why}`, g = same.get(k); if (g) g.n++; else same.set(k, { title: x.title, why: x.why, n: 1 }); }
  const lines = [...[...same.values()].map((g) => g.n === 1 ? `- Move “${g.title}” to the trash (${g.why})` : `- Move ${g.n} pages called “${g.title}” to the trash (${g.why.replace(/^a copy of/, "copies of").replace(/^empty$/, "all empty")})`), ...p.moves.map((x) => `- Put “${x.title}” in “${x.to_title}”`)];
  return { title: `Weekly tidy-up: ${parts.join(", ")}`, body: `I found a few things to tidy. Nothing changes unless you accept, and you can undo it after.\n${lines.join("\n")}` };
}
