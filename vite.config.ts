import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { execSync } from "node:child_process";

// SEAGLASS_STATE points the local D1/R2/KV at another folder, so the test suites (which wipe the database)
// can run on their own server without touching the notes in your normal dev server. See tests/README.md.
const state = process.env.SEAGLASS_STATE;
// Shown at the bottom of Settings, so it's easy to tell which version a device is running.
const commit = (() => { try { return execSync("git rev-parse --short HEAD").toString().trim(); } catch { return "dev"; } })();
const BUILD = `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · ${commit}`;

export default defineConfig({
  plugins: [react(), cloudflare(state ? { persistState: { path: state } } : {})],
  define: { __BUILD__: JSON.stringify(BUILD) },
  // On-device speech runs on the CPU, so it uses the plain runtime: the WebGPU one is bigger than a Workers static file may be.
  resolve: { alias: { "onnxruntime-web/webgpu": "onnxruntime-web/wasm" } },
  worker: { format: "es" },
});
