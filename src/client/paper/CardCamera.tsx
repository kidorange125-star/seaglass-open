// The Paper Lock camera: full screen, like a document scanner. It looks for the card all the time (scan.ts findCard), draws
// its edges in green when it has it, and takes the scan by itself once the card has been held still for a moment (or on the
// shutter). A scan is the card straightened by its corners and read finely (match.ts), three frames voted into one. A photo
// from the gallery works the same way (the file input has no `capture`, so iOS offers the photo library, not its camera).
import { useCallback, useEffect, useRef, useState } from "react";
import type { PaperScan } from "../api";
import { cardInk, packBits, quality, vote } from "./match";
import { CARD_H, CARD_W, findCard, rectify, scaleQuad, steady, type Quad } from "./scan";

export interface CardShot { scan: PaperScan; thumb: string }
type Phase = "seek" | "reading" | "sending" | "good" | "bad";

const SMALL = 360;   // the width a frame is searched at
const FULL = 1600;   // the longest side a frame is read at
const STILL = 5;     // frames (about 0.7 s) the card must be held still before it is taken

function grab(src: CanvasImageSource, sw: number, sh: number, maxSide: number) {
  const k = Math.min(1, maxSide / Math.max(sw, sh)), w = Math.round(sw * k), h = Math.round(sh * k);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true })!; g.drawImage(src, 0, 0, w, h);
  return { c, w, h, data: g.getImageData(0, 0, w, h).data };
}

/** One read of an image: the card found and straightened, or why not. */
function readImage(src: CanvasImageSource, sw: number, sh: number) {
  const full = grab(src, sw, sh, FULL);
  const small = grab(full.c, full.w, full.h, SMALL);
  const f = findCard(small.data, small.w, small.h);
  if (!f.ok) return { ok: false as const, message: f.message };
  const quad = scaleQuad(f.quad, full.w / small.w);
  const flat = rectify(full.data, full.w, full.h, quad);
  return { ok: true as const, bits: cardInk(flat, CARD_W, CARD_H), flat, full, quad };
}

function thumbOf(flat: Uint8ClampedArray) {
  const c = document.createElement("canvas"); c.width = CARD_W; c.height = CARD_H;
  c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(flat), CARD_W, CARD_H), 0, 0);
  const t = document.createElement("canvas"); t.width = 200; t.height = 120; t.getContext("2d")!.drawImage(c, 0, 0, 200, 120);
  return t.toDataURL("image/jpeg", 0.7);
}

