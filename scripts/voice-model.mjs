// Copies the on-device speech model (the revision pinned in src/client/voice/localEar.worker.ts) from Hugging Face into R2,
// where the Worker serves it at /api/voice/model/. Phones then download it from Seaglass itself, which nothing on the phone
// (Private Relay, tracker blocking, content blockers) can block.
//   npm run voice:model -- --remote                         production
//   npm run voice:model -- --local [--persist-to <folder>]  a local dev server (the test runners' own folder, for example)
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const src = readFileSync(new URL("../src/client/voice/localEar.worker.ts", import.meta.url), "utf8");
const MODEL = /const MODEL = "([^"]+)"/.exec(src)?.[1], REVISION = /const REVISION = "([0-9a-f]{40})"/.exec(src)?.[1];
if (!MODEL || !REVISION) throw new Error("couldn't find MODEL and REVISION in localEar.worker.ts");
const FILES = ["config.json", "generation_config.json", "preprocessor_config.json", "tokenizer.json", "tokenizer_config.json",
  "onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx"];

const args = process.argv.slice(2);
if (!args.includes("--remote") && !args.includes("--local")) { console.error("Say --remote or --local."); process.exit(1); }
const dir = join(tmpdir(), "seaglass-voice-model");
for (const f of FILES) {
  const res = await fetch(`https://huggingface.co/${MODEL}/resolve/${REVISION}/${f}`);
  if (!res.ok) throw new Error(`${f}: ${res.status}`);
  const file = join(dir, f);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  const type = f.endsWith(".json") ? "application/json" : "application/octet-stream";
  execFileSync("npx", ["wrangler", "r2", "object", "put", `seaglass-files/voice-model/${MODEL}/${f}`, "--file", file, "--content-type", type, ...args], { stdio: ["ignore", "ignore", "inherit"], shell: true });
  console.log(`${f} copied`);
}
rmSync(dir, { recursive: true, force: true });
console.log(`Done: ${MODEL} at ${REVISION.slice(0, 7)}`);
