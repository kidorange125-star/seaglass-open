// Handwriting (#45): strokes from an Apple Pencil (or a finger or mouse), kept as data so a drawing can be edited again.
// A drawing in a page is a PNG (what's shown) plus a JSON file of these strokes (what's edited), both uploaded files; the
// image carries data-drawing = the JSON's URL (and alt = "Handwriting: <transcript>", so the assistant, search and MCP
// can read it). Pure apart from perfect-freehand (the smooth outlines): tests/unit/ink.test.mts. The editor is components/Handwriting.tsx.
import { getStroke } from "perfect-freehand";

export type Tool = "pen" | "highlighter";
/** One stroke: points as [x, y, pressure 0..1], in CSS pixels on a page `width` wide. */
export interface Stroke { tool: Tool; color: string; size: number; points: [number, number, number][] }
/** The paper: plain lined (the default), or a Cornell sheet (a top line under the title, a side line between cues and
 *  notes, a bottom line above the summary; lines only, drawn into the picture). */
export type Paper = "lined" | "cornell";
export interface Ink { v: 1; width: number; height: number; strokes: Stroke[]; paper?: Paper; /** the title strokes as last read (titleSig), so an unchanged title isn't read again */ titleSig?: string;
  /** all the strokes as last transcribed (the image's alt), so unchanged writing isn't read again */ textSig?: string }

export const INKS = ["#1f2328", "#2563eb", "#dc2626"];
export const HIGHLIGHT = "#facc15";
/** The pen's three widths (Fine, Medium, Bold; perfect-freehand sizes, see outline), remembered per device (sg.ink.width). */
export const PEN_WIDTHS = { fine: 1.15, medium: 1.6, bold: 2.4 } as const;
export type PenWidth = keyof typeof PEN_WIDTHS;
const LEGACY_PEN = 2.6;
export const PAPER_MIN = 420, PAPER_GROW = 360, MARGIN = 24;
/** A Cornell sheet on lined paper: the title above `top`, the cue column `side` of the width, the summary in the last
 *  `bottom` pixels. Its lines sit on the ruled lines (every LINE pixels), so Snap to lines works across it. It's one
 *  sheet (a letter page's shape, a whole number of lines tall), so it doesn't grow. */
export const CORNELL = { top: 96, side: 0.3, bottom: 192, ratio: 1.3 };
export const cornellHeight = (width: number) => Math.ceil(Math.max(PAPER_MIN + CORNELL.top + CORNELL.bottom, width * CORNELL.ratio) / 32) * 32;

/** The paper's own lines: a Cornell sheet's three (on screen the ruled lines are the page's CSS); with `ruled`, the
 *  ruled lines too (the saved picture of a Cornell sheet). Lined paper's picture is just the writing. */
export function drawPaper(ctx: CanvasRenderingContext2D, paper: Paper | undefined, w: number, h: number, ruled = false) {
  if (paper !== "cornell") return;
  ctx.save();
  if (ruled) {
    ctx.strokeStyle = "rgba(37, 99, 235, 0.16)"; ctx.lineWidth = 1; ctx.beginPath();
    for (let y = 31.5; y < h; y += 32) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
  }
  const top = CORNELL.top, side = Math.round(w * CORNELL.side), bottom = h - CORNELL.bottom;
  ctx.strokeStyle = "#8f959c"; ctx.lineWidth = 1.5; ctx.beginPath();
  ctx.moveTo(0, top); ctx.lineTo(w, top);
  ctx.moveTo(side, top); ctx.lineTo(side, bottom);
  ctx.moveTo(0, bottom); ctx.lineTo(w, bottom);
  ctx.stroke(); ctx.restore();
}

/** The strokes written above a Cornell sheet's top line: its title. */
export const titleStrokes = (strokes: Stroke[]) => strokes.filter((s) => s.points.length && s.points.filter((p) => p[1] < CORNELL.top).length > s.points.length / 2);

/** How wide the line is at a point: pen follows pressure (a mouse or finger reports 0.5), the highlighter doesn't. */
export const widthAt = (s: Pick<Stroke, "tool" | "size">, pressure: number) => (s.tool === "highlighter" ? s.size : s.size * (0.45 + 1.1 * Math.min(1, Math.max(0, pressure || 0.5))));

