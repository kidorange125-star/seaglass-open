// Handwriting (#45) and handwriting to text (#46), full screen over the page. Write with an Apple Pencil (pressure changes
// the line), or a finger or mouse until a pencil is used; after that a finger scrolls the paper instead of drawing (palm
// rejection). Pen in three inks, highlighter, stroke eraser, undo and redo; the paper grows as you write. Done puts the
// drawing in the page (a PNG to show plus its strokes as JSON to edit again, ink.ts). "Turn into text" reads it with the
// assistant (worker ai.ts handwritingToText) and offers to add the text below the drawing or to use the text instead.
// Paper: lined, or a Cornell sheet (ink.ts CORNELL: lines only, one page). On a Cornell sheet the title is written above
// the top line; on Done it's read (one call) and handed to onTitle, which makes it the page's title if it has none.
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, Eraser, Highlighter, Keyboard, Plus, Redo2, Undo2, Type, X } from "lucide-react";
import { api } from "../api";
import { JeffAvatar } from "../icons";
import { agentName } from "../persona";
import { bounds, CORNELL, cornellHeight, drawPaper, drawStroke, drawStrokes, eraseAt, HIGHLIGHT, INKS, LINE, PAPER_GROW, PAPER_MIN, paperHeight, PEN_WIDTHS, snapToLines, strokesSig, thin, titleFor, type Ink, type Paper, type PenWidth, type Stroke } from "../handwriting/ink";
import { jeffModel } from "./AiTools";

export interface InkResult { png: Blob; ink: Ink; text?: { html: string; replace: boolean } }
type Mode = "pen" | "highlighter" | "eraser";
const HL = 18;
const WIDTH_NAMES: Record<PenWidth, string> = { fine: "Fine", medium: "Medium", bold: "Bold" };

