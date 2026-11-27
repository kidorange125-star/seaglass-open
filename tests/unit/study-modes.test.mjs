// Study games built from flashcards (quiz, fill in the blanks, match) and the server's card count.
// Run: node tests/unit/study-modes.test.mjs
import { answerMatches, blanksFromCards, blanksFromMarks, keyWord, makeQuiz, matchRounds, norm, shuffle } from "../../src/client/study/modes.ts";
import { countCards } from "../../src/client/study/cards.ts";
import { asked, blanksFromSet, cardsHtml, cleanCards, cleanSet, existingQuestions, pairsToCards, playable, quizFromSet } from "../../src/client/study/generated.ts";

let ok = 0, bad = 0;
const eq = (name, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) ok++; else { bad++; console.log("FAIL", name, "got", g, "want", w); } };
const yes = (name, v) => eq(name, !!v, true);
// a seeded random, so runs repeat
const seeded = (n = 1) => () => { n = (n * 16807) % 2147483647; return (n - 1) / 2147483646; };
const card = (id, question, answerText) => ({ id, question, answerText, answerHtml: `<p>${answerText}</p>` });
const cards = [
  card("a", "Osmosis", "Diffusion of water across a semipermeable membrane"),
  card("b", "Mitochondria", "The powerhouse of the cell that makes ATP"),
  card("c", "Ribosome", "Builds proteins from amino acids"),
  card("d", "What does active transport need to move molecules?", "Energy from ATP to pump molecules against the gradient"),
  card("e", "Nucleus", "Holds the cell's DNA"),
];

// typed answers
yes("same word", answerMatches("Osmosis", "osmosis"));
yes("punctuation and spaces ignored", answerMatches("cell membrane", "  Cell-membrane. "));
yes("a typo on a long word", answerMatches("mitochondria", "mitocondria"));
eq("no typo allowed on short words", answerMatches("cat", "car"), false);
yes("leading article", answerMatches("the nucleus", "nucleus"));
yes("either alternative", answerMatches("ATP / adenosine triphosphate", "atp"));
eq("empty is wrong", answerMatches("ATP", "  "), false);
eq("different word is wrong", answerMatches("ribosome", "nucleus"), false);
eq("accents", norm("Café Ñandú"), "cafe nandu");

// quiz
const quiz = makeQuiz(cards, seeded(3));
eq("one question per card", quiz.length, 5);
yes("every question's answer is among its options", quiz.every((q) => q.options[q.answer] !== undefined));
yes("four options when there are enough cards", quiz.every((q) => q.options.length === 4));
yes("options are distinct", quiz.every((q) => new Set(q.options.map(norm)).size === q.options.length));
yes("the right option is that card's answer (or its term when reversed)", quiz.every((q) => { const c = cards.find((x) => x.id === q.cardId); return q.options[q.answer] === (q.reverse ? c.question : c.answerText); }));
eq("a quiz needs two cards", makeQuiz(cards.slice(0, 1)).length, 0);
eq("two cards: two options each", makeQuiz(cards.slice(0, 2), seeded(5)).every((q) => q.options.length === 2), true);
yes("long questions are never reversed", makeQuiz(cards, seeded(9)).filter((q) => q.cardId === "d").every((q) => !q.reverse));

// blanks
eq("key word skips filler and the question's own words", keyWord("Energy from ATP to pump molecules against the gradient", "What does active transport need to move molecules?"), "gradient");
const b = blanksFromCards(cards);
eq("a blank per card", b.length, 5);
const term = b.find((x) => x.cardId === "a");
eq("short term: the term is blanked, definition is the clue", [term.before, term.answer, term.after.startsWith(" : Diffusion")], ["", "Osmosis", true]);
const long = b.find((x) => x.cardId === "d");
eq("long question: question is the clue, a word of the answer is blanked", [long.clue.startsWith("What does"), long.before + "_" + long.after], [true, "Energy from ATP to pump molecules against the _"]);
const marks = blanksFromMarks([{ text: "Plants make glucose by photosynthesis in the chloroplast.", marks: ["photosynthesis", "chloroplast"] }, { text: "Photosynthesis again", marks: ["photosynthesis"] }, { text: "Just bold", marks: ["Just bold"] }]);
eq("bold words become blanks, each once, not whole-line bolds", marks.map((m) => m.answer), ["photosynthesis", "chloroplast"]);
eq("the sentence around the blank is kept", [marks[0].before, marks[0].after], ["Plants make glucose by ", " in the chloroplast."]);

// match
const rounds = matchRounds(cards, 2, seeded(4));
eq("every card appears once across the rounds", rounds.flat().filter((t) => t.side === "term").map((t) => t.pair).sort(), ["a", "b", "c", "d", "e"]);
yes("each pair has a term and an answer", rounds.flat().every((t) => rounds.flat().some((o) => o.pair === t.pair && o.side !== t.side)));
yes("a lone leftover joins the last round instead of a round of one", rounds.every((r) => r.length >= 4));
eq("shuffle keeps every item", shuffle([1, 2, 3, 4, 5], seeded(2)).sort(), [1, 2, 3, 4, 5]);

