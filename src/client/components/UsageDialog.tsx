// Settings > AI usage: what the AI has cost you (today, this month, the last 30 days, by feature and by model), and for
// the household's owners each person's totals (numbers only, never what they asked) and the limits and rules they set.
import { useEffect, useState } from "react";
import { api, type HouseholdUsage, type MyUsage, type Rules } from "../api";
import { useStore } from "../store";
import { IClose } from "../ui-icons";

const usd = (n: number) => (n === 0 ? "$0" : n < 0.01 ? "<$0.01" : `$${n < 100 ? n.toFixed(2) : n.toFixed(0)}`);
// What each feature is called on screen (the server records short names).
const FEATURE: Record<string, string> = {
  assistant: "Assistant chat", "study chat": "Study chat", "quick action": "Quick actions (Ctrl+K)", routine: "Routines",
  "live voice": "Live voice", "live voice (stronger model)": "Live voice, harder questions", selection: "Ask on selected text",
  explain: "Explain this", photo: "Photo to notes", quiz: "Practice tests", grade: "Marking answers", write: "Writing in a page",
  suggest: "Suggestions", checkin: "Check-ins", summary: "Conversation summary", study: "Quizzes and games", cards: "Flashcards",
  coach: "Study coach", reword: "Missed questions", plan: "Study plans", explainq: "Explain it (questions)",
  explaincheck: "Explain it (checking)", steps: "Steps for assignments", tidy: "Weekly tidy-up", wrapup: "Daily wrap-up",
  handwriting: "Reading handwriting", syllabus: "Reading a syllabus", lecture: "Notes from a class recording",
  "voice to text": "Voice notes", "live listening": "Live voice listening", "read a PDF": "Reading PDFs", "voice (speaking)": "Spoken replies",
};
const featureName = (n: string) => FEATURE[n] ?? n.charAt(0).toUpperCase() + n.slice(1);

