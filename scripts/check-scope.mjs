// Seaglass Open 0.2: every database query that touches a personal table must be scoped to one person. This lists the
// queries that aren't: a line mentioning a personal table after FROM, INTO, UPDATE or JOIN, without the owner column
// (`owner_id`) on the same line. A line that is safe for another reason says so with a `scope-ok: why` comment.
// npm run check:scope   (exits 1 while any are left)
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PERSONAL = ["notes", "actions", "links", "comments", "changes", "study", "memories", "chats", "push_subs", "push_sent",
  "push_snooze", "prefs", "embeddings", "inbox", "prompts", "routines", "thread", "study_subjects", "study_pages", "study_sets",
  "study_sessions", "study_exams", "study_exam_pages", "study_misses", "agent_approvals", "capture_keys"];
const table = /\b(?:FROM|INTO|UPDATE|JOIN)\s+([a-z_]+)\b/gi;
const dir = "src/worker";
let left = 0;
const byFile = {};
for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
  readFileSync(join(dir, f), "utf8").split("\n").forEach((line, i) => {
    const hits = [...line.matchAll(table)].map((m) => m[1].toLowerCase()).filter((t) => PERSONAL.includes(t));
    if (!hits.length || /owner_id|scope-ok/.test(line)) return;
    left++;
    (byFile[f] ??= []).push(i + 1);
  });
}
for (const [f, lines] of Object.entries(byFile).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${String(lines.length).padStart(4)}  ${f}  (lines ${lines.slice(0, 12).join(", ")}${lines.length > 12 ? ", …" : ""})`);
}
console.log(`${left} unscoped queries on personal tables`);
process.exit(left ? 1 : 0);
