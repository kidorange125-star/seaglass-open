// Waffle: The user's cyan four-point star with two slanted eyes, animated in the style of the Grok Bot icon (studied from
// its designer's demo clip; everything here is original code, no Grok assets). It's a character driven by springs:
//   idle   gentle sway and breathing, blinks (sometimes double), glances, an occasional happy squint
//   think  the "wait" look: Waffle shrinks into the middle of three pulsing dots, glancing about
//   tool   the "work" look: thin rainbow comets race round Waffle on tilted 3D rings (behind and in front of it), the
//          rings slowly precess, and Waffle tumbles with its eyes sliding across its face as if it turned in 3D
//   then   when a job ends the comets shrink to streaks and fly off, and Waffle answers with happy ^ ^ eyes and a bounce
// One requestAnimationFrame loop per Waffle writes straight to the SVG (no React re-render per frame); springs are
// stepped at 120 Hz. With reduced motion Waffle stays still.
import { useEffect, useRef } from "react";

export type WaffleMode = "idle" | "think" | "tool";
export const WAFFLE_STAR = "M0.832 0.380 Q0.175 0.394 -0.274 0.872 Q-0.383 0.999 -0.380 0.832 Q-0.394 0.175 -0.872 -0.274 Q-0.999 -0.383 -0.832 -0.380 Q-0.175 -0.394 0.274 -0.872 Q0.383 -0.999 0.380 -0.832 Q0.394 -0.175 0.872 0.274 Q0.999 0.383 0.832 0.380 Z"; // rounded points are part of the outline (Safari flattens a round stroke join at sharp tips)
const CYAN = "#0EBFDF";
const EYE_AT: [number, number][] = [[-0.17, -0.23], [0.035, -0.125]]; // from the user's drawing
const EYE_TILT = 36;
const RAINBOW = ["#F2546B", "#F5953D", "#E9D24A", "#5CCF78", "#38C6C6", "#4C8BF5", "#8C5BEA", "#E35BCF"];
const SVGNS = "http://www.w3.org/2000/svg";
const VIEW = 2; // half-width of the drawing in star units; the star itself is about 1.1 across from its centre

// ---------------------------------------------------------------- springs
interface Spring { x: number; v: number; t: number }
const sp = (x: number): Spring => ({ x, v: 0, t: x });
function step(s: Spring, w: number, z: number, dt: number) { s.v += (w * w * (s.t - s.x) - 2 * z * w * s.v) * dt; s.x += s.v * dt; }
const rand = (a: number, b: number) => a + Math.random() * (b - a);

// ---------------------------------------------------------------- eyes
type Eye = { w: number; h: number; bend: number };
const E = (w: number, h: number, bend = 0): Eye => ({ w, h, bend });
const EXPR: Record<string, [Eye, Eye]> = {
  neutral: [E(0.15, 0.41), E(0.15, 0.41)],
  wide: [E(0.17, 0.46), E(0.17, 0.46)],
  happy: [E(0.2, 0.08, -0.11), E(0.2, 0.08, -0.11)], // ^ ^
  squint: [E(0.17, 0.2), E(0.17, 0.2)],
  focus: [E(0.16, 0.28), E(0.16, 0.28)],
  wink: [E(0.15, 0.41), E(0.2, 0.05)],
  ponder: [E(0.16, 0.3), E(0.15, 0.4)],
};
function eyePath(e: Eye, open: number, squeeze: number) {
  const n = 26, h = Math.max(0.018, e.h * open), w = Math.max(0.03, e.w * squeeze);
  let d = "";
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, x = (w / 2) * Math.cos(a), k = x / (w / 2);
    const y = (h / 2) * Math.sin(a) + e.bend * (1 - k * k);
    d += `${i ? "L" : "M"}${x.toFixed(4)} ${y.toFixed(4)}`;
  }
  return d + "Z";
}

// ---------------------------------------------------------------- comets (the "work" orbit)
const SEGS = 14;
interface Comet { color: string; r: number; tilt: number; turn: number; spinRate: number; speed: number; a: number; len: number; grow: Spring; seg: [SVGLineElement, SVGLineElement][] }

const reduceMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Waffle({ size = 24, mode = "idle", className = "" }: { size?: number; mode?: WaffleMode; className?: string }) {
  const body = useRef<SVGGElement>(null);
  const eyes = useRef<SVGGElement>(null);
  const eyeEls = [useRef<SVGPathElement>(null), useRef<SVGPathElement>(null)];
  const back = useRef<SVGGElement>(null);
  const front = useRef<SVGGElement>(null);
  const dots = useRef<SVGGElement>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const orbits = size >= 24; // tiny Waffles (tool steps, buttons) keep the comets out of the text around them

  useEffect(() => {
    if (reduceMotion()) { eyeEls.forEach((r, i) => r.current?.setAttribute("d", eyePath(EXPR.neutral[i], 1, 1))); return; }
    const tilt = sp(0), x = sp(0), y = sp(0), sx = sp(1), sy = sp(1), spin = sp(0), shrink = sp(1), flip = sp(0);
    const gx = sp(0), gy = sp(0), open = sp(1), dotsOn = sp(0);
    const eye = [0, 1].map((i) => ({ w: sp(EXPR.neutral[i].w), h: sp(EXPR.neutral[i].h), bend: sp(0) }));
    const setExpr = (name: string) => { const p = EXPR[name]; eye.forEach((e, i) => { e.w.t = p[i].w; e.h.t = p[i].h; e.bend.t = p[i].bend; }); expr = name; };
    let expr = "neutral";
    let t = 0, last = performance.now(), raf = 0, lastMode: WaffleMode = modeRef.current;
    let nextExpr = rand(5, 10), nextGlance = rand(1, 3), nextBlink = rand(1.5, 4), blinkUntil = -1, doubleBlink = false, revertAt = -1;
    let nextFlip = 1.5, nextSpin = rand(3, 5);

    // comets, built once (only drawn while working)
    const comets: Comet[] = [];
    if (orbits && back.current && front.current) {
      for (let k = 0; k < 7; k++) {
        const seg: [SVGLineElement, SVGLineElement][] = [];
        for (let s = 0; s < SEGS; s++) {
          const mk = (g: SVGGElement) => { const l = document.createElementNS(SVGNS, "line"); l.setAttribute("stroke", RAINBOW[k % RAINBOW.length]); l.setAttribute("stroke-linecap", "round"); l.setAttribute("opacity", "0"); g.appendChild(l); return l; };
          seg.push([mk(back.current), mk(front.current)]);
        }
        comets.push({ color: RAINBOW[k], r: rand(1.22, 1.5), tilt: rand(0.9, 1.45) * (Math.random() < 0.5 ? -1 : 1), turn: (k / 7) * Math.PI + rand(-0.2, 0.2),
          spinRate: rand(-0.35, 0.35), speed: rand(3, 4.8) * (Math.random() < 0.25 ? -1 : 1), a: rand(0, 6.28), len: rand(1.7, 2.6), grow: sp(0), seg });
      }
    }
    // a point on comet c's ring at angle a: a circle tilted about x, then turned about the view axis (precessing)
    const ring = (c: Comet, a: number) => {
      const px = c.r * Math.cos(a), py = c.r * Math.sin(a);
      const y1 = py * Math.cos(c.tilt), z = py * Math.sin(c.tilt);
      const ct = Math.cos(c.turn), st = Math.sin(c.turn);
      const s = 1 / (1 - z * 0.12); // a touch of perspective
      return [(px * ct - y1 * st) * s, (px * st + y1 * ct) * s, z] as const;
    };

    const tick = (now: number) => {
      let dt = Math.min(0.1, (now - last) / 1000); last = now;
      const frame = dt, m = modeRef.current;
      if (m !== lastMode) {
        // finishing a job gets the "response": happy eyes and a springy bounce
        if (lastMode === "tool" && m !== "tool") { setExpr("happy"); revertAt = t + 0.95; sx.v -= 3; sy.v += 3.5; spin.t = Math.round(spin.x / 360) * 360; }
        else { sx.v += 2; sy.v -= 2; setExpr(m === "tool" ? "focus" : m === "think" ? "ponder" : "neutral"); }
        if (m === "tool") { comets.forEach((c, i) => { c.grow.x = 0; c.grow.v = 0; c.a = rand(0, 6.28); c.grow.t = 0; (c as Comet & { at?: number }).at = t + i * 0.12; }); nextFlip = t + 0.6; nextSpin = t + rand(2.5, 4); }
        lastMode = m; nextExpr = t + rand(1.5, 3);
      }

      // ---- expressions, glances, blinks
      if (revertAt > 0 && t > revertAt) { revertAt = -1; setExpr("neutral"); blinkUntil = t + 0.09; }
      if (t > nextExpr && revertAt < 0) {
        if (m === "idle") { const pick = ["happy", "wide", "wink"][Math.floor(Math.random() * 3)]; setExpr(pick); revertAt = t + rand(1, 1.8); nextExpr = t + rand(8, 15); }
        else if (m === "think") { setExpr(["ponder", "squint", "neutral"][Math.floor(Math.random() * 3)]); nextExpr = t + rand(1.6, 3); }
        else { setExpr(["focus", "focus", "wide"][Math.floor(Math.random() * 3)]); nextExpr = t + rand(1.4, 2.6); }
      }
      if (t > nextGlance && m !== "tool") {
        const r = m === "think" ? 0.06 : 0.045, a = Math.random() * Math.PI * 2;
        gx.t = r * Math.cos(a); gy.t = r * Math.sin(a) - (m === "think" ? 0.02 : 0);
        if (m === "idle" && Math.random() < 0.35) { gx.t = 0; gy.t = 0; }
        nextGlance = t + (m === "think" ? rand(1, 2.2) : rand(2.5, 6));
      }
      if (t > nextBlink && expr !== "happy") { blinkUntil = t + 0.09; doubleBlink = Math.random() < 0.2; nextBlink = t + rand(2.2, 5.5); }
      if (blinkUntil > 0) { open.t = t < blinkUntil ? 0.05 : 1; if (t >= blinkUntil) { blinkUntil = -1; if (doubleBlink) { doubleBlink = false; blinkUntil = t + 0.17; } } }

      // ---- body targets per mood
      if (m === "idle") {
        tilt.t = 3.5 * Math.sin(0.5 * t) + 1.5 * Math.sin(0.17 * t); x.t = 0.02 * Math.sin(0.27 * t); y.t = 0.035 * Math.sin(0.85 * t);
        sx.t = 1 + 0.012 * Math.sin(0.85 * t); sy.t = 1 - 0.008 * Math.sin(0.85 * t); shrink.t = 1; dotsOn.t = 0; flip.t = 0;
      } else if (m === "think") {
        tilt.t = -6 + 4 * Math.sin(0.9 * t); x.t = 0; y.t = 0.02 * Math.sin(1.6 * t); sx.t = 1; sy.t = 1; shrink.t = 0.48; dotsOn.t = 1; flip.t = 0;
      } else {
        const beat = Math.max(0, Math.sin(t * Math.PI * 2.4));
        tilt.t = 4 * Math.sin(t * 1.7); x.t = 0; y.t = -0.04 * beat; sx.t = 1 + 0.035 * beat; sy.t = 1 - 0.04 * beat; shrink.t = 0.86; dotsOn.t = 0;
        // tumbling: the face turns away and back, so the eyes slide across it and foreshorten
        if (t > nextFlip) { flip.t = flip.t === 0 ? rand(0.55, 0.8) * (Math.random() < 0.5 ? -1 : 1) : 0; nextFlip = t + rand(0.9, 1.6); }
        if (t > nextSpin) { spin.t += 360 * (Math.random() < 0.5 ? -1 : 1); nextSpin = t + rand(3, 5); }
      }

      // ---- physics
      while (dt > 0) {
        const h = Math.min(dt, 1 / 120); dt -= h; t += h;
        step(tilt, 5, 0.9, h); step(x, 3.5, 1, h); step(y, 4, 1, h); step(sx, 10, 0.5, h); step(sy, 10, 0.5, h); step(shrink, 9, 0.62, h);
        step(spin, 5.5, 0.55, h); step(flip, 7, 0.7, h); step(gx, 13, 0.9, h); step(gy, 13, 0.9, h); step(open, 30, 1, h); step(dotsOn, 10, 1, h);
        for (const e of eye) { step(e.w, 12, 0.72, h); step(e.h, 12, 0.72, h); step(e.bend, 12, 0.72, h); }
        for (const c of comets) step(c.grow, 7, 1, h);
      }

      // ---- draw the body
      const turnAway = Math.sin(flip.x * 1.6); // -1..1, how far the face has turned
      const fx = 1 - 0.32 * Math.abs(turnAway);
      body.current?.setAttribute("transform", `translate(${x.x.toFixed(4)} ${y.x.toFixed(4)}) rotate(${(tilt.x + spin.x).toFixed(2)}) scale(${(sx.x * shrink.x * fx).toFixed(4)} ${(sy.x * shrink.x).toFixed(4)})`);
      eyes.current?.setAttribute("transform", `translate(${(gx.x + 0.28 * turnAway).toFixed(4)} ${gy.x.toFixed(4)})`);
      eyeEls.forEach((r, i) => r.current?.setAttribute("d", eyePath({ w: eye[i].w.x, h: eye[i].h.x, bend: eye[i].bend.x }, open.x, 1 - 0.45 * Math.abs(turnAway))));

      // ---- the waiting dots: Waffle in the middle, a dot either side, pulsing in turn
      if (dots.current) {
        dots.current.setAttribute("opacity", Math.max(0, Math.min(1, dotsOn.x)).toFixed(3));
        Array.from(dots.current.children).forEach((c, i) => {
          const pulse = 0.5 + 0.5 * Math.sin(t * 5.5 - (i === 0 ? 0 : 2 * 0.9) * 1.0 - i * 0.9);
          (c as SVGCircleElement).setAttribute("r", ((0.17 + 0.07 * pulse) * Math.max(0, dotsOn.x)).toFixed(4));
          (c as SVGCircleElement).setAttribute("cx", ((i === 0 ? -1 : 1) * 0.82 * Math.max(0.3, dotsOn.x)).toFixed(4));
        });
      }

      // ---- the comets
      const working = m === "tool";
      for (const c of comets as (Comet & { at?: number })[]) {
        c.grow.t = working && t > (c.at ?? 0) ? 1 : 0;
        const g = c.grow.x;
        c.a += frame * c.speed * (working ? 1 : 1.8); // when the job ends they speed up as they fade
        c.turn += frame * c.spinRate;
        const L = c.len * Math.max(0, g) * (working ? 1 : 0.6);
        let px = 0, py = 0;
        for (let s = 0; s <= SEGS; s++) {
          const a = c.a - Math.sign(c.speed) * (L * s) / SEGS;
          const [qx, qy, qz] = ring(c, a);
          if (s > 0) {
            const k = s - 1, [bl, fl] = c.seg[k];
            const width = (0.06 * (1 - k / SEGS) + 0.01) * Math.min(1, g * 1.4);
            const op = Math.max(0, Math.min(1, g * 1.6)) * (1 - (k / SEGS) * 0.75);
            const inFront = qz > 0;
            for (const [el, show] of [[fl, inFront], [bl, !inFront]] as const) {
              if (!show || width < 0.004) { el.setAttribute("opacity", "0"); continue; }
              el.setAttribute("x1", px.toFixed(3)); el.setAttribute("y1", py.toFixed(3)); el.setAttribute("x2", qx.toFixed(3)); el.setAttribute("y2", qy.toFixed(3));
              el.setAttribute("stroke-width", width.toFixed(3)); el.setAttribute("opacity", op.toFixed(3));
            }
          }
          px = qx; py = qy;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); comets.forEach((c) => c.seg.forEach(([a, b]) => { a.remove(); b.remove(); })); };
  }, [orbits]); // eslint-disable-line react-hooks/exhaustive-deps

  const canvas = Math.round((size * VIEW) / 1.2);
  return (
    <span className={`waffle waffle-${mode} ${className}`} style={{ width: size, height: size }} aria-hidden>
      {/* Always drawn on a padded canvas centred on the box: Safari clips an SVG to its own box, so tips, squash and spins
          (and the comets) need the room inside the drawing itself. */}
      <svg viewBox={`${-VIEW} ${-VIEW} ${VIEW * 2} ${VIEW * 2}`} width={canvas} height={canvas} className="waffle-wide" style={{ left: (size - canvas) / 2, top: (size - canvas) / 2 }}>
        {/* An invisible frame filling the whole drawing: iPad/iPhone Safari sizes its paint area from what's drawn, and
            without this, points that sway or spin past the first frame's outline get cut off with straight edges. */}
        <rect x={-VIEW} y={-VIEW} width={VIEW * 2} height={VIEW * 2} fill="#000" fillOpacity="0" pointerEvents="none" />
        <g ref={back} />
        <g ref={dots} opacity="0">
          <circle cx="-0.82" cy="0" r="0" fill={CYAN} />
          <circle cx="0.82" cy="0" r="0" fill={CYAN} />
        </g>
        <g ref={body}>
          <path d={WAFFLE_STAR} fill={CYAN} />
          <g ref={eyes}>
            {EYE_AT.map(([cx, cy], i) => (
              <g key={i} transform={`translate(${cx} ${cy}) rotate(${EYE_TILT})`}>
                <path ref={eyeEls[i]} d={eyePath(EXPR.neutral[i], 1, 1)} fill="#000" />
              </g>
            ))}
          </g>
        </g>
        <g ref={front} />
      </svg>
    </span>
  );
}
