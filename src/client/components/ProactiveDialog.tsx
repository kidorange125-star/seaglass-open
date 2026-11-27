// Settings > Routines & saved prompts. Saved prompts are your own one-tap requests (/name in the chat, or the page's
// / menu). Routines run a prompt by themselves at set times and report in the conversation. The hourly check-in (6 AM to
// 9 PM) needs no setup; "Check in now" runs one straight away.
import { useEffect, useState } from "react";
import { CalendarClock, Play, Plus, Sparkles, Trash2 } from "lucide-react";
import { api, type Routine, type SavedPrompt } from "../api";
import { useStore } from "../store";
import { JeffAvatar } from "../icons";
import { IClose } from "../ui-icons";
import { agentName } from "../persona";
import { refreshPrompts, refreshUnread } from "../proactive";

const DAYS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayText = (d: number) => (d === 127 ? "Every day" : d === 0b0111110 ? "Weekdays" : d === 0b1000001 ? "Weekends" : DAY_NAMES.filter((_, i) => d & (1 << i)).join(", "));
const clock = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
const BLANK_ROUTINE: Partial<Routine> = { name: "", prompt: "", time: "18:00", days: 0b0111110, notify: true, enabled: true };
/** The routine gallery: starters that fill the form, ready to save or tweak. Days: bit i = day i, 0 = Sunday. */
export const STARTERS: Pick<Routine, "name" | "prompt" | "time" | "days" | "notify">[] = [
  { name: "Morning brief", time: "07:00", days: 0b0111110, notify: true, prompt: "Give me a short morning brief: what's due today and tomorrow, any test in the next week, and the one study session most worth doing today. Keep it to a few lines." },
  { name: "Homework check", time: "20:00", days: 0b0011111, notify: true, prompt: "Check what's due tomorrow and whether it's done. If something isn't, tell me plainly and suggest how to finish it tonight." },
  { name: "Study nudge", time: "16:30", days: 0b0111110, notify: true, prompt: "Pick the one study session most worth doing today: the weakest page with a test coming up. Tell me which page and which way to study it, in two lines." },
  { name: "Sunday reset", time: "17:00", days: 0b0000001, notify: true, prompt: "Sunday reset: list what's overdue and what's due this week, suggest which tasks to move or drop, and propose study sessions for any test in the next two weeks (ask me before adding them)." },
  { name: "Week in review", time: "18:00", days: 0b0100000, notify: false, prompt: "Recap my week in a new page called \"Week of\" and Monday's date: what I studied and how I scored, what I finished, and one thing to do better next week." },
  { name: "Night wrap-up", time: "21:30", days: 0b1111111, notify: false, prompt: "Wrap up my day in three lines: what got done, what moved to tomorrow, and anything I captured today that still needs sorting." },
];