export function Handwriting({ initial, paper: startPaper, hint, onDone, onCancel, onTitle, onType, asPage, onSave, onBack, title, todos, onTodoDone, onTranscript }: {
  initial?: Ink | null; paper?: Paper; /** words typed elsewhere, to write in by hand */ hint?: string; onDone: (r: InkResult) => void; onCancel: () => void; onTitle?: (title: string) => void;
  /** "Type instead": keep what's written and go to the keyboard */ onType?: () => void;
  /** A handwritten note (iPad): the paper is the body of an ordinary Seaglass page (its top bar, title and sidebar stay).
   *  Saved as the user writes (onSave); the pens float at the bottom of the page; the paper's settings (Cornell or Lined, Snap
   *  to lines, Add lines, Turn into text) are in the page's ⋯ menu (seaglass:ink-cmd / seaglass:ink-state); things typed
   *  on other devices are listed to write in. */
  asPage?: boolean; onSave?: (r: InkResult) => Promise<void>; onBack?: () => void; title?: string; todos?: string[]; onTodoDone?: (text: string) => void;
  /** What the writing says, read in the background (cheap model), to keep with the drawing so the assistant, search and
   *  MCP can read it (Editor puts it in the image's alt). Only when the writing changed since it was last read. */
  onTranscript?: (text: string) => void;
}) {
  // New writing starts on the lined Cornell sheet (a formatted page); a drawing made before keeps the paper it was made on.
  const [paper, setPaper] = useState<Paper>(initial ? initial.paper ?? "lined" : startPaper ?? "cornell");
  // Snap to lines (a switch, remembered on this device): after a pause, the word or line just written is straightened
  // onto the nearest line and resized to fit it (ink.ts snapToLines). A new line of writing snaps the last one at once.
  const [snap, setSnap] = useState(() => { try { return localStorage.getItem("sg.ink.snap") === "1"; } catch { return false; } });
  const group = useRef<number | null>(null), snapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const box = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<Stroke[]>(initial?.strokes ?? []);
  const [redo, setRedo] = useState<Stroke[][]>([]);
  const [mode, setMode] = useState<Mode>("pen");
  const [color, setColor] = useState(INKS[0]);
  // the pen's width (Fine, Medium, Bold), remembered on this device
  const [penW, setPenW] = useState<PenWidth>(() => { try { const v = localStorage.getItem("sg.ink.width"); return v === "fine" || v === "bold" ? v : "medium"; } catch { return "medium"; } });
  const [widthOpen, setWidthOpen] = useState(false);
  const choose = (w: PenWidth) => { setPenW(w); setMode("pen"); setWidthOpen(false); try { localStorage.setItem("sg.ink.width", w); } catch { /* this visit only */ } };
  useEffect(() => {
    if (!widthOpen) return;
    const shut = (e: PointerEvent) => { if (!(e.target as Element | null)?.closest?.(".ink-width-wrap")) setWidthOpen(false); };
    addEventListener("pointerdown", shut, true); return () => removeEventListener("pointerdown", shut, true);
  }, [widthOpen]);
  const [width, setWidth] = useState(initial?.width ?? 800);
  const [height, setHeight] = useState(Math.max(initial?.height ?? 0, PAPER_MIN, (typeof innerHeight === "number" ? innerHeight : 0) - 110)); // a full screen of paper to start
  const [reading, setReading] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState("");
  // Palm rejection: once this device has seen an Apple Pencil (remembered, sg.ink.pen), fingers and palms never draw,
  // they scroll; a stroke only takes points from the pointer that started it (a palm landing mid-stroke adds nothing);
  // a big contact (a hand resting) is ignored outright; and a touch stroke still going when the Pencil comes down was a
  // palm, so it's dropped.
  const live = useRef<Stroke | null>(null), livePointer = useRef<{ id: number; type: string } | null>(null), scrollPointer = useRef<number | null>(null);
  const penSeen = useRef((() => { try { return localStorage.getItem("sg.ink.pen") === "1"; } catch { return false; } })());
  const scrollFrom = useRef<{ y: number; top: number } | null>(null);
  const strokesRef = useRef(strokes); strokesRef.current = strokes;

  // size the paper to the screen (a drawing made on a wider screen is scaled down to fit, never cropped)
  useEffect(() => {
    const fit = () => setWidth(asPage ? (box.current?.clientWidth ?? 800) : Math.min(1000, (box.current?.clientWidth ?? 800) - 34)); // the whole screen, or inside the desk's margins
    fit(); addEventListener("resize", fit);
    // the space it sits in can change without the window changing (the note going full screen, the sidebar folding)
    const ro = typeof ResizeObserver !== "undefined" && box.current ? new ResizeObserver(fit) : null;
    if (ro && box.current) ro.observe(box.current);
    return () => { removeEventListener("resize", fit); ro?.disconnect(); };
  }, []);
  const scale = initial?.width && initial.width > width ? width / initial.width : 1;
  // a Cornell sheet is one page tall (the shape of a letter page); lined paper grows as you write
  // lines added to a Cornell sheet (Add lines, or writing near its bottom line): the notes area gets longer
  const baseW = initial?.width && scale < 1 ? initial.width : width;
  const [extra, setExtra] = useState(() => initial?.paper === "cornell" ? Math.max(0, Math.round(((initial.height ?? 0) - cornellHeight(initial.width)) / LINE) * LINE) : 0);
  const sheetH = cornellHeight(baseW) + extra;
  const sheet = paper === "cornell" ? sheetH * scale : null;
  const shown = sheet ?? height;
  const extraRef = useRef(extra); extraRef.current = extra;
  /** More paper: lined paper grows; a Cornell sheet's notes area gets `n` more lines, the summary moving down with them. */
  const addLines = (n: number) => {
    if (paper !== "cornell") { setHeight((h) => h + n * LINE); return; }
    const bottom = cornellHeight(baseW) + extraRef.current - CORNELL.bottom, add = n * LINE;
    extraRef.current += add; setExtra(extraRef.current);
    const below = (s: Stroke) => s.points.filter((p) => p[1] > bottom).length > s.points.length / 2;
    setStrokes((xs) => xs.map((s) => (below(s) ? { ...s, points: s.points.map(([x, y, pr]) => [x, y + add, pr] as [number, number, number]) } : s)));
  };

  const paint = useCallback(() => {
    const c = canvas.current; if (!c) return;
    const dpr = Math.min(3, devicePixelRatio || 1);
    if (c.width !== Math.round(width * dpr) || c.height !== Math.round(shown * dpr)) { c.width = Math.round(width * dpr); c.height = Math.round(shown * dpr); }
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    ctx.clearRect(0, 0, width / scale, shown / scale);
    drawPaper(ctx, paper, width / scale, shown / scale);
    drawStrokes(ctx, strokesRef.current);
    paintLive();
  }, [width, shown, scale, paper]); // eslint-disable-line react-hooks/exhaustive-deps
  // No lag: the page's ink (above) is drawn only when it changes; the stroke being written lives on its own layer on top,
  // redrawn once per frame, with the Pencil's predicted next points (where the browser gives them) so it keeps up.
  const liveCanvas = useRef<HTMLCanvasElement>(null), predicted = useRef<[number, number, number][]>([]), frame = useRef<number | null>(null);
  function paintLive() {
    frame.current = null;
    const c = liveCanvas.current; if (!c) return;
    const dpr = Math.min(3, devicePixelRatio || 1);
    if (c.width !== Math.round(width * dpr) || c.height !== Math.round(shown * dpr)) { c.width = Math.round(width * dpr); c.height = Math.round(shown * dpr); }
    const ctx = (c.getContext("2d", { desynchronized: true }) ?? c.getContext("2d")) as CanvasRenderingContext2D;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    ctx.clearRect(0, 0, width / scale, shown / scale);
    const s = live.current;
    if (s?.points.length) drawStroke(ctx, predicted.current.length ? { ...s, points: [...s.points, ...predicted.current] } : s, true);
  }
  const liveFrame = () => { if (frame.current === null) frame.current = requestAnimationFrame(paintLive); };
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  useEffect(() => { paint(); }, [paint, strokes]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !asPage) onCancel(); if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redoOne(); else undoOne(); } }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); });

  const at = (e: React.PointerEvent): [number, number, number] => {
    const r = canvas.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale, e.pointerType === "pen" ? e.pressure : 0.5];
  };
  const grow = (y: number) => {
    if (paper !== "cornell") { if (y * scale > height - 120) setHeight((h) => h + PAPER_GROW); return; }
    // writing on a Cornell sheet's last line before the summary: four more lines
    const bottom = cornellHeight(baseW) + extraRef.current - CORNELL.bottom;
    if (y > bottom - LINE && y < bottom && live.current?.tool === "pen") addLines(4);
  };
  /** Snaps the strokes written since the last snap (the group), if they're a line of writing. */
  const flush = () => {
    if (snapTimer.current) { clearTimeout(snapTimer.current); snapTimer.current = null; }
    const from = group.current; group.current = null;
    if (from === null) return;
    setStrokes((xs) => { const done = snapToLines(xs.slice(from), LINE); return done ? [...xs.slice(0, from), ...done] : xs; });
  };
  useEffect(() => () => { if (snapTimer.current) clearTimeout(snapTimer.current); }, []);
  // Writing must never select or highlight anything: iPad Safari treats a Pencil drag or a long press as selecting text
  // (blue highlights, the magnifier, the callout menu). The paper takes its touches itself (passive: false so they can
  // be cancelled), any selection is cleared when a stroke starts, and selecting is off on the paper and while writing.
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const stop = (e: Event) => { if (e.cancelable) e.preventDefault(); };
    // Fingers scroll natively (with momentum) once a Pencil has been seen: the paper allows vertical panning
    // (touch-action: pan-y), and only touches that must not move the page are cancelled: the Pencil itself, any touch
    // while a stroke is being drawn, a flat palm, and every touch before a Pencil was seen (then fingers draw).
    const hold = (e: TouchEvent) => {
      const ts = [...e.changedTouches] as (Touch & { touchType?: string })[];
      const keep = ts.some((t) => t.touchType === "stylus") || !penSeen.current || !!livePointer.current || ts.some((t) => Math.max(t.radiusX || 0, t.radiusY || 0) > 22);
      if (keep && e.cancelable) e.preventDefault();
    };
    // Like other iPad note apps: a quick tap with two fingers undoes, with three redoes (once a Pencil is in use, so
    // fingers aren't drawing). It must be short and still, or it was a scroll or a pinch.
    let tap: { n: number; t: number; x: number; y: number } | null = null;
    const mid = (l: TouchList) => { let x = 0, y = 0; for (const t of l) { x += t.clientX; y += t.clientY; } return { x: x / l.length, y: y / l.length }; };
    const tapStart = (e: TouchEvent) => {
      const stylus = [...e.touches].some((t) => (t as Touch & { touchType?: string }).touchType === "stylus");
      if (e.touches.length < 2 || stylus || !penSeen.current || livePointer.current) { if (e.touches.length < 2) tap = null; return; }
      const m = mid(e.touches);
      tap = { n: Math.max(tap?.n ?? 0, e.touches.length), t: tap?.t ?? Date.now(), x: m.x, y: m.y };
    };
    const tapMove = (e: TouchEvent) => { if (!tap || e.touches.length < 2) return; const m = mid(e.touches); if (Math.hypot(m.x - tap.x, m.y - tap.y) > 14) tap = null; };
    const tapEnd = (e: TouchEvent) => {
      if (!tap || e.touches.length) return;
      const t = tap; tap = null;
      if (Date.now() - t.t > 350) return;
      if (t.n === 2) undoOne(); else redoOne();
    };
    c.addEventListener("touchstart", hold, { passive: false }); c.addEventListener("touchmove", hold, { passive: false });
    c.addEventListener("touchstart", tapStart); c.addEventListener("touchmove", tapMove); c.addEventListener("touchend", tapEnd); c.addEventListener("touchcancel", tapEnd);
    c.addEventListener("contextmenu", stop); c.addEventListener("selectstart", stop);
    document.body.classList.add("inking");
    return () => {
      c.removeEventListener("touchstart", hold); c.removeEventListener("touchmove", hold);
      c.removeEventListener("touchstart", tapStart); c.removeEventListener("touchmove", tapMove); c.removeEventListener("touchend", tapEnd); c.removeEventListener("touchcancel", tapEnd);
      c.removeEventListener("contextmenu", stop); c.removeEventListener("selectstart", stop); document.body.classList.remove("inking");
    };
  }, []);
  // while a stroke is being written the floating pens fade and let touches through, so they never get in the way
  const writing = (on: boolean) => box.current?.closest(".ink")?.classList.toggle("writing", on);
  // where touch events exist (iPad, iPhone) the browser scrolls for a finger itself; elsewhere a touch pointer is scrolled here
  const native = typeof window !== "undefined" && "ontouchstart" in window;
  const down = (e: React.PointerEvent) => {
    if (e.cancelable && !(e.pointerType === "touch" && penSeen.current && native)) e.preventDefault();
    try { const sel = getSelection(); if (sel && !sel.isCollapsed) sel.removeAllRanges(); } catch { /* none */ }
    const palmSized = e.pointerType === "touch" && Math.max(e.width || 0, e.height || 0) > 44;
    if (palmSized) return; // a hand resting on the screen
    if (e.pointerType === "pen") {
      if (!penSeen.current) { penSeen.current = true; try { localStorage.setItem("sg.ink.pen", "1"); } catch { /* this visit only */ } }
      if (livePointer.current?.type === "touch") { live.current = null; livePointer.current = null; liveFrame(); } // the palm got there first
      scrollFrom.current = null; scrollPointer.current = null;
    }
    // while a stroke is being drawn, any other contact is a palm: ignore it
    if (livePointer.current && livePointer.current.id !== e.pointerId) return;
    if (snapTimer.current) { clearTimeout(snapTimer.current); snapTimer.current = null; }
    // starting another line (or a highlighter or the eraser) finishes the word being written
    if (group.current !== null) {
      const g = bounds(strokesRef.current.slice(group.current)), y = (e.clientY - canvas.current!.getBoundingClientRect().top) / scale;
      if (mode !== "pen" || !g || y > g.y1 + LINE * 0.6 || y < g.y0 - LINE * 0.6) flush();
    }
    if (e.pointerType === "touch" && penSeen.current) { if (!native && scrollPointer.current === null) { scrollPointer.current = e.pointerId; scrollFrom.current = { y: e.clientY, top: scroller().scrollTop }; } return; } // a finger scrolls (natively where the browser can)
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* a pointer the browser no longer tracks: draw without capture */ }
    const p = at(e);
    livePointer.current = { id: e.pointerId, type: e.pointerType };
    if (mode === "eraser") { const next = eraseAt(strokesRef.current, p[0], p[1]); if (next.length !== strokesRef.current.length) { setRedo([]); setStrokes(next); } live.current = { tool: "pen", color: "#000000", size: 0, points: [] }; return; }
    live.current = { tool: mode === "highlighter" ? "highlighter" : "pen", color: mode === "highlighter" ? HIGHLIGHT : color, size: mode === "highlighter" ? HL : PEN_WIDTHS[penW], points: [p] };
    predicted.current = [];
    writing(true);
    liveFrame();
  };
  const move = (e: React.PointerEvent) => {
    if (scrollFrom.current && e.pointerId === scrollPointer.current) { scroller().scrollTop = scrollFrom.current.top - (e.clientY - scrollFrom.current.y); return; }
    if (!live.current || e.pointerId !== livePointer.current?.id) return; // only the pointer that started the stroke draws
    const events = typeof e.nativeEvent.getCoalescedEvents === "function" ? e.nativeEvent.getCoalescedEvents() : [];
    const pts = (events.length ? events : [e.nativeEvent]).map((ev) => at({ clientX: ev.clientX, clientY: ev.clientY, pressure: ev.pressure, pointerType: ev.pointerType } as React.PointerEvent));
    if (mode === "eraser") { let next = strokesRef.current; for (const p of pts) next = eraseAt(next, p[0], p[1]); if (next.length !== strokesRef.current.length) setStrokes(next); return; }
    live.current.points.push(...pts); grow(pts[pts.length - 1][1]);
    const ahead = typeof e.nativeEvent.getPredictedEvents === "function" ? e.nativeEvent.getPredictedEvents() : [];
    predicted.current = ahead.slice(0, 3).map((ev) => at({ clientX: ev.clientX, clientY: ev.clientY, pressure: ev.pressure, pointerType: ev.pointerType } as React.PointerEvent));
    liveFrame();
  };
  const up = (e?: React.PointerEvent) => {
    if (e && e.pointerId === scrollPointer.current) { scrollFrom.current = null; scrollPointer.current = null; return; }
    if (e && livePointer.current && e.pointerId !== livePointer.current.id) return; // a palm lifting doesn't end the stroke
    scrollFrom.current = null; scrollPointer.current = null; livePointer.current = null; predicted.current = [];
    writing(false);
    const s = live.current; live.current = null;
    if (!s || mode === "eraser" || !s.points.length) return;
    if (snap && mode === "pen" && group.current === null) group.current = strokesRef.current.length;
    setRedo([]); setStrokes((xs) => [...xs, { ...s, points: thin(s.points) }]);
    if (snap && mode === "pen") snapTimer.current = setTimeout(flush, 650);
  };
  const undoOne = () => setStrokes((xs) => { if (!xs.length) return xs; setRedo((r) => [...r, xs]); return xs.slice(0, -1); });
  const redoOne = () => setRedo((r) => { if (!r.length) return r; setStrokes(r[r.length - 1]); return r.slice(0, -1); });

  /** The drawing as a PNG, cropped to the paper it uses, on white (so it reads in dark mode and to the model). */
  const toPng = async (list = strokesRef.current) => {
    const w = initial?.width && scale < 1 ? initial.width : width, h = paper === "cornell" ? cornellHeight(w) + extraRef.current : paperHeight(list);
    const png = await picture(list, w, h, paper);
    const ink: Ink = { v: 1, width: w, height: h, strokes: list, ...(paper === "cornell" ? { paper } : {}), ...(textSigRef.current ? { textSig: textSigRef.current } : {}) };
    return { png, ink };
  };
  /** The writing as a saved drawing, and its title read in the background when that changed. */
  const titleSigRef = useRef(initial?.titleSig);
  const finish = async (snapNow: boolean) => {
    // a word still waiting to snap is snapped first
    let list = strokesRef.current;
    if (snapNow && snap && group.current !== null) { const from = group.current; const fixed = snapToLines(list.slice(from), LINE); if (fixed) list = [...list.slice(0, from), ...fixed]; flush(); }
    const r = await toPng(list);
    // the title: what's above a Cornell sheet's top line, or the first line on lined paper; read again only if it changed
    const t = onTitle ? titleFor(paper, list) : [];
    const sig = strokesSig(t);
    if (sig) r.ink.titleSig = sig;
    return { r, t, sig };
  };
  const done = async () => {
    if (!strokes.length) { onCancel(); return; }
    const { r, t, sig } = await finish(true);
    onDone(r);
    readTitle(r, t, sig);
    void transcribe(r.ink.strokes);
  };
  // what the writing says, for the assistant (the image's alt): read when it changed, with the cheap model
  const textSigRef = useRef(initial?.textSig), textTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcribe = async (list = strokesRef.current) => {
    if (textTimer.current) { clearTimeout(textTimer.current); textTimer.current = null; }
    if (!onTranscript) return;
    const pens = list.filter((s) => s.points.length);
    const sig = strokesSig(pens), b = bounds(pens);
    if (!sig || !b || sig === textSigRef.current) return;
    textSigRef.current = sig;
    try {
      const png = await picture(pens, Math.ceil(b.x1 + 16), Math.ceil(b.y1 + 16), undefined);
      const { html } = await api.handwriting(png, "claude-haiku-5-5");
      const d = new DOMParser().parseFromString(html, "text/html").body; // inert
      const lines = [...d.querySelectorAll("h1, h2, h3, p, li")].map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);
      const text = (lines.length ? lines.join("\n") : (d.textContent ?? "").trim()).slice(0, 6000);
      if (text && !/^\[No writing found\]$/.test(text)) onTranscript(text);
    } catch { textSigRef.current = undefined; /* tried again next time */ }
  };
  // as a page: saved a moment after each change, when the user leaves, and when the app goes to the background
  const dirty = useRef(false), saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null), first = useRef(true);
  const saveNow = async () => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    if (!asPage || !onSave || !dirty.current || !strokesRef.current.length) return;
    dirty.current = false;
    const { r, t, sig } = await finish(false);
    await onSave(r);
    readTitle(r, t, sig);
  };
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!asPage) return;
    dirty.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void saveNow(), 700);
    if (textTimer.current) clearTimeout(textTimer.current);
    textTimer.current = setTimeout(() => void transcribe(), 6000);
  }, [strokes, paper, extra]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!asPage) return;
    const hide = () => { if (document.visibilityState === "hidden") { void saveNow(); void transcribe(); } };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const back = async () => { await saveNow(); onBack?.(); };
  // what scrolls: the page itself for a handwritten note, else the writing screen's paper
  const scroller = () => (asPage ? (box.current?.closest(".scroll") as HTMLElement | null) : null) ?? box.current!;
  // leaving the note (another page, the sidebar) saves it at once
  useEffect(() => {
    if (!asPage) return;
    const leave = () => { void saveNow(); void transcribe(); };
    addEventListener("hashchange", leave); addEventListener("pagehide", leave);
    return () => { removeEventListener("hashchange", leave); removeEventListener("pagehide", leave); };
  }); // eslint-disable-line react-hooks/exhaustive-deps
  // the page's ⋯ menu drives the paper's settings, and is told what they are
  useEffect(() => {
    if (!asPage) return;
    dispatchEvent(new CustomEvent("seaglass:ink-state", { detail: { on: true, paper, snap, canRead: strokes.length > 0 } }));
  }, [asPage, paper, snap, strokes.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (asPage) dispatchEvent(new CustomEvent("seaglass:ink-state", { detail: { on: false } })); }, [asPage]);
  useEffect(() => {
    if (!asPage) return;
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ paper?: Paper; snap?: boolean; lines?: number; read?: boolean }>).detail ?? {};
      if (d.paper) pick(d.paper);
      if (typeof d.snap === "boolean") setSnapOn(d.snap);
      if (d.lines) addLines(d.lines);
      if (d.read) void read();
    };
    addEventListener("seaglass:ink-cmd", on); return () => removeEventListener("seaglass:ink-cmd", on);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const readTitle = (r: InkResult, t: Stroke[], sig: string) => {
    const b = bounds(t);
    if (!b || !onTitle || sig === titleSigRef.current) return;
    titleSigRef.current = sig;
    void (async () => {
      const png = await picture(t.map((s) => ({ ...s, points: s.points.map(([x, y, pr]) => [x - Math.max(0, b.x0 - 8), y - Math.max(0, b.y0 - 8), pr] as [number, number, number]) })), Math.ceil(b.x1 - Math.max(0, b.x0 - 8) + 16), Math.ceil(b.y1 - Math.max(0, b.y0 - 8) + 16), undefined);
      api.handwriting(png, jeffModel()).then(({ html }) => {
        const d = new DOMParser().parseFromString(html, "text/html").body; // inert: nothing in it loads or runs
        const line = (d.querySelector("h1, h2, h3, p, li")?.textContent ?? d.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
        if (line) onTitle(line);
      }).catch(() => { titleSigRef.current = undefined; /* the title stays as it is; tried again next time */ });
    })();
  };
  const read = async () => {
    if (!strokes.length) return;
    setReading(true); setErr("");
    try { const { png } = await toPng(); setText((await api.handwriting(png, jeffModel())).html); }
    catch (e) { setErr((e as Error).message); }
    setReading(false);
  };
  const useText = async (replace: boolean) => { const r = await toPng(); onDone({ ...r, text: { html: text ?? "", replace } }); };

  const pick = (p: Paper) => { if (p === paper) return; setPaper(p); if (p === "lined") setHeight((h) => Math.max(h, paperHeight(strokesRef.current) + 120)); };
  const setSnapOn = (v: boolean) => { setSnap(v); if (!v) flush(); try { localStorage.setItem("sg.ink.snap", v ? "1" : "0"); } catch { /* not kept */ } };
  const tools = (
    <div className="ink-tools" role="toolbar" aria-label="Pen">
      {INKS.map((c) => <button key={c} className={`ink-swatch ${mode === "pen" && color === c ? "on" : ""}`} style={{ "--ink": c } as React.CSSProperties} aria-label={`Pen, ${c === INKS[0] ? "black" : c === INKS[1] ? "blue" : "red"}`} aria-pressed={mode === "pen" && color === c} onClick={() => { setMode("pen"); setColor(c); }}><span className="ink-dot" /></button>)}
      <span className="ink-width-wrap">
        <button className={`ink-tool ink-width ${widthOpen ? "on" : ""}`} aria-label={`Pen width: ${WIDTH_NAMES[penW]}`} title="Pen width" aria-expanded={widthOpen} aria-haspopup="true" onClick={() => setWidthOpen((v) => !v)}>
          <WidthLine w={penW} color={color} />
        </button>
        {widthOpen && <span className="ink-widths" role="menu" aria-label="Pen width">
          {(Object.keys(PEN_WIDTHS) as PenWidth[]).map((w) => <button key={w} role="menuitemradio" aria-checked={penW === w} className={penW === w ? "on" : ""} onClick={() => choose(w)}><WidthLine w={w} color={color} /> {WIDTH_NAMES[w]}</button>)}
        </span>}
      </span>
      <span className="ink-sep" />
      <button className={`ink-tool ${mode === "highlighter" ? "on" : ""}`} aria-label="Highlighter" title="Highlighter" aria-pressed={mode === "highlighter"} onClick={() => setMode("highlighter")}><Highlighter size={19} /></button>
      <button className={`ink-tool ${mode === "eraser" ? "on" : ""}`} aria-label="Eraser" title="Eraser: touch a stroke to remove it" aria-pressed={mode === "eraser"} onClick={() => setMode("eraser")}><Eraser size={19} /></button>
      <span className="ink-sep" />
      <button className="ink-tool" aria-label="Undo" title="Undo (or tap with two fingers)" disabled={!strokes.length} onClick={undoOne}><Undo2 size={19} /></button>
      <button className="ink-tool" aria-label="Redo" title="Redo (or tap with three fingers)" disabled={!redo.length} onClick={redoOne}><Redo2 size={19} /></button>
    </div>
  );
  const textPanel = (text !== null || err) && (
    <div className="ink-text" role="region" aria-label="As text">
      <div className="ink-text-head"><JeffAvatar size={22} /> <b>{err ? "Couldn't read it" : "As text"}</b></div>
      {err ? <p className="when-err">{err}</p> : <div className="ink-text-body" dangerouslySetInnerHTML={{ __html: text ?? "" }} />}
      <div className="ink-text-actions">
        <button onClick={() => { setText(null); setErr(""); }}>Back to writing</button>
        {!err && <button onClick={() => void useText(false)}>Add below the drawing</button>}
        {!err && <button className="primary" onClick={() => void useText(true)}>Use the text instead</button>}
      </div>
    </div>
  );
  if (asPage) return (
    // a handwritten note: the paper is the page's body; the pens float at the bottom; settings live in the ⋯ menu
    <div className="ink as-page inline" role="region" aria-label="Handwritten note">
      {!!todos?.length && <div className="ink-todos" role="note">
        <b>Typed on another device, to write in:</b>
        {todos.map((t, i) => <span key={i} className="ink-todo-item">“{t}” <button onClick={() => onTodoDone?.(t)} title="I've written it in: remove the typed words">Written ✓</button></span>)}
      </div>}
      <div className="ink-paper-wrap" ref={box}>
        <div className="ink-sheet" style={{ width, height: shown }}>
          <canvas ref={canvas} className={`ink-paper ${paper}`} style={{ width, height: shown }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={(e) => { if (e.pointerType !== "touch") up(e); }} />
          <canvas ref={liveCanvas} className="ink-live" style={{ width, height: shown }} aria-hidden />
        </div>
        <button className="ink-more" onClick={() => addLines(paper === "cornell" ? 6 : 8)}><Plus size={16} /> Add lines</button>
      </div>
      {text === null && !err && <div className="ink-float-wrap">
        {!strokes.length && <p className="ink-float-hint">{paper === "cornell" ? "Write the title above the top line to name the page." : "Your first line names the page."}</p>}
        <div className="ink-float">{tools}</div>
      </div>}
      {textPanel}
    </div>
  );
  return (
    <div className={`ink ${asPage ? "as-page" : ""}`} role={asPage ? "region" : "dialog"} aria-label={asPage ? "Handwritten note" : "Handwriting"}>
      {/* top: close, the tools in one pill, Done; under it the page's settings and the ways out to text */}
      <div className="ink-bar">
        {asPage
          ? <><button className="ghost ink-close" aria-label="Back" title="Back (it's saved)" onClick={() => void back()}><ChevronLeft size={24} /></button>
              <span className="ink-title" title="The title is read from your handwriting">{title || "Untitled"}</span></>
          : <button className="ghost ink-close" aria-label="Cancel (Esc)" title="Close without saving (Esc)" onClick={onCancel}><X size={20} /></button>}
        {tools}
        {asPage ? <span className="ink-saved" aria-live="polite">Saved as you write</span> : <button className="primary ink-done" onClick={() => void done()}>Done</button>}
      </div>
      <div className="ink-opts">
        <div className="ink-paper-pick" role="radiogroup" aria-label="Paper">
          <button role="radio" aria-checked={paper === "cornell"} className={paper === "cornell" ? "on" : ""} onClick={() => pick("cornell")}><span className="ink-mini cornell" aria-hidden />Cornell</button>
          <button role="radio" aria-checked={paper === "lined"} className={paper === "lined" ? "on" : ""} onClick={() => pick("lined")}><span className="ink-mini lined" aria-hidden />Lined</button>
        </div>
        <button className={`ink-snap ${snap ? "on" : ""}`} aria-pressed={snap} title="Straighten each word onto the lines and size it to fit" onClick={() => { const v = !snap; setSnap(v); if (!v) flush(); try { localStorage.setItem("sg.ink.snap", v ? "1" : "0"); } catch { /* not kept */ } }}>
          <span className="ink-switch" aria-hidden /> Snap to lines
        </button>
        <span className="ink-gap" />
        <button className="ghost ink-read" disabled={!strokes.length || reading} onClick={() => void read()} title={`${agentName()} reads your writing`}><Type size={17} /> {reading ? "Reading…" : "Turn into text"}</button>
        {onType && !asPage && <button className="ghost ink-type" title="Keep what's written and type with the keyboard" onClick={() => void done().then(onType)}><Keyboard size={17} /> Type instead</button>}
      </div>
      {hint && <div className="ink-copy" role="note"><b>Write in:</b> {hint}</div>}
      {asPage && !!todos?.length && <div className="ink-copy ink-todos" role="note">
        <b>Typed on another device, to write in:</b>
        {todos.map((t, i) => <span key={i} className="ink-todo-item">“{t}” <button onClick={() => onTodoDone?.(t)} title="I've written it in: remove the typed words">Written ✓</button></span>)}
      </div>}
      <div className="ink-paper-wrap" ref={box}>
        {!strokes.length && <p className="ink-hint">{paper === "cornell" ? "Write the title above the top line with your Apple Pencil: it names the page. Questions on the left, notes on the right, a summary at the bottom." : "Write with your Apple Pencil. Your first line names the page. Once you use the Pencil, your hand can rest on the screen."}</p>}
        <div className="ink-sheet" style={{ width, height: shown }}>
          <canvas ref={canvas} className={`ink-paper ${paper}`} style={{ width, height: shown }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={(e) => { if (e.pointerType !== "touch") up(e); }} />
          <canvas ref={liveCanvas} className="ink-live" style={{ width, height: shown }} aria-hidden />
        </div>
        <button className="ink-more" onClick={() => addLines(paper === "cornell" ? 6 : 8)}><Plus size={16} /> Add lines</button>
      </div>
      {(text !== null || err) && (
        <div className="ink-text" role="region" aria-label="As text">
          <div className="ink-text-head"><JeffAvatar size={22} /> <b>{err ? "Couldn't read it" : "As text"}</b></div>
          {err ? <p className="when-err">{err}</p> : <div className="ink-text-body" dangerouslySetInnerHTML={{ __html: text ?? "" }} />}
          <div className="ink-text-actions">
            <button onClick={() => { setText(null); setErr(""); }}>Back to writing</button>
            {!err && <button onClick={() => void useText(false)}>Add below the drawing</button>}
            {!err && <button className="primary" onClick={() => void useText(true)}>Use the text instead</button>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Strokes on white (so it reads in dark mode and to the model), with the paper's own lines, as a PNG. */
async function picture(strokes: Stroke[], w: number, h: number, paper: Paper | undefined) {
  const c = document.createElement("canvas"); c.width = Math.round(w * 2); c.height = Math.round(h * 2);
  const ctx = c.getContext("2d")!; ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height); ctx.scale(2, 2);
  drawPaper(ctx, paper, w, h, true);
  drawStrokes(ctx, strokes);
  return new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("couldn't save the drawing"))), "image/png"));
}

/** A sample of the pen's line at a width, for the width button and its menu. */
function WidthLine({ w, color }: { w: PenWidth; color: string }) {
  return <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden><path d="M3 15c4-7 7 2 9-3s4-4 7-6" fill="none" stroke={color} strokeWidth={PEN_WIDTHS[w] * 1.4} strokeLinecap="round" /></svg>;
}
