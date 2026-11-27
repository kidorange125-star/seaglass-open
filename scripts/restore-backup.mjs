// Restore a backup downloaded from Settings > Backups into the local database (or, with --remote --yes, production).
//   npm run backup:restore -- path/to/seaglass-backup.json            # local (wrangler dev's database)
//   npm run backup:restore -- path/to/seaglass-backup.json --remote --yes
// Every table in the backup is emptied and refilled from it. Sealed columns stay sealed: the database must run with the same
// DATA_KEY the backup was made with. Search-by-meaning vectors aren't in backups; the cron rebuilds them.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { countRows, toSql } from "./backup-sql.mjs";

const args = process.argv.slice(2), file = args.find((a) => !a.startsWith("--"));
const remote = args.includes("--remote"), yes = args.includes("--yes"), persist = args.find((a) => a.startsWith("--persist-to="))?.slice(13);
if (!file) { console.error("Usage: npm run backup:restore -- <backup.json> [--remote --yes] [--persist-to=<dir>]"); process.exit(1); }
const dump = JSON.parse(readFileSync(file, "utf8"));
const sql = toSql(dump), counts = countRows(dump);
console.log(`Backup from ${new Date(dump.at).toLocaleString()}: ${Object.values(counts).reduce((a, b) => a + b, 0)} rows in ${Object.keys(counts).length} tables.`);
if (remote && !yes) { console.error("This replaces the production database's tables with the backup's. First make a fresh backup (Settings > Backups > Back up now) so you can go back, then run again with --yes."); process.exit(1); }
const out = join(mkdtempSync(join(tmpdir(), "sg-restore-")), "restore.sql");
writeFileSync(out, sql);
const wranglerArgs = ["wrangler", "d1", "execute", "seaglass", remote ? "--remote" : "--local", ...(persist ? ["--persist-to", persist] : []), "--file", out, "--yes"];
execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", wranglerArgs, { stdio: "inherit", shell: process.platform === "win32" });
console.log("Restored. Sign in and check your pages; search by meaning rebuilds by itself over the next minutes.");
