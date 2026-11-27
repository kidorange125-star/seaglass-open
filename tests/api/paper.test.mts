// Paper Lock on the server (worker/paper.ts, notes.ts paperLock): the card, locking a page, what can and can't see the words,
// a device asking and the phone answering, relock, removing the lock, and the guard against guessing.
// Local dev server on a wiped database, mock model:  SEAGLASS_URL=http://localhost:5174 node --experimental-strip-types tests/api/paper.test.mts
import { fullCard, redraw, scanOf, scene, type Card } from "../helpers/paperCards.mts";

const B = process.env.SEAGLASS_URL || "http://localhost:5173";
const PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
let fails = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
type R = { status: number; body: any; text: string };
const j = async (m: string, p: string, b?: unknown, ua = DESKTOP, h: Record<string, string> = {}): Promise<R> => {
  const r = await fetch(B + p, { method: m, headers: { "Content-Type": "application/json", "User-Agent": ua, ...h }, body: b === undefined ? undefined : JSON.stringify(b) });
  const text = await r.text(); let body: any = {}; try { body = JSON.parse(text); } catch { /* html */ }
  return { status: r.status, body, text };
};
/** A phone's scan of a card (a fresh photo for every seed); .bits alone for setting a card up. */
const map = (card: Card, seed: number) => scanOf(scene(card, seed));
const bits = (card: Card, seed: number) => map(card, seed).bits;
/** Changes the local test database directly (the dev server's own D1 explorer), to make a card look like an old one. */
const sql = async (q: string) => {
  const dbs = await (await fetch(`${B}/cdn-cgi/local/explorer/api/d1/database`)).json() as { result: { uuid: string }[] };
  const r = await fetch(`${B}/cdn-cgi/local/explorer/api/d1/database/${dbs.result[0].uuid}/raw`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sql: q }) });
  if (!r.ok) throw new Error(`sql failed: ${r.status} ${await r.text()}`);
};
const WORDS = "the vault code is 4821 under the third tile";

