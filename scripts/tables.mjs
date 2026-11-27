// Which tables are personal (one person's rows, reached only with {owner}) and which belong to the whole copy. The one
// list is src/worker/scope.ts (PERSONAL and SYSTEM_TABLES); scripts read it from there so nothing drifts.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/worker/scope.ts", import.meta.url), "utf8");
const list = (name) => {
  const m = new RegExp(`export const ${name} = \\[([^\\]]*)\\]`).exec(src);
  if (!m) throw new Error(`${name} not found in src/worker/scope.ts`);
  return [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
};
export const PERSONAL = list("PERSONAL");
export const SYSTEM_TABLES = list("SYSTEM_TABLES");
