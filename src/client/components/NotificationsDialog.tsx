// Settings > Notifications: turn task reminders on for this device, see the other devices, and choose the
// default reminder and the daily summary. Not note content, so nothing here is in page history.
import { useEffect, useState } from "react";
import { api, type PushInfo } from "../api";
import { useStore } from "../store";
import { IBell, IClose, ITrash } from "../ui-icons";
import { currentEndpoint, disablePush, enablePush, pushState, timeZone, type PushState } from "../push";
import { DEFAULT_REMIND_OPTIONS } from "../remind";
import { timeAgo } from "./ui";

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const DAYS = ["S", "M", "T", "W", "T", "F", "S"], DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SCHOOL = "12345@08:00-15:00";

/** Quiet hours, e.g. school: "<days 0-6>@HH:MM-HH:MM", or "" for off (worker reminders.ts quietNow). */
function QuietHours({ value, busy, onChange }: { value: string; busy: boolean; onChange: (v: string) => void }) {
  const m = /^([0-6]+)@(\d\d:\d\d)-(\d\d:\d\d)$/.exec(value);
  const days = m?.[1] ?? "12345", start = m?.[2] ?? "08:00", end = m?.[3] ?? "15:00";
  const set = (d: string, a: string, b: string) => { if (d && a < b) onChange(`${[...d].sort().join("")}@${a}-${b}`); };
  return (
    <div className="notify-pref notify-quiet">
      <span>Quiet hours<small>No notifications then (school, say), except High priority tasks and anything urgent from the assistant. What you missed arrives in one notification when they end.</small></span>
      <span className="notify-digest">
        <input type="checkbox" checked={!!m} disabled={busy} onChange={(e) => onChange(e.target.checked ? SCHOOL : "")} aria-label="Quiet hours" />
        <input type="time" step={900} value={start} disabled={busy || !m} onChange={(e) => e.target.value && set(days, e.target.value, end)} aria-label="Quiet hours start" />
        <span className="muted">to</span>
        <input type="time" step={900} value={end} disabled={busy || !m} onChange={(e) => e.target.value && set(days, start, e.target.value)} aria-label="Quiet hours end" />
      </span>
      {m && <span className="notify-days" role="group" aria-label="Quiet days">
        {DAYS.map((d, i) => { const on = days.includes(String(i)); return (
          <button key={i} type="button" aria-pressed={on} aria-label={DAY_NAMES[i]} className={on ? "on" : ""} disabled={busy || (on && days.length === 1)}
            onClick={() => set(on ? days.replace(String(i), "") : days + i, start, end)}>{d}</button>
        ); })}
      </span>}
      {m && start >= end && <small className="when-err">The end has to be after the start.</small>}
    </div>
  );
}

