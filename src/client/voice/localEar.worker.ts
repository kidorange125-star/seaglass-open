// The background thread that runs a small Whisper model on the phone itself. Only this file imports Transformers.js, so
// none of it lands in the main app. The runtime and the model both come from Seaglass (the model is a copy of one pinned
// Hugging Face revision, put in R2 by `npm run voice:model`): an iPhone's privacy features can block downloads from other
// sites ("Load failed"). Once downloaded it stays in the browser's cache.
import { lastFailed } from "./localEar.fetches"; // first, so it sees every download
import { env, pipeline } from "@huggingface/transformers";
import wasm from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import mjs from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";

const MODEL = "onnx-community/whisper-tiny.en";
const REVISION = "2575352d61be1bf7225cf8f8b268a4678025fc58";

const me = self as unknown as { postMessage: (m: unknown) => void; onmessage: ((e: MessageEvent) => void) | null };
const onnx = env.backends.onnx as unknown as { wasm: { wasmPaths: unknown; numThreads: number } };
env.allowLocalModels = false;
env.remoteHost = `${self.location.origin}/api/voice/model/`;
env.remotePathTemplate = "{model}/{revision}/";
onnx.wasm.wasmPaths = { wasm, mjs };
onnx.wasm.numThreads = 1; // more threads would need cross-origin isolation, which would break embeds and outside images

type Asr = (pcm: Float32Array) => Promise<{ text: string } | { text: string }[]>;
let model: Promise<Asr> | null = null;
const load = () => model ??= pipeline("automatic-speech-recognition", MODEL, {
  revision: REVISION, device: "wasm", dtype: "q8",
  progress_callback: (p: { status: string; progress?: number }) => { if (p.status === "progress_total") me.postMessage({ type: "progress", pct: Math.round(p.progress ?? 0) }); },
}) as unknown as Promise<Asr>;

me.onmessage = async ({ data }) => {
  if (data.type === "load") {
    me.postMessage({ type: "stage", stage: "thread running" }); // the thread and its code loaded
    const began = performance.now();
    try { await load(); me.postMessage({ type: "ready", ms: Math.round(performance.now() - began) }); }
    catch (e) { me.postMessage({ type: "failed", message: `${String((e as Error).message ?? e).slice(0, 120)}${lastFailed ? ` (${lastFailed})` : ""}` }); }
    return;
  }
  const began = performance.now();
  try {
    const out = await (await load())(data.pcm as Float32Array);
    me.postMessage({ type: "heard", id: data.id, text: (Array.isArray(out) ? out[0]?.text : out.text) ?? "", ms: Math.round(performance.now() - began) });
  } catch (e) { me.postMessage({ type: "heard", id: data.id, error: String((e as Error).message ?? e).slice(0, 200) }); }
};