/** Points closer than `min` pixels to the last kept one add nothing but size. */
export function thin(points: [number, number, number][], min = 1.2): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const p of points) {
    const l = out[out.length - 1];
    if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) >= min) out.push([Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10, Math.round(p[2] * 100) / 100]);
  }
  const last = points[points.length - 1];
  if (last && out.length && out[out.length - 1] !== last && (out[out.length - 1][0] !== Math.round(last[0] * 10) / 10 || out[out.length - 1][1] !== Math.round(last[1] * 10) / 10)) out.push([Math.round(last[0] * 10) / 10, Math.round(last[1] * 10) / 10, Math.round(last[2] * 100) / 100]);
  return out;
}

/** The eraser: every stroke that passes within `r` pixels of (x, y) goes. */
export function eraseAt(strokes: Stroke[], x: number, y: number, r = 12): Stroke[] {
  const near = (s: Stroke) => s.points.some((p, i) => {
    if (Math.hypot(p[0] - x, p[1] - y) <= r + widthAt(s, p[2]) / 2) return true;
    const q = s.points[i + 1];
    if (!q) return false;
    const dx = q[0] - p[0], dy = q[1] - p[1], len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((x - p[0]) * dx + (y - p[1]) * dy) / len)) : 0;
    return Math.hypot(p[0] + t * dx - x, p[1] + t * dy - y) <= r + widthAt(s, p[2]) / 2;
  });
  return strokes.filter((s) => !near(s));
}

/** The area the strokes cover. */
export function bounds(strokes: Stroke[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) for (const p of s.points) { const w = widthAt(s, p[2]) / 2; x0 = Math.min(x0, p[0] - w); y0 = Math.min(y0, p[1] - w); x1 = Math.max(x1, p[0] + w); y1 = Math.max(y1, p[1] + w); }
  return strokes.length && Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

/** The paper's height: the writing plus a margin, never less than PAPER_MIN. */
export const paperHeight = (strokes: Stroke[]) => Math.max(PAPER_MIN, Math.ceil((bounds(strokes)?.y1 ?? 0) + MARGIN));

/** A saved drawing, checked: real strokes only. Null if it isn't one. */
export function parseInk(raw: unknown): Ink | null {
  const r = raw as Partial<Ink> | null;
  if (!r || r.v !== 1 || !Array.isArray(r.strokes) || typeof r.width !== "number") return null;
  const strokes = r.strokes.filter((s): s is Stroke => !!s && (s.tool === "pen" || s.tool === "highlighter") && typeof s.color === "string" && /^#[0-9a-f]{6}$/i.test(s.color)
    && typeof s.size === "number" && Array.isArray(s.points) && s.points.every((p) => Array.isArray(p) && p.length === 3 && p.every((n) => typeof n === "number" && Number.isFinite(n))));
  return { v: 1, width: r.width, height: typeof r.height === "number" ? r.height : paperHeight(strokes), strokes, ...(r.paper === "cornell" ? { paper: "cornell" as const } : {}), ...(typeof r.titleSig === "string" ? { titleSig: r.titleSig.slice(0, 64) } : {}), ...(typeof r.textSig === "string" ? { textSig: r.textSig.slice(0, 64) } : {}) };
}

/** A stroke's outline as one smooth, filled shape (perfect-freehand): the pen's width follows the Pencil's pressure and
 *  tapers naturally, the line is smoothed and gently streamlined; a finger or mouse (no real pressure) gets a simulated
 *  one; the highlighter is an even band. `live` is the stroke still being drawn (its end isn't finished yet). */
export function outline(s: Stroke, live = false): number[][] {
  const hl = s.tool === "highlighter";
  const real = s.points.some((p) => p[2] !== 0.5);
  // perfect-freehand's size is a RADIUS at full pressure, so a pen's line is about 1.3x its size at a normal press.
  // Pens written before the width choice (size 2.6, drawn far too thick) are drawn at today's medium.
  const size = hl ? s.size : s.size === LEGACY_PEN ? PEN_WIDTHS.medium : s.size;
  return getStroke(s.points, {
    size,
    thinning: hl ? 0 : 0.5,
    smoothing: 0.6,
    streamline: hl ? 0.5 : 0.28,
    easing: (t) => Math.sin((t * Math.PI) / 2),
    simulatePressure: !hl && !real,
    last: !live,
    start: { taper: 0, cap: true }, end: { taper: 0, cap: true },
  });
}

/** The outline as a closed path, curved through its midpoints. */
function pathOf(pts: number[][]): Path2D {
  const path = new Path2D();
  if (!pts.length) return path;
  path.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; path.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2); }
  const [lx, ly] = pts[pts.length - 1], [fx, fy] = pts[0];
  path.quadraticCurveTo(lx, ly, (lx + fx) / 2, (ly + fy) / 2);
  path.closePath();
  return path;
}

