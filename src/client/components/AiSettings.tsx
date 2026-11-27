// Settings > Setup & status > AI: the choices made during setup, changeable later (owners only). AI on, saved for later,
// or off; the keys saved in the app (replace or remove; values are never shown, only their last four characters);
// which models may be used; web search.
import { useEffect, useState } from "react";
import { api, type AiSetup } from "../api";

export function AiSettings({ toast }: { toast: (m: string) => void }) {
  const [d, setD] = useState<AiSetup | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState("");
  const load = () => api.setupAi().then(setD).catch(() => setD(null));
  useEffect(() => { void load(); }, []);
  if (!d) return null;
  const run = async (what: string, f: () => Promise<unknown>, done: string, reload = false) => {
    setBusy(what);
    try { await f(); toast(done); await load(); if (reload) location.reload(); } catch (e) { toast((e as Error).message); } finally { setBusy(""); }
  };
  const ro = !d.owner;
  const mode = d.settings.mode;
  return (
    <section className="ai-set">
      <h3>AI</h3>
      <div className="seg ai-seg" role="radiogroup" aria-label="AI">
        {([["on", "On"], ["later", "Set up later"], ["off", "No AI"]] as const).map(([m, l]) => (
          <button key={m} role="radio" aria-checked={mode === m} className={mode === m ? "on" : ""} disabled={ro || busy === "mode"}
            onClick={() => void run("mode", () => api.saveAiSettings({ mode: m }), m === "off" ? "AI is off for everyone here" : m === "on" ? "AI is on" : "AI saved for later", true)}>{l}</button>
        ))}
      </div>
      <p className="muted ai-note">{mode === "off" ? "Waffle and every AI feature are off for everyone, and the server refuses AI requests." : mode === "later" ? "AI stays off until you connect Claude and turn it on." : d.connected ? `Connected to Claude${d.mode === "mock" ? " (test mode)" : ""}.` : "On, but not connected: add a Claude API key below."}</p>

      {d.owner && mode !== "off" && (
        <>
          <ul className="ai-keys">
            {d.keys.map((k) => (
              <li key={k.name}>
                <span><b>{k.label}</b><small>{k.source === "secret" ? "Set as a Worker secret (that one is used)" : k.saved ? `Saved ${k.hint}` : "Not set"}</small></span>
                {edit === k.name ? (
                  <form className="ai-edit" onSubmit={(e) => { e.preventDefault(); void run(k.name, () => api.saveKey(k.name, val.trim()), `${k.label} saved`, k.name === "ANTHROPIC_API_KEY").then(() => { setEdit(null); setVal(""); }); }}>
                    <input type="password" autoComplete="off" spellCheck={false} placeholder={k.example} value={val} onChange={(e) => setVal(e.target.value)} aria-label={k.label} autoFocus />
                    <button className="primary" disabled={!val.trim() || busy === k.name}>{busy === k.name ? "Checking…" : "Save"}</button>
                    <button type="button" className="ghost" onClick={() => { setEdit(null); setVal(""); }}>Cancel</button>
                  </form>
                ) : (
                  <span className="ai-btns">
                    <button className="ghost" onClick={() => { setEdit(k.name); setVal(""); }}>{k.saved ? "Replace" : "Add"}</button>
                    {k.saved && <button className="ghost danger" disabled={busy === `rm${k.name}`} onClick={() => void run(`rm${k.name}`, () => api.removeKey(k.name), `${k.label} removed`, k.name === "ANTHROPIC_API_KEY")}>Remove</button>}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <div className="ai-models">
            <b>Models that may be used</b>
            {d.models.map((m) => (
              <label key={m.id}><input type="checkbox" checked={d.settings.models.includes(m.id)} disabled={busy === "models"}
                onChange={(e) => { const next = e.target.checked ? [...d.settings.models, m.id] : d.settings.models.filter((x) => x !== m.id); void run("models", () => api.saveAiSettings({ models: next }), "Models saved"); }} />
                {m.label} <small>{m.blurb}</small></label>
            ))}
          </div>
          <label className="ai-web"><input type="checkbox" checked={d.settings.web} disabled={busy === "web"} onChange={(e) => void run("web", () => api.saveAiSettings({ web: e.target.checked }), e.target.checked ? "Web search on" : "Web search off")} /> Let the assistant search the web</label>
        </>
      )}
      {ro && <p className="muted ai-note">Only the household's owner can change these.</p>}
    </section>
  );
}
