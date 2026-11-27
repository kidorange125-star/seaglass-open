// Upgrading a real copy: runs an OLD release (a git tag) on a fresh database, makes data through its own API
// (seed.py), stops it, applies this checkout's migrations to that same database, runs this version on it and checks
// that the old owner's things all still work (check.py). Every release that adds a migration runs this from the last
// release first.   node tests/upgrade/run.mjs v0.2.0     (needs Python 3; uses ports 5175 and a temporary folder)
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, unlinkSync, copyFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const from = process.argv[2];
if (!from) { console.error("Usage: node tests/upgrade/run.mjs <release tag, e.g. v0.2.0>"); process.exit(2); }
const repo = resolve(new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const work = mkdtempSync(join(tmpdir(), "sg-upgrade-"));
const old = join(work, "old"), state = join(work, "state"), data = join(work, "upgrade.json");
const PORT = 5175, URL_ = `http://localhost:${PORT}`;
const win = process.platform === "win32";
const run = (cmd, args, cwd, env = {}) => {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: win, env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed`);
};
const migrate = (cwd) => run("npx", ["wrangler", "d1", "migrations", "apply", "seaglass", "--local", "--persist-to", state], cwd);
async function serve(cwd) {
  const p = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { cwd, shell: win, env: { ...process.env, SEAGLASS_STATE: state }, stdio: "ignore" });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${URL_}/api/session`)).status < 500) return p; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("the server didn't start");
}
const stop = (p) => { if (win) spawnSync("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" }); else p.kill(); };

let server = null, ok = false;
try {
  run("git", ["worktree", "add", "--detach", old, from], repo);
  symlinkSync(join(repo, "node_modules"), join(old, "node_modules"), "junction");
  copyFileSync(join(repo, ".dev.vars"), join(old, ".dev.vars"));
  console.log(`\n== ${from}: migrate a fresh database and make data`);
  migrate(old);
  server = await serve(old);
  run("python", [join(repo, "tests/upgrade/seed.py")], repo, { SEAGLASS_URL: URL_, UPGRADE_FILE: data });
  stop(server); server = null;
  console.log("\n== this version: apply the new migrations to that database and check");
  migrate(repo);
  server = await serve(repo);
  run("python", [join(repo, "tests/upgrade/check.py")], repo, { SEAGLASS_URL: URL_, UPGRADE_FILE: data, PYTHONIOENCODING: "utf-8" });
  ok = true;
} catch (e) {
  console.error(String(e));
} finally {
  if (server) stop(server);
  // The junction first (unlinking it removes only the link, never the real node_modules), then the worktree.
  try { if (existsSync(join(old, "node_modules"))) unlinkSync(join(old, "node_modules")); } catch { /* already gone */ }
  spawnSync("git", ["worktree", "remove", "--force", old], { cwd: repo, stdio: "ignore", shell: win });
  rmSync(work, { recursive: true, force: true });
  spawnSync("git", ["worktree", "prune"], { cwd: repo, stdio: "ignore", shell: win });
}
console.log(ok ? `\nupgrade from ${from}: all good` : `\nupgrade from ${from}: FAILED`);
process.exit(ok ? 0 : 1);
