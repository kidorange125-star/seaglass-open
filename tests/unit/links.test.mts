// Links in pages: which addresses are allowed and how they're completed, how they're shown, and what a click does
// (src/client/editor/links.ts). node --experimental-strip-types tests/unit/links.test.mts
import { hostOf, normalizeHref, openLink } from "../../src/client/editor/links.ts";

let fails = 0, n = 0;
const eq = (what: string, got: unknown, want: unknown) => { n++; if (JSON.stringify(got) !== JSON.stringify(want)) { fails++; console.log(`FAIL ${what}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); } };

// ---- addresses
eq("a full address stays", normalizeHref("https://example.com/a?b=1"), "https://example.com/a?b=1");
eq("no scheme gets https", normalizeHref("example.com"), "https://example.com");
eq("www gets https", normalizeHref("www.example.com/x"), "https://www.example.com/x");
eq("surrounding spaces are dropped", normalizeHref("  example.com  "), "https://example.com");
eq("empty is empty (remove the link)", normalizeHref("   "), "");
eq("http stays http", normalizeHref("http://example.com"), "http://example.com");
eq("an email address becomes mailto", normalizeHref("me@school.edu"), "mailto:me@school.edu");
eq("mailto and tel stay", [normalizeHref("mailto:a@b.co"), normalizeHref("tel:+15551234")], ["mailto:a@b.co", "tel:+15551234"]);
eq("an address inside the app stays", normalizeHref("#/p/0f8b2c1e-1111-4222-8333-444455556666"), "#/p/0f8b2c1e-1111-4222-8333-444455556666");
eq("a site path stays", normalizeHref("/files/abc/handout.pdf"), "/files/abc/handout.pdf");
eq("localhost works", normalizeHref("localhost:5173/x"), "https://localhost:5173/x");
eq("scripts are never links", [normalizeHref("javascript:alert(1)"), normalizeHref("JaVaScRiPt:alert(1)"), normalizeHref("data:text/html,x"), normalizeHref("file:///c:/x"), normalizeHref("vbscript:x")], [null, null, null, null, null]);
eq("words with spaces aren't an address", normalizeHref("my lab report"), null);
eq("one word with no dot isn't an address", normalizeHref("report"), null);
eq("a protocol-relative address gets https", normalizeHref("//example.com/a"), "https://example.com/a");

// ---- how it's shown
eq("the site without www", hostOf("https://www.example.com/"), "example.com");
eq("the site and path", hostOf("https://example.com/docs/a"), "example.com/docs/a");
eq("an app link", hostOf("#/p/abc"), "a page in Seaglass");
eq("an email", hostOf("mailto:me@school.edu"), "me@school.edu");

// ---- what a click does
const here = (href: string) => { const u = new URL(href); return { href: u.href, origin: u.origin, pathname: u.pathname, set(v: string) { this.href = v; } } as unknown as Location; };
const run = (href: string, at = "https://seaglass.example.dev/#/p/abc") => {
  const went: string[] = [], opened: string[] = [], loc = here(at);
  const did = openLink(href, (to) => went.push(to), loc, (u) => opened.push(u));
  return { did, went, opened, to: loc.href };
};
eq("a web address opens in a new tab", run("https://example.com/x"), { did: "tab", went: [], opened: ["https://example.com/x"], to: "https://seaglass.example.dev/#/p/abc" });
eq("an app address goes there, in the app", run("#/p/zzz"), { did: "app", went: ["/p/zzz"], opened: [], to: "https://seaglass.example.dev/#/p/abc" });
eq("this site's own address with a page route goes there too", run("https://seaglass.example.dev/#/tasks"), { did: "app", went: ["/tasks"], opened: [], to: "https://seaglass.example.dev/#/p/abc" });
eq("a file on this site opens in a new tab", run("/files/a/handout.pdf").did, "tab");
eq("mail goes to the device's mail app", run("mailto:me@school.edu"), { did: "device", went: [], opened: [], to: "mailto:me@school.edu" });
eq("a script address does nothing", run("javascript:alert(1)"), { did: "none", went: [], opened: [], to: "https://seaglass.example.dev/#/p/abc" });

console.log(fails ? `${fails} of ${n} failed` : `${n} passed`);
process.exit(fails ? 1 : 0);
