// Imported first by localEar.worker.ts: remembers which download failed, so a failure can say what it was ("Load failed"
// alone, Safari's word for any blocked or broken request, doesn't say which).
export let lastFailed = "";
const real = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  try { return await real(input, init); }
  catch (e) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    lastFailed = `${init?.method ?? "GET"} ${url.replace(/\?.*/, "").slice(0, 150)}${init?.headers && new Headers(init.headers).has("range") ? " (range)" : ""}: ${(e as Error).message}`;
    throw e;
  }
};
