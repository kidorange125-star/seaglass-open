// What a paper-locked page shows until it's opened. On a phone: scan the card. On any other device: ask the phone, which
// gets a notification and a screen to scan the card on (PaperHost.tsx); this screen waits, and when the phone has scanned it,
// the lock turns green and the page opens. Nothing of the page is here: its words are only on the server behind the lock.
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";
import { isPhone } from "../device";
import { IChevronLeft, IChevronsRight, IExpand } from "../ui-icons";
import { useStore } from "../store";
import type { Note } from "../types";
import { holdGrant } from "./grants";
import { LockIcon } from "./LockIcon";
import { CardCamera, type CardShot } from "./CardCamera";

/** What a refused scan says, with the tries left. */
export function scanMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const left = e.data.tries_left as number | undefined;
    if (e.status === 403 && left !== undefined) return `That doesn't look like the card. ${left} ${left === 1 ? "try" : "tries"} left.`;
    return e.message;
  }
  return (e as Error)?.message ?? "Something went wrong. Try again.";
}

export function PaperLocked({ note, peek, onOpened }: { note: Note; peek: boolean; onOpened: () => void }) {
  const store = useStore();
  const id = note.id;
  const phone = isPhone();
  const [card, setCard] = useState<{ name: string; missing: boolean; retired?: boolean } | null>(null);
  const [mode, setMode] = useState<"idle" | "asking" | "opening">("idle");
  const [msg, setMsg] = useState("");
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(0);
  const asked = useRef<{ id: string; secret: string; until: number } | null>(null);

  useEffect(() => { let on = true; api.paperInfo(id).then((c) => { if (on) setCard(c); }).catch(() => { if (on) setCard({ name: "your card", missing: false }); }); return () => { on = false; }; }, [id]);

  // asking the phone: wait for its answer
  useEffect(() => {
    if (mode !== "asking") return;
    let on = true;
    const t = setInterval(async () => {
      const a = asked.current;
      if (!a || !on) return;
      setLeft(Math.max(0, Math.ceil((a.until - Date.now()) / 1000)));
      try {
        const s = (await api.paperRequestStatus(a.id)).status;
        if (!on) return;
        if (s === "approved") { clearInterval(t); holdGrant(id, a.secret); asked.current = null; setMode("opening"); setTimeout(onOpened, 1100); }
        else if (s !== "pending") { clearInterval(t); asked.current = null; setMode("idle"); setMsg(s === "denied" ? "Your phone said no." : s === "relocked" ? "Your phone locked it again." : "That request ran out. Ask again."); }
      } catch { /* offline: keep waiting */ }
    }, 1500);
    return () => { on = false; clearInterval(t); };
  }, [mode, id, onOpened]);

  // opening, but this screen is still here: the lock was closed again (Relock) before the page could be read
  useEffect(() => {
    if (mode !== "opening") return;
    const t = setTimeout(() => { setMode("idle"); setMsg("It was locked again before it opened."); }, 4000);
    return () => clearTimeout(t);
  }, [mode]);

  // leaving this screen while a request is waiting takes it off the phone
  useEffect(() => () => { const a = asked.current; if (a) void api.paperDeny(a.id).catch(() => {}); }, []);

  const ask = async () => {
    setMsg(""); setBusy(true);
    try {
      const r = await api.paperAsk(id);
      asked.current = { id: r.id, secret: r.secret, until: r.expires_at };
      setLeft(Math.ceil((r.expires_at - Date.now()) / 1000)); setMode("asking");
    } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  };
  const cancel = () => { const a = asked.current; asked.current = null; if (a) void api.paperDeny(a.id).catch(() => {}); setMode("idle"); setMsg(""); };

  const scan = async ({ scan: sc }: CardShot) => {
    let r: Awaited<ReturnType<typeof api.paperScan>>;
    try { r = await api.paperScan(id, sc); } catch (e) { throw new Error(scanMessage(e)); }
    holdGrant(id, r.secret);
    setTimeout(() => {
      setCamera(false); setMode("opening"); setTimeout(onOpened, 1100);
    }, 600);
  };

  if (camera) return <CardCamera title="Scan to open" once hint={`Scan your “${card?.name ?? "paper"}” card.`} onClose={() => setCamera(false)} onShot={scan} />;

  return (
    <div className={`page ${peek ? "in-peek" : ""}`}>
      <div className="topbar">
        {peek && (
          <div className="peek-nav">
            <button className="ghost icon-btn" title="Close (Esc)" aria-label="Close side peek" onClick={() => store.setPeek(null)}><span className="peek-x-desk"><IChevronsRight size={18} /></span><span className="peek-x-phone"><IChevronLeft size={26} /></span></button>
            <button className="ghost icon-btn" title="Open as full page" aria-label="Open as full page" onClick={() => store.go(`/p/${id}`)}><IExpand size={16} /></button>
          </div>
        )}
        <div className="crumbs"><span className="cur">Paper-locked page</span></div>
      </div>
      <div className="pl-screen" data-mode={mode}>
        <LockIcon state={mode === "opening" ? "open" : "locked"} size={phone && mode === "idle" ? 72 : 104} />
        <h2>{mode === "opening" ? "Unlocked" : "This page is locked with a paper card"}</h2>
        {card?.missing || card?.retired ? (
          <p className="pl-sub">{card.retired ? "This page was locked with a card from the first scanner, which wasn't safe enough, so it can't be opened any more. You can move it to the trash." : "The card for this page was deleted, so it can't be opened any more."}</p>
        ) : mode === "opening" ? (
          <p className="pl-sub">Opening the page…</p>
        ) : mode === "asking" ? (
          <>
            <p className="pl-sub">Waiting for your phone. Open Seaglass on it, or tap the notification, then scan <b>{card?.name ?? "your card"}</b>.</p>
            <div className="pl-wait" aria-hidden><i /><i /><i /></div>
            <p className="pl-fine">The request runs out in {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</p>
            <button className="ghost" onClick={cancel}>Cancel</button>
          </>
        ) : phone ? (
          <>
            <p className="pl-sub">Scan your <b>{card?.name ?? "paper"}</b> card to open it.</p>
            <button className="primary pl-ask" onClick={() => setCamera(true)}>Scan card to open</button>
          </>
        ) : (
          <>
            <p className="pl-sub">Only the card opens it. Your phone will ask you to scan <b>{card?.name ?? "your card"}</b>.</p>
            <button className="primary pl-ask" disabled={busy || !card} onClick={() => void ask()}>{busy ? "Asking…" : "Ask my phone to unlock"}</button>
            <p className="pl-fine">Your phone gets a notification. It needs Seaglass open there, or notifications on.</p>
          </>
        )}
        {msg && <p className="pl-msg" role="alert">{msg}</p>}
      </div>
    </div>
  );
}
