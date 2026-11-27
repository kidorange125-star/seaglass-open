// The end of setup: rings of sea-glass dots around the logo, a wave of light running round them, and a small bubble that
// orbits the ring showing each thing being set up ("Your first page", "Waffle"...). It runs for at least the length of the
// list and until the setup work is done, then says "You're all set" and opens the app. Reduced motion: no wave or orbit.
import { useEffect, useMemo, useRef, useState } from "react";
import { Logo } from "../icons";
import { Waffle } from "../waffle";

export type FinishItem = { id: string; label: string; icon: string };

// a sea-glass spectrum around the ring: teal, aqua, sky, lavender, sand, sea green
const STOPS = ["#3f8e86", "#5fb7c6", "#7aa7e0", "#a99be0", "#e3b98c", "#8fcaae", "#3f8e86"];
function mix(t: number) {
  const n = STOPS.length - 1, i = Math.min(n - 1, Math.floor(t * n)), f = t * n - i;
  const a = STOPS[i].match(/\w\w/g)!.map((h) => parseInt(h, 16)), b = STOPS[i + 1].match(/\w\w/g)!.map((h) => parseInt(h, 16));
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(",")})`;
}

const STEP_MS = 1150;

export function FinishRing({ items, work, onDone }: { items: FinishItem[]; work: Promise<string | null> | null; onDone: (result: string | null) => void }) {
  const [i, setI] = useState(0);
  const [done, setDone] = useState(false);
  const result = useRef<string | null>(null);
  const still = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // dots: three rings, each dot coloured by its angle, with an animation delay by angle so the wave runs round
  const dots = useMemo(() => {
    const out: { x: number; y: number; r: number; c: string; d: number }[] = [];
    [{ R: 118, n: 34, r: 5.2 }, { R: 140, n: 40, r: 6.4 }, { R: 162, n: 46, r: 7.2 }].forEach(({ R, n, r }, ring) => {
      for (let k = 0; k < n; k++) {
        const t = k / n, a = t * Math.PI * 2 - Math.PI / 2 + ring * 0.09;
        out.push({ x: 180 + R * Math.cos(a), y: 180 + R * Math.sin(a), r: r * (0.75 + 0.25 * Math.sin(k * 2.3 + ring)), c: mix(t), d: t });
      }
    });
    return out;
  }, []);

  useEffect(() => {
    let alive = true;
    const minEnd = Date.now() + items.length * STEP_MS;
    const tick = setInterval(() => setI((x) => Math.min(items.length - 1, x + 1)), STEP_MS);
    void (async () => {
      try { result.current = work ? await work : null; } catch { result.current = null; }
      await new Promise((r) => setTimeout(r, Math.max(0, minEnd - Date.now())));
      if (!alive) return;
      clearInterval(tick); setI(items.length - 1); setDone(true);
      setTimeout(() => alive && onDone(result.current), still ? 600 : 1500);
    })();
    return () => { alive = false; clearInterval(tick); };
  }, [work]); // eslint-disable-line react-hooks/exhaustive-deps

  const item = items[i];
  const angle = (i / Math.max(1, items.length)) * 360 + 135; // the bubble moves round the ring as items change
  return (
    <div className={`fr ${done ? "done" : ""} ${still ? "still" : ""}`} role="status" aria-live="polite">
      <div className="fr-stage">
        <svg className="fr-dots" viewBox="0 0 360 360" aria-hidden>
          {dots.map((p, k) => <circle key={k} cx={p.x} cy={p.y} r={p.r} fill={p.c} style={{ animationDelay: `${-p.d * 2.4}s` }} />)}
        </svg>
        <div className="fr-center"><Logo size={92} /></div>
        <div className="fr-orbit" style={{ transform: `rotate(${angle}deg)` }} aria-hidden>
          <div className="fr-bubble" style={{ transform: `rotate(${-angle}deg)` }} key={item.id}>
            {done ? <span className="fr-check">✓</span> : item.icon === "waffle" ? <Waffle size={34} /> : item.icon === "logo" ? <Logo size={34} /> : <span className="fr-emo">{item.icon}</span>}
          </div>
        </div>
      </div>
      <h1 className="fr-title">{done ? "You're all set" : "Setting up your Seaglass"}</h1>
      <p className="fr-sub" key={done ? "done" : item.id}>{done ? "Opening your notes…" : item.label}</p>
    </div>
  );
}
