// Setup after the account exists (Onboarding hands over here, then to the closing animation): AI (connect Claude, save
// it for later, or no AI at all), how the assistant works (which models are allowed, what it may do without asking,
// web search, a spending limit, spoken replies), inviting the household, and this device (theme, reminders). Every
// choice can be changed later in Settings. Runs before the app's own state exists, so it talks to the API directly.
import { useEffect, useState } from "react";
import { api, type AiSetup, type NewInvite } from "../api";
import { enablePush } from "../push";
import { Logo } from "../icons";
import { InviteQr } from "./InviteQr";

type Step = "ai" | "assistant" | "people" | "device";
export type SetupResult = { ai: "on" | "later" | "off"; invited: number; reminders: boolean };

const PRESETS = [
  { id: "careful", title: "Ask before changes", what: "Waffle asks you to approve every change first. Best to start with." },
  { id: "balanced", title: "Ask before deleting", what: "Adds and edits on its own, asks before trashing anything." },
  { id: "free", title: "Act freely", what: "Does what you ask straight away. You can undo anything." },
] as const;
const LIMITS = [{ v: 5, l: "$5" }, { v: 20, l: "$20" }, { v: 50, l: "$50" }, { v: null, l: "No limit" }] as const;

export function SetupSteps({ household, onDone }: { household: boolean; onDone: (r: SetupResult) => void }) {
  const [step, setStep] = useState<Step>("ai");
  const [info, setInfo] = useState<AiSetup | null>(null);
  const [result, setResult] = useState<SetupResult>({ ai: "on", invited: 0, reminders: false });
  useEffect(() => { api.setupAi().then(setInfo).catch(() => setInfo(null)); }, []);
  const steps: Step[] = ["ai", ...(result.ai === "on" ? ["assistant" as const] : []), ...(household ? ["people" as const] : []), "device"];
  const next = (from: Step, r: Partial<SetupResult> = {}) => {
    const merged = { ...result, ...r };
    setResult(merged);
    const order: Step[] = ["ai", ...(merged.ai === "on" ? ["assistant" as const] : []), ...(household ? ["people" as const] : []), "device"];
    const i = order.indexOf(from);
    if (i >= order.length - 1) onDone(merged); else { setStep(order[i + 1]); window.scrollTo?.(0, 0); }
  };
  const idx = steps.indexOf(step);
  return (
    <div className="ob">
      <div className="ob-top">
        <span className="ob-brand"><Logo size={26} /> Seaglass</span>
        <div className="ob-progress" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={idx + 1} aria-label="Setting up"><i style={{ width: `${((idx + 1) / steps.length) * 100}%` }} /></div>
        <span className="ob-count">{idx + 1} of {steps.length}</span>
      </div>
      <main className="ob-main" key={step}>
        {step === "ai" && <AiStep info={info} onDone={(ai) => next("ai", { ai })} />}
        {step === "assistant" && info && <AssistantStep info={info} onDone={() => next("assistant")} />}
        {step === "people" && <PeopleStep onDone={(invited) => next("people", { invited })} />}
        {step === "device" && <DeviceStep onDone={(reminders) => next("device", { reminders })} />}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------- AI: connect, later, or none
function AiStep({ info, onDone }: { info: AiSetup | null; onDone: (ai: "on" | "later" | "off") => void }) {
  const [pick, setPick] = useState<"connect" | "later" | "off" | null>(null);
  const [key, setKey] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const byServer = !!info?.connected && !info.keys.some((k) => k.name === "ANTHROPIC_API_KEY" && k.source === "saved");
  const choose = async (mode: "later" | "off") => {
    setBusy(true); setErr("");
    try { await api.saveAiSettings({ mode }); onDone(mode); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const connect = async () => {
    setBusy(true); setErr("");
    try { await api.saveKey("ANTHROPIC_API_KEY", key.trim()); onDone("on"); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <section className="ob-step">
      <h1>Do you want an AI assistant?</h1>
      <p className="ob-lead">Waffle, and AI help like quizzes made from your notes, reading handwriting and turning a class recording into notes, run on Claude by Anthropic. You use your own key and pay Anthropic for what you use; Seaglass shows what everything costs and can cap it.</p>
      <div className="w-choices su-choices" role="radiogroup" aria-label="AI">
        <button type="button" role="radio" aria-checked={pick === "connect"} className={pick === "connect" ? "on" : ""} onClick={() => setPick("connect")}>
          <b>Connect Claude</b><small>{byServer ? "Already connected by this copy's settings." : "Paste an API key from the Claude Console."}</small>
        </button>
        <button type="button" role="radio" aria-checked={pick === "later"} className={pick === "later" ? "on" : ""} onClick={() => setPick("later")}>
          <b>Save for later</b><small>Set it up any time in Settings. AI features stay off until then.</small>
        </button>
        <button type="button" role="radio" aria-checked={pick === "off"} className={pick === "off" ? "on" : ""} onClick={() => setPick("off")}>
          <b>I don't want AI</b><small>Everything else works without it, and nothing is ever sent to an AI.</small>
        </button>
      </div>
      {pick === "connect" && (byServer ? (
        <div className="su-panel"><p>Claude is already connected{info?.mode === "mock" ? " (test mode: Waffle gives scripted answers)" : ""}.</p>
          <div className="ob-actions"><button className="primary ob-cta" disabled={busy} onClick={() => void api.saveAiSettings({ mode: "on" }).then(() => onDone("on"), (e) => setErr((e as Error).message))}>Continue</button></div>
        </div>
      ) : (
        <form className="su-panel" onSubmit={(e) => { e.preventDefault(); if (!busy && key.trim()) void connect(); }}>
          <ol className="su-howto">
            <li>Open <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a> and sign in (or make an account and add a little credit).</li>
            <li>Under API keys, choose Create key, name it "Seaglass", and copy it.</li>
            <li>Paste it here. It's checked with Claude, stored encrypted, and never shown again.</li>
          </ol>
          <label className="w-field"><span>Claude API key</span>
            <input type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} aria-invalid={!!err} />
          </label>
          <div className="ob-actions"><button className="primary ob-cta" disabled={busy || !key.trim()}>{busy ? "Checking with Claude…" : "Connect"}</button></div>
        </form>
      ))}
      {pick === "later" && <div className="ob-actions"><button className="primary ob-cta" disabled={busy} onClick={() => void choose("later")}>Continue without AI for now</button></div>}
      {pick === "off" && (
        <div className="su-panel"><p>Waffle and the AI buttons are turned off for everyone here, and the server refuses any AI request. An owner can change this in Settings &gt; Setup &amp; status.</p>
          <div className="ob-actions"><button className="primary ob-cta" disabled={busy} onClick={() => void choose("off")}>Use Seaglass without AI</button></div>
        </div>
      )}
      {err && <p className="err" role="alert">{err}</p>}
    </section>
  );
}

// ---------------------------------------------------------------- how the assistant works
function AssistantStep({ info, onDone }: { info: AiSetup; onDone: () => void }) {
  const [models, setModels] = useState<string[]>(info.settings.models);
  const [preset, setPreset] = useState<(typeof PRESETS)[number]["id"]>("careful");
  const [web, setWeb] = useState(info.settings.web);
  const [limit, setLimit] = useState<number | null>(20);
  const [voice, setVoice] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) => setModels((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
  const save = async () => {
    setBusy(true); setErr("");
    try {
      await api.saveAiSettings({ models, web });
      const p = (await api.agentPermissions()).presets[preset];
      if (p) await api.setAgentPermissions(p);
      await api.setRules("household", { monthly_usd: limit });
      if (voice.trim()) await api.saveKey(voice.trim().startsWith("sk-or-") ? "OPENROUTER_API_KEY" : "ELEVENLABS_API_KEY", voice.trim());
      onDone();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <section className="ob-step">
      <h1>How Waffle works for you</h1>
      <p className="ob-lead">You can change all of this later in Settings.</p>

      <h3 className="su-h">Before Waffle changes your things</h3>
      <div className="w-choices su-choices" role="radiogroup" aria-label="Before Waffle changes things">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={preset === p.id} className={preset === p.id ? "on" : ""} onClick={() => setPreset(p.id)}><b>{p.title}</b><small>{p.what}</small></button>
        ))}
      </div>

      <h3 className="su-h">Which Claude models may be used</h3>
      <div className="su-checks-list">
        {info.models.map((m) => (
          <label key={m.id} className="su-check"><input type="checkbox" checked={models.includes(m.id)} onChange={() => toggle(m.id)} />
            <span><b>{m.label}</b><small>{m.blurb}</small></span></label>
        ))}
      </div>
      {!models.length && <p className="err" role="alert">Allow at least one model.</p>}

      <label className="su-check"><input type="checkbox" checked={web} onChange={(e) => setWeb(e.target.checked)} />
        <span><b>Let Waffle search the web</b><small>For questions your notes can't answer. What it finds is treated as information, never as instructions.</small></span></label>

      <h3 className="su-h">A monthly spending limit for the household</h3>
      <div className="seg su-seg" role="radiogroup" aria-label="Monthly limit">
        {LIMITS.map((x) => <button key={x.l} type="button" role="radio" aria-checked={limit === x.v} className={limit === x.v ? "on" : ""} onClick={() => setLimit(x.v)}>{x.l}</button>)}
      </div>
      <p className="ob-fine">AI stops once it's reached and starts again next month. Kid accounts get their own small daily allowance too.</p>

      <details className="su-more"><summary>Spoken replies (optional)</summary>
        <p className="ob-fine">For live voice, an ElevenLabs or OpenRouter key gives Waffle a natural voice. Without one, your device's own voice is used.</p>
        <input type="password" autoComplete="off" spellCheck={false} placeholder="ElevenLabs (sk_…) or OpenRouter (sk-or-…) key" value={voice} onChange={(e) => setVoice(e.target.value)} aria-label="Voice key" />
      </details>

      {err && <p className="err" role="alert">{err}</p>}
      <div className="ob-actions"><button className="primary ob-cta" disabled={busy || !models.length} onClick={() => void save()}>{busy ? "Saving…" : "Continue"}</button></div>
    </section>
  );
}

// ---------------------------------------------------------------- invite the household
function PeopleStep({ onDone }: { onDone: (invited: number) => void }) {
  const [label, setLabel] = useState("");
  const [role, setRole] = useState<"adult" | "kid" | "owner">("adult");
  const [made, setMade] = useState<(NewInvite & { label: string })[]>([]);
  const [err, setErr] = useState("");
  const invite = async () => {
    setErr("");
    try { const r = await api.invite(role, label.trim()); setMade((m) => [{ ...r, label: label.trim() }, ...m]); setLabel(""); }
    catch (e) { setErr((e as Error).message); }
  };
  const last = made[0];
  return (
    <section className="ob-step">
      <h1>Invite your household</h1>
      <p className="ob-lead">Everyone gets their own private account: their notes, tasks, study and assistant are theirs alone. You also share a Family space for pages, chores and the calendar.</p>
      <form className="su-invite" onSubmit={(e) => { e.preventDefault(); void invite(); }}>
        <input aria-label="Who it's for" placeholder="Who it's for (Sam)" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
        <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
          <option value="adult">Adult</option><option value="kid">Kid</option><option value="owner">Owner</option>
        </select>
        <button className="primary">Make invite</button>
      </form>
      {role === "kid" && <p className="ob-fine">Kid accounts get an assistant that teaches instead of doing homework, no web search and a small daily AI allowance.</p>}
      {last && (
        <div className="hh-code su-code" aria-live="polite">
          <small>{last.label ? `${last.label}'s` : "Their"} invite: scan it, or send the code or link</small>
          <InviteQr link={last.link} size={150} />
          <code>{last.code}</code>
          <div className="hh-row">
            <button className="ghost" onClick={() => void navigator.clipboard?.writeText(last.link)}>Copy link</button>
            {"share" in navigator && <button className="ghost" onClick={() => void navigator.share({ title: "Seaglass invite", text: `Join my Seaglass: ${last.link}\nOr use the code ${last.code}` }).catch(() => undefined)}>Send</button>}
          </div>
          <small>Works once, for 7 days. It's only shown now; you can always make another in Settings.</small>
        </div>
      )}
      {made.length > 1 && <p className="ob-fine">{made.length} invites made.</p>}
      {err && <p className="err" role="alert">{err}</p>}
      <div className="ob-actions"><button className={made.length ? "primary ob-cta" : "ghost ob-cta"} onClick={() => onDone(made.length)}>{made.length ? "Continue" : "Later"}</button></div>
    </section>
  );
}

// ---------------------------------------------------------------- this device
function DeviceStep({ onDone }: { onDone: (reminders: boolean) => void }) {
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem("sg.theme") ?? "system"; } catch { return "system"; } });
  const [push, setPush] = useState<"idle" | "on" | "denied" | "busy" | "unsupported">(() => ("Notification" in window && "serviceWorker" in navigator ? "idle" : "unsupported"));
  const [err, setErr] = useState("");
  const pickTheme = (t: string) => {
    setTheme(t);
    try { localStorage.setItem("sg.theme", t); } catch { /* private window */ }
    document.documentElement.dataset.theme = t === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : t;
  };
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <section className="ob-step">
      <h1>This device</h1>
      <h3 className="su-h">Look</h3>
      <div className="seg su-seg" role="radiogroup" aria-label="Theme">
        {(["system", "light", "dark"] as const).map((t) => <button key={t} type="button" role="radio" aria-checked={theme === t} className={theme === t ? "on" : ""} onClick={() => pickTheme(t)}>{t === "system" ? "Match device" : t === "light" ? "Light" : "Dark"}</button>)}
      </div>
      <h3 className="su-h">Reminders</h3>
      <p className="ob-fine">Get a notification when a task is due, and a short morning summary. Times use your time zone, {tz.replace(/_/g, " ")}.</p>
      {push === "on" ? <p className="su-ok">Reminders are on for this device.</p>
        : push === "unsupported" ? <p className="ob-fine">This browser can't show notifications. On an iPhone or iPad, add Seaglass to your Home Screen first, then turn them on in Settings.</p>
        : <button className="ghost su-btn" disabled={push === "busy"} onClick={async () => {
            setPush("busy"); setErr("");
            try { const r = await enablePush(); setPush(r === "on" ? "on" : r === "denied" ? "denied" : "idle"); }
            catch (e) { setErr((e as Error).message); setPush("idle"); }
          }}>{push === "denied" ? "Notifications are blocked in this browser's settings" : push === "busy" ? "Asking…" : "Turn on reminders"}</button>}
      {err && <p className="err" role="alert">{err}</p>}
      <div className="ob-actions"><button className="primary ob-cta" onClick={() => onDone(push === "on")}>Finish setup</button></div>
    </section>
  );
}
