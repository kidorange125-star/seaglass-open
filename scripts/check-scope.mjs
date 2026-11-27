// Seaglass Open 0.2: every database query that touches a personal table must be scoped to one person (src/worker/scope.ts).
// This lists the ones that aren't: SQL naming a personal table after FROM, INTO, UPDATE or JOIN (upper case, as SQL is
// written here) with neither {owner} nor the any-owner marker in the statement (this line and the next three). A line
// that's safe for another reason says so with a `scope-ok: why` comment. The scoped database also refuses such queries
// at run time; this catches them before then.   npm run check:scope   (exits 1 while any are left)
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PERSONAL, SYSTEM_TABLES } from "./tables.mjs";

const table = /\b(?:FROM|INTO|UPDATE|JOIN)\s+(?:main\.)?["`[]?([a-z_]+)\b/g;
const ok = /\{owner\}|any-owner|scope-ok/;
const dir = "src/worker";
let left = 0;
const byFile = {};
for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
  const lines = readFileSync(join(dir, f), "utf8").split("\n");
  lines.forEach((line, i) => {
    const hits = [...line.matchAll(table)].map((m) => m[1]).filter((t) => PERSONAL.includes(t));
    if (!hits.length || ok.test(lines.slice(i, i + 4).join(" "))) return;
    left++;
    (byFile[f] ??= []).push(i + 1);
  });
}
// Every table a migration makes must be in one of the two lists in src/worker/scope.ts.
const made = new Set();
for (const f of readdirSync("migrations").filter((x) => x.endsWith(".sql"))) {
  for (const m of readFileSync(join("migrations", f), "utf8").matchAll(/CREATE TABLE (?:IF NOT EXISTS )?([a-z_]+)/g)) if (!m[1].endsWith("_new")) made.add(m[1]);
}
const unlisted = [...made].filter((t) => !PERSONAL.includes(t) && !SYSTEM_TABLES.includes(t));
if (unlisted.length) { console.log(`tables in neither PERSONAL nor SYSTEM_TABLES (src/worker/scope.ts): ${unlisted.join(", ")}`); left += unlisted.length; }
for (const [f, lines] of Object.entries(byFile).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${String(lines.length).padStart(4)}  ${f}  (lines ${lines.slice(0, 12).join(", ")}${lines.length > 12 ? ", …" : ""})`);
}
console.log(`${left} unscoped queries on personal tables`);
process.exit(left ? 1 : 0);
