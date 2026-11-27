// Note formats (src/client/editor/formats.ts) and Cornell notes as flashcards (src/client/study/cards.ts countCards; the
// browser's extractCards is covered by tests/browser/formats.cjs). node --experimental-strip-types tests/unit/formats.test.mts
import { FORMATS } from "../../src/client/editor/formats.ts";
import { countCards } from "../../src/client/study/cards.ts";

let fails = 0, n = 0;
const eq = (what: string, got: unknown, want: unknown) => { n++; if (JSON.stringify(got) !== JSON.stringify(want)) { fails++; console.log(`FAIL ${what}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); } };

eq("formats: the seven", FORMATS.map((f) => f.key), ["cornell", "cornell-ink", "outline", "lecture", "qa", "charting", "study-guide"]);
const cornell = FORMATS[0].html("2026-11-10");
eq("cornell: lines only: no words, three rows of cue | notes, then one wide summary cell", [/^<table><tbody><tr><td colwidth="210" data-format="cornell"><p><\/p><\/td><td><p><\/p><\/td><\/tr>/.test(cornell), (cornell.match(/<tr>/g) ?? []).length, /<tr><td colspan="2"><p><\/p><\/td><\/tr><\/tbody><\/table>$/.test(cornell), /Cues|Notes|Summary|Topic|<strong>/.test(cornell)], [true, 4, true, false]);
eq("cornell: an empty one has no cards yet", countCards(cornell), 0);
const filled = cornell.replace('<tr><td colwidth="210"><p></p></td><td><p></p></td></tr>', '<tr><td colwidth="210"><p>What is osmosis?</p></td><td><p>Water moving across a membrane</p></td></tr>')
  .replace('<tr><td colwidth="210"><p></p></td><td><p></p></td></tr>', '<tr><td colwidth="210"><p>Half done</p></td><td><p></p></td></tr>')
  .replace('<tr><td colspan="2"><p></p></td></tr>', '<tr><td colspan="2"><p>Water moves to where there is more solute.</p></td></tr>');
eq("cornell: a filled row is a card, a half one isn't, the summary isn't", countCards(filled), 1);
eq("cornell: an older one with header words still counts", countCards('<table><tbody><tr><th><p>Cues and questions</p></th><th><p>Notes</p></th></tr><tr><td><p>q</p></td><td><p>a</p></td></tr></tbody></table>'), 1);
eq("cornell: other tables aren't cards", countCards("<table><tbody><tr><th><p>Topic</p></th><th><p>Notes</p></th></tr><tr><td><p>a</p></td><td><p>b</p></td></tr></tbody></table>"), 0);
eq("cornell, handwritten: opens the writing screen on a Cornell sheet", [FORMATS[1].ink, FORMATS[1].html("2026-11-10")], ["cornell", ""]);
eq("lecture: the key-term line is a card", countCards(FORMATS[3].html("2026-11-10")), 1);
eq("q&a: three toggles, three cards", countCards(FORMATS[4].html("2026-11-10")), 3);
const outline = FORMATS[2].html("2026-11-10");
eq("outline: a numbered outline (I. / A. / 1.), three levels", [/^<ol data-format="outline">/.test(outline), (outline.match(/<ol/g) ?? []).length >= 4], [true, true]);
eq("charting: a comparison chart marked as one", /<th data-format="chart">/.test(FORMATS[5].html("2026-11-10")), true);
eq("every format has a title and a subtitle", FORMATS.every((f) => f.title && f.subtitle), true);

console.log(fails ? `${fails} of ${n} failed` : `${n} passed`);
process.exit(fails ? 1 : 0);
