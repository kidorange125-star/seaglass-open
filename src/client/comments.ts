// Comments on specific text and suggested edits (#22). A comment is tied to the words it was made on by their text (quote)
// and which occurrence of it on the page (nth), not by anything written into the page, so the page itself never changes
// until an edit is accepted. If those words are later edited away, the comment stays in the panel, marked as such.
// Blocks here are a page's text blocks with every inline thing that isn't text (a mention, an equation, a line break)
// as one "￼" character, so an offset in the text is exactly a position in the editor (block.pos + 1 + offset).

export interface Anchor { quote: string; nth: number }
export interface Block { pos: number; text: string }
export interface Comment {
  id: string; note_id: string; body: string; resolved: number; created_at: number;
  kind: "comment" | "suggestion"; author: "user" | "agent" | "mcp"; anchor: Anchor | null; replace_with: string | null; outcome: "accepted" | "rejected" | null;
}
export const OBJ = "￼";
export const MAX_QUOTE = 500;

/** Every place `quote` appears, in page order. */
function places(blocks: Block[], quote: string) {
  const out: { from: number; to: number }[] = [];
  if (!quote) return out;
  for (const b of blocks) {
    for (let i = b.text.indexOf(quote); i >= 0; i = b.text.indexOf(quote, i + 1)) out.push({ from: b.pos + 1 + i, to: b.pos + 1 + i + quote.length });
  }
  return out;
}

/** Where an anchor is now, or null when its words are gone. */
export function findQuote(blocks: Block[], a: Anchor): { from: number; to: number } | null {
  const all = places(blocks, a.quote);
  return all[a.nth] ?? (all.length === 1 ? all[0] : null);
}

/** The anchor for a selection, which must sit inside one block and hold some text. */
export function anchorOf(blocks: Block[], from: number, to: number): Anchor | null {
  const b = blocks.find((x) => from >= x.pos + 1 && to <= x.pos + 1 + x.text.length);
  if (!b || to <= from) return null;
  const raw = b.text.slice(from - b.pos - 1, to - b.pos - 1);
  const lead = raw.length - raw.trimStart().length, trail = raw.length - raw.trimEnd().length;
  const quote = raw.trim();
  if (!quote || quote.includes(OBJ) || quote.length > MAX_QUOTE) return null;
  const at = from + lead;
  const nth = places(blocks, quote).findIndex((p) => p.from === at);
  return nth < 0 || to - trail - at !== quote.length ? null : { quote, nth };
}

/** Open ones first (suggestions before comments, then oldest first), then the resolved ones. */
export function ordered(list: Comment[]) {
  return [...list].sort((a, b) => (a.resolved - b.resolved) || (a.resolved ? b.created_at - a.created_at : (a.kind === b.kind ? a.created_at - b.created_at : a.kind === "suggestion" ? -1 : 1)));
}
export const openSuggestions = (list: Comment[]) => list.filter((c) => c.kind === "suggestion" && !c.resolved).length;
