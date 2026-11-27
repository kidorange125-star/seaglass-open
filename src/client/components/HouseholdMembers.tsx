// Settings > Account & household > People: who's in this household, inviting someone (a code and a link, shown once),
// owner/adult roles, and removing someone (which deletes everything of theirs, so their username must be typed).
import { useEffect, useState } from "react";
import { api, type Account, type NewInvite, type PendingInvite } from "../api";
import { useStore } from "../store";

const days = (t: number) => Math.max(1, Math.round((t - Date.now()) / 86_400_000));
const ROLE_NAME: Record<string, string> = { owner: "Owner", adult: "Adult" };

export function HouseholdMembers({ me, members, onMembers }: { me: Account; members: Account[]; onMembers: (m: Account[]) => void }) {
  const s = useStore();
  const owner = me.role === "owner";
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [fresh, setFresh] = useState<NewInvite | null>(null);
  const [label, setLabel] = useState("");
  const [role, setRole] = useState<"adult" | "owner">("adult");
  const [removing, setRemoving] = useState<Account | null>(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState("");

  const reload = async () => {
    onMembers(await api.members());
    if (owner) setInvites(await api.invites());
  };
  useEffect(() => { void reload().catch(() => undefined); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (what: string, f: () => Promise<unknown>, done?: string) => {
    setBusy(what);
    try { await f(); if (done) s.toast(done); return true; } catch (e) { s.toast((e as Error).message); return false; } finally { setBusy(""); }
  };
  const copy = (text: string, what: string) => { void navigator.clipboard?.writeText(text).then(() => s.toast(`${what} copied`), () => s.toast("Couldn't copy. Select it and copy instead.")); };
  const share = (inv: NewInvite) => {
    const text = `Join my Seaglass: ${inv.link}\nOr use the code ${inv.code}`;
    if (navigator.share) void navigator.share({ title: "Seaglass invite", text }).catch(() => undefined);
    else copy(text, "Invite");
  };

  return (
    <div className="hh">
      <ul className="hh-people" aria-label="People in this household">
        {members.map((m) => (
          <li key={m.id}>
            <span className="hh-av" aria-hidden>{(m.display_name || m.username).slice(0, 1).toUpperCase()}</span>
            <span className="hh-who"><b>{m.display_name}{m.id === me.id ? " (you)" : ""}</b><small>{m.username}</small></span>
            {owner && m.id !== me.id ? (
              <select aria-label={`${m.display_name}'s role`} value={m.role} disabled={busy === `role${m.id}`}
                onChange={(e) => { const r = e.target.value as "adult" | "owner"; void run(`role${m.id}`, async () => { await api.setRole(m.id, r); await reload(); }, `${m.display_name} is now ${r === "owner" ? "an owner" : "an adult"}`); }}>
                <option value="owner">Owner</option><option value="adult">Adult</option>
              </select>
            ) : <small className="hh-role">{ROLE_NAME[m.role] ?? m.role}</small>}
            {(owner ? m.id !== me.id : m.id === me.id) && (
              <button className="ghost hh-x" onClick={() => { setRemoving(m); setConfirm(""); }}>{m.id === me.id ? "Leave" : "Remove"}</button>
            )}
          </li>
        ))}
      </ul>

      {removing && (
        <form className="hh-remove" role="alertdialog" aria-label={removing.id === me.id ? "Leave the household" : `Remove ${removing.display_name}`}
          onSubmit={(e) => {
            e.preventDefault();
            const self = removing.id === me.id;
            void run("remove", async () => {
              await api.removeMember(removing.id, confirm.trim());
              if (self) { location.hash = "#/"; location.reload(); return; }
              setRemoving(null); await reload();
            }, self ? undefined : `${removing.display_name} was removed`);
          }}>
          <b>{removing.id === me.id ? "Leave this household?" : `Remove ${removing.display_name}?`}</b>
          <p>{removing.id === me.id ? "Your account" : `${removing.display_name}'s account`} and everything in it are deleted for good: pages, tasks, study history, the assistant's conversation and memory, and uploaded files. Nobody else's things change.</p>
          <label>Type <code>{removing.username}</code> to confirm
            <input aria-label={`Type ${removing.username} to confirm`} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoCapitalize="none" spellCheck={false} autoComplete="off" />
          </label>
          <div className="hh-row">
            <button type="button" className="ghost" onClick={() => setRemoving(null)}>Cancel</button>
            <button className="danger" disabled={busy === "remove" || confirm.trim().toLowerCase() !== removing.username.toLowerCase()}>
              {removing.id === me.id ? "Leave and delete my things" : "Remove and delete"}
            </button>
          </div>
        </form>
      )}

      {owner && (
        <div className="hh-invite">
          <b>Invite someone</b>
          {fresh ? (
            <div className="hh-code" aria-live="polite">
              <small>Their invite code</small>
              <code>{fresh.code}</code>
              <small>Works once, for {days(fresh.expires_at)} days. It's only shown now: send it before you close this.</small>
              <div className="hh-row">
                <button className="primary" onClick={() => share(fresh)}>{"share" in navigator ? "Send invite" : "Copy invite"}</button>
                <button className="ghost" onClick={() => copy(fresh.link, "Link")}>Copy link</button>
                <button className="ghost" onClick={() => { setFresh(null); setLabel(""); }}>Done</button>
              </div>
            </div>
          ) : (
            <form className="hh-row hh-new" onSubmit={(e) => {
              e.preventDefault();
              void run("invite", async () => { setFresh(await api.invite(role, label.trim())); setInvites(await api.invites()); });
            }}>
              <input aria-label="Who it's for" placeholder="Who it's for (optional)" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
              <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as "adult" | "owner")}>
                <option value="adult">Adult</option><option value="owner">Owner</option>
              </select>
              <button className="primary" disabled={busy === "invite"}>Make invite</button>
            </form>
          )}
          {invites.length > 0 && (
            <ul className="hh-pending" aria-label="Invites waiting">
              {invites.map((i) => (
                <li key={i.id}>
                  <span>{i.label || "Invite"} <small>{ROLE_NAME[i.role] ?? i.role}, {days(i.expires_at)} days left</small></span>
                  <button className="ghost" disabled={busy === `cancel${i.id}`} onClick={() => void run(`cancel${i.id}`, async () => { await api.cancelInvite(i.id); setInvites(await api.invites()); }, "Invite cancelled")}>Cancel</button>
                </li>
              ))}
            </ul>
          )}
          <p className="muted acc-note">Owners can invite people, change roles, remove people and run backups. Everyone's notes, tasks, study and assistant stay their own.</p>
        </div>
      )}
    </div>
  );
}
