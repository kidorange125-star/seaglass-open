// The chart view (#24): a line over time or bars by choice, from db/chart.ts. Plain SVG drawn at the real width (so text
// stays readable on a phone), 2px lines with ringed markers, rounded bar tops, a recessive grid, a legend for two or more
// series, and a tooltip on hover or tap. Colours follow each option's own colour, so a class keeps its colour.
import { useEffect, useMemo, useRef, useState } from "react";
import type { VP } from "./views";
import { chartData, defaultChart, type ChartData } from "./chart";

const H = 260, PAD = { l: 40, r: 14, t: 12, b: 34 };
const col = (c: string) => `var(--c-${c}, var(--c-blue))`;
const fmt = (n: number, pct: boolean) => `${Math.round(n * 10) / 10}${pct ? "%" : ""}`;

export function ChartView({ rows, schema, view, ctx }: VP) {
  const cfg = view.chart ?? defaultChart(schema);
  const d = useMemo(() => chartData(rows, schema, cfg, ctx), [rows, schema, cfg, ctx]);
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(260, el.clientWidth)));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  if (d.empty) return <div className="chart-empty muted">Nothing to chart yet. Charts need rows with {cfg.y === "count" ? "a value" : "a number"} and {d.byDate ? "a date" : "a choice"}. Change what it shows in the view's settings (click the view's tab).</div>;
  return (
    <div className="chart-wrap" ref={box}>
      {d.series.length > 1 && (
        <div className="chart-legend" aria-label="Legend">
          {d.series.map((s) => <span key={s.key}><i style={{ background: col(s.color) }} />{s.name}</span>)}
        </div>
      )}
      <Plot d={d} w={w} hover={hover} setHover={setHover} />
    </div>
  );
}

function Plot({ d, w, hover, setHover }: { d: ChartData; w: number; hover: number | null; setHover: (i: number | null) => void }) {
  const iw = w - PAD.l - PAD.r, ih = H - PAD.t - PAD.b, n = d.xs.length;
  const y = (v: number) => PAD.t + ih - ((v - d.min) / (d.max - d.min || 1)) * ih;
  const band = iw / Math.max(1, n);
  const xLine = (i: number) => PAD.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const xMid = (i: number) => PAD.l + band * i + band / 2;
  const at = d.kind === "line" ? xLine : xMid;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => d.min + (d.max - d.min) * f);
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 70))));
  const idx = new Map(d.xs.map((x, i) => [x.x, i]));
  const pick = (clientX: number, el: SVGSVGElement) => {
    const px = clientX - el.getBoundingClientRect().left;
    let best = 0, dist = Infinity;
    for (let i = 0; i < n; i++) { const dd = Math.abs(at(i) - px); if (dd < dist) { dist = dd; best = i; } }
    setHover(best);
  };
  const tip = hover === null ? null : d.xs[hover];
  const rowsAt = tip ? d.series.flatMap((s) => { const p = s.points.find((q) => q.x === tip.x); return p ? [{ s, p }] : []; }) : [];
  const bw = Math.max(3, Math.min(36, (band * 0.72) / Math.max(1, d.series.length) - 2));
  return (
    <div className="chart-plot">
      <svg width={w} height={H} role="img" aria-label={`Chart of ${d.series.map((s) => s.name).join(", ")}`}
        onMouseMove={(e) => pick(e.clientX, e.currentTarget)} onMouseLeave={() => setHover(null)} onClick={(e) => pick(e.clientX, e.currentTarget)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={w - PAD.r} y1={y(t)} y2={y(t)} className={t === d.min ? "ch-base" : "ch-grid"} />
            <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" className="ch-tick">{fmt(t, d.percent)}</text>
          </g>
        ))}
        {/* the first and last date labels sit inside the plot instead of hanging off its edges */}
        {d.xs.map((x, i) => i % every === 0 && <text key={x.x} x={at(i)} y={H - 12} textAnchor={d.kind === "line" && n > 1 && i === 0 ? "start" : d.kind === "line" && n > 1 && i === n - 1 ? "end" : "middle"} className="ch-tick">{x.label.length > 12 ? `${x.label.slice(0, 11)}…` : x.label}</text>)}
        {hover !== null && d.kind === "line" && <line x1={at(hover)} x2={at(hover)} y1={PAD.t} y2={PAD.t + ih} className="ch-cross" />}
        {d.kind === "line" ? d.series.map((s) => (
          <g key={s.key} style={{ color: col(s.color) }}>
            <polyline fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" points={s.points.map((p) => `${at(idx.get(p.x)!)},${y(p.y)}`).join(" ")} />
            {s.points.map((p) => <circle key={p.x} cx={at(idx.get(p.x)!)} cy={y(p.y)} r={hover === idx.get(p.x) ? 5 : 4} fill="currentColor" className="ch-dot" />)}
          </g>
        )) : d.series.map((s, si) => (
          <g key={s.key} style={{ color: col(s.color) }}>
            {s.points.map((p) => {
              const i = idx.get(p.x)!, x0 = xMid(i) - (d.series.length * (bw + 2)) / 2 + si * (bw + 2) + 1, top = y(p.y), base = y(Math.max(d.min, 0));
              const h = Math.max(0, base - top), r = Math.min(4, bw / 2, h);
              return <path key={p.x} fill="currentColor" opacity={hover === null || hover === i ? 1 : 0.55} d={`M${x0},${base} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + bw - r} Q${x0 + bw},${top} ${x0 + bw},${top + r} V${base} Z`} />;
            })}
          </g>
        ))}
      </svg>
      {tip && rowsAt.length > 0 && (
        <div className="chart-tip" style={{ left: Math.min(Math.max(at(hover!) - 80, 0), w - 170) }} role="status">
          <b>{tip.label}</b>
          {rowsAt.map(({ s, p }) => <span key={s.key}><i style={{ background: col(s.color) }} />{d.series.length > 1 ? `${s.name}: ` : ""}{fmt(p.y, d.percent)}{p.n > 1 ? <small> ({p.n} rows)</small> : null}</span>)}
        </div>
      )}
    </div>
  );
}
