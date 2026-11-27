// The deploy that Cloudflare runs for a copy connected to GitHub (npm run deploy:ci): build, deploy, then apply any new
// database tables. Wrangler makes the D1 database, R2 bucket and KV namespace on the first deploy (their ids are left out of
// wrangler.jsonc on purpose), so the tables can only be applied after it. Settings > Backups keeps nightly copies of the
// database; take one first ("Back up now") before updating a copy that already holds notes.
import { spawnSync } from "node:child_process";

const run = (cmd, args) => spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
for (const [cmd, args] of [["npm", ["run", "build"]], ["npx", ["wrangler", "deploy"]], ["npx", ["wrangler", "d1", "migrations", "apply", "seaglass", "--remote"]]]) {
  const r = run(cmd, args);
  if (r.status !== 0) { console.error(`Stopped: ${cmd} ${args.join(" ")} failed.`); process.exit(r.status ?? 1); }
}
