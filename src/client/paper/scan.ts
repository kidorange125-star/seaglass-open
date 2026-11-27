// Paper Lock, finding the card in a camera frame or photo and straightening it. Pure (no DOM), tested in
// tests/unit/paper-scan.test.mts.
//
// The card is the white thing: the frame's darkest colour channel (white paper is bright in all three, a blue or black
// pen and most tables are not) is split into bright and dark with Otsu's threshold, and the largest bright region is the
// card. Its four corners are the region's extreme points (top-left is where x + y is smallest, and so on), which holds
// for a card turned up to about 30 degrees. Then a homography maps those corners onto a flat 5:3 card, so the drawing is
// read in the card's own coordinates whatever the angle, distance or tilt of the phone. A frame where no single
// card-shaped white region can be found (two overlapping cards, a card cut off by the edge, a white table) is refused
// rather than guessed at.

export type Pt = [number, number];
export type Quad = [Pt, Pt, Pt, Pt]; // top-left, top-right, bottom-right, bottom-left
export type Found =
  | { ok: true; quad: Quad }
  | { ok: false; reason: "none" | "small" | "edge" | "shape" | "sideways"; message: string };

export const CARD_W = 500, CARD_H = 300; // a straightened card (5:3, an index card)

const MESSAGES = {
  none: "I can't see a white card. Put it on something darker, in good light.",
  small: "Bring the phone closer so the card fills the outline.",
  edge: "Fit the whole card inside the screen, with a little space around it.",
  shape: "Show one card at a time, flat, not touching anything white.",
  sideways: "Turn the card sideways, long side across.",
} as const;
const no = (reason: keyof typeof MESSAGES): Found => ({ ok: false, reason, message: MESSAGES[reason] });

function otsu(hist: Uint32Array, total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, t = 127;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; t = i; }
  }
  return t;
}