/** The last 30 days as thin bars, one per day, tallest = the most spent. */
function DayBars({ days, end }: { days: MyUsage["days"]; end: string }) {
  const map = new Map(days.map((d) => [d.day, d]));
  const all = Array.from({ length: 30 }, (_, i) => {
    const t = new Date(`${end}T12:00:00Z`); t.setUTCDate(t.getUTCDate() - (29 - i));
    const day = t.toISOString().slice(0, 10);
    return { day, cost: map.get(day)?.cost_usd ?? 0, calls: map.get(day)?.calls ?? 0 };
  });
  const max = Math.max(...all.map((d) => d.cost), 0.0001);
  return (
    <div className="us-bars" role="img" aria-label={`Spending over the last 30 days, ${usd(all.reduce((n, d) => n + d.cost, 0))} in all`}>
      {all.map((d) => (
        <span key={d.day} className="us-bar" title={`${new Date(`${d.day}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}: ${usd(d.cost)}, ${d.calls} ${d.calls === 1 ? "request" : "requests"}`}>
          <i style={{ height: `${d.cost ? Math.max(6, (d.cost / max) * 100) : 0}%` }} />
        </span>
      ))}
    </div>
  );
}

function Lines({ title, rows }: { title: string; rows: { name: string; label?: string; calls: number; cost_usd: number }[] }) {
  if (!rows.length) return null;
  return (
    <div className="us-lines">
      <h4>{title}</h4>
      <ul>{rows.slice(0, 8).map((r) => <li key={r.name}><span>{r.label ?? featureName(r.name)}</span><small>{r.calls} {r.calls === 1 ? "request" : "requests"}</small><b>{usd(r.cost_usd)}</b></li>)}</ul>
    </div>
  );
}

/** One person's limits, editable by an owner. */
function RulesRow({ id, name, role, today, month, rules, onSaved }: { id: string; name: string; role?: string; today?: number; month: number; rules: Rules; onSaved: () => void }) {
  const s = useStore();
  const [daily, setDaily] = useState(rules.daily_usd?.toString() ?? "");
  const [monthly, setMonthly] = useState(rules.monthly_usd?.toString() ?? "");
  const whole = id === "household";
  const save = async (patch: Partial<Rules>, msg: string) => {
    try { await api.setRules(id, patch); s.toast(msg); onSaved(); } catch (e) { s.toast((e as Error).message); }
  };
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const dirty = !whole && (daily !== (rules.daily_usd?.toString() ?? "")) || monthly !== (rules.monthly_usd?.toString() ?? "");
  return (
    <li className="us-person">
      <div className="us-who"><b>{name}</b><small>{whole ? `${usd(month)} this month` : `${role === "kid" ? "Kid · " : ""}${usd(today ?? 0)} today, ${usd(month)} this month`}</small></div>
      <form className="us-limits" onSubmit={(e) => { e.preventDefault(); void save(whole ? { monthly_usd: num(monthly) } : { daily_usd: num(daily), monthly_usd: num(monthly) }, `${name}: limits saved`); }}>
        {!whole && <label>A day <input inputMode="decimal" placeholder="None" value={daily} onChange={(e) => setDaily(e.target.value)} aria-label={`${name}'s daily limit in dollars`} /></label>}
        <label>A month <input inputMode="decimal" placeholder="None" value={monthly} onChange={(e) => setMonthly(e.target.value)} aria-label={`${whole ? "The household's" : `${name}'s`} monthly limit in dollars`} /></label>
        <button className="ghost" disabled={!dirty}>Save</button>
      </form>
      {!whole && (
        <div className="us-switches">
          <label><input type="checkbox" checked={rules.teach} onChange={(e) => void save({ teach: e.target.checked }, e.target.checked ? `${name}: the assistant teaches` : `${name}: teach mode off`)} /> Teaches instead of doing homework</label>
          <label><input type="checkbox" checked={rules.web} onChange={(e) => void save({ web: e.target.checked }, e.target.checked ? `${name}: web search on` : `${name}: web search off`)} /> Can search the web</label>
        </div>
      )}
    </li>
  );
}

export function UsageDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [me, setMe] = useState<MyUsage | null>(null);
  const [home, setHome] = useState<HouseholdUsage | null>(null);
  const load = () => {
    api.usage().then(setMe).catch((e) => s.toast((e as Error).message));
    api.householdUsage().then(setHome).catch(() => setHome(null)); // 403 for everyone but owners
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onClose]);
  const r = me?.rules;
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal account usage" role="dialog" aria-label="AI usage" onMouseDown={(e) => e.stopPropagation()}>
        <div className="memory-head">
          <div><b>AI usage</b><small>What the assistant and AI features have cost</small></div>
          <button className="ghost icon-btn" aria-label="Close" onClick={onClose}><IClose size={18} /></button>
        </div>
        {!me ? <p className="muted">Loading…</p> : (
          <>
            <section className="acc-sec">
              <div className="us-totals">
                <div><small>Today</small><b>{usd(me.today)}</b>{r?.daily_usd !== null && r && <small>of {usd(r.daily_usd!)}</small>}</div>
                <div><small>This month</small><b>{usd(me.month)}</b>{r?.monthly_usd !== null && r && <small>of {usd(r.monthly_usd!)}</small>}</div>
              </div>
              <DayBars days={me.days} end={me.date} />
              <Lines title="What it went on" rows={me.by_feature} />
              <Lines title="Models" rows={me.by_model} />
              {!me.by_feature.length && <p className="muted acc-note">Nothing yet this month. Using the assistant, quizzes, voice and other AI features shows up here.</p>}
              <p className="muted acc-note">Costs are worked out from each model's price per token. Voice and Workers AI features are counted but have no price here.</p>
            </section>
            {home && (
              <section className="acc-sec">
                <h3>Everyone (owners only)</h3>
                <p className="muted acc-note">Spending only, never what anyone asked. A limit stops the next request once it's reached; it starts again the next day or month.</p>
                <ul className="us-people">
                  {home.people.map((p) => <RulesRow key={p.id} id={p.id} name={p.name} role={p.role} today={p.today} month={p.month} rules={p.rules} onSaved={load} />)}
                  <RulesRow id="household" name="The whole household" month={home.household.month} rules={home.household.rules} onSaved={load} />
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
