// The first visit to a new Seaglass: try it before any setup. Write a first note, take a three-question quiz on a sample
// note, meet Waffle (a scripted chat, no AI, that shows it asks before acting), pick what it's for, then make the account,
// and a closing animation sets everything up (FinishRing). Nothing here needs a key or calls a model. What you wrote and
// picked waits in this browser (sg.onboard) until the account exists, then becomes real pages.
import { useEffect, useMemo, useState } from "react";
import { Logo } from "../icons";
import { Waffle } from "../waffle";
import { SetupWizard } from "./Welcome";
import { FinishRing, type FinishItem } from "./FinishRing";
import { SetupSteps, type SetupResult } from "./SetupSteps";
import { api } from "../api";

type Goal = "study" | "notes" | "tasks" | "family";
type Saved = { title: string; body: string; goals: Goal[] };
const KEY = "sg.onboard";
const load = (): Saved => { try { return { title: "", body: "", goals: [], ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { return { title: "", body: "", goals: [] }; } };
const keep = (s: Saved) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private window */ } };

const STEPS = ["hello", "write", "study", "waffle", "goals", "setup", "more", "finish"] as const;
type Step = (typeof STEPS)[number];

export function Onboarding({ codeRequired, noTables, onDone }: { codeRequired: boolean; noTables: boolean; onDone: () => void }) {
  const [step, setStep] = useState<Step>("hello");
  const [saved, setSaved] = useState<Saved>(load);
  const [home, setHome] = useState(false);
  const [setup, setSetup] = useState<SetupResult>({ ai: "on", invited: 0, reminders: false });
  const save = (p: Partial<Saved>) => setSaved((s) => { const n = { ...s, ...p }; keep(n); return n; });
  const go = (s: Step) => { setStep(s); window.scrollTo?.(0, 0); };
  const tryIdx = ["write", "study", "waffle", "goals"].indexOf(step);

  if (noTables) return <SetupWizard codeRequired={codeRequired} noTables onDone={onDone} />;
  if (step === "setup") return <SetupWizard codeRequired={codeRequired} initialMode={saved.goals.includes("family") ? "household" : undefined} onDone={(mode) => { setHome(mode === "household"); go("more"); }} onBack={() => go("goals")} />;
  // After the account: AI, the assistant, the household and this device (SetupSteps), then the closing animation.
  if (step === "more") return <SetupSteps household={home} onDone={(r) => { setSetup(r); go("finish"); }} />;
  if (step === "finish") return <Finish saved={saved} setup={setup} onDone={() => { try { localStorage.removeItem(KEY); } catch { /* fine */ } onDone(); }} />;

  return (
    <div className="ob">
      <div className="ob-top">
        <span className="ob-brand"><Logo size={26} /> Seaglass</span>
        {tryIdx >= 0 && <div className="ob-progress" role="progressbar" aria-valuemin={0} aria-valuemax={4} aria-valuenow={tryIdx + 1} aria-label="Getting to know Seaglass"><i style={{ width: `${((tryIdx + 1) / 4) * 100}%` }} /></div>}
        {step !== "hello" && <button className="ghost ob-skip" onClick={() => go("setup")}>Skip to setup</button>}
      </div>
      <main className="ob-main" key={step}>
        {step === "hello" && <Hello onNext={() => go("write")} onSkip={() => go("setup")} />}
        {step === "write" && <Write saved={saved} save={save} onNext={() => go("study")} />}
        {step === "study" && <Study onNext={() => go("waffle")} />}
        {step === "waffle" && <MeetWaffle onNext={() => go("goals")} />}
        {step === "goals" && <Goals goals={saved.goals} onChange={(g) => save({ goals: g })} onNext={() => go("setup")} />}
      </main>
    </div>
  );
}

