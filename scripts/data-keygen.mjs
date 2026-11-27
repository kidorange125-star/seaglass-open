// Makes the key that encrypts Seaglass's stored data (DATA_KEY, 32 random bytes, base64url).
//   node scripts/data-keygen.mjs --dev                 add one to .dev.vars for local development (if it has none)
//   node scripts/data-keygen.mjs --out <file>          write a new key to a file (never printed), e.g. to back it up
//   node scripts/data-keygen.mjs --out <file> --put    ...and store the same key as the Worker secret DATA_KEY
//   node scripts/data-keygen.mjs --print               print it (only when you are sure nobody is looking)
// LOSING THE PRODUCTION KEY LOSES EVERY NOTE. Keep a copy in a password manager.
import { webcrypto as crypto } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const key = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

if (flag("--dev")) {
  const f = ".dev.vars";
  const cur = existsSync(f) ? readFileSync(f, "utf8") : "";
  if (/^DATA_KEY=/m.test(cur)) console.error(".dev.vars already has a DATA_KEY; left alone.");
  else { appendFileSync(f, `${cur && !cur.endsWith("\n") ? "\n" : ""}DATA_KEY=${key}\n`); console.error("Added a DATA_KEY to .dev.vars (local development only)."); }
} else if (val("--out")) {
  const out = val("--out");
  if (existsSync(out)) { console.error(`${out} already exists; not overwriting it.`); process.exit(1); }
  writeFileSync(out, key + "\n", { mode: 0o600 });
  console.error(`Wrote a new key to ${out}. Keep a copy in your password manager.`);
  if (flag("--put")) {
    const r = spawnSync("npx", ["wrangler", "secret", "put", "DATA_KEY"], { input: key + "\n", stdio: ["pipe", "inherit", "inherit"], shell: true });
    if (r.status !== 0) { console.error("wrangler secret put failed; the key file was still written."); process.exit(r.status ?? 1); }
  }
} else if (flag("--print")) {
  console.log(key);
} else {
  console.error("Use --dev, --out <file> [--put], or --print. See the top of this file.");
  process.exit(1);
}
