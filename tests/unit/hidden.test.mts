// "Hide from AI": what an AI is shown, and which tool inputs are refused (src/worker/hidden.ts).
import { blankMentions, namesHidden, scrub, scrubText, type HiddenSet } from "../../src/worker/hidden.ts";
let ok = 0, bad = 0; const t = (n: string, c: boolean, x: unknown = "") => { c ? ok++ : (bad++, console.log("FAIL", n, x)); if (c) console.log("PASS", n); };

const H = "11111111-1111-4111-8111-111111111111", V = "22222222-2222-4222-8222-222222222222", B = "33333333-3333-4333-8333-333333333333";
const hidden = new Set([H]);

t("lists drop hidden pages", JSON.stringify(scrub([{ id: H, title: "Secret" }, { id: V, title: "Open" }], hidden)) === JSON.stringify([{ id: V, title: "Open" }]));
t("nested lists too (search hits inside a result)", JSON.stringify(scrub({ hits: [{ id: H, title: "Secret" }], pending: 0 }, hidden)) === JSON.stringify({ hits: [], pending: 0 }));
t("change feed items keyed by page_id", (scrub({ changes: [{ page_id: H, title: "Secret" }, { page_id: V, title: "x" }] }, hidden) as { changes: unknown[] }).changes.length === 1);
t("database rows of a hidden database (parent_id)", (scrub([{ id: B, parent_id: H, title: "row" }], hidden) as unknown[]).length === 0);
t("study session only on hidden pages is dropped", (scrub([{ ids: [H], title: "Secret quiz", missed: [] }], hidden) as unknown[]).length === 0);
t("study session on a visible page too is kept, hidden id removed", JSON.stringify(scrub([{ ids: [H, V], title: "Mixed" }], hidden)) === JSON.stringify([{ ids: [V], title: "Mixed" }]));
t("an object field about a hidden page is blanked", (scrub({ page: { id: H, title: "Secret" } }, hidden) as { page: unknown }).page === "[hidden page]");
t("a list of only hidden pages is just empty", JSON.stringify(scrub({ pages: [{ id: H }], next_cursor: null }, hidden)) === JSON.stringify({ pages: [], next_cursor: null }));

const mention = `<p>See <span data-type="mention" data-id="${H}" data-label="Secret plans">Secret plans</span> and <span data-type="mention" data-id="${V}">Open</span>.</p>`;
const out = scrubText(mention, hidden);
t("mention of a hidden page loses its title", !out.includes("Secret plans") && out.includes("[hidden page]") && out.includes(">Open</span>"), out);
const nested = `<div data-type="callout" data-id="${B}"><p>x <span data-type="mention" data-id="${H}">Secret</span></p></div>`;
t("mention inside a callout is still caught", !scrubText(nested, hidden).includes("Secret"), scrubText(nested, hidden));
t("sub-page block of a hidden page", !scrubText(`<div data-type="child-page" data-id="${H}">Secret</div><p>after</p>`, hidden).includes("Secret"));
t("link to a hidden page", !scrubText(`<a href="#/p/${H}">Secret</a>`, hidden).includes("Secret"));
t("a bare hidden id becomes 'hidden'", scrubText(`id ${H} and ${V}`, hidden) === `id hidden and ${V}`);
t("text without hidden ids is untouched", scrubText(mention, new Set([B])) === mention);
t("nothing hidden: the same object comes back", (() => { const o = { a: [1] }; return scrub(o, new Set()) === o; })());

t("input naming a hidden page is caught", namesHidden({ id: H }, hidden) && namesHidden({ ids: [V, H] }, hidden) && namesHidden({ parent_id: H.toUpperCase() }, hidden));
t("hidden id inside HTML being written is caught", namesHidden({ html: `<p><span data-type="mention" data-id="${H}"></span></p>` }, hidden));
t("other inputs pass", !namesHidden({ id: V, query: "plans" }, hidden) && !namesHidden({ id: H }, new Set()));

const withTitles: HiddenSet = Object.assign(new Set([H]), { titles: new Map([[V, ["Secret diary"]]]) });
const hit = scrub([{ id: V, title: "Open", snippet: "see Secret diary launch" }], withTitles) as { snippet: string }[];
t("a page that mentions a hidden one has that title blanked in its snippet", hit[0].snippet === "see [hidden page] launch", hit);
t("…but other pages keep the same words", (scrub([{ id: B, snippet: "Secret diary" }], withTitles) as { snippet: string }[])[0].snippet === "Secret diary");
t("blankMentions for prompts", blankMentions("see Secret diary now", V, withTitles) === "see [hidden page] now" && blankMentions("Secret diary", B, withTitles) === "Secret diary");
console.log(`\n${ok} passed, ${bad} failed`);
if (bad) process.exit(1);
