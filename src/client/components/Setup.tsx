import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, Loader2, PlugZap, ShieldCheck, X } from "lucide-react";
import { api, type SetupData } from "../api";
import { useStore } from "../store";

// Setup & status: what's configured, what's missing, and the exact values to paste into
// Claude and the Claude Console. See docs/SETUP.md for the full walkthrough.
export function SetupModal({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [d, setD] = useState<SetupData | null>(null);
  const [test, setTest] = useState<null | "running" | { ok: boolean; text: string }>(null);
  useEffect(() => { api.setup().then(setD).catch(() => s.toast("Couldn't load setup status")); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const copy = (v: string) => { void navigator.clipboard?.writeText(v); s.toast("Copied"); };
  const Row = ({ label, value }: { label: string; value: string }) => (
    <div className="su-row"><span>{label}</span><code>{value}</code><button className="ghost icon-btn" title="Copy" onClick={() => copy(value)}><Copy size={14} /></button></div>
  );
  const runTest = async () => {
    setTest("running");
    try {
      const r = await api.agentTest();
      setTest({ ok: r.ok, text: r.ok ? `Connected (${r.mode === "wif" ? "workload identity federation" : r.mode}). Claude replied: “${r.reply ?? ""}”` : `Failed${r.status ? ` (${r.status})` : ""}: ${r.error ?? "unknown error"}` });
    } catch (e) { setTest({ ok: false, text: (e as Error).message }); }
  };

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="setup" onMouseDown={(e) => e.stopPropagation()}>
        <div className="su-head"><b><ShieldCheck size={18} /> Setup & status</b><button className="ghost icon-btn" onClick={onClose}><X size={17} /></button></div>
        {!d ? <div className="su-loading"><Loader2 size={18} className="spin" /> Checking…</div> : (
          <div className="su-body">
            <ul className="su-checks">
              {d.checks.map((c) => (
                <li key={c.id} className={c.ok ? "ok" : "warn"}>
                  {c.ok ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}
                  <span><b>{c.label}</b><small>{c.detail}</small></span>
                </li>
              ))}
            </ul>
            <div className="su-test">
              <button onClick={() => void runTest()} disabled={test === "running" || d.mode === "none"}>{test === "running" ? <Loader2 size={15} className="spin" /> : <PlugZap size={15} />} Test Claude connection</button>
              {test && test !== "running" && <p className={test.ok ? "good" : "bad"}>{test.text}</p>}
            </div>

            <h4>Connect Claude to your notes (MCP)</h4>
            <p className="muted">Claude on the web, desktop or phone: Settings → Connectors → Add custom connector, then paste the URL. You'll sign in here and approve it.</p>
            <Row label="Connector URL" value={d.mcp.url} />
            <p className="muted">Claude Code (uses your access token instead of signing in):</p>
            <Row label="Command" value={d.mcp.claude_code} />

            <h4>Workload identity federation (Claude Console)</h4>
            <p className="muted">Console → Settings → Workload identity → Connect workload → Custom OIDC. Use these values; JWKS source: discovery.</p>
            <Row label="Issuer URL" value={d.wif.issuer} />
            <Row label="Discovery" value={d.wif.discovery} />
            <Row label="JWKS" value={d.wif.jwks} />
            <Row label="Subject (sub)" value={d.wif.subject} />
            <Row label="Audience (aud)" value={d.wif.audience} />
            {d.wif.missing.length > 0 && <p className="su-missing">Still needed on the Worker: {d.wif.missing.join(", ")}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
