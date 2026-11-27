import { ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { committed, isTouch, reduceMotion, settle, swipe } from "../gestures";
import { EMOJI } from "../emoji";
import { COVER_SECTIONS } from "../covers";
import { api } from "../api";
import { useStore } from "../store";

/** On phones menus are bottom sheets: a tap outside one should only close it, like Notion's app, and not
 *  also press whatever was under your finger. Call this when an outside tap closes a menu. */
export function swallowNextClick() {
  if (!matchMedia("(max-width: 859px)").matches) return;
  const stop = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
  addEventListener("click", stop, { capture: true, once: true });
  setTimeout(() => removeEventListener("click", stop, { capture: true }), 600);
}

/** Phones (menus are bottom sheets under 860px): drag the sheet down to close it, and closing slides it away
 *  instead of vanishing. Returns the close function to use for outside taps and Escape. */
export function useSheet(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  const closing = useRef(false);
  // The latest onClose, without re-attaching the drag (a re-render mid-drag, e.g. from sync, would drop it).
  const latest = useRef(onClose); latest.current = onClose;
  const isSheet = () => matchMedia("(max-width: 859px)").matches;
  const away = useCallback((el: HTMLElement, ms = 260) => { closing.current = true; settle(el, `translateY(${el.offsetHeight + 48}px)`, () => latest.current(), ms); }, []);
  const close = useCallback(() => {
    const el = ref.current;
    if (closing.current) return;
    if (!el || !isSheet() || reduceMotion()) { latest.current(); return; }
    away(el);
  }, [away, ref]);
  useEffect(() => {
    const el = ref.current;
    if (!el || !isSheet() || !isTouch()) return;
    let from: Element | null = null;
    // A list inside the sheet that can scroll up gets the drag instead (so you can scroll back up).
    const scroller = () => { for (let n = from; n && n !== el.parentElement; n = n.parentElement) { if (n instanceof HTMLElement && n.scrollHeight > n.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(n).overflowY)) return n; } return null; };
    return swipe(el, {
      axis: "y", dir: 1, scroller,
      canStart: (_t, e) => { from = e.target as Element; return !(from instanceof HTMLInputElement && from.type === "range"); },
      onMove: (d) => { el.style.transform = `translateY(${d}px)`; },
      onEnd: (d, v) => { if (committed(d, v, el.offsetHeight, 1, 0.28)) away(el, 220); else settle(el, "none"); },
    });
  }, [ref, away]);
  return close;
}

// Popover that closes on outside click / Escape (on phones: a sheet you can drag down).
export function Popover({ children, onClose, className = "", style }: { children: ReactNode; onClose: () => void; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useSheet(ref, onClose);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { swallowNextClick(); close(); } };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    const t = setTimeout(() => addEventListener("mousedown", down), 0);
    addEventListener("keydown", key);
    return () => { clearTimeout(t); removeEventListener("mousedown", down); removeEventListener("keydown", key); };
  }, [close]);
  // Fit it on screen when it opens, and again when it grows (the date picker gains rows as times or a start are added).
  useLayoutEffect(() => {
    const el = ref.current;
    keepInView(el);
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => keepInView(el));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return <div ref={ref} className={`popover ${className}`} style={style}>{children}</div>;
}

/** Nudges a menu up / left so all of it shows: inside the screen and inside any scrolling box it sits in (the sidebar's
 *  page list cut the bottom of a page's ⋯ menu off). Phones show menus as bottom sheets, which already fit. */
export function keepInView(el: HTMLElement | null) {
  if (!el || getComputedStyle(el).position === "fixed") return;
  const M = 8;
  let top = 0, left = 0, bottom = innerHeight, right = innerWidth;
  for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
    const cs = getComputedStyle(a);
    if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
    const r = a.getBoundingClientRect();
    top = Math.max(top, r.top); left = Math.max(left, r.left); bottom = Math.min(bottom, r.bottom); right = Math.min(right, r.right);
  }
  // its settled box: the open animation is still scaling it at this point, so read layout offsets, not the drawn rect
  const op = (el.offsetParent as HTMLElement | null) ?? document.body, o = op.getBoundingClientRect();
  const t0 = o.top + op.clientTop + el.offsetTop, l0 = o.left + op.clientLeft + el.offsetLeft;
  const r = { top: t0, left: l0, bottom: t0 + el.offsetHeight, right: l0 + el.offsetWidth };
  let dy = Math.min(0, bottom - M - r.bottom), dx = Math.min(0, right - M - r.right);
  if (r.top + dy < top + M) dy = Math.min(0, top + M - r.top); // too tall to fit: keep its top showing
  if (r.left + dx < left + M) dx = Math.min(0, left + M - r.left);
  if (dx || dy) el.style.translate = `${Math.round(dx)}px ${Math.round(dy)}px`;
}

