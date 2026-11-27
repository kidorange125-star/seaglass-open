// Turns a Seaglass backup (worker backup.ts, downloaded from Settings > Backups) into SQL that puts every table back:
// for each table, delete what's there and insert the backup's rows. Sealed columns stay sealed, so the restored database
// needs the same DATA_KEY. Used by scripts/restore-backup.mjs; tested by tests/unit/backup.test.mjs.
//
// D1 refuses any single SQL statement over 100 KB, so rows are batched by size, and a row too big for one statement (a long
// page, or a history entry with a whole page before and after) is inserted with its long text empty and then filled in
// with UPDATE ... || '...' pieces on the row just inserted (last_insert_rowid()). Search-by-meaning vectors aren't in a
// backup and would be stale after a restore, so they're cleared and the cron rebuilds them.

export const MAX_STATEMENT = 90_000; // bytes, under D1's 100 KB limit
const PIECE = 10_000; // characters per appended piece: at most 40 KB even if every one is 4 bytes

const ident = (s) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) throw new Error(`not a safe name: ${s}`);
  return `"${s}"`;
};
const bytes = (s) => Buffer.byteLength(s, "utf8");

/** One value as SQL: NULL, a number, a string, or a blob ({ $b64 }) as X'hex'. */
export function sqlValue(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") { if (!Number.isFinite(v)) throw new Error("not a finite number"); return String(v); }
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "string") return `'${v.replace(/'/g, "''")}'`;
  if (v && typeof v === "object" && typeof v.$b64 === "string") return `X'${Buffer.from(v.$b64, "base64").toString("hex")}'`;
  throw new Error(`can't write a ${typeof v} value`);
}

/** Statements that put one oversized row in: the insert with its long strings empty, then those strings in pieces. */
function bigRow(table, cols, row) {
  const long = cols.filter((c) => typeof row[c] === "string" && bytes(sqlValue(row[c])) > 2000);
  const out = [`INSERT INTO ${ident(table)} (${cols.map(ident).join(", ")}) VALUES (${cols.map((c) => (long.includes(c) ? "''" : sqlValue(row[c]))).join(", ")});`];
  if (bytes(out[0]) > MAX_STATEMENT) throw new Error(`a row in ${table} is too big to restore even in pieces`);
  for (const c of long) {
    const chars = Array.from(row[c]); // whole characters, never half a surrogate pair
    for (let i = 0; i < chars.length; i += PIECE) out.push(`UPDATE ${ident(table)} SET ${ident(c)} = ${ident(c)} || ${sqlValue(chars.slice(i, i + PIECE).join(""))} WHERE rowid = last_insert_rowid();`);
  }
  return out;
}

/** The whole restore: checked first (a Seaglass backup, version 1), then DELETE and INSERT per table, in one file. */
export function toSql(dump, { max = MAX_STATEMENT, clear = ["embeddings"] } = {}) {
  if (!dump || dump.app !== "seaglass" || dump.kind !== "backup" || dump.v !== 1 || typeof dump.tables !== "object") throw new Error("That isn't a Seaglass backup file.");
  const out = ["PRAGMA defer_foreign_keys = ON;"];
  for (const t of clear) if (!(t in dump.tables)) out.push(`DELETE FROM ${ident(t)};`);
  for (const [table, rows] of Object.entries(dump.tables)) {
    if (!Array.isArray(rows)) throw new Error(`table ${table} isn't a list`);
    out.push(`DELETE FROM ${ident(table)};`);
    let cols = null, head = "", tuples = [], size = 0;
    const flush = () => { if (tuples.length) out.push(`${head}\n${tuples.join(",\n")};`); tuples = []; size = 0; };
    for (const row of rows) {
      const keys = Object.keys(row);
      if (!keys.length) continue;
      if (!cols || keys.join("\u0000") !== cols.join("\u0000")) { flush(); cols = keys; head = `INSERT INTO ${ident(table)} (${cols.map(ident).join(", ")}) VALUES`; }
      const tuple = `(${cols.map((c) => sqlValue(row[c])).join(", ")})`;
      const b = bytes(tuple) + 2;
      if (bytes(head) + b + 1 > max) { flush(); out.push(...bigRow(table, cols, row)); continue; }
      if (bytes(head) + size + b + 1 > max) flush();
      tuples.push(tuple); size += b;
    }
    flush();
  }
  return out.join("\n") + "\n";
}

/** How many rows of each table the file holds (to compare with what the backup said). */
export const countRows = (dump) => Object.fromEntries(Object.entries(dump.tables).map(([t, rows]) => [t, rows.length]));
