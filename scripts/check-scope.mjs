// Seaglass Open 0.2: every database query that touches a personal table must be scoped to one person (src/worker/scope.ts).
// This lists the ones that aren't: SQL naming a personal table after FROM, INTO, UPDATE or JOIN (upper case, as SQL is
// written here) with neither {owner} nor the any-owner marker in the statement (this line and the next three). A line
// that's safe for another reason says so with a `scope-ok: why` comment. The scoped database also refuses such queries
// at run time; this catches them before then.   npm run check:scope   (exits 1 while any are left)
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PERSONAL = ["notes", "actions", "links", "comments", "changes", "study", "memories", "chats", "push_subs", "push_sent",
  "push_snooze", "prefs", "embeddings", "inbox", "prompts", "routines", "thread", "study_subjects", "study_pages", "study_sets",
  "study_sessions", "study_exams", "study_exam_pages", "study_misses", "agent_approvals"];
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
for (const [f, lines] of Object.entries(byFile).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${String(lines.length).padStart(4)}  ${f}  (lines ${lines.slice(0, 12).join(", ")}${lines.length > 12 ? ", …" : ""})`);
}
console.log(`${left} unscoped queries on personal tables`);
process.exit(left ? 1 : 0);
