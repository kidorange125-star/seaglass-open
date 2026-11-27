// Synthetic hand-drawn cards and "photos" of them (a card held a little differently, lit unevenly, with noise), for the Paper Lock
// tests. A card is a few strokes and a loop; a photo is 500 x 300 RGBA pixels of its face; a scene is a phone photo of it.

// a small seeded random generator so a failure can be repeated
export const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

export type Pt = [number, number];
export type Card = { strokes: Pt[][]; ink: [number, number, number] };

/** A card: some strokes (lines, scribbles, a loop) all over a 500 x 300 card. */
export function drawCard(seed: number, strokes = 9): Card {
  const r = rng(seed);
  const out: Pt[][] = [];
  for (let s = 0; s < strokes; s++) {
    const pts: Pt[] = [];
    let x = 30 + r() * 440, y = 20 + r() * 260;
    const n = 3 + Math.floor(r() * 5);
    for (let i = 0; i < n; i++) { pts.push([x, y]); x = Math.min(480, Math.max(20, x + (r() - 0.5) * 220)); y = Math.min(280, Math.max(20, y + (r() - 0.5) * 140)); }
    out.push(pts);
  }
  const cx = 80 + r() * 340, cy = 60 + r() * 180, rad = 25 + r() * 40, loop: Pt[] = [];
  for (let a = 0; a <= 6.4; a += 0.4) loop.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad * 0.8]);
  out.push(loop);
  const inks: [number, number, number][] = [[20, 20, 30], [20, 40, 140], [160, 30, 30], [20, 100, 50]];
  return { strokes: out, ink: inks[Math.floor(r() * inks.length)] };
}

/** One photo of a card: held at a slightly different angle, size and place, lit unevenly, with sensor noise. 500 x 300 RGBA. */
export function photo(card: Card, seed: number, o: { turn?: number; zoom?: number; shift?: number; noise?: number; shade?: number } = {}) {
  const r = rng(seed), W = 500, H = 300;
  const turn = ((o.turn ?? 4) * (r() * 2 - 1) * Math.PI) / 180, zoom = 1 + (o.zoom ?? 0.04) * (r() * 2 - 1);
  const sx = (o.shift ?? 0.02) * W * (r() * 2 - 1), sy = (o.shift ?? 0.02) * H * (r() * 2 - 1);
  const cos = Math.cos(turn), sin = Math.sin(turn), width = 5 + r() * 2;
  const mask = new Float32Array(W * H);
  const dot = (x: number, y: number) => {
    const rad = width / 2;
    for (let yy = Math.floor(y - rad); yy <= Math.ceil(y + rad); yy++) for (let xx = Math.floor(x - rad); xx <= Math.ceil(x + rad); xx++) {
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      if ((xx - x) ** 2 + (yy - y) ** 2 <= rad * rad) mask[yy * W + xx] = 1;
    }
  };
  const map = ([x, y]: Pt): Pt => { const dx = x - W / 2, dy = y - H / 2; return [(cos * dx - sin * dy) * zoom + W / 2 + sx, (sin * dx + cos * dy) * zoom + H / 2 + sy]; };
  for (const s of card.strokes) {
    for (let i = 0; i + 1 < s.length; i++) {
      const [x0, y0] = map(s[i]), [x1, y1] = map(s[i + 1]), len = Math.hypot(x1 - x0, y1 - y0), steps = Math.ceil(len / 1.5);
      for (let k = 0; k <= steps; k++) dot(x0 + ((x1 - x0) * k) / steps, y0 + ((y1 - y0) * k) / steps);
    }
  }
  const lightA = 0.82 + r() * 0.18, lightB = (r() - 0.5) * 0.3 * (o.shade ?? 1), noise = o.noise ?? 5;
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const light = lightA + lightB * (x / W - 0.5) + (o.shade === 0 ? 0 : 0.08 * Math.sin((y / H) * 3));
    const i = (y * W + x) * 4, m = mask[y * W + x];
    for (let c = 0; c < 3; c++) px[i + c] = (240 * (1 - m) + card.ink[c] * m) * light + (r() - 0.5) * 2 * noise;
    px[i + 3] = 255;
  }
  return { px, W, H };
}



// ---- scenes: a card lying on a darker surface, photographed from an angle (for scan.ts and match.ts)

/** The same drawing drawn again by hand: every point moved by up to `amount` of the card's width (3 to 8% is someone
 *  copying the motif from memory). */
export function redraw(card: Card, seed: number, amount: number): Card {
  const r = rng(seed), d = 500 * amount;
  return { ...card, strokes: card.strokes.map((s) => { const ox = (r() * 2 - 1) * d, oy = (r() * 2 - 1) * d; return s.map(([x, y]): Pt => [x + ox + (r() * 2 - 1) * d * 0.4, y + oy + (r() * 2 - 1) * d * 0.4]); }) };
}