export function CardCamera({ title, step, steps, hint, needFull = false, once = false, distinct = false, onShot, onClose }: {
  title: string; step?: number; steps?: number; hint?: string;
  /** One good scan is all: stop looking after it (the screen behind closes the camera). */
  once?: boolean;
  /** Setting a card up: each scan must be of the card moved since the last (the camera's next look, not the same frame). */
  distinct?: boolean;
  /** Setting a card up: the drawing must be full enough to be a key (match.ts quality). */
  needFull?: boolean;
  /** Called with each scan. Throw to show why and scan again; return to show the green tick. */
  onShot: (s: CardShot) => Promise<void>;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null), overlay = useRef<HTMLCanvasElement>(null);
  const [cam, setCam] = useState<"starting" | "live" | "none">("starting");
  const [phase, setPhase] = useState<Phase>("seek");
  const [msg, setMsg] = useState("");
  const [found, setFound] = useState(false);
  const last = useRef<Quad | null>(null), still = useRef(0), pause = useRef(0), busy = useRef(false), shotAt = useRef<Quad | null>(null), done = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null, dead = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setCam("none"); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
        if (dead) { stream.getTracks().forEach((t) => t.stop()); return; }
        video.current!.srcObject = stream; await video.current!.play().catch(() => {});
        setCam("live");
      } catch { if (!dead) setCam("none"); }
    })();
    return () => { dead = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, []);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onClose]);

  /** Where a point of the video is on the screen (the video fills the screen, cropped: object-fit cover). */
  const toScreen = useCallback((q: Quad) => {
    const v = video.current!, W = v.clientWidth, H = v.clientHeight, s = Math.max(W / v.videoWidth, H / v.videoHeight);
    const ox = (W - v.videoWidth * s) / 2, oy = (H - v.videoHeight * s) / 2;
    return q.map(([x, y]) => [x * s + ox, y * s + oy]);
  }, []);
  const draw = useCallback((q: Quad | null, colour: string) => {
    const c = overlay.current, v = video.current;
    if (!c || !v) return;
    const dpr = devicePixelRatio || 1, W = v.clientWidth, H = v.clientHeight;
    if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const g = c.getContext("2d")!; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    if (!q) return;
    const p = toScreen(q);
    g.beginPath(); p.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
    g.fillStyle = `${colour}22`; g.fill(); g.lineWidth = 4; g.lineJoin = "round"; g.strokeStyle = colour; g.stroke();
  }, [toScreen]);

  const finish = useCallback(async (read: { bits: Uint8Array; flat: Uint8ClampedArray; full: { c: HTMLCanvasElement; w: number; h: number; data: Uint8ClampedArray }; quad: Quad }, live: boolean) => {
    const q = quality(read.bits);
    if (!q.ok && (needFull || q.reason === "blank" || q.reason === "dark")) { setPhase("bad"); setMsg(q.message); pause.current = Date.now() + 1800; return; }
    setPhase("sending"); setMsg("Checking…");
    try {
      await onShot({ scan: { bits: packBits(read.bits) }, thumb: thumbOf(read.flat) });
      navigator.vibrate?.(40);
      if (once) done.current = true;
      if (live) shotAt.current = last.current;
      setPhase("good"); setMsg(""); pause.current = Date.now() + 1300;
      setTimeout(() => setPhase((p) => (p === "good" ? "seek" : p)), 900);
    } catch (e) {
      navigator.vibrate?.([70, 50, 70]);
      setPhase("bad"); setMsg((e as Error).message); pause.current = Date.now() + 1800;
    }
  }, [needFull, onShot, once]);

  const capture = useCallback(async () => {
    const v = video.current;
    if (!v?.videoWidth || busy.current || done.current) return;
    if (distinct && shotAt.current && last.current && steady(shotAt.current, last.current, 0.05)) { setMsg("Move the card a little, then hold still."); return; }
    busy.current = true; setPhase("reading"); setMsg("Hold still…");
    try {
      const reads: Uint8Array[] = []; let first: ReturnType<typeof readImage> | null = null;
      for (let i = 0; i < 3; i++) {
        const r = readImage(v, v.videoWidth, v.videoHeight);
        if (r.ok) { reads.push(r.bits); first ??= r; }
        if (i < 2) await new Promise((res) => setTimeout(res, 110));
      }
      if (!first?.ok || reads.length < 2) { setPhase("seek"); setMsg("Hold the card still, flat and in good light."); return; }
      await finish({ ...first, bits: vote(reads) }, true);
    } finally { busy.current = false; still.current = 0; }
  }, [finish]);

  // look for the card, a few times a second
  useEffect(() => {
    if (cam !== "live") return;
    const t = setInterval(() => {
      const v = video.current;
      if (!v?.videoWidth || busy.current || done.current) return;
      const small = grab(v, v.videoWidth, v.videoHeight, SMALL);
      const f = findCard(small.data, small.w, small.h);
      if (!f.ok) { setFound(false); draw(null, ""); last.current = null; still.current = 0; if (Date.now() > pause.current) { setPhase("seek"); setMsg(f.message); } return; }
      const q = scaleQuad(f.quad, v.videoWidth / small.w);
      still.current = last.current && steady(last.current, q) ? still.current + 1 : 1;
      last.current = q; setFound(true);
      draw(q, "#2fd47f");
      if (Date.now() < pause.current) return;
      if (distinct && shotAt.current && steady(shotAt.current, q, 0.05)) { still.current = 0; setPhase("seek"); setMsg("Got it. Now move the card a little, then hold still."); return; }
      setPhase("seek"); setMsg(still.current >= 2 ? "Hold still…" : "Card found");
      if (still.current >= STILL) void capture();
    }, 140);
    return () => clearInterval(t);
  }, [cam, draw, capture, distinct]);

  const fromPhoto = async (file: File | undefined) => {
    if (!file || busy.current || done.current) return;
    busy.current = true; setPhase("reading"); setMsg("Reading the photo…");
    try {
      const bmp = await createImageBitmap(file);
      const r = readImage(bmp, bmp.width, bmp.height); bmp.close?.();
      if (!r.ok) { setPhase("bad"); setMsg(r.message); return; }
      await finish(r, false);
    } catch { setPhase("bad"); setMsg("I couldn't read that photo."); }
    finally { busy.current = false; }
  };

  const shutter = () => { if (found) void capture(); else setMsg(msg || "Put the whole card in view first."); };
  const live = cam === "live";
  return (
    <div className={`cc ph-${phase} ${found ? "found" : ""}`} role="dialog" aria-label={title}>
      <video ref={video} playsInline muted aria-hidden className={live ? "" : "off"} />
      <canvas ref={overlay} className="cc-overlay" aria-hidden />
      {!found && live && <div className="cc-guide" aria-hidden><i /><i /><i /><i /></div>}
      {!live && <div className="cc-nocam">{cam === "starting" ? "Opening the camera…" : "The camera isn't available here. Choose a photo of the card instead: the whole card, on something darker, with a little space around it."}</div>}
      <div className="cc-top">
        <button className="cc-x" aria-label="Close" onClick={onClose}>✕</button>
        <div className="cc-title"><b>{title}</b>{steps ? <span className="cc-steps" aria-label={`Scan ${step} of ${steps}`}>{Array.from({ length: steps }, (_, i) => <i key={i} className={i < (step ?? 1) - 1 ? "done" : i === (step ?? 1) - 1 ? "now" : ""} />)}</span> : null}</div>
      </div>
      <div className="cc-bottom">
        <p className="cc-msg" role="status">{msg || hint || (live ? "Hold the card flat, the whole card in view, long side across." : "")}</p>
        {live && <button className="cc-shutter" aria-label="Scan now" disabled={phase === "reading" || phase === "sending"} onClick={shutter}><span /></button>}
        <label className={`cc-photo ${live ? "" : "big"}`}>{live ? "Choose a photo instead" : "Choose or take a photo of the card"}<input type="file" accept="image/*" aria-label="Choose a photo of the card from your photos" onChange={(e) => { void fromPhoto(e.target.files?.[0]); e.target.value = ""; }} /></label>
      </div>
      {phase === "good" && <div className="cc-tick" aria-hidden><svg viewBox="0 0 48 48"><path d="m13 25 7.5 7.5L35 17" /></svg></div>}
    </div>
  );
}
