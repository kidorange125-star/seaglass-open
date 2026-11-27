// A handwritten drawing reads as its transcript (its alt) in search and embeddings (src/worker/sanitize.ts toText).
// node --experimental-strip-types tests/unit/handwriting-text.test.mts
import { cleanHtml, toText } from "../../src/worker/sanitize.ts";

let fails = 0, n = 0;
const eq = (what: string, got: unknown, want: unknown) => { n++; if (JSON.stringify(got) !== JSON.stringify(want)) { fails++; console.log(`FAIL ${what}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); } };

const page = '<p>Before</p><img src="/files/a/handwriting.png" alt="Handwriting: Osmosis moves water &amp; salt" data-drawing="/files/b/handwriting.json"><p>After</p>';
eq("a drawing's transcript is part of the page's text", toText(page), "Before\nHandwriting: Osmosis moves water & salt\nAfter");
eq("a drawing not read yet adds nothing", toText('<p>A</p><img src="/files/a/x.png" alt="Handwriting" data-drawing="/files/b/x.json">'), "A");
eq("an ordinary picture's alt isn't text", toText('<p>A</p><img src="/files/a/x.png" alt="cat">'), "A");
eq("the transcript survives sanitizing", /alt="Handwriting: Osmosis moves water &amp; salt"/.test(cleanHtml(page)), true);
eq("ink colours survive sanitizing (Turn into text)", cleanHtml('<p><span style="color: #2563eb">blue</span> <span style="color: #dc2626">red</span> <mark>hi</mark></p>'), '<p><span style="color:#2563eb">blue</span> <span style="color:#dc2626">red</span> <mark>hi</mark></p>');

console.log(fails ? `${fails} of ${n} failed` : `${n} passed`);
process.exit(fails ? 1 : 0);
