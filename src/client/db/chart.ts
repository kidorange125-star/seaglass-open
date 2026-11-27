// Chart view for databases (#24): grades over time, tasks per status, anything with a date or a choice on one side and a
// number (or a count) on the other. Pure: rows in, points out; db/ChartView.tsx draws them.
import { dateStart, getValue, optionOf, type DbCtx } from "./logic.ts";
import type { ChartCfg, DbSchema, Note, Prop } from "../types";
export type { ChartCfg };
export interface Point { x: string; label: string; y: number; n: number }
export interface Series { key: string; name: string; color: string; points: Point[] }
export interface ChartData { kind: "line" | "bar"; byDate: boolean; xs: { x: string; label: string }[]; series: Series[]; min: number; max: number; percent: boolean; empty: boolean }

const isX = (p: Prop) => ["date", "created_time", "last_edited_time", "select", "status", "title", "text"].includes(p.type);
const isY = (p: Prop) => ["number", "formula", "rollup"].includes(p.type);
const isSeries = (p: Prop) => ["select", "status"].includes(p.type);
export const chartProps = (s: DbSchema) => ({ x: s.properties.filter(isX), y: s.properties.filter(isY), series: s.properties.filter(isSeries) });
const isDate = (p?: Prop) => !!p && ["date", "created_time", "last_edited_time"].includes(p.type);

/** A sensible first chart for a database: over time when it has a date, else by its first choice property. */
export function defaultChart(s: DbSchema): ChartCfg {
  const { x, y, series } = chartProps(s);
  const date = x.find((p) => p.type === "date"), choice = series[0];
  const yp = y.find((p) => /percent|%/i.test(p.name)) ?? y.find((p) => p.type === "number" && !/out of|weight/i.test(p.name)) ?? y[0];
  const xp = date ?? choice ?? x[0];
  const sp = date ? series.find((p) => /class|subject|course/i.test(p.name)) ?? series.find((p) => p.type === "select") : undefined;
  return { kind: isDate(xp) ? "line" : "bar", x: xp?.id ?? "title", y: yp?.id ?? "count", agg: "avg", ...(sp ? { series: sp.id } : {}) };
}

const num = (v: unknown) => { const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN; return Number.isFinite(n) ? n : NaN; };
const fmtShort = (iso: string) => { const d = new Date(`${iso}T00:00:00`); return isNaN(+d) ? iso : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }); };

export function chartData(rows: Note[], schema: DbSchema, cfg: ChartCfg, ctx: DbCtx): ChartData {
  const P = (id?: string) => schema.properties.find((p) => p.id === id);
  const xp = P(cfg.x), yp = cfg.y === "count" ? undefined : P(cfg.y), ofp = cfg.of ? P(cfg.of) : undefined, sp = cfg.series ? P(cfg.series) : undefined;
  const byDate = isDate(xp);
  const cells = new Map<string, { sum: number; n: number }>(); // series \u0000 x
  const xLabel = new Map<string, string>(), seen = new Set<string>();
  for (const r of rows) {
    if (r.is_template || !xp) continue;
    const xv = getValue(r, xp, ctx);
    let x = "", label = "";
    if (byDate) { x = dateStart(xv); label = x ? fmtShort(x) : ""; }
    else if (xp.type === "select" || xp.type === "status") { const o = optionOf(xp, xv); x = o?.id ?? ""; label = o?.name ?? ""; }
    else { x = String(xv ?? "").trim(); label = x; }
    if (!x) continue;
    let y = 1;
    if (cfg.y !== "count") {
      if (!yp) continue;
      y = num(getValue(r, yp, ctx));
      if (ofp) { const d = num(getValue(r, ofp, ctx)); y = d > 0 ? (y / d) * 100 : NaN; }
      if (!Number.isFinite(y)) continue;
    }
    const s = sp ? String(getValue(r, sp, ctx) ?? "") : "";
    const k = `${s}\u0000${x}`, c = cells.get(k) ?? { sum: 0, n: 0 };
    c.sum += y; c.n++; cells.set(k, c);
    xLabel.set(x, label); seen.add(s);
  }
  const order = (byDate || !xp?.options) ? [...xLabel.keys()].sort() : [...(xp.options ?? []).map((o) => o.id).filter((id) => xLabel.has(id)), ...[...xLabel.keys()].filter((k) => !xp.options!.some((o) => o.id === k)).sort()];
  const xs = order.map((x) => ({ x, label: xLabel.get(x)! }));
  const keys = sp?.options ? [...sp.options.map((o) => o.id).filter((id) => seen.has(id)), ...(seen.has("") ? [""] : [])] : [...seen];
  const series: Series[] = keys.map((key, i) => {
    const o = sp ? optionOf(sp, key) : undefined;
    const points = xs.flatMap(({ x, label }) => {
      const c = cells.get(`${key}\u0000${x}`);
      if (!c) return [];
      const y = cfg.y === "count" ? c.n : cfg.agg === "sum" ? c.sum : c.sum / c.n;
      return [{ x, label, y: Math.round(y * 100) / 100, n: c.n }];
    });
    return { key, name: sp ? o?.name ?? "None" : yp?.name ?? "Count", color: o?.color ?? ["blue", "orange", "green", "purple", "red", "pink", "brown", "yellow", "gray"][i % 9], points };
  });
  const ys = series.flatMap((s) => s.points.map((p) => p.y));
  const percent = !!ofp || /percent|%/i.test(yp?.name ?? "") || yp?.number_format === "percent";
  const hi = ys.length ? Math.max(...ys) : 1, lo = ys.length ? Math.min(...ys) : 0;
  const max = percent && hi <= 100 ? 100 : niceTop(hi);
  const min = lo >= 0 ? 0 : -niceTop(-lo);
  return { kind: cfg.kind, byDate, xs, series, min, max, percent, empty: !ys.length };
}

/** A round number at or above n (1, 2, 2.5, 5 times a power of ten). */
export function niceTop(n: number) {
  if (!(n > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(n));
  return ([1, 2, 2.5, 5, 10].find((m) => m * p >= n) ?? 10) * p;
}