/** Draws one stroke (smooth, see outline). */
export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, live = false) {
  if (!s.points.length) return;
  ctx.save();
  ctx.fillStyle = s.color;
  if (s.tool === "highlighter") { ctx.globalAlpha = 0.35; ctx.globalCompositeOperation = "multiply"; }
  ctx.fill(pathOf(outline(s, live)));
  ctx.restore();
}

/** Draws strokes on a canvas. */
export function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[]) {
  for (const s of strokes) drawStroke(ctx, s);
}

/** The lined paper's spacing (notion.css .ink-paper draws a line every LINE pixels). */
export const LINE = 32;

/**
 * Snap to lines: a word or line of handwriting, straightened onto the nearest ruled line and resized to fit it.
 * Its baseline (most writing sits on it; descenders like g and y go below) lands just above the line, and the part
 * above the baseline is scaled to about two thirds of a line (a third of its size at least, nearly twice at most). The left edge
 * stays put. Returns null for something that isn't a line of writing: a dot, a highlighter mark, or a drawing taller
 * than about two lines.
 */
export function snapToLines(group: Stroke[], line = LINE): Stroke[] | null {
  if (!group.length || group.some((s) => s.tool !== "pen")) return null;
  const b = bounds(group);
  if (!b || b.y1 - b.y0 > line * 2.4) return null;
  const ys = group.flatMap((s) => s.points.map((p) => p[1])).sort((x, y) => x - y);
  const top = ys[0], base = ys[Math.min(ys.length - 1, Math.floor(ys.length * 0.85))];
  const body = base - top;
  if (body < 4) return null;
  const k = Math.max(0.3, Math.min(1.8, (line * 0.68) / body));
  const target = Math.max(1, Math.round(base / line)) * line - 3;
  const x0 = Math.min(...group.flatMap((s) => s.points.map((p) => p[0])));
  const r = (n: number) => Math.round(n * 10) / 10;
  return group.map((s) => ({ ...s, points: s.points.map(([x, y, pr]) => [r(x0 + (x - x0) * k), r(target + (y - base) * k), pr] as [number, number, number]) }));
}

/** The page's title, written by hand: on a Cornell sheet everything above the top line; on lined paper the first line
 *  of writing (pen strokes that start within a line and a half of the topmost one). */
export function titleFor(paper: Paper | undefined, strokes: Stroke[]): Stroke[] {
  if (paper === "cornell") return titleStrokes(strokes);
  const pens = strokes.filter((s) => s.tool === "pen" && s.points.length);
  if (!pens.length) return [];
  const top = Math.min(...pens.map((s) => Math.min(...s.points.map((p) => p[1]))));
  return pens.filter((s) => Math.min(...s.points.map((p) => p[1])) < top + LINE * 1.5);
}

/** A short fingerprint of some strokes: the same writing gives the same one. */
export function strokesSig(strokes: Stroke[]): string {
  let h = 0x811c9dc5;
  for (const s of strokes) for (const p of s.points) for (const n of [Math.round(p[0]), Math.round(p[1])]) { h ^= n & 0xffff; h = Math.imul(h, 0x01000193); }
  return strokes.length ? `${strokes.length}:${(h >>> 0).toString(36)}` : "";
}