export function ProactiveDialog() {
  const s = useStore();
  const [prompts, setPrompts] = useState<SavedPrompt[] | null>(null);
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const [p, setP] = useState<Partial<SavedPrompt> | null>(null);
  const [r, setR] = useState<Partial<Routine> | null>(null);
  const [busy, setBusy] = useState("");
  const [mode, setMode] = useState<"on_demand" | "proactive" | null>(null);
  useEffect(() => { api.assistantMode().then((r) => setMode(r.mode)).catch(() => setMode("on_demand")); }, []);
  const switchMode = async (next: "on_demand" | "proactive") => {
    const was = mode; setMode(next);
    try { await api.setAssistantMode(next); s.toast(next === "on_demand" ? `${agentName()} only works when you ask now` : `${agentName()} will check in and run your routines`); }
    catch (e) { setMode(was); err(e); }
  };
  const onDemand = mode !== "proactive";
  const close = () => s.setProactiveOpen(false);
  const load = async () => {
    try { const [a, b] = await Promise.all([api.prompts(), api.routines()]); setPrompts(a); setRoutines(b); } catch (e) { s.toast((e as Error).message); setPrompts([]); setRoutines([]); }
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { if (p || r) { setP(null); setR(null); } else close(); } };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  });
  const err = (e: unknown) => s.toast((e as Error).message);

  const savePrompt = async () => { if (!p) return; try { await api.savePrompt(p); setP(null); await load(); void refreshPrompts(); } catch (e) { err(e); } };
  const delPrompt = async (id: string) => { if (!(await s.confirm("Delete this saved prompt?"))) return; try { await api.deletePrompt(id); await load(); void refreshPrompts(); } catch (e) { err(e); } };
  const saveRoutine = async () => { if (!r) return; try { await api.saveRoutine(r); setR(null); await load(); } catch (e) { err(e); } };
  const delRoutine = async (id: string) => { if (!(await s.confirm("Delete this routine?"))) return; try { await api.deleteRoutine(id); await load(); } catch (e) { err(e); } };
  const toggle = async (x: Routine) => { try { await api.saveRoutine({ ...x, enabled: !x.enabled }); await load(); } catch (e) { err(e); } };
  const runNow = async (x: Routine) => {
    setBusy(x.id);
    try { const res = await api.runRoutine(x.id); s.toast(res.error ? `It couldn't finish: ${res.error}` : `"${x.name}" ran: the result is in your conversation`); void refreshUnread(); } catch (e) { err(e); }
    setBusy("");
  };
  const tidyNow = async () => {
    setBusy("tidy");
    try { const r = await api.tidyNow(); s.toast(r.proposed ? `${agentName()} proposed a tidy-up in your conversation` : "Everything's already tidy"); void refreshUnread(); } catch (e) { err(e); }
    setBusy("");
  };
  const checkIn = async () => {
    setBusy("checkin");
    try { const res = await api.checkinNow(); s.toast(res.messages ? `${agentName()} said ${res.messages} thing${res.messages === 1 ? "" : "s"} in your conversation` : `${agentName()} had nothing new to say`); void refreshUnread(); } catch (e) { err(e); }
    setBusy("");
  };

  return (
    <div className="modal-back" onMouseDown={close}>
      <div className="modal proactive" role="dialog" aria-label="Routines and saved prompts" onMouseDown={(e) => e.stopPropagation()}>
        <div className="memory-head">
          <JeffAvatar size={36} />
          <div><b>Routines & saved prompts</b><small>{onDemand ? `${agentName()} works when you ask. Saved prompts are one-tap requests; routines only run on schedule if you turn off "On demand only".` : `Every hour from 6 AM to 9 PM, ${agentName()} checks whether there's anything worth telling you, and says it in your conversation (urgent things also as a notification). Routines and saved prompts are yours to set up.`}</small></div>
          <button className="ghost icon-btn" title="Close" onClick={close}><IClose size={18} /></button>
        </div>
        <div className="pd-body">
          <div className="pd-mode">
            <label className="switch">
              <input type="checkbox" checked={onDemand} disabled={mode === null} onChange={(e) => void switchMode(e.target.checked ? "on_demand" : "proactive")} /> On demand only
            </label>
            <p className="muted">{onDemand ? `${agentName()} only works when you ask: no check-ins, routines, tidy-ups or wrap-ups run by themselves. The buttons below still work.` : `${agentName()} checks in every hour from 6 AM to 9 PM and runs your routines on schedule.`}</p>
          </div>
          <div className={`pd-section ${onDemand ? "pd-paused" : ""}`}>
            <div className="pd-title"><CalendarClock size={16} /> Routines<span className="grow" /><button onClick={() => setR({ ...BLANK_ROUTINE })}><Plus size={14} /> New routine</button></div>
            {r && (
              <div className="pd-form">
                <input placeholder="Name, e.g. Sunday recap" value={r.name ?? ""} onChange={(e) => setR({ ...r, name: e.target.value })} autoFocus />
                <textarea placeholder={`What should ${agentName()} do? e.g. Recap what I studied this week into a new page, and list what's due next week.`} rows={4} value={r.prompt ?? ""} onChange={(e) => setR({ ...r, prompt: e.target.value })} />
                <div className="pd-row">
                  <input type="time" value={r.time ?? "18:00"} onChange={(e) => setR({ ...r, time: e.target.value })} aria-label="Time" />
                  <div className="pd-days" role="group" aria-label="Days">
                    {DAYS.map((d, i) => <button key={i} className={(r.days ?? 0) & (1 << i) ? "on" : ""} title={DAY_NAMES[i]} aria-pressed={!!((r.days ?? 0) & (1 << i))} onClick={() => setR({ ...r, days: (r.days ?? 0) ^ (1 << i) })}>{d}</button>)}
                  </div>
                </div>
                <label className="pd-check"><input type="checkbox" checked={r.notify !== false} onChange={(e) => setR({ ...r, notify: e.target.checked })} /> Send a notification when it's done</label>
                <div className="pd-actions"><button className="ghost" onClick={() => setR(null)}>Cancel</button><button className="primary" onClick={() => void saveRoutine()}>Save routine</button></div>
              </div>
            )}
            {!r && routines !== null && (() => {
              const have = new Set(routines.map((x) => x.name.trim().toLowerCase()));
              const left = STARTERS.filter((x) => !have.has(x.name.toLowerCase()));
              return left.length > 0 && (
                <div className="pd-gallery" role="group" aria-label="Routine starters">
                  <small>Start from one of these</small>
                  <div className="pd-starters">
                    {left.map((x) => <button key={x.name} className="pd-starter" title={x.prompt} onClick={() => setR({ ...BLANK_ROUTINE, ...x })}><b>{x.name}</b><small>{clock(x.time)} · {dayText(x.days)}</small></button>)}
                  </div>
                </div>
              );
            })()}
            {routines === null ? <p className="pd-empty">Loading…</p> : !routines.length && !r ? <p className="pd-empty">No routines yet. A routine runs a request by itself at set times, like a weekly recap every Sunday evening or a quiz on what's due tomorrow on school nights.</p> : null}
            {routines?.map((x) => (
              <div key={x.id} className={`pd-item ${x.enabled ? "" : "off"}`}>
                <button className="pd-main" onClick={() => setR({ ...x })}>
                  <b>{x.name}</b><small>{clock(x.time)} · {dayText(x.days)}{x.notify ? " · notifies" : ""}{!x.enabled ? " · paused" : onDemand ? " · paused (on demand only)" : ""}</small>
                </button>
                <button className="ghost icon-btn" title="Run now" disabled={busy === x.id} onClick={() => void runNow(x)}><Play size={15} /></button>
                <label className="pd-switch" title={x.enabled ? "On" : "Paused"}><input type="checkbox" checked={x.enabled} onChange={() => void toggle(x)} /></label>
                <button className="ghost icon-btn" title="Delete" onClick={() => void delRoutine(x.id)}><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
          <div className="pd-section">
            <div className="pd-title"><Sparkles size={16} /> Saved prompts<span className="grow" /><button onClick={() => setP({ name: "", text: "" })}><Plus size={14} /> New prompt</button></div>
            {p && (
              <div className="pd-form">
                <div className="pd-name"><span>/</span><input placeholder="name, e.g. cram" value={p.name ?? ""} onChange={(e) => setP({ ...p, name: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} autoFocus /></div>
                <textarea placeholder="What it asks, e.g. Make 15 flashcards from this page and quiz me on the hardest 5." rows={4} value={p.text ?? ""} onChange={(e) => setP({ ...p, text: e.target.value })} />
                <div className="pd-actions"><button className="ghost" onClick={() => setP(null)}>Cancel</button><button className="primary" onClick={() => void savePrompt()}>Save prompt</button></div>
              </div>
            )}
            {prompts === null ? <p className="pd-empty">Loading…</p> : !prompts.length && !p ? <p className="pd-empty">No saved prompts yet. Save one, then type /name in the chat (add words after it if you like), or pick it from a page's / menu to run it on that page.</p> : null}
            {prompts?.map((x) => (
              <div key={x.id} className="pd-item">
                <button className="pd-main" onClick={() => setP({ ...x })}><b>/{x.name}</b><small>{x.text}</small></button>
                <button className="ghost icon-btn" title="Delete" onClick={() => void delPrompt(x.id)}><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
          <div className="pd-section pd-checkin">
            <div><b>{onDemand ? "Check-in" : "Hourly check-in"}</b><small>{onDemand ? "Off while on demand only: tap Check in now when you want one. " : "6 AM to 9 PM in your time zone, on Haiku. "}It speaks only when something is timely and new, and learns from your thumbs up and down.</small></div>
            <button disabled={busy === "checkin"} onClick={() => void checkIn()}>{busy === "checkin" ? "Checking…" : "Check in now"}</button>
            <button disabled={busy === "tidy"} title="Empty pages, duplicates and loose notes. It also runs every Sunday evening." onClick={() => void tidyNow()}>{busy === "tidy" ? "Looking…" : "Tidy up now"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