export function NotificationsDialog() {
  const s = useStore();
  const close = () => s.setNotifyOpen(false);
  const [info, setInfo] = useState<PushInfo | null>(null);
  const [state, setState] = useState<PushState | null>(null);
  const [mine, setMine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [i, st, ep] = await Promise.all([api.push(), pushState(), currentEndpoint()]);
      setInfo(i); setState(st); setMine(ep);
    } catch (e) { s.toast((e as Error).message); setState("unsupported"); }
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  });

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); } catch (e) { s.toast((e as Error).message); }
    setBusy(false); void load();
  };
  const turnOn = () => run(async () => {
    const st = await enablePush(info?.key);
    if (st === "on") s.toast("Notifications are on for this device");
    else if (st === "denied") s.toast("Notifications are blocked for Seaglass");
  });
  const test = (endpoint?: string) => run(async () => {
    const r = await api.pushTest(endpoint);
    s.toast(r.sent ? `Sent to ${r.sent} device${r.sent === 1 ? "" : "s"}` : `Couldn't send: ${r.errors[0] ?? "unknown error"}`);
  });
  const setPref = (p: Partial<PushInfo["prefs"]>) => run(async () => { const prefs = await api.pushPrefs(p); setInfo((i) => (i ? { ...i, prefs } : i)); });

  const devices = info?.devices ?? [];
  const prefs = info?.prefs;
  return (
    <div className="modal-back" onMouseDown={close}>
      <div className="modal notify" role="dialog" aria-label="Notifications" onMouseDown={(e) => e.stopPropagation()}>
        <div className="memory-head">
          <span className="notify-ico"><IBell size={22} /></span>
          <div><b>Notifications</b><small>Reminders for your tasks, on this computer or phone, even when Seaglass is closed.</small></div>
          <button className="ghost icon-btn" aria-label="Close" onClick={close}><IClose size={18} /></button>
        </div>

        <section className="notify-sec">
          <h3>This device</h3>
          {state === null ? <div className="skeleton" style={{ height: 40 }} />
            : info && !info.key ? <p className="notify-note">Notifications aren't set up on the server yet: it needs a <code>VAPID_PRIVATE_KEY</code> secret (see docs/SETUP.md).</p>
            : state === "needs-install" ? (
              <div className="notify-steps">
                <p>On iPhone and iPad, notifications only work in the Seaglass app on your Home Screen:</p>
                <ol>
                  <li>Tap the <b>Share</b> button in Safari.</li>
                  <li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li>
                  <li>Open Seaglass from your Home Screen and come back here (Settings &gt; Notifications).</li>
                </ol>
              </div>
            )
            : state === "unsupported" ? <p className="notify-note">This browser can't show notifications from websites. On Windows, use Chrome or Edge.</p>
            : state === "denied" ? (
              <p className="notify-note">Notifications are blocked for Seaglass. {isIOS()
                ? "Turn them on in iPhone Settings > Notifications > Seaglass, then come back here."
                : "Click the icon to the left of the address bar, set Notifications to Allow, then reload."}</p>
            )
            : state === "on" ? (
              <div className="notify-row">
                <span className="notify-on">On</span>
                <button className="ghost" disabled={busy} onClick={() => void test(mine ?? undefined)}>Send a test</button>
                <button className="ghost" disabled={busy} onClick={() => void run(async () => { await disablePush(); s.toast("Notifications are off for this device"); })}>Turn off</button>
              </div>
            ) : (
              <div className="notify-row">
                <button className="primary" disabled={busy} onClick={() => void turnOn()}><IBell size={16} /> Turn on notifications</button>
                {!isIOS() && <small className="muted">On Windows, notifications arrive while Chrome or Edge is running, even with Seaglass closed.</small>}
              </div>
            )}
        </section>

        {prefs && (
          <section className="notify-sec">
            <h3>Reminders</h3>
            <label className="notify-pref">
              <span>Tasks with a time<small>Each task can change this in its date picker.</small></span>
              <select value={prefs.remind} disabled={busy} onChange={(e) => void setPref({ remind: e.target.value })}>
                {DEFAULT_REMIND_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="notify-pref">
              <span>Daily summary<small>What's due today, and anything overdue.</small></span>
              <span className="notify-digest">
                <input type="checkbox" checked={!!prefs.digest} disabled={busy} onChange={(e) => void setPref({ digest: e.target.checked ? "08:00" : "" })} aria-label="Daily summary" />
                <input type="time" step={900} value={prefs.digest} disabled={busy || !prefs.digest} onChange={(e) => e.target.value && void setPref({ digest: e.target.value })} aria-label="Summary time" />
              </span>
            </label>
            <label className="notify-pref">
              <span>Weekly review<small>Overdue, next 7 days and flashcards, with a button to sort them out.</small></span>
              <span className="notify-digest">
                <input type="checkbox" checked={!!prefs.weekly} disabled={busy} onChange={(e) => void setPref({ weekly: e.target.checked ? "0@17:00" : "" })} aria-label="Weekly review" />
                <select value={prefs.weekly.split("@")[0] || "0"} disabled={busy || !prefs.weekly} onChange={(e) => void setPref({ weekly: `${e.target.value}@${prefs.weekly.split("@")[1] || "17:00"}` })} aria-label="Weekly review day">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => <option key={d} value={i}>{d}</option>)}
                </select>
                <input type="time" step={900} value={prefs.weekly.split("@")[1] || "17:00"} disabled={busy || !prefs.weekly} onChange={(e) => e.target.value && void setPref({ weekly: `${prefs.weekly.split("@")[0] || "0"}@${e.target.value}` })} aria-label="Weekly review time" />
              </span>
            </label>
            <QuietHours value={prefs.quiet ?? ""} busy={busy} onChange={(quiet) => void setPref({ quiet })} />
            <p className="notify-tz">Times use your time zone ({timeZone().replace(/_/g, " ")}).</p>
          </section>
        )}

        {devices.length > 0 && (
          <section className="notify-sec">
            <h3>Devices</h3>
            {devices.map((d) => (
              <div key={d.endpoint} className="notify-dev">
                <div>
                  <b>{d.label || "Device"}{d.endpoint === mine && <span className="muted"> (this one)</span>}</b>
                  <small>Added {timeAgo(d.created_at)}{d.last_error ? ` · last send failed (${d.last_error.slice(0, 60)})` : ""}</small>
                </div>
                <button className="ghost" disabled={busy} onClick={() => void test(d.endpoint)}>Test</button>
                <button className="ghost icon-btn" aria-label={`Remove ${d.label}`} title="Remove" disabled={busy}
                  onClick={() => void run(async () => { if (d.endpoint === mine) await disablePush(); else await api.pushUnsubscribe(d.endpoint); })}><ITrash size={16} /></button>
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
