// Paper Lock's screens that aren't a page: locking a page with a card (phone), the pop-up when another device asks to open a
// page (phone), and the list of cards and what is open (Settings > Paper Lock). One instance lives in App.tsx, driven by
// window events: seaglass:paper-lock {id}, seaglass:paper-manage. The phone polls for requests while it's open; with notifications on, a request also
// arrives as a notification that opens this app (url /?paper=<id>).
import { useEffect, useRef, useState } from "react";
import { api, ApiError, type PaperCard, type PaperGrantInfo, type PaperRequest } from "../api";
import { isPhone } from "../device";
import { useStore } from "../store";
import { IClose, ILock } from "../ui-icons";
import { CardCamera, type CardShot } from "./CardCamera";
import { LockIcon } from "./LockIcon";
import { scanMessage } from "./PaperLocked";

const asError = (e: unknown) => new Error(scanMessage(e));

// ---------------------------------------------------------------- locking a page

type Step = "intro" | "draw" | "scan" | "name" | "reuse" | "working" | "done";

function PaperSetup({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const store = useStore();
  const [step, setStep] = useState<Step>("intro");
  const [cards, setCards] = useState<PaperCard[]>([]);
  const [use, setUse] = useState<PaperCard | null>(null);
  const [shots, setShots] = useState<CardShot[]>([]);
  const [name, setName] = useState("My card");
  const [err, setErr] = useState("");
  const phone = isPhone();
  useEffect(() => { api.paperCards().then((c) => setCards(c.filter((x) => !x.retired))).catch(() => {}); }, []);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape" && step !== "working" && step !== "scan" && step !== "reuse") onClose(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onClose, step]);

  const locked = async () => { await store.refreshTree(); dispatchEvent(new Event("seaglass:agent-changed")); setStep("done"); };
  const make = async () => {
    setStep("working"); setErr("");
    try {
      const card = await api.paperMakeCard(name, shots.map((s) => s.scan.bits));
      await api.paperLock(pageId, card.id);
      await locked();
    } catch (e) {
      setErr(scanMessage(e)); setShots([]);
      setStep(e instanceof ApiError && e.data.quality ? "draw" : "name");
    }
  };

  if (step === "scan") return (
    <CardCamera title="Scan your card" step={shots.length + 1} steps={3} needFull distinct
      hint={shots.length ? "Got it. Move the card a little, and hold still again." : "Hold the card flat, the whole card in view, long side across."}
      onClose={() => { setShots([]); setStep("draw"); }}
      onShot={async (s) => { const next = [...shots, s]; setShots(next); if (next.length >= 3) setTimeout(() => setStep("name"), 700); }} />
  );
  if (step === "reuse" && use) return (
    <CardCamera title={`Scan “${use.name}”`} once hint="Scan the card to lock this page with it." onClose={() => { setUse(null); setStep("intro"); }}
      onShot={async (s) => { try { await api.paperLock(pageId, use.id, s.scan); } catch (e) { throw asError(e); } setTimeout(() => void locked(), 700); }} />
  );

  return (
    <div className="modal-back" onMouseDown={() => step !== "working" && onClose()}>
      <div className="modal pl-setup" role="dialog" aria-label="Lock with a paper card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="memory-head">
          <span className="notify-ico"><ILock size={22} /></span>
          <div><b>Paper Lock</b><small>Lock this page with a card you draw</small></div>
          <button className="ghost icon-btn" aria-label="Close" onClick={onClose} disabled={step === "working"}><IClose size={18} /></button>
        </div>

        {!phone ? (
          <div className="pl-step">
            <p>Paper Lock cards are drawn and scanned on your <b>phone</b>. Open Seaglass on your phone, open this page and choose “Lock with a paper card”.</p>
            <div className="dlg-actions"><button className="primary" onClick={onClose}>OK</button></div>
          </div>
        ) : step === "intro" ? (
          <div className="pl-step">
            <ul className="pl-points">
              <li><b>Draw on an index card</b> with a dark pen. That card is the only key.</li>
              <li><b>There's no password and no reset.</b> Lose the card and this page can't be opened again.</li>
              <li>The page leaves search, sharing and AI (Waffle, Claude). Its version history and comments are removed.</li>
              <li>Other devices open it by asking your phone, which asks you to scan the card.</li>
            </ul>
            {cards.length > 0 && (
              <div className="pl-cards"><span>Use a card you already made:</span>{cards.map((c) => <button key={c.id} onClick={() => { setUse(c); setStep("reuse"); }}>{c.name}</button>)}</div>
            )}
            <div className="dlg-actions"><button onClick={onClose}>Cancel</button><button className="primary" onClick={() => setStep("draw")}>Make a new card</button></div>
          </div>
        ) : step === "draw" ? (
          <div className="pl-step">
            <div className="pl-card-art" aria-hidden><svg viewBox="0 0 200 120"><path d="M14 22c18-10 30 8 46-4s26 14 40 2M118 16l20 26 22-22 24 20M16 58c14 18 30-12 44 8M70 52a12 12 0 1 0 .1 0M104 64h34l-10 20M150 56c10 22 24-6 36 12M20 100c22-10 26 6 50-6M84 104l16-16 16 16M126 98c18 8 36-12 58 0" /></svg></div>
            <p>Take a <b>white index card</b> and a <b>dark pen</b>. Draw anything you like: a few free curves are hard to copy exactly, even with the card in front of you.</p>
            <p className="pl-fine">Keep the card somewhere safe, and don't let anyone trace it.</p>
            {err && <p className="pl-msg" role="alert">{err}</p>}
            <div className="dlg-actions"><button onClick={() => setStep("intro")}>Back</button><button className="primary" onClick={() => { setShots([]); setErr(""); setStep("scan"); }}>I've drawn it, scan it</button></div>
          </div>
        ) : step === "name" ? (
          <div className="pl-step">
            <div className="pl-thumbs">{shots.map((s, i) => <span key={i} className="got"><img src={s.thumb} alt={`Scan ${i + 1}`} /></span>)}</div>
            <p>Three scans agree. Give the card a name so you know which one to scan.</p>
            <input className="pl-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} aria-label="Card name" onKeyDown={(e) => { if (e.key === "Enter") void make(); }} />
            {err && <p className="pl-msg" role="alert">{err}</p>}
            <div className="dlg-actions"><button onClick={() => { setShots([]); setStep("scan"); }}>Scan again</button><button className="primary" onClick={() => void make()}>Lock this page</button></div>
          </div>
        ) : step === "working" ? (
          <div className="pl-step pl-center"><LockIcon state="open" size={84} /><p>Locking the page…</p></div>
        ) : (
          <div className="pl-step pl-center">
            <LockIcon state="locked" size={96} />
            <p><b>Locked.</b> The only way back in is your card.</p>
            <p className="pl-fine">Keep it somewhere safe. If you lose it, there's no other way to open this page.</p>
            <div className="dlg-actions"><button className="primary" onClick={onClose}>Done</button></div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the phone is asked to unlock

function RequestSheet({ req, onClose }: { req: PaperRequest; onClose: () => void }) {
  const store = useStore();
  const [state, setState] = useState<"ask" | "ok" | "relocked" | "denied">("ask");
  const [camera, setCamera] = useState(false);
  const [left, setLeft] = useState(Math.max(0, Math.ceil((req.expires_at - Date.now()) / 1000)));
  const answered = useRef(false);

  useEffect(() => { navigator.vibrate?.([60, 40, 60]); }, []);
  // the request is still open? (the other device may have given up, or it ran out)
  useEffect(() => {
    if (state !== "ask") return;
    const t = setInterval(async () => {
      setLeft(Math.max(0, Math.ceil((req.expires_at - Date.now()) / 1000)));
      try { if ((await api.paperRequestStatus(req.id)).status !== "pending" && !answered.current) { store.toast("That request ended"); onClose(); } } catch { /* offline */ }
    }, 2500);
    return () => clearInterval(t);
  }, [state, req, onClose, store]);
  // gone three seconds after it unlocked, unless Relock was pressed
  useEffect(() => { if (state !== "ok") return; const t = setTimeout(onClose, 3000); return () => clearTimeout(t); }, [state, onClose]);
  useEffect(() => { if (state !== "relocked" && state !== "denied") return; const t = setTimeout(onClose, 1500); return () => clearTimeout(t); }, [state, onClose]);

  const relock = async () => { try { await api.paperRelock({ request_id: req.id }); } catch { /* it runs out on its own */ } setState("relocked"); };
  const deny = async () => { answered.current = true; try { await api.paperDeny(req.id); } catch { /* ignore */ } setState("denied"); };

  if (camera) return (
    <CardCamera title="Scan to allow" once hint={`Scan your “${req.card}” card to let ${req.device} open the page.`} onClose={() => setCamera(false)}
      onShot={async (s) => {
        try {
          await api.paperApprove(req.id, s.scan);
          answered.current = true;
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) { setTimeout(() => { store.toast("That request ended"); onClose(); }, 0); }
          throw asError(e);
        }
        setTimeout(() => { setCamera(false); setState("ok"); navigator.vibrate?.(120); }, 600);
      }} />
  );

  return (
    <div className={`pl-sheet st-${state}`} role="dialog" aria-label="Unlock request" aria-live="polite">
      <div className="pl-sheet-in">
        <LockIcon state={state === "ok" ? "open" : "locked"} size={120} />
        {state === "ask" && (
          <>
            <h2>Unlock request</h2>
            <p className="pl-who"><b>{req.device}</b> wants to open a page locked with your <b>{req.card}</b> card.</p>
            <p className="pl-fine">Runs out in {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</p>
            <div className="pl-sheet-actions">
              <button className="primary pl-big" onClick={() => setCamera(true)}>Scan card to allow</button>
              <button className="pl-deny ghost" onClick={() => void deny()}>Not me, deny</button>
            </div>
          </>
        )}
        {state === "ok" && (
          <>
            <h2>Unlocked</h2>
            <p className="pl-who"><b>{req.device}</b> can open the page now.</p>
            <div className="pl-bar" aria-hidden><i /></div>
            <button className="pl-relock" onClick={() => void relock()}>Relock — I didn't mean to</button>
          </>
        )}
        {state === "relocked" && (<><h2>Locked again</h2><p className="pl-who"><b>{req.device}</b> can't open the page.</p></>)}
        {state === "denied" && (<><h2>Denied</h2><p className="pl-who">Nothing was unlocked.</p></>)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Settings > Paper Lock

function PaperCardsDialog({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const [cards, setCards] = useState<PaperCard[] | null>(null);
  const [open, setOpen] = useState<PaperGrantInfo[]>([]);
  const load = () => { api.paperCards().then(setCards).catch(() => setCards([])); api.paperGrants().then((r) => setOpen(r.grants)).catch(() => {}); };
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, []);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onClose]);

  const relock = async (g: PaperGrantInfo) => { await api.paperRelock({ grant_id: g.id }).catch(() => {}); store.toast(`Locked again on ${g.device}`); load(); };
  const remove = async (c: PaperCard) => {
    if (!(await store.confirm(`Delete the card “${c.name}”? Nothing it locks can be opened by it afterwards.`))) return;
    try { await api.paperDeleteCard(c.id); load(); } catch (e) { store.toast((e as Error).message); }
  };
  const when = (t: number) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal pl-manage" role="dialog" aria-label="Paper Lock" onMouseDown={(e) => e.stopPropagation()}>
        <div className="memory-head">
          <span className="notify-ico"><ILock size={22} /></span>
          <div><b>Paper Lock</b><small>Pages locked with a card you drew. Only a scan of the card opens them.</small></div>
          <button className="ghost icon-btn" aria-label="Close" onClick={onClose}><IClose size={18} /></button>
        </div>
        <h3 className="pl-h">Open right now</h3>
        {open.length === 0 ? <p className="pl-fine">Nothing is open. Locks close when a page is closed, and after 10 idle minutes.</p> : (
          <ul className="pl-list">{open.map((g) => (
            <li key={g.id}><span><b>{g.device}</b><small>Opened {when(g.since)} with “{g.card}”</small></span><button onClick={() => void relock(g)}>Relock</button></li>
          ))}</ul>
        )}
        <h3 className="pl-h">Your cards</h3>
        {!cards ? <div className="skeleton" style={{ height: 40 }} /> : cards.length === 0 ? <p className="pl-fine">No cards yet. Open a page on your phone and choose “Lock with a paper card”.</p> : (
          <ul className="pl-list">{cards.map((c) => (
            <li key={c.id}><span><b>{c.name}</b><small>{c.pages === 0 ? "Locks no pages" : `Locks ${c.pages} page${c.pages === 1 ? "" : "s"}`}{c.retired ? " · first scanner, not safe: opens nothing" : ""}{c.blocked_until ? ` · blocked until ${when(c.blocked_until)} (too many wrong scans)` : ""}</small></span>
              <button disabled={c.pages > 0} title={c.pages > 0 ? "Remove the lock from its pages first" : "Delete this card"} onClick={() => void remove(c)}>Delete</button></li>
          ))}</ul>
        )}
        <p className="pl-fine">When another device asks to open a locked page, your phone shows a request{" "}
          <button className="lnk" onClick={() => { onClose(); store.setNotifyOpen(true); }}>(turn on notifications)</button>.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the host

export function PaperHost() {
  const [lockFor, setLockFor] = useState<string | null>(null);
  const [manage, setManage] = useState(false);
  const [req, setReq] = useState<PaperRequest | null>(null);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    const lock = (e: Event) => setLockFor((e as CustomEvent<{ id: string }>).detail.id);
    const mng = () => setManage(true);
    addEventListener("seaglass:paper-lock", lock); addEventListener("seaglass:paper-manage", mng);
    return () => { removeEventListener("seaglass:paper-lock", lock); removeEventListener("seaglass:paper-manage", mng); };
  }, []);

  // the phone watches for requests while it's open
  useEffect(() => {
    if (!isPhone() || req) return;
    let on = true;
    const check = async () => {
      if (document.hidden) return;
      try { const r = (await api.paperRequests()).requests.find((x) => !seen.current.has(x.id)); if (on && r) setReq(r); } catch { /* offline, signed out */ }
    };
    void check();
    const t = setInterval(check, 4000);
    document.addEventListener("visibilitychange", check); addEventListener("focus", check);
    return () => { on = false; clearInterval(t); document.removeEventListener("visibilitychange", check); removeEventListener("focus", check); };
  }, [req]);

  return (
    <>
      {lockFor && <PaperSetup pageId={lockFor} onClose={() => setLockFor(null)} />}
      {manage && <PaperCardsDialog onClose={() => setManage(false)} />}
      {req && <RequestSheet key={req.id} req={req} onClose={() => { seen.current.add(req.id); setReq(null); }} />}
    </>
  );
}
