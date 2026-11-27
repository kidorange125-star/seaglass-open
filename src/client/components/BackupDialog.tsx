// Settings > Backups (#15): the nightly backups (worker backup.ts), when the last one ran and whether its check passed,
// "Back up now", and a download of any of them for scripts/restore-backup.mjs.
import { useEffect, useState } from "react";
import { api, type BackupItem, type BackupStatus } from "../api";
import { useStore } from "../store";
import { IClose, IDownload, IShield } from "../ui-icons";

const size = (n: number) => n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
const when = (at: number) => new Date(at).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function BackupDialog() {
  const s = useStore();
  const close = () => s.setBackupOpen(false);
  const [data, setData] = useState<{ status: BackupStatus | null; backups: BackupItem[]; keep: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api.backups().then(setData).catch((e) => { s.toast((e as Error).message); setData({ status: null, backups: [], keep: 14 }); });
  useEffect(() => { void load(); }, []);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") close(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); });

  const now = async () => {
    setBusy(true);
    try { const r = await api.backupNow(); s.toast(r.ok ? "Backed up and checked" : `Backup failed: ${r.error}`); }
    catch (e) { s.toast(`Backup failed: ${(e as Error).message}`); }
    await load(); setBusy(false);
  };
  const download = async (b: BackupItem) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/backups/${b.name}`, { credentials: "same-origin" });
      if (!r.ok) throw new Error(r.status === 404 ? "That backup is gone" : `Couldn't download it (${r.status})`);
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a"); a.href = url; a.download = `seaglass-database-${b.name.replace(/\.sgb$/, "")}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (e) { s.toast((e as Error).message); }
    setBusy(false);
  };
  const st = data?.status;

  return (
    <div className="modal-back" onMouseDown={close}>
      <div className="modal backups" role="dialog" aria-label="Backups" onMouseDown={(e) => e.stopPropagation()}>
        <div className="memory-head">
          <span className="notify-ico"><IShield size={22} /></span>
          <div><b>Backups</b><small>Every night Seaglass copies your whole database, checks the copy opens, and keeps the last {data?.keep ?? 14}.</small></div>
          <button className="ghost icon-btn" aria-label="Close" onClick={close}><IClose size={18} /></button>
        </div>
        {!data ? <div className="skeleton" style={{ height: 60 }} /> : (
          <>
            <div className={`backup-state${st && !st.ok ? " bad" : ""}`}>
              {!st ? <span>No backups yet. The first runs tonight, or back up now.</span>
                : st.ok ? <><span>Last backup {when(st.at)}: checked and fine.</span><small>{st.rows} rows in {st.tables} tables, {size(st.bytes ?? 0)}</small></>
                : <><span>The last backup, {when(st.at)}, failed.</span><small>{st.error}</small></>}
            </div>
            <div className="dlg-actions"><button className="primary" disabled={busy} onClick={() => void now()}>{busy ? "Backing up…" : "Back up now"}</button></div>
            {data.backups.length > 0 && (
              <ul className="backup-list" aria-label="Saved backups">
                {data.backups.map((b) => (
                  <li key={b.name}>
                    <span>{when(b.at)}<br /><small>{size(b.bytes)}</small></span>
                    <button className="ghost icon-btn" disabled={busy} onClick={() => void download(b)} aria-label={`Download the backup from ${when(b.at)}`} title="Download"><IDownload size={18} /></button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <p className="notify-note dlg-warn">Your pages stay encrypted inside every backup, so a backup only opens with this app's data key (<code>DATA_KEY</code>). Keep a copy of that key somewhere safe, like a password manager: without it no backup can be restored. Pictures and files you uploaded aren't in these copies; they're kept separately in file storage.</p>
      </div>
    </div>
  );
}