export function EmojiPicker({ onPick, onRemove, onClose }: { onPick: (e: string) => void; onRemove?: () => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const list = EMOJI.filter(([e, k]) => !q || k.includes(q.toLowerCase()) || e === q);
  return (
    <Popover onClose={onClose} className="emoji-pop">
      <div className="row">
        <input autoFocus placeholder="Search icons…" value={q} onChange={(e) => setQ(e.target.value)} />
        {onRemove && <button onClick={() => { onRemove(); onClose(); }}>Remove</button>}
      </div>
      <div className="emoji-grid">
        {list.map(([e]) => <button key={e} onClick={() => { onPick(e); onClose(); }}>{e}</button>)}
        {!list.length && <span className="muted">No matches</span>}
      </div>
    </Popover>
  );
}

/** Notion's cover menu: Gallery (colours, gradients, public-domain art) and Upload tabs, Remove on the right. */
export function CoverPicker({ onPick, onRemove, onClose, current }: { onPick: (c: string) => void; onRemove: () => void; onClose: () => void; current?: string | null }) {
  const { toast } = useStore();
  const [tab, setTab] = useState<"gallery" | "upload">("gallery");
  const [busy, setBusy] = useState(false);
  const upload = () => {
    const i = document.createElement("input");
    i.type = "file"; i.accept = "image/png,image/jpeg,image/webp,image/gif";
    i.onchange = async () => {
      const f = i.files?.[0]; if (!f) return;
      setBusy(true);
      try { onPick(await api.upload(f)); onClose(); } catch (e) { toast(`Upload failed: ${(e as Error).message}`); } finally { setBusy(false); }
    };
    i.click();
  };
  return (
    <Popover onClose={onClose} className="cover-pop">
      <div className="cover-tabs">
        <button className={tab === "gallery" ? "on" : ""} onClick={() => setTab("gallery")}>Gallery</button>
        <button className={tab === "upload" ? "on" : ""} onClick={() => setTab("upload")}>Upload</button>
        {current && <button className="cover-remove" onClick={() => { onRemove(); onClose(); }}>Remove</button>}
      </div>
      {tab === "gallery" ? (
        <div className="cover-gallery">
          {COVER_SECTIONS.map((s) => (
            <section key={s.title}>
              <div className="cover-sec">{s.title}</div>
              <div className="cover-grid">
                {s.items.map((c) => (
                  <button key={c.value} title={c.label} aria-label={c.label} className={current === c.value ? "on" : ""}
                    style={{ background: c.thumb ? `url(${c.thumb}) center / cover no-repeat` : c.value }}
                    onClick={() => { onPick(c.value); onClose(); }} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="cover-upload">
          <button className="primary" disabled={busy} onClick={upload}>{busy ? "Uploading…" : "Upload file"}</button>
          <p>Images wider than 1500 pixels work best.</p>
        </div>
      )}
    </Popover>
  );
}

// Promise-based text prompt / confirm (replaces window.prompt).
export function Dialogs() {
  const { dialog, closeDialog, toasts } = useStore();
  const [val, setVal] = useState("");
  useEffect(() => setVal(dialog?.initial ?? ""), [dialog]);
  return (
    <>
      {dialog && (
        <div className="modal-back" onMouseDown={() => closeDialog(null)}>
          <form className="modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); closeDialog(dialog.confirm ? "ok" : val); }}>
            <label>{dialog.label}</label>
            {!dialog.confirm && <input autoFocus value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === "Escape" && closeDialog(null)} />}
            <div className="row end">
              <button type="button" onClick={() => closeDialog(null)}>Cancel</button>
              <button className="primary" autoFocus={dialog.confirm}>{dialog.confirm ? "Confirm" : "OK"}</button>
            </div>
          </form>
        </div>
      )}
      <div className="toasts">{toasts.map((t) => <div key={t.id}>{t.msg}{t.action && <button className="toast-act" onClick={() => t.action!.run()}>{t.action.label}</button>}</div>)}</div>
    </>
  );
}

export const timeAgo = (t: number) => {
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: s > 31536000 ? "numeric" : undefined });
};

export function download(name: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
