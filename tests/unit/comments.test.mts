// Comments on text and suggested edits (src/client/comments.ts). node --experimental-strip-types tests/unit/comments.test.mts
import { anchorOf, findQuote, OBJ, ordered, openSuggestions, type Block, type Comment } from "../../src/client/comments.ts";

let ok = 0, bad = 0;
const eq = (n: string, g: unknown, w: unknown) => { const a = JSON.stringify(g), b = JSON.stringify(w); if (a === b) ok++; else { bad++; console.log("FAIL", n, a, "!=", b); } };

// "The cell membrane controls the cell." at 0, "See @Biology for the cell wall." at 40 (the mention is one position)
const blocks: Block[] = [{ pos: 0, text: "The cell membrane controls the cell." }, { pos: 40, text: `See ${OBJ} for the cell wall.` }];
const at = (b: number, i: number) => blocks[b].pos + 1 + i;

eq("a selection becomes its words and which one", anchorOf(blocks, at(0, 4), at(0, 8)), { quote: "cell", nth: 0 });
eq("the second 'cell' is nth 1", anchorOf(blocks, at(0, 31), at(0, 35)), { quote: "cell", nth: 1 });
eq("in a later block, counted across the page", anchorOf(blocks, at(1, 14), at(1, 18)), { quote: "cell", nth: 2 });
eq("spaces at the ends are dropped", anchorOf(blocks, at(0, 3), at(0, 18)), { quote: "cell membrane", nth: 0 });
eq("not across two blocks", anchorOf(blocks, at(0, 4), at(1, 3)), null);
eq("not over a mention", anchorOf(blocks, at(1, 0), at(1, 9)), null);
eq("not an empty selection", anchorOf(blocks, at(0, 4), at(0, 4)), null);
eq("only spaces is nothing", anchorOf(blocks, at(0, 3), at(0, 4)), null);

eq("found again", findQuote(blocks, { quote: "cell", nth: 1 }), { from: at(0, 31), to: at(0, 35) });
eq("after the page changed above it", findQuote([{ pos: 0, text: "New first line." }, ...blocks.map((b) => ({ ...b, pos: b.pos + 17 }))], { quote: "cell membrane", nth: 0 }), { from: 17 + at(0, 4), to: 17 + at(0, 17) });
eq("gone when the words are gone", findQuote(blocks, { quote: "nucleus", nth: 0 }), null);
eq("one left: that one, whatever nth was", findQuote(blocks, { quote: "membrane", nth: 3 }), { from: at(0, 9), to: at(0, 17) });
eq("several left and nth past them: unknown", findQuote(blocks, { quote: "cell", nth: 7 }), null);

const c = (id: string, kind: Comment["kind"], resolved: number, created_at: number) => ({ id, note_id: "n", body: "", resolved, created_at, kind, author: "user", anchor: null, replace_with: null, outcome: null }) as Comment;
const list = [c("a", "comment", 0, 1), c("b", "suggestion", 0, 2), c("c", "comment", 1, 3), c("d", "suggestion", 1, 4), c("e", "suggestion", 0, 5)];
eq("suggestions first, then comments, resolved last (newest first)", ordered(list).map((x) => x.id), ["b", "e", "a", "d", "c"]);
eq("open suggestions", openSuggestions(list), 2);
console.log(`${ok} passed, ${bad} failed`); if (bad) process.exit(1);