const area = (q: Quad) => Math.abs(q.reduce((s, p, i) => { const n = q[(i + 1) % 4]; return s + p[0] * n[1] - n[0] * p[1]; }, 0)) / 2;
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Finds the card in an RGBA image (best at 300 to 500 pixels across). */
export function findCard(rgba: ArrayLike<number>, w: number, h: number): Found {
  const n = w * h, plane = new Uint8Array(n), hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) { const v = Math.min(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]); plane[i] = v; hist[v]++; }
  const t = otsu(hist, n);
  let bright = 0, bSum = 0, dSum = 0;
  for (let i = 0; i < n; i++) if (plane[i] > t) { bright++; bSum += plane[i]; } else dSum += plane[i];
  if (!bright || bright === n) return no("none");
  if (bSum / bright < 120 || bSum / bright - dSum / (n - bright) < 45) return no("none");

  // the largest bright region (4-connected)
  const label = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  let best = -1, bestArea = 0;
  for (let s = 0, id = 0; s < n; s++) {
    if (plane[s] <= t || label[s] !== -1) continue;
    let top = 0, count = 0; stack[top++] = s; label[s] = id;
    while (top) {
      const p = stack[--top]; count++;
      const x = p % w, y = (p - x) / w;
      if (x > 0 && plane[p - 1] > t && label[p - 1] === -1) { label[p - 1] = id; stack[top++] = p - 1; }
      if (x < w - 1 && plane[p + 1] > t && label[p + 1] === -1) { label[p + 1] = id; stack[top++] = p + 1; }
      if (y > 0 && plane[p - w] > t && label[p - w] === -1) { label[p - w] = id; stack[top++] = p - w; }
      if (y < h - 1 && plane[p + w] > t && label[p + w] === -1) { label[p + w] = id; stack[top++] = p + w; }
    }
    if (count > bestArea) { bestArea = count; best = id; }
    id++;
  }
  if (bestArea < n * 0.06) return no("small");

  // the card with its drawing: everything the outside can't reach without crossing the card (fills in the ink)
  const outside = new Uint8Array(n);
  let top = 0;
  const push = (p: number) => { if (!outside[p] && label[p] !== best) { outside[p] = 1; stack[top++] = p; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (top) {
    const p = stack[--top], x = p % w, y = (p - x) / w;
    if (x > 0) push(p - 1); if (x < w - 1) push(p + 1); if (y > 0) push(p - w); if (y < h - 1) push(p + w);
  }
  let inside = 0, edge = 0;
  let tl: Pt = [0, 0], tr: Pt = [0, 0], br: Pt = [0, 0], bl: Pt = [0, 0];
  let mTL = Infinity, mTR = -Infinity, mBR = -Infinity, mBL = -Infinity;
  for (let p = 0; p < n; p++) {
    if (outside[p]) continue;
    inside++;
    const x = p % w, y = (p - x) / w;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge++;
    if (x + y < mTL) { mTL = x + y; tl = [x, y]; }
    if (x + y > mBR) { mBR = x + y; br = [x + 1, y + 1]; }
    if (x - y > mTR) { mTR = x - y; tr = [x + 1, y]; }
    if (y - x > mBL) { mBL = y - x; bl = [x, y + 1]; }
  }
  if (edge > (w + h) * 0.01) return no("edge");
  const quad: Quad = refine([tl, tr, br, bl], outside, w, h);
  const qa = area(quad);
  if (qa < n * 0.06) return no("small");
  // a card is nearly all of its four-cornered outline; two overlapping cards, or a card and a white thing, are not
  if (inside / qa < 0.9 || inside / qa > 1.08) return no("shape");
  const across = (dist(tl, tr) + dist(bl, br)) / 2, down = (dist(tl, bl) + dist(tr, br)) / 2;
  const aspect = across / down;
  if (aspect < 0.85 && aspect > 0.45) return no("sideways");
  if (aspect < 1.3 || aspect > 2.15) return no("shape");
  return { ok: true, quad };
}

/** Sharper corners (auto-align). The extreme points land on a pixel and a slightly rounded or frayed corner, so each
 *  side is instead fitted as a straight line through every pixel along that edge (its middle 70%, away from the corners),
 *  and the corners are where neighbouring sides cross: hundreds of pixels per side put a corner within a fraction of a
 *  pixel. If a fit looks wrong (a crossing far from the rough corner), the rough corner is kept. */
export function refine(rough: Quad, outside: Uint8Array, w: number, h: number): Quad {
  const sides: number[][][] = [[], [], [], []]; // pixels on each side (top, right, bottom, left)
  const seg = rough.map((a, i) => { const b = rough[(i + 1) % 4], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1; return { a, dx, dy, len }; });
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const p = y * w + x;
    if (outside[p] || !(outside[p - 1] || outside[p + 1] || outside[p - w] || outside[p + w])) continue; // the card's own edge
    let best = -1, bd = Infinity;
    for (let i = 0; i < 4; i++) {
      const { a, dx, dy, len } = seg[i], t = ((x + 0.5 - a[0]) * dx + (y + 0.5 - a[1]) * dy) / (len * len);
      if (t < 0.15 || t > 0.85) continue;
      const d = Math.abs((x + 0.5 - a[0]) * dy - (y + 0.5 - a[1]) * dx) / len;
      if (d < bd) { bd = d; best = i; }
    }
    if (best >= 0 && bd < Math.max(3, seg[best].len * 0.04)) sides[best].push([x + 0.5, y + 0.5]);
  }
  // each side as a line: a point on it and its direction (the main axis of its pixels)
  const lines = sides.map((pts) => {
    if (pts.length < 12) return null;
    let mx = 0, my = 0; for (const [x, y] of pts) { mx += x; my += y; } mx /= pts.length; my /= pts.length;
    let sxx = 0, syy = 0, sxy = 0; for (const [x, y] of pts) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    return { mx, my, ux: Math.cos(ang), uy: Math.sin(ang) };
  });
  const width = Math.hypot(rough[1][0] - rough[0][0], rough[1][1] - rough[0][1]);
  return rough.map((c, i) => {
    const l1 = lines[(i + 3) % 4], l2 = lines[i]; // the corner between the previous side and this one
    if (!l1 || !l2) return c;
    const det = l1.ux * l2.uy - l1.uy * l2.ux;
    if (Math.abs(det) < 0.2) return c;
    const t = ((l2.mx - l1.mx) * l2.uy - (l2.my - l1.my) * l2.ux) / det;
    const p: Pt = [l1.mx + t * l1.ux, l1.my + t * l1.uy];
    return Math.hypot(p[0] - c[0], p[1] - c[1]) < width * 0.05 ? p : c;
  }) as Quad;
}