// server-side count (no DOM)
eq("count: toggles and term lines", countCards("<details><summary>Q</summary><p>A</p></details><p>Mitosis :: division</p><ul><li><p>DNA :: genes</p></li></ul>"), 3);
eq("count: toggle headings and code aren't cards", countCards('<details data-heading="h2"><summary>Section</summary></details><pre><code>a :: b</code></pre><p>x ::</p>'), 0);
eq("count: empty", countCards(""), 0);

{ // what the assistant writes: only well-formed items get through
const quiz = cleanSet("quiz", [
  { q: " Good  one ", options: ["a", "b", "c", "d"], answer: 2, why: "because" },
  { q: "Answer out of range", options: ["a", "b"], answer: 5 },
  { q: "Fractional answer", options: ["a", "b"], answer: 0.5 },
  { q: "A blank option shifts the index", options: ["a", "", "c"], answer: 2 },
  { q: "Same option twice", options: ["Yes", "yes!"], answer: 0 },
  { q: "good one", options: ["x", "y"], answer: 0 },
  "not an object", null,
]);
eq("quiz: keeps the good question, tidied, without repeats", quiz.items, [{ q: "Good one", options: ["a", "b", "c", "d"], answer: 2, why: "because" }]);
eq("quiz: anything that isn't a list is empty", cleanSet("quiz", "nope").items, []);
const blanks = cleanSet("blanks", [
  { before: "Plants use", answer: "chlorophyll", after: ", a pigment." },
  { before: "The word osmosis is in", answer: "osmosis", after: "this." },
  { before: "", answer: "alone", after: "" },
  { before: "(", answer: "either / or", after: ")" },
]);
eq("blanks: spaced around punctuation; a giveaway and an empty sentence go", blanks.items.map((x) => [x.before, x.after]), [["Plants use ", ", a pigment."], ["(", ")"]]);
eq("blanks: round keeps the answer", blanksFromSet(blanks.items)[0].answer, "chlorophyll");
const pairs = cleanSet("match", [{ term: "A", match: "one" }, { term: "a", match: "two" }, { term: "B", match: "One" }, { term: "C", match: "three" }, { term: "same", match: "Same" }]);
eq("match: terms and matches are unique", pairs.items.map((x) => x.term), ["A", "C"]);
yes("match: two pairs can be played", playable(pairs));
yes("match: one pair can't", !playable({ mode: "match", items: pairs.items.slice(0, 1) }));
yes("quiz: one question can", playable(quiz));
eq("match: pairs become cards", pairsToCards(pairs.items).map((c) => [c.question, c.answerText]), [["A", "one"], ["C", "three"]]);
eq("asked: lists what a set covers", asked(quiz), ["Good one"]);
const set = [{ q: "Q1", options: ["a", "b", "c", "d"], answer: 3 }, { q: "Q2", options: ["e", "f"], answer: 0, why: "w" }];
for (let n = 1; n < 40; n++) for (const r of quizFromSet(set, seeded(n))) {
  const src = set.find((x) => x.q === r.prompt);
  if (r.options[r.answer] !== src.options[src.answer]) { bad++; console.log("FAIL shuffled quiz lost its answer", n); } else ok++;
}
eq("quiz: the why comes along", quizFromSet(set, seeded(3)).find((x) => x.prompt === "Q2").why, "w");

// flashcards written onto a page
const page = '<h2>Notes</h2><p>Mitosis :: division</p><details data-id="1"><summary>What is <b>DNA</b>?</summary><div>Genes</div></details><details data-heading="2"><summary>A section</summary><p>Inside :: yes</p></details><pre><code>a :: b</code></pre><p>Tom &amp; Jerry :: friends</p>';
eq("existing: toggles and term lines, not sections or code", existingQuestions(page).sort(), ["Inside", "Mitosis", "Tom & Jerry", "What is DNA ?"].sort());
eq("cards: no repeats, nothing blank, capped", cleanCards([{ q: "mitosis", a: "x" }, { q: "New", a: "y" }, { q: "NEW ", a: "z" }, { q: "", a: "n" }, { q: "n", a: "" }], existingQuestions(page)), [{ q: "New", a: "y" }]);
eq("cards: at most the cap", cleanCards(Array.from({ length: 40 }, (_, i) => ({ q: `q${i}`, a: "a" }))).length, 30);
const made = cardsHtml([{ q: "a<b", a: 'c & "d"' }], "<p>x</p>");
yes("cards: escaped, under a heading", made.startsWith("<h2>Flashcards</h2>") && made.includes("a&lt;b") && made.includes("c &amp; &quot;d&quot;"));
yes("cards: no second heading", !cardsHtml([{ q: "a", a: "b" }], '<h2 data-id="x">Flashcards</h2>').includes("<h2>"));
eq("cards: what was written counts as cards", countCards(made), 1);
}

console.log(`${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
