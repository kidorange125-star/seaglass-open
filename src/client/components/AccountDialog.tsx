// Settings > Account & household: your name and password, signing other devices out, whether this Seaglass is for one
// person or a household, and About (the one place that says "Seaglass Open").
import { useEffect, useState } from "react";
import { api, type Account, type Household } from "../api";
import { useStore } from "../store";
import { EDITION } from "../edition";
import { Logo } from "../icons";
import { IClose } from "../ui-icons";
import { Field } from "./Welcome";

export const SOURCE_URL = "https://github.com/kidorange125-star/seaglass-open";

export function AccountDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [me, setMe] = useState<Account | null>(null);
  const [home, setHome] = useState<Household | null>(null);
  const [members, setMembers] = useState<Account[]>([]);
  const [name, setName] = useState("");
  const [homeName, setHomeName] = useState("");
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    api.account().then((r) => { setMe(r.user); setHome(r.household); setMembers(r.members); setName(r.user.display_name); setHomeName(r.household.name); })
      .catch((e) => s.toast((e as Error).message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onClose]);

  const run = async (what: string, f: () => Promise<unknown>, done: string) => {
    setBusy(what);
    try { await f(); s.toast(done); return true; } catch (e) { s.toast((e as Error).message); return false; } finally { setBusy(""); }
  };
  const owner = me?.role === "owner";

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal account" role="dialog" aria-label="Account and household" onMouseDown={(e) => e.stopPropagation()}>
        <div className="memory-head">
          <div><b>Account & household</b><small>{me ? `Signed in as ${me.username}` : "Loading…"}</small></div>
          <button className="ghost icon-btn" aria-label="Close" onClick={onClose}><IClose size={18} /></button>
        </div>
        {me && home && (
          <>
            <section className="acc-sec">
              <h3>You</h3>
              <Field label="Your name" hint="What Waffle calls you.">{(id, h) => (
                <div className="acc-row">
                  <input id={id} aria-describedby={h} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
                  <button disabled={!name.trim() || name.trim() === me.display_name || busy === "name"}
                    onClick={() => void run("name", () => api.renameMe(name.trim()), "Name saved").then((ok) => ok && setMe({ ...me, display_name: name.trim() }))}>Save</button>
                </div>
              )}</Field>
            </section>

            <section className="acc-sec">
              <h3>Password</h3>
              <form className="acc-pw" onSubmit={(e) => { e.preventDefault(); void run("pw", () => api.changePassword(cur, next), "Password changed. Other devices were signed out.").then((ok) => { if (ok) { setCur(""); setNext(""); } }); }}>
                <input type="password" placeholder="Current password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} aria-label="Current password" />
                <input type="password" placeholder="New password (10+ characters)" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} aria-label="New password" />
                <button className="primary" disabled={!cur || next.length < 10 || busy === "pw"}>Change password</button>
              </form>
              <button className="ghost acc-link" disabled={busy === "out"} onClick={() => void run("out", () => api.signOutEverywhere(), "Signed out on every other device")}>Sign out on every other device</button>
            </section>

            <section className="acc-sec">
              <h3>Who this Seaglass is for</h3>
              <div className="w-choices compact" role="radiogroup" aria-label="Who this Seaglass is for">
                {(["individual", "household"] as const).map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={home.mode === m} className={home.mode === m ? "on" : ""} disabled={!owner || busy === "mode"}
                    onClick={() => void run("mode", async () => { const r = await api.setHousehold({ mode: m }); setHome(r.household); }, m === "household" ? "Now a household" : "Now just you")}>
                    <b>{m === "individual" ? "Just me" : "My household"}</b>
                  </button>
                ))}
              </div>
              {home.mode === "household" && (
                <>
                  <Field label="Household name">{(id) => (
                    <div className="acc-row">
                      <input id={id} value={homeName} disabled={!owner} onChange={(e) => setHomeName(e.target.value)} placeholder="The Rivera house" />
                      <button disabled={!owner || homeName.trim() === home.name || busy === "home"}
                        onClick={() => void run("home", async () => { const r = await api.setHousehold({ name: homeName.trim() }); setHome(r.household); }, "Household name saved")}>Save</button>
                    </div>
                  )}</Field>
                  <ul className="acc-members">
                    {members.map((m) => <li key={m.id}><b>{m.display_name}</b> <small>{m.username} · {m.role}</small></li>)}
                  </ul>
                  <p className="muted acc-note">Family members get their own accounts in Seaglass Open 0.2, once every part of Seaglass keeps each person's notes separate.</p>
                </>
              )}
            </section>

            <section className="acc-sec acc-about">
              <Logo size={28} />
              <div>
                <b>Seaglass Open {EDITION.version}</b>
                <small>Free and open source under the Apache License 2.0. <a href={SOURCE_URL} target="_blank" rel="noreferrer">Source code</a></small>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