/** The homography taking the flat card (0,0)-(W,H) to the quad, as a 3x3 matrix (row major, last element 1). */
export function homography(quad: Quad, W: number, H: number): number[] {
  const src: Pt[] = [[0, 0], [W, 0], [W, H], [0, H]];
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = src[i], [x, y] = quad[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x, x]);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y, y]);
  }
  for (let c = 0; c < 8; c++) { // Gaussian elimination with partial pivoting
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  return [...Array.from({ length: 8 }, (_, i) => A[i][8] / A[i][i]), 1];
}

/** The card straightened: CARD_W x CARD_H RGBA of the inside of the quad (an inset keeps the card's own edge out). */
export function rectify(rgba: ArrayLike<number>, w: number, h: number, quad: Quad, inset = 0.035): Uint8ClampedArray {
  const m = homography(quad, CARD_W, CARD_H), out = new Uint8ClampedArray(CARD_W * CARD_H * 4);
  const u0 = CARD_W * inset, v0 = CARD_H * inset * (5 / 3), su = (CARD_W - 2 * u0) / CARD_W, sv = (CARD_H - 2 * v0) / CARD_H;
  for (let y = 0; y < CARD_H; y++) for (let x = 0; x < CARD_W; x++) {
    const u = u0 + x * su, v = v0 + y * sv;
    const d = m[6] * u + m[7] * v + 1, sx = (m[0] * u + m[1] * v + m[2]) / d, sy = (m[3] * u + m[4] * v + m[5]) / d;
    const x0 = Math.max(0, Math.min(w - 2, Math.floor(sx))), y0 = Math.max(0, Math.min(h - 2, Math.floor(sy))), fx = Math.min(1, Math.max(0, sx - x0)), fy = Math.min(1, Math.max(0, sy - y0));
    const o = (y * CARD_W + x) * 4;
    for (let c = 0; c < 3; c++) {
      const a = rgba[(y0 * w + x0) * 4 + c], b = rgba[(y0 * w + x0 + 1) * 4 + c], cc = rgba[((y0 + 1) * w + x0) * 4 + c], dd = rgba[((y0 + 1) * w + x0 + 1) * 4 + c];
      out[o + c] = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + cc * (1 - fx) * fy + dd * fx * fy;
    }
    out[o + 3] = 255;
  }
  return out;
}

/** A 5:3 rectangle [x, y, w, h] around a found card, `margin` larger than it (for reading version 1 cards, which were
 *  framed by hand: the card filling the old guide). Kept inside the image. */
export function cardBox(q: Quad, w: number, h: number, margin: number): [number, number, number, number] {
  const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  let bw = Math.max(Math.max(...xs) - Math.min(...xs), ((Math.max(...ys) - Math.min(...ys)) * 5) / 3) * (1 + margin);
  bw = Math.min(bw, w, (h * 5) / 3);
  const bh = (bw * 3) / 5, x = Math.min(Math.max(0, cx - bw / 2), w - bw), y = Math.min(Math.max(0, cy - bh / 2), h - bh);
  return [Math.round(x), Math.round(y), Math.round(bw), Math.round(bh)];
}

/** Scales a quad found in a smaller copy of an image back to the full image. */
export const scaleQuad = (q: Quad, k: number): Quad => q.map(([x, y]) => [x * k, y * k]) as Quad;

/** Whether two quads (the same card in two frames) are within `tol` of the card's width of each other: holding still. */
export function steady(a: Quad, b: Quad, tol = 0.02): boolean {
  const width = dist(a[0], a[1]) || 1;
  return a.every((p, i) => dist(p, b[i]) / width < tol);
}