(async () => {
  const mine = fullCard(11), other = fullCard(12), blank = { strokes: [], ink: [20, 20, 30] as [number, number, number] };
  const waves: Card = { strokes: [0, 1, 2].map((k) => Array.from({ length: 12 }, (_, i): [number, number] => [170 + i * 15, 95 + k * 55 + Math.sin(i / 1.8) * 16])), ink: [30, 110, 190] };

  // ---- a card is made on a phone, from three scans that agree
  check((await j("POST", "/api/paper/cards", { name: "Fish", scans: [bits(mine, 1), bits(mine, 2), bits(mine, 3)] }, DESKTOP)).status === 403, "a computer can't make a card");
  check((await j("POST", "/api/paper/cards", { name: "x", scans: [bits(mine, 1), bits(mine, 2)] }, PHONE)).status === 400, "two scans aren't enough");
  const blanks = await j("POST", "/api/paper/cards", { name: "x", scans: [bits(blank, 1), bits(blank, 2), bits(blank, 3)] }, PHONE);
  check(blanks.status === 400 && /drawing/.test(blanks.body.error), `a blank card is refused with advice (${blanks.body.error})`);
  const simple = await j("POST", "/api/paper/cards", { name: "x", scans: [bits(waves, 1), bits(waves, 2), bits(waves, 3)] }, PHONE);
  check(simple.status === 201, `a card of three curved strokes is fine (${simple.status} ${simple.body.error ?? ""})`);
  if (simple.status === 201) await j("DELETE", `/api/paper/cards/${simple.body.id}`);
  const mixed = await j("POST", "/api/paper/cards", { name: "x", scans: [bits(mine, 1), bits(other, 2), bits(mine, 3)] }, PHONE);
  check(mixed.status === 400, `scans of different drawings are refused (${mixed.body.error})`);
  check((await j("POST", "/api/paper/cards", { name: "x", scans: ["abc", "abc", "abc"] }, PHONE)).status === 400, "junk isn't a scan");
  const made = await j("POST", "/api/paper/cards", { name: "Fish", scans: [bits(mine, 1), bits(mine, 2), bits(mine, 3)] }, PHONE);
  check(made.status === 201 && made.body.name === "Fish", "a card is made from three good scans");
  const card = made.body.id as string;

  // ---- a page with words, shared, with a comment, then locked
  const page = (await j("POST", "/api/notes", { title: "Safe notes", html: `<p>${WORDS}</p>`, icon: "🔑" })).body;
  const slug = (await j("POST", `/api/notes/${page.id}/share`, { enabled: true })).body.share_slug;
  await j("PATCH", `/api/notes/${page.id}`, { html: `<p>${WORDS} (edited)</p>`, revision: page.revision }); // some history
  check((await j("GET", `/p/${slug}`)).text.includes("4821"), "(before) the shared page shows the words");
  const child = (await j("POST", "/api/notes", { title: "Child", html: "<p>x</p>", parent_id: page.id })).body;
  const withKids = await j("POST", `/api/paper/pages/${page.id}/lock`, { card_id: card }, PHONE);
  check(withKids.status === 400 && /sub-pages/.test(withKids.body.error), "a page with sub-pages can't be locked (they'd be left outside it)");
  await j("DELETE", `/api/notes/${child.id}`); await j("DELETE", `/api/notes/${child.id}/purge`);
  check((await j("POST", `/api/paper/pages/${page.id}/lock`, { card_id: card }, DESKTOP)).status === 403, "a computer can't lock a page");
  const locked = await j("POST", `/api/paper/pages/${page.id}/lock`, { card_id: card }, PHONE);
  check(locked.status === 200 && locked.body.paper_lock === card, "locking a page with the new card works");

  // ---- afterwards, nothing but the placeholder is left to read
  const row = (await j("GET", `/api/notes/${page.id}`)).body;
  check(row.html === "" && row.title === "Paper-locked page" && row.ai_hidden === 1 && !row.share_slug && row.paper_lock === card, "the page row is an empty placeholder, hidden from AI, unshared");
  check(!JSON.stringify(row).includes("4821") && !JSON.stringify(row).includes("Safe notes"), "its title and words are nowhere in the row");
  check((await j("GET", `/p/${slug}`)).status === 404, "the share link stopped working");
  check(!(await j("GET", `/api/search?q=vault`)).text.includes(page.id), "search can't find the words");
  check(!(await j("GET", `/api/search?q=Safe`)).text.includes(page.id), "search can't find the title");
  check(!(await j("GET", "/api/tree")).text.includes("Safe notes") && !(await j("GET", "/api/export")).text.includes("4821"), "the tree and the export don't hold them");
  check(!(await j("GET", `/api/notes/${page.id}/history`)).text.includes("4821"), "the history is gone");
  check((await j("PATCH", `/api/notes/${page.id}`, { html: "<p>overwrite</p>" })).status === 423, "the normal editor can't write words into it");
  check((await j("POST", `/api/notes/${page.id}/share`, { enabled: true })).status === 400, "it can't be shared");
  check((await j("POST", `/api/notes/${page.id}/duplicate`)).status === 400, "it can't be duplicated");
  check((await j("POST", `/api/notes/${page.id}/ai-hidden`, { hidden: false })).status === 400, "Hide from AI can't be turned off on it");
  check((await j("POST", `/api/notes/${page.id}/comments`, { body: "quote" })).status === 400, "no comments on it");
  check((await j("GET", `/api/paper/pages/${page.id}`)).status === 423, "the words need an open lock");
  check((await j("GET", `/api/paper/pages/${page.id}`, undefined, DESKTOP, { "X-Paper-Grant": "guess" })).status === 423, "a made-up secret opens nothing");
  check((await j("GET", `/api/paper/pages/${page.id}/info`)).body.name === "Fish", "the lock screen can say which card");

  // ---- a computer asks, the phone is told, a wrong card is refused, the right one opens it
  const asked = await j("POST", `/api/paper/pages/${page.id}/request`, {}, DESKTOP);
  check(asked.status === 201 && asked.body.secret && asked.body.id, "a computer can ask to open the page");
  const { id: rid, secret } = asked.body;
  const waiting = (await j("GET", "/api/paper/requests", undefined, PHONE)).body.requests;
  check(waiting.length === 1 && waiting[0].device === "Windows computer · Chrome" && waiting[0].card === "Fish" && !JSON.stringify(waiting).includes("Safe"), "the phone sees who asks and which card, not which page");
  check((await j("GET", `/api/paper/requests/${rid}`)).body.status === "pending", "the request is pending");
  check((await j("GET", `/api/paper/pages/${page.id}`, undefined, DESKTOP, { "X-Paper-Grant": secret })).status === 423, "the asking device's secret opens nothing before the card is scanned");
  check((await j("POST", `/api/paper/requests/${rid}/approve`, { scan: map(other, 21) }, DESKTOP)).status === 403, "a computer can't answer");
  const wrong = await j("POST", `/api/paper/requests/${rid}/approve`, { scan: map(other, 21) }, PHONE);
  check(wrong.status === 403 && wrong.body.tries_left === 5, `another drawing is refused and the tries left are counted (${wrong.body.tries_left})`);
  check((await j("GET", `/api/paper/requests/${rid}`)).body.status === "pending", "and the request stays pending");
  const copy = await j("POST", `/api/paper/requests/${rid}/approve`, { scan: map(redraw(mine, 5, 0.05), 24) }, PHONE);
  check(copy.status === 403 && copy.body.tries_left === 4, `the same drawing copied by hand (5% off) is refused (${copy.status})`);
  const poor = await j("POST", `/api/paper/requests/${rid}/approve`, { scan: map(blank, 22) }, PHONE);
  check(poor.status === 400 && poor.body.tries_left === undefined, "a scan too poor to read says so and doesn't count as a try");
  const approved = await j("POST", `/api/paper/requests/${rid}/approve`, { scan: map(mine, 23) }, PHONE);
  check(approved.status === 200 && approved.body.device === "Windows computer · Chrome", "the real card, photographed again, opens it");
  check((await j("GET", `/api/paper/requests/${rid}`)).body.status === "approved", "the asking device sees it was approved");
  const open = await j("GET", `/api/paper/pages/${page.id}`, undefined, DESKTOP, { "X-Paper-Grant": secret });
  check(open.status === 200 && open.body.html.includes("4821") && open.body.title === "Safe notes" && open.body.icon === "🔑" && open.body.paper_unlocked === true, "with the secret the words come out");
  check((await j("GET", `/api/paper/grants`)).body.grants.length === 1, "the phone lists what is open");

  // ---- editing while open, with the revision check
  const rev = open.body.paper_rev;
  const saved = await j("PUT", `/api/paper/pages/${page.id}`, { html: `<p>${WORDS} and a new line</p><script>alert(1)</script>`, title: "Safe notes 2", revision: rev }, DESKTOP, { "X-Paper-Grant": secret });
  check(saved.status === 200 && saved.body.paper_rev === rev + 1 && saved.body.html.includes("new line") && !saved.body.html.includes("script"), "an open page can be saved (and is cleaned)");
  const stale = await j("PUT", `/api/paper/pages/${page.id}`, { html: "<p>stale</p>", revision: rev }, DESKTOP, { "X-Paper-Grant": secret });
  check(stale.status === 409 && stale.body.current?.html.includes("new line"), "a stale save is a conflict");
  check(!(await j("GET", `/api/notes/${page.id}`)).text.includes("new line"), "saving didn't put the words in the placeholder");
  check((await j("POST", `/api/paper/pages/${page.id}/ping`, {}, DESKTOP, { "X-Paper-Grant": secret })).status === 200, "a ping keeps it open");

  // ---- the phone presses Relock
  check((await j("POST", "/api/paper/relock", { request_id: rid }, PHONE)).status === 200, "the phone can relock");
  check((await j("GET", `/api/paper/pages/${page.id}`, undefined, DESKTOP, { "X-Paper-Grant": secret })).status === 423, "the page is locked again at once");
  check((await j("POST", `/api/paper/pages/${page.id}/ping`, {}, DESKTOP, { "X-Paper-Grant": secret })).status === 423, "the asking device's next ping finds out");
  check((await j("PUT", `/api/paper/pages/${page.id}`, { html: "<p>late</p>" }, DESKTOP, { "X-Paper-Grant": secret })).status === 423, "and can't save after it");
  check((await j("GET", `/api/paper/requests/${rid}`)).body.status === "relocked", "the request says it was relocked");

  // ---- the phone opening it itself, and closing the page relocks (by the device's own secret)
  check((await j("POST", `/api/paper/pages/${page.id}/unlock`, { scan: map(mine, 31) }, DESKTOP)).status === 403, "a computer can't scan");
  const self = await j("POST", `/api/paper/pages/${page.id}/unlock`, { scan: map(mine, 31) }, PHONE);
  check(self.status === 200 && !!self.body.secret, "a phone scans and opens the page itself");
  check((await j("GET", `/api/paper/pages/${page.id}`, undefined, PHONE, { "X-Paper-Grant": self.body.secret })).body.html.includes("new line"), "the saved words were kept");
  await j("POST", "/api/paper/relock", { secret: self.body.secret }, PHONE);
  check((await j("GET", `/api/paper/pages/${page.id}`, undefined, PHONE, { "X-Paper-Grant": self.body.secret })).status === 423, "closing the page (its own secret) relocks it");

  // ---- a request nobody answers can be denied; a request can't be answered twice
  const r2 = (await j("POST", `/api/paper/pages/${page.id}/request`, {}, DESKTOP)).body;
  check((await j("POST", `/api/paper/requests/${r2.id}/deny`, {}, PHONE)).body.ok === true && (await j("GET", `/api/paper/requests/${r2.id}`)).body.status === "denied", "a request can be denied");
  check((await j("POST", `/api/paper/requests/${r2.id}/approve`, { scan: map(mine, 41) }, PHONE)).status === 404, "a denied request can't be approved after");

  // ---- guessing: six wrong scans block the card, even for the right one
  let last: R | null = null;
  for (let i = 0; i < 6; i++) last = await j("POST", `/api/paper/pages/${page.id}/unlock`, { scan: map(other, 50 + i) }, PHONE);
  check(last!.status === 429, `the sixth wrong scan blocks the card (${last!.status})`);
  const blocked = await j("POST", `/api/paper/pages/${page.id}/unlock`, { scan: map(mine, 60) }, PHONE);
  check(blocked.status === 429 && /minute/.test(blocked.body.error), `the right card is refused while blocked (${blocked.body.error})`);
  check((await j("GET", "/api/paper/cards")).body[0].blocked_until > Date.now(), "the card list says it's blocked");

  // ---- a card can't be deleted while it holds a page; the lock can be removed from an open page
  check((await j("DELETE", `/api/paper/cards/${card}`)).status === 400, "a card that locks a page can't be deleted");
  const note2 = (await j("POST", "/api/notes", { title: "Second", html: "<p>second words</p>" })).body;
  const card2 = (await j("POST", "/api/paper/cards", { name: "Star", scans: [bits(other, 71), bits(other, 72), bits(other, 73)] }, PHONE)).body.id;
  check((await j("POST", `/api/paper/pages/${note2.id}/lock`, { card_id: card2 }, PHONE)).status === 200, "a second card locks another page");
  const s2 = (await j("POST", `/api/paper/pages/${note2.id}/unlock`, { scan: map(other, 74) }, PHONE)).body.secret;
  check((await j("GET", `/api/paper/pages/${note2.id}`, undefined, PHONE, { "X-Paper-Grant": s2 })).status === 200, "it opens with its own card");
  check((await j("GET", `/api/paper/pages/${page.id}`, undefined, PHONE, { "X-Paper-Grant": s2 })).status === 423, "one page's secret doesn't open another page");
  const removed = await j("POST", `/api/paper/pages/${note2.id}/remove-lock`, {}, PHONE, { "X-Paper-Grant": s2 });
  check(removed.status === 200 && removed.body.paper_lock === null && removed.body.html.includes("second words") && removed.body.title === "Second" && removed.body.ai_hidden === 1, "removing the lock puts the words back (still hidden from AI)");
  check((await j("GET", `/api/search?q=second`)).text.includes(note2.id), "and search finds it again");
  check((await j("DELETE", `/api/paper/cards/${card2}`)).body.ok === true, "a card with no pages can be deleted");

  // ---- a card from the first scanner (version 1) is retired: it opens nothing, and says so
  const note3 = (await j("POST", "/api/notes", { title: "Old card page", html: "<p>old words</p>" })).body;
  const old = fullCard(90);
  const card3 = (await j("POST", "/api/paper/cards", { name: "Old", scans: [bits(old, 91), bits(old, 92), bits(old, 93)] }, PHONE)).body.id;
  await j("POST", `/api/paper/pages/${note3.id}/lock`, { card_id: card3 }, PHONE);
  await sql(`UPDATE paper_cards SET version = 1 WHERE id = '${card3}'`);
  check((await j("GET", "/api/paper/cards")).body.find((c: any) => c.id === card3)?.retired === true, "an old card is listed as retired");
  const info3 = (await j("GET", `/api/paper/pages/${note3.id}/info`)).body;
  check(info3.retired === true, "its page says it can't be opened any more");
  const tryOld = await j("POST", `/api/paper/pages/${note3.id}/unlock`, { scan: map(old, 94) }, PHONE);
  check(tryOld.status === 403 && tryOld.body.retired === true && /first scanner/.test(tryOld.body.error), `even the right card opens nothing (${tryOld.status})`);
  check((await j("POST", `/api/paper/pages/${note3.id}/request`, {}, DESKTOP)).status === 403, "and no device can ask for it");
  check((await j("POST", `/api/paper/pages/${note2.id}/lock`, { card_id: card3, scan: map(old, 95) }, PHONE)).status === 400, "an old card can't lock another page");
  check((await j("GET", "/api/paper/cards")).body.find((c: any) => c.id === card3)?.blocked_until === 0, "and trying doesn't count as wrong scans");
  check((await j("DELETE", `/api/notes/${note3.id}`)).status === 204, "its page can still go to the trash");

  // ---- a phone still running the version before this one is told to reopen the app
  const outdated = await j("POST", `/api/paper/pages/${note2.id}/unlock`, { map: "AAAA" }, PHONE);
  check(outdated.status === 400 && /updated/.test(outdated.body.error), `an outdated app is told to close and reopen (${outdated.body.error})`);

  // ---- the trash keeps the lock, purging removes the words
  await j("DELETE", `/api/notes/${page.id}`);
  check((await j("GET", `/api/notes/${page.id}?deleted=1`)).body.html === "", "a trashed locked page is still just a placeholder");
  check((await j("DELETE", `/api/notes/${page.id}/purge`)).status === 204, "purging works");
  check((await j("GET", `/api/paper/pages/${page.id}/info`)).status === 404, "and nothing is left of it");

  console.log(fails ? `${fails} failed` : "all good");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