function Hello({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  return (
    <section className="ob-hello">
      <div className="ob-hello-mark"><Logo size={120} /></div>
      <h1>Notes that stay yours.</h1>
      <p>Seaglass is a notes app you run on your own account: pages, tasks, studying, and an assistant called Waffle. Try it for a minute before you set anything up.</p>
      <button className="primary ob-cta" onClick={onNext}>Try it</button>
      <button className="ghost ob-quiet" onClick={onSkip}>I've done this before: set it up</button>
    </section>
  );
}

function Write({ saved, save, onNext }: { saved: Saved; save: (p: Partial<Saved>) => void; onNext: () => void }) {
  const has = saved.title.trim() || saved.body.trim();
  return (
    <section className="ob-step">
      <h2>Start with something on your mind.</h2>
      <p className="ob-lead">This becomes your first page. It stays on this device until you set up, then it's saved for real.</p>
      <div className="ob-page">
        <input className="ob-page-title" aria-label="Page title" placeholder="Untitled" value={saved.title} onChange={(e) => save({ title: e.target.value })} autoFocus />
        <textarea className="ob-page-body" aria-label="Page text" rows={5} placeholder="What are you working on, learning or planning?" value={saved.body} onChange={(e) => save({ body: e.target.value })} />
      </div>
      <div className="ob-actions">
        <button className="primary ob-cta" onClick={onNext}>{has ? "Keep going" : "Skip for now"}</button>
      </div>
    </section>
  );
}

const QUIZ = [
  { q: "Where in a plant cell does photosynthesis happen?", a: "Chloroplasts", wrong: ["Mitochondria", "The nucleus"] },
  { q: "Which gas do plants take in for photosynthesis?", a: "Carbon dioxide", wrong: ["Oxygen", "Nitrogen"] },
  { q: "What does photosynthesis make that the plant uses for energy?", a: "Glucose", wrong: ["Water", "Protein"] },
];

function Study({ onNext }: { onNext: () => void }) {
  const [phase, setPhase] = useState<"note" | "quiz" | "done">("note");
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [right, setRight] = useState(0);
  const opts = useMemo(() => QUIZ.map((x, k) => [x.a, ...x.wrong].sort((a, b) => ((a.length * 7 + k) % 5) - ((b.length * 7 + k) % 5))), []);
  const item = QUIZ[i];
  const answer = (o: string) => {
    if (picked) return;
    setPicked(o);
    if (o === item.a) setRight((r) => r + 1);
    setTimeout(() => { if (i < QUIZ.length - 1) { setI(i + 1); setPicked(null); } else setPhase("done"); }, 1100);
  };
  return (
    <section className="ob-step">
      {phase === "note" && <>
        <h2>Your notes become a quiz.</h2>
        <p className="ob-lead">Seaglass makes flashcards and quizzes from what you write. Here's a short note:</p>
        <div className="ob-page ob-sample">
          <div className="ob-page-title static">Photosynthesis</div>
          <p>Plants make their own food in their <b>chloroplasts</b>. They take in <b>carbon dioxide</b> and water and, using light, make <b>glucose</b> and give off oxygen.</p>
        </div>
        <div className="ob-actions"><button className="primary ob-cta" onClick={() => setPhase("quiz")}>Quiz me</button></div>
      </>}
      {phase === "quiz" && <>
        <div className="ob-qcount">Question {i + 1} of {QUIZ.length}</div>
        <h2 className="ob-q" key={i}>{item.q}</h2>
        <div className="ob-opts" role="group" aria-label="Answers">
          {opts[i].map((o) => (
            <button key={o} className={`ob-opt ${picked ? (o === item.a ? "right" : o === picked ? "wrong" : "dim") : ""}`} onClick={() => answer(o)} disabled={!!picked}>{o}</button>
          ))}
        </div>
        <p className="ob-feedback" aria-live="polite">{picked ? (picked === item.a ? "Nice." : `It's ${item.a}.`) : ""}</p>
      </>}
      {phase === "done" && <>
        <div className="ob-score" aria-live="polite"><b>{right} of {QUIZ.length}</b></div>
        <h2>{right === QUIZ.length ? "All right. That's how Study works." : "That's how Study works."}</h2>
        <p className="ob-lead">With your own notes, Seaglass also brings back the questions you miss a few days later, and plans study sessions before a test.</p>
        <div className="ob-actions"><button className="primary ob-cta" onClick={onNext}>Next</button></div>
      </>}
    </section>
  );
}

function MeetWaffle({ onNext }: { onNext: () => void }) {
  type Line = { who: "waffle" | "you" | "ask"; text: string };
  const [lines, setLines] = useState<Line[]>([{ who: "waffle", text: "Hi, I'm Waffle. I can find things in your notes, make pages and help you plan. I only act when you ask." }]);
  const [stage, setStage] = useState<"pick" | "typing" | "asking" | "done">("pick");
  const [mode, setMode] = useState<"idle" | "think">("idle");
  const say = (l: Line, delay: number) => new Promise<void>((r) => setTimeout(() => { setLines((x) => [...x, l]); r(); }, delay));
  const pick = async (text: string) => {
    setStage("typing"); setLines((x) => [...x, { who: "you", text }]); setMode("think");
    await say({ who: "waffle", text: "Sure. I'll make a page called “Study plan” with three sessions before Friday." }, 1100);
    setMode("idle"); setStage("asking");
    setLines((x) => [...x, { who: "ask", text: "Create the page “Study plan”" }]);
  };
  const decide = async (ok: boolean) => {
    setLines((x) => x.filter((l) => l.who !== "ask"));
    setStage("typing"); setMode("think");
    await say({ who: "waffle", text: ok ? "Done. You'll find it in your sidebar." : "No problem, I won't make it." }, 900);
    await say({ who: "waffle", text: "You choose what I can do on my own and what I check with you first. You can change that any time in Settings." }, 900);
    setMode("idle"); setStage("done");
  };
  return (
    <section className="ob-step">
      <div className="ob-waffle"><Waffle size={84} mode={mode === "think" ? "think" : "idle"} /></div>
      <h2>Meet Waffle.</h2>
      <div className="ob-chat" aria-live="polite">
        {lines.map((l, k) => l.who === "ask" ? (
          <div key={k} className="tx-approve asking">
            <div className="tx-approve-what"><b>Waffle wants to:</b> {l.text}</div>
            <div className="tx-approve-btns"><button className="ghost" onClick={() => void decide(false)}>Don't</button><button className="primary" onClick={() => void decide(true)}>Approve</button></div>
          </div>
        ) : <div key={k} className={`ob-bubble ${l.who}`}>{l.text}</div>)}
        {stage === "typing" && <div className="ob-bubble waffle ob-dots" aria-label="Waffle is typing"><i /><i /><i /></div>}
      </div>
      {stage === "pick" && (
        <div className="ob-chips">
          <button onClick={() => void pick("Plan my studying for Friday's test")}>Plan my studying for Friday's test</button>
          <button onClick={() => void pick("Make a page for my week")}>Make a page for my week</button>
        </div>
      )}
      {stage === "done" && <div className="ob-actions"><button className="primary ob-cta" onClick={onNext}>Next</button></div>}
      <p className="ob-fine">Waffle needs a Claude API key to work for real. You can add one after setup; everything else works without it.</p>
    </section>
  );
}

const GOALS: { id: Goal; title: string; what: string; icon: string }[] = [
  { id: "study", title: "Studying", what: "Flashcards, quizzes, test plans", icon: "📚" },
  { id: "notes", title: "Notes and ideas", what: "Pages for anything", icon: "📝" },
  { id: "tasks", title: "Tasks and plans", what: "To-dos with reminders", icon: "✅" },
  { id: "family", title: "My household", what: "A shared calendar and plans", icon: "🏡" },
];

function Goals({ goals, onChange, onNext }: { goals: Goal[]; onChange: (g: Goal[]) => void; onNext: () => void }) {
  const flip = (g: Goal) => onChange(goals.includes(g) ? goals.filter((x) => x !== g) : [...goals, g]);
  return (
    <section className="ob-step">
      <h2>What will you use Seaglass for?</h2>
      <p className="ob-lead">Pick any. Seaglass sets up a few pages to start you off.</p>
      <div className="ob-goals" role="group" aria-label="What it's for">
        {GOALS.map((g) => (
          <button key={g.id} aria-pressed={goals.includes(g.id)} className={goals.includes(g.id) ? "on" : ""} onClick={() => flip(g.id)}>
            <span className="ob-goal-ico" aria-hidden>{g.icon}</span><b>{g.title}</b><small>{g.what}</small>
          </button>
        ))}
      </div>
      <div className="ob-actions"><button className="primary ob-cta" onClick={onNext}>Save my Seaglass</button></div>
    </section>
  );
}

/** After the account exists: make the first page and the starters while the ring plays, then open the app. */
function Finish({ saved, setup, onDone }: { saved: Saved; setup: SetupResult; onDone: () => void }) {
  const items = useMemo<FinishItem[]>(() => {
    const l: FinishItem[] = [{ id: "account", label: "Your account", icon: "logo" }];
    if (saved.title.trim() || saved.body.trim()) l.push({ id: "page", label: "Your first page", icon: "📝" });
    if (saved.goals.includes("study")) l.push({ id: "study", label: "Flashcards to try", icon: "📚" });
    if (saved.goals.includes("tasks") || !saved.goals.length) l.push({ id: "tasks", label: "My tasks", icon: "✅" });
    if (saved.goals.includes("family")) l.push({ id: "calendar", label: "Your calendar", icon: "📅" });
    if (setup.invited) l.push({ id: "people", label: setup.invited === 1 ? "An invite" : `${setup.invited} invites`, icon: "👪" });
    if (setup.reminders) l.push({ id: "reminders", label: "Reminders", icon: "🔔" });
    if (setup.ai === "on") l.push({ id: "waffle", label: "Waffle", icon: "waffle" });
    return l;
  }, [saved, setup]);
  const [work, setWork] = useState<Promise<string | null> | null>(null);
  useEffect(() => {
    setWork((async () => {
      let first: string | null = null;
      try {
        if (saved.title.trim() || saved.body.trim()) {
          const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
          const html = saved.body.split(/\n+/).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join("") || "<p></p>";
          first = (await api.create({ title: saved.title.trim() || "My first note", html, icon: "📝" })).id;
        }
        if (saved.goals.includes("study")) {
          const cards = QUIZ.map((x) => `<details><summary>${x.q}</summary><div data-type="detailsContent"><p>${x.a}</p></div></details>`).join("");
          await api.create({ title: "Photosynthesis (try studying this)", icon: "🌿", html: `<p>Plants make their own food in their chloroplasts, from carbon dioxide and water, using light. Each toggle below is a flashcard: open Study to quiz yourself.</p>${cards}` });
        }
        if (saved.goals.includes("family")) await api.ensureCalendar();
      } catch { /* the app still opens; nothing here is essential */ }
      return first;
    })());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <FinishRing items={items} work={work} onDone={(first) => { if (first) location.hash = `/p/${first}`; onDone(); }} />;
}
