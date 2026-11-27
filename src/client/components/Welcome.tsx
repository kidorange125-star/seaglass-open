// The first screens of Seaglass Open: setting up a new copy (who it's for, then your account) and signing in.
// Both use plain fetch so the server's own message ("Wrong username or password.") reaches the screen.
import { useId, useState, type ReactNode } from "react";
import { Logo } from "../icons";

async function post(path: string, body: unknown): Promise<{ ok: boolean; error?: string; field?: string }> {
  try {
    const r = await fetch(path, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = (await r.json().catch(() => ({}))) as { error?: string; field?: string };
    return r.ok ? { ok: true } : { ok: false, error: d.error ?? `Something went wrong (${r.status}).`, field: d.field };
  } catch {
    return { ok: false, error: "Can't reach Seaglass. Check your connection and try again." };
  }
}

/** A form field: label, input (passed as a render function that gets its id and hint id), and an optional hint. */
export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: (id: string, hintId?: string) => ReactNode }) {
  const id = useId(), hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="w-field">
      <label htmlFor={id}>{label}</label>
      {children(id, hintId)}
      {hint && <small id={hintId}>{hint}</small>}
    </div>
  );
}

export function SignIn({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form className="login welcome" onSubmit={async (e) => {
      e.preventDefault();
      if (busy) return;
      setBusy(true); setErr("");
      const r = await post("/api/login", { username: username.trim(), password });
      setBusy(false);
      if (r.ok) onDone(); else setErr(r.error ?? "");
    }}>
      <div className="brand"><Logo size={44} /> Seaglass</div>
      <p>Sign in to open your notes.</p>
      <Field label={<>Username</>}>{(id) => <input id={id} autoFocus autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} />}</Field>
      <Field label={<>Password</>}>{(id) => <input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
      {err && <p className="err" role="alert">{err}</p>}
      <button className="primary" disabled={busy || !username.trim() || !password}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}

type Mode = "individual" | "household";

export function SetupWizard({ codeRequired, noTables = false, onDone }: { codeRequired: boolean; noTables?: boolean; onDone: () => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [mode, setMode] = useState<Mode | null>(null);
  const [code, setCode] = useState("");
  const [home, setHome] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [err, setErr] = useState<{ text: string; field?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const mismatch = again.length > 0 && again !== password;
  const ready = !!mode && name.trim() && username.trim() && password.length >= 10 && again === password && (!codeRequired || code.trim());

  const finish = async () => {
    if (!ready || busy || !mode) return;
    setBusy(true); setErr(null);
    const r = await post("/api/setup", { code: code.trim() || undefined, mode, household_name: home.trim(), display_name: name.trim(), username: username.trim(), password });
    setBusy(false);
    if (r.ok) onDone(); else setErr({ text: r.error ?? "", field: r.field });
  };

  if (noTables) return (
    <div className="login welcome setup">
      <div className="brand"><Logo size={44} /> Seaglass</div>
      <h1>Almost there</h1>
      <p>Seaglass is running, but its database tables haven't been made yet. On your computer, in the Seaglass folder, run:</p>
      <pre className="w-cmd">npx wrangler d1 migrations apply seaglass --remote</pre>
      <p>then reload this page. (A copy deployed from GitHub does this by itself once its first build finishes.)</p>
      <button className="primary" onClick={() => location.reload()}>Reload</button>
    </div>
  );
  return (
    <div className="login welcome setup">
      <div className="brand"><Logo size={44} /> Seaglass</div>
      <ol className="w-steps" aria-label="Setup steps">
        <li className={step === 1 ? "on" : "done"}>Who it's for</li>
        <li className={step === 2 ? "on" : ""}>Your account</li>
      </ol>
      {step === 1 ? (
        <>
          <h1>Who is this Seaglass for?</h1>
          <div className="w-choices" role="radiogroup" aria-label="Who this Seaglass is for">
            <button type="button" role="radio" aria-checked={mode === "individual"} className={mode === "individual" ? "on" : ""} onClick={() => setMode("individual")}>
              <b>Just me</b><small>Your own notes, tasks and studying.</small>
            </button>
            <button type="button" role="radio" aria-checked={mode === "household"} className={mode === "household" ? "on" : ""} onClick={() => setMode("household")}>
              <b>My household</b><small>You set it up; family members get their own accounts in a coming update.</small>
            </button>
          </div>
          <p className="w-note">You can change this later in Settings.</p>
          <button className="primary" disabled={!mode} onClick={() => setStep(2)}>Continue</button>
        </>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void finish(); }} className="w-form">
          <h1>Make your account</h1>
          {codeRequired && (
            <Field label={<>Setup code</>} hint={<>The SETUP_CODE you chose when deploying. It proves this copy is yours.</>}>{(id, h) => <input id={id} autoFocus autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} aria-invalid={err?.field === "code"} aria-describedby={h} />}</Field>
          )}
          {mode === "household" && (
            <Field label={<>Household name <em>(optional)</em></>}>{(id) => <input id={id} placeholder="The Rivera house" value={home} onChange={(e) => setHome(e.target.value)} />}</Field>
          )}
          <Field label={<>Your name</>} hint={<>What Waffle calls you.</>}>{(id, h) => <input id={id} autoFocus={!codeRequired && mode !== "household"} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} aria-describedby={h} />}</Field>
          <Field label={<>Username</>}>{(id) => <input id={id} autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} aria-invalid={err?.field === "username"} />}</Field>
          <Field label={<>Password</>} hint={<>At least 10 characters.</>}>{(id, h) => <input id={id} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={err?.field === "password"} aria-describedby={h} />}</Field>
          <Field label={<>Password again</>} hint={mismatch ? <span className="err" role="alert">The passwords don't match.</span> : undefined}>{(id, h) => <input id={id} type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} aria-invalid={mismatch} aria-describedby={h} />}</Field>
          {err && <p className="err" role="alert">{err.text}</p>}
          <div className="w-actions">
            <button type="button" className="ghost" onClick={() => setStep(1)}>Back</button>
            <button className="primary" disabled={!ready || busy}>{busy ? "Setting up…" : "Finish setup"}</button>
          </div>
        </form>
      )}
    </div>
  );
}
