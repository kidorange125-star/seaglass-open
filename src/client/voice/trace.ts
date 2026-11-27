// Temporary: what live voice is doing, step by step, sent to the Worker's log so a problem on a phone can be seen from the
// server. Only technical facts (states, sizes, error names), never what was said.
let sent = 0;
export function trace(event: string, detail: unknown = "") {
  if (++sent > 400) return;
  try {
    void fetch("/api/voice/trace", { method: "POST", credentials: "same-origin", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ e: event, d: typeof detail === "string" ? detail : JSON.stringify(detail) }) }).catch(() => {});
  } catch { /* diagnostics must never break anything */ }
}