/** A card covered all over (what Paper Lock now asks for): strokes in every part of it. */
export function fullCard(seed: number): Card {
  const r = rng(seed), out: Pt[][] = [];
  for (let gy = 0; gy < 3; gy++) for (let gx = 0; gx < 4; gx++) {
    const x0 = 25 + gx * 115, y0 = 22 + gy * 88, pts: Pt[] = [];
    for (let i = 0; i < 4; i++) pts.push([x0 + r() * 105, y0 + r() * 80]);
    out.push(pts);
  }
  const loop: Pt[] = [], cx = 150 + r() * 200, cy = 100 + r() * 100, rad = 40 + r() * 30;
  for (let a = 0; a <= 6.4; a += 0.35) loop.push([cx + Math.cos(a) * rad * 1.3, cy + Math.sin(a) * rad]);
  out.push(loop);
  return { strokes: out, ink: ([[20, 20, 30], [20, 40, 140], [30, 110, 190]] as [number, number, number][])[Math.floor(r() * 3)] };
}

export type ScenePt = [number, number];
function invert3(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}
function homographyTo(q: ScenePt[], W: number, H: number): number[] {
  const src: ScenePt[] = [[0, 0], [W, 0], [W, H], [0, H]], A: number[][] = [];
  for (let k = 0; k < 4; k++) { const [u, v] = src[k], [x, y] = q[k]; A.push([u, v, 1, 0, 0, 0, -u * x, -v * x, x]); A.push([0, 0, 0, u, v, 1, -u * y, -v * y, y]); }
  for (let c = 0; c < 8; c++) { let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r; [A[c], A[p]] = [A[p], A[c]]; for (let r = 0; r < 8; r++) { if (r === c) continue; const f = A[r][c] / A[c][c]; for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k]; } }
  return [...Array.from({ length: 8 }, (_, i) => A[i][8] / A[i][i]), 1];
}

/** A phone photo (FW x FH, portrait by default) of the card on a dark textured surface: turned up to `turn` degrees,
 *  filling `fill` of the width, tilted (perspective), lit unevenly. Returns the pixels and the card's true corners. */
export function scene(card: Card, seed: number, o: { W?: number; H?: number; turn?: number; fill?: number; tilt?: number; bg?: number; extra?: "overlap" | "edge" | "portrait" } = {}) {
  const r = rng(seed * 7 + 3), FW = o.W ?? 480, FH = o.H ?? 640;
  const face = photo(card, seed, { turn: 0, zoom: 0, shift: 0, noise: 3, shade: 0.6 }); // the card's face, flat
  const fill = (o.fill ?? 0.7) * (0.92 + r() * 0.16), cw = FW * fill, ch = (cw * 3) / 5;
  const t = (((o.turn ?? 12) * (r() * 2 - 1)) * Math.PI) / 180, tilt = (o.tilt ?? 0.06) * FW;
  const cx = FW / 2 + (r() - 0.5) * FW * 0.08, cy = FH / 2 + (r() - 0.5) * FH * 0.08;
  let corners: ScenePt[] = [[-cw / 2, -ch / 2], [cw / 2, -ch / 2], [cw / 2, ch / 2], [-cw / 2, ch / 2]];
  if (o.extra === "portrait") corners = [[-ch / 2, -cw / 2], [ch / 2, -cw / 2], [ch / 2, cw / 2], [-ch / 2, cw / 2]];
  corners = corners.map(([x, y], k): ScenePt => [cx + Math.cos(t) * x - Math.sin(t) * y + (k < 2 ? (k ? -1 : 1) * tilt * r() * 0.5 : 0), cy + Math.sin(t) * x + Math.cos(t) * y]);
  if (o.extra === "edge") corners = corners.map(([x, y]): ScenePt => [x - FW * 0.3, y]);
  const toCard = invert3(homographyTo(corners, face.W, face.H));
  const second = o.extra === "overlap" ? invert3(homographyTo(corners.map(([x, y]): ScenePt => [x + cw * 0.15, y + ch * 0.55]), face.W, face.H)) : null;
  const bg = o.bg ?? 55, px = new Uint8ClampedArray(FW * FH * 4);
  const sample = (m: number[], x: number, y: number) => {
    const d = m[6] * x + m[7] * y + m[8], u = (m[0] * x + m[1] * y + m[2]) / d, v = (m[3] * x + m[4] * y + m[5]) / d;
    if (u < 0 || v < 0 || u >= face.W - 1 || v >= face.H - 1) return null;
    return (Math.floor(v) * face.W + Math.floor(u)) * 4;
  };
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
    const o4 = (y * FW + x) * 4, light = 0.85 + 0.25 * (x / FW) - 0.1 * (y / FH);
    let at = sample(toCard, x, y);
    if (at === null && second) at = sample(second, x, y);
    if (at !== null) for (let c = 0; c < 3; c++) px[o4 + c] = face.px[at + c] * light;
    else { const tex = bg + 18 * Math.sin(x * 0.9 + y * 0.31) + (r() - 0.5) * 16; px[o4] = tex; px[o4 + 1] = tex; px[o4 + 2] = tex + 4; }
    px[o4 + 3] = 255;
  }
  return { px, W: FW, H: FH, corners };
}

// ---- a scan as the phone sends it: { bits }, the card found, straightened and read
import { findCard as _find, rectify as _rect, CARD_W as _CW, CARD_H as _CH } from "../../src/client/paper/scan.ts";
import { cardInk as _ink, packBits as _packBits } from "../../src/client/paper/match.ts";

export function scanOf(s: { px: Uint8ClampedArray; W: number; H: number }) {
  const f = _find(s.px, s.W, s.H);
  if (!f.ok) throw new Error(`no card: ${f.message}`);
  const bits = _packBits(_ink(_rect(s.px, s.W, s.H, f.quad), _CW, _CH));
  return { bits };
}
