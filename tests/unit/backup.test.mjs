// Restoring a backup (scripts/backup-sql.mjs). node tests/unit/backup.test.mjs
import { countRows, MAX_STATEMENT, sqlValue, toSql } from "../../scripts/backup-sql.mjs";

let ok = 0, bad = 0;
const eq = (n, g, w) => { const a = JSON.stringify(g), b = JSON.stringify(w); if (a === b) ok++; else { bad++; console.log("FAIL", n, a, "!=", b); } };
const throws = (n, f) => { try { f(); bad++; console.log("FAIL", n, "didn't throw"); } catch { ok++; } };
// statements as the file has them: each ends with ";" at the end of a line
const statements = (sql) => sql.split(/;\n/).filter((s) => s.trim());

eq("values", [sqlValue(null), sqlValue(3), sqlValue(true), sqlValue("it's"), sqlValue({ $b64: Buffer.from([1, 255]).toString("base64") })], ["NULL", "3", "1", "'it''s'", "X'01ff'"]);
throws("no NaN", () => sqlValue(NaN));
throws("no objects", () => sqlValue({ a: 1 }));
const dump = { app: "seaglass", kind: "backup", v: 1, at: 1, tables: { notes: [{ id: "a", title: "x'y", revision: 2 }, { id: "b", title: null, revision: 1 }], prefs: [] } };
const sql = toSql(dump);
eq("deletes then inserts each table", [sql.includes('DELETE FROM "notes";'), sql.includes('DELETE FROM "prefs";'), sql.includes(`INSERT INTO "notes" ("id", "title", "revision") VALUES\n('a', 'x''y', 2),\n('b', NULL, 1);`)], [true, true, true]);
eq("foreign keys wait until the end", sql.startsWith("PRAGMA defer_foreign_keys = ON;"), true);
eq("stale search vectors are cleared", sql.includes('DELETE FROM "embeddings";'), true);
throws("not a backup", () => toSql({ app: "seaglass", version: 1, notes: [] }));
throws("an unsafe table name", () => toSql({ ...dump, tables: { "notes; DROP TABLE x": [] } }));
eq("counts", countRows(dump), { notes: 2, prefs: 0 });

// batches by size, never a statement over D1's limit
const many = Array.from({ length: 400 }, (_, i) => ({ id: `n${i}`, html: "<p>" + "word ".repeat(200) + "</p>" }));
const bigSql = toSql({ ...dump, tables: { notes: many } });
const st = statements(bigSql);
eq("many rows split into several inserts", st.filter((s) => s.startsWith("INSERT")).length > 3, true);
eq("no statement over the limit", Math.max(...st.map((s) => Buffer.byteLength(s))) <= MAX_STATEMENT, true);
eq("every row is there", (bigSql.match(/\('n\d+'/g) ?? []).length, 400);

// a row too big for one statement goes in pieces
const huge = "é'; DROP ".repeat(30_000); // 270,000 characters with quotes, semicolons and two-byte letters
const pieces = statements(toSql({ ...dump, tables: { actions: [{ id: "h", before_json: huge, after_json: "small" }] } }));
eq("an oversized row: insert with it empty, then pieces", [pieces.filter((s) => s.startsWith("INSERT")).length, pieces.filter((s) => s.startsWith("UPDATE")).length > 20], [1, true]);
eq("pieces fit too", Math.max(...pieces.map((s) => Buffer.byteLength(s))) <= MAX_STATEMENT, true);
const rebuilt = pieces.filter((s) => s.includes("last_insert_rowid")).map((s) => /\|\| '(.*)' WHERE rowid = last_insert_rowid\(\)$/s.exec(s)[1].replace(/''/g, "'")).join("");
eq("the pieces add up to the original", rebuilt === huge, true);
// a backup from before rows had owners (0.1): restored, its rows go to the first account; shared settings stay shared
const old = toSql({ ...dump, tables: { notes: [{ id: "a", title: "t" }], prefs: [{ key: "household", value: "{}" }, { key: "persona", value: "waffle" }] } });
eq("a 0.1 backup: personal rows go to the first account", [old.includes(`UPDATE "notes" SET owner_id = COALESCE((SELECT id FROM users ORDER BY created_at LIMIT 1), '') WHERE owner_id = '';`), /UPDATE prefs SET owner_id = .* AND key NOT IN \('household', 'backup_status', 'vault_sealed_kid', 'changes_pruned_through'\);/.test(old)], [true, true]);
const now = toSql({ ...dump, tables: { notes: [{ owner_id: "u1", id: "a", title: "t" }], prefs: [{ owner_id: "", key: "household", value: "{}" }] } });
eq("a 0.2 backup keeps its owners as they are", now.includes("SET owner_id"), false);
console.log(`${ok} passed, ${bad} failed`); if (bad) process.exit(1);
