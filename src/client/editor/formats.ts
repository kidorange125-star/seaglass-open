// Note formats (#44): ready-made layouts for ordinary notes, from a new page's starter, the / menu and the page's ⋯ menu.
// Each looks like the real thing on paper:
//  - Cornell notes: lines only, like the paper. The page title is the top; a top line, a side line between a narrow
//    cue column and the notes, and a bottom line above the summary space. No words, colours or ruled lines.
//    study/cards.ts reads each filled cue | notes row as a flashcard. "Cornell notes, handwritten" opens the writing
//    screen on a Cornell sheet instead (`ink`), where the title written above the top line names the page.
//  - Outline: I. / A. / 1. / a. numbering, deeper levels by pressing Tab.
//  - Charting: a comparison chart, things down the side and what you compare across the top.
//  - Lecture notes and Study guide: a header card, sections, "term :: definition" lines (flashcards), a summary card.
//  - Q&A: questions with the answers folded inside (flashcards).
// The look comes from a data-format mark on the first header cell (tables) or the list (outline), styled in notion.css;
// FormatAttr in extensions.tsx keeps it. Rows or items added later pick the look up from their table or list.

export interface NoteFormat { key: string; title: string; subtitle: string; html: (today: string) => string; /** Opens the writing screen on this paper instead of adding HTML. */ ink?: "cornell" }

const p = (s = "") => `<p>${s}</p>`;
const date = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
const callout = (emoji: string, inner: string) => `<div data-type="callout" data-emoji="${emoji}">${inner}</div>`;
const task = (s = "") => `<li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div>${p(s)}</div></li>`;
const fold = (q: string, a = "") => `<details><summary>${q}</summary><div data-type="detailsContent">${p(a)}</div></details>`;

const cornell = () => `<table><tbody>`
  + [0, 1, 2].map((i) => `<tr><td colwidth="210"${i ? "" : ' data-format="cornell"'}>${p()}</td><td>${p()}</td></tr>`).join("")
  + `<tr><td colspan="2">${p()}</td></tr>`
  + `</tbody></table>`;

const outline = () => `<ol data-format="outline">`
  + `<li>${p("Main idea")}<ol><li>${p("Supporting point")}<ol><li>${p("Detail or example")}</li><li>${p("Detail or example")}</li></ol></li><li>${p("Supporting point")}</li></ol></li>`
  + `<li>${p("Second main idea")}<ol><li>${p("Supporting point")}</li></ol></li>`
  + `</ol>`;

const chart = () => `<table><tbody>`
  + `<tr><th data-format="chart">${p("")}</th><th>${p("Category 1")}</th><th>${p("Category 2")}</th><th>${p("Category 3")}</th></tr>`
  + ["Item 1", "Item 2", "Item 3"].map((r) => `<tr><td>${p(r)}</td><td>${p()}</td><td>${p()}</td><td>${p()}</td></tr>`).join("")
  + `</tbody></table>`;

export const FORMATS: NoteFormat[] = [
  { key: "cornell", title: "Cornell notes", subtitle: "Typed: questions on the left, notes on the right, a summary at the bottom. Rows become flashcards.", html: cornell },
  { key: "cornell-ink", title: "Cornell notes, handwritten", subtitle: "Write with Apple Pencil on a Cornell sheet. The title you write names the page.", html: () => "", ink: "cornell" },
  { key: "outline", title: "Outline", subtitle: "I. main ideas, A. points, 1. details. Tab goes a level deeper.", html: outline },
  { key: "lecture", title: "Lecture notes", subtitle: "Key ideas, terms as flashcards, questions, a summary",
    html: (t) => callout("🎓", `${p("<strong>Class:</strong> ")}${p(`<strong>Date:</strong> ${date(t)}`)}`)
      + `<h2>Key ideas</h2><ul><li>${p()}</li></ul><h2>Key terms</h2>${p("Term :: what it means")}<h2>Questions to ask</h2><ul data-type="taskList">${task()}</ul>`
      + callout("📝", `${p("<strong>Summary</strong>")}${p()}`) },
  { key: "qa", title: "Q&A", subtitle: "Questions with the answers folded inside: flashcards as you write",
    html: () => fold("Question", "Answer") + fold("Question", "Answer") + fold("Question", "Answer") },
  { key: "charting", title: "Charting", subtitle: "A comparison chart: items down the side, what you compare across the top", html: chart },
  { key: "study-guide", title: "Study guide", subtitle: "What to know for a test, key terms and practice questions",
    html: () => callout("🎯", `${p("<strong>Test:</strong> ")}${p("<strong>Covers:</strong> ")}`)
      + `<h2>What I need to know</h2><ul data-type="taskList">${task()}${task()}</ul><h2>Key terms</h2>${p("Term :: what it means")}<h2>Practice questions</h2>${fold("Question", "Answer")}` },
];
