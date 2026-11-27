// Touch gestures for phones and tablets: drag sheets down to close, swipe the drawer and side panels away, swipe
// from the left edge to go back, swipe task rows, slide along the tab bar. Everything follows the finger, locks to
// one axis after a few pixels (so vertical scrolling and taps keep working), and decides by distance or by speed
// when you let go, then settles with a spring. Touch events (not pointer events) so we can claim a drag that starts
// inside a scrolling area only when it's really ours.

export const SPRING = "cubic-bezier(.32, .72, 0, 1)";          // iOS-like: quick start, long soft settle
export const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
export const isTouch = () => matchMedia("(pointer: coarse)").matches;
export const isStandalone = () => matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

export interface SwipeOpts {
  axis: "x" | "y";
  /** Only these touches may start the gesture (e.g. near an edge, or on a handle). */
  canStart?: (t: Touch, e: TouchEvent) => boolean;
  /** For "y" on a scrolling sheet: only claim a downward drag when this element is scrolled to the top. */
  scroller?: () => HTMLElement | null;
  /** Which way(s) the drag may go: +1 (right/down), -1 (left/up) or 0 (both). Other way is rubber-banded. */
  dir?: 1 | -1 | 0;
  onStart?: () => void;
  onMove: (d: number) => void;
  /** d = distance along the axis, v = px/ms in that direction at release. */
  onEnd: (d: number, v: number) => void;
}

/** Attaches a swipe to `el`. Returns a cleanup function. */
export function swipe(el: HTMLElement, o: SwipeOpts) {
  let sx = 0, sy = 0, state: "idle" | "maybe" | "drag" = "idle";
  let samples: { t: number; p: number }[] = [];
  const along = (t: Touch) => (o.axis === "x" ? t.clientX - sx : t.clientY - sy);
  const shape = (d: number) => {
    // Rubber band past the allowed direction: resistance grows the further you pull.
    if (o.dir && d !== 0 && Math.sign(d) !== o.dir) return Math.sign(d) * Math.pow(Math.abs(d), 0.7) * 0.6;
    return d;
  };
  const start = (e: TouchEvent) => {
    if (e.touches.length !== 1) { state = "idle"; return; }
    const t = e.touches[0];
    if (o.canStart && !o.canStart(t, e)) return;
    sx = t.clientX; sy = t.clientY; state = "maybe"; samples = [{ t: e.timeStamp, p: 0 }];
  };
  const move = (e: TouchEvent) => {
    if (state === "idle") return;
    const t = e.touches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (state === "maybe") {
      if (Math.hypot(dx, dy) < 8) return;
      const mine = o.axis === "x" ? Math.abs(dx) > Math.abs(dy) * 1.2 : Math.abs(dy) > Math.abs(dx) * 1.2;
      const d = o.axis === "x" ? dx : dy;
      const wrongWay = o.dir !== undefined && o.dir !== 0 && Math.sign(d) !== o.dir;
      const sc = o.scroller?.();
      const scrolled = o.axis === "y" && sc && (sc.scrollTop > 0 || (wrongWay && sc.scrollHeight > sc.clientHeight));
      if (!mine || wrongWay || scrolled) { state = "idle"; return; }
      state = "drag"; sx = t.clientX; sy = t.clientY; samples = [{ t: e.timeStamp, p: 0 }];
      o.onStart?.();
    }
    e.preventDefault(); // ours now: don't scroll or select
    const d = along(t);
    samples.push({ t: e.timeStamp, p: d });
    while (samples.length > 2 && e.timeStamp - samples[0].t > 100) samples.shift();
    o.onMove(shape(d));
  };
  const end = (e: TouchEvent) => {
    if (state !== "drag") { state = "idle"; return; }
    state = "idle";
    const last = samples[samples.length - 1], first = samples[0];
    const v = last && first && last.t > first.t ? (last.p - first.p) / (last.t - first.t) : 0;
    const t = e.changedTouches[0];
    o.onEnd(shape(t ? along(t) : last?.p ?? 0), v);
  };
  const cancel = () => { if (state === "drag") o.onEnd(0, 0); state = "idle"; };
  el.addEventListener("touchstart", start, { passive: true });
  el.addEventListener("touchmove", move, { passive: false });
  el.addEventListener("touchend", end);
  el.addEventListener("touchcancel", cancel);
  return () => {
    el.removeEventListener("touchstart", start); el.removeEventListener("touchmove", move);
    el.removeEventListener("touchend", end); el.removeEventListener("touchcancel", cancel);
  };
}

/** Animate an element's transform to `to` (from wherever it is now) with the spring, then call done. */
export function settle(el: HTMLElement, to: string, done?: () => void, ms = 320, extra: Keyframe = {}) {
  const from = el.style.transform || "none";
  if (reduceMotion()) { el.style.transform = to === "none" ? "" : to; done?.(); return; }
  const a = el.animate([{ transform: from }, { transform: to, ...extra }], { duration: ms, easing: SPRING, fill: "forwards" });
  a.onfinish = () => { el.style.transform = to === "none" ? "" : to; a.cancel(); done?.(); };
}

/** Did the gesture go far or fast enough to finish? */
export const committed = (d: number, v: number, size: number, sign: 1 | -1, frac = 0.35) =>
  (d * sign > size * frac && v * sign > -0.2) || (v * sign > 0.55 && d * sign > 24);
