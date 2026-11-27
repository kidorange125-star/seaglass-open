// Paper Lock, version 2 matching: does a straightened card (paper/scan.ts) carry the same drawing as the card that was set
// up? Pure, used by the phone (to check a scan is readable) and by the Worker (to decide). Tests: tests/unit/paper.test.mts.
//
// The card is read as a 200 x 120 grid of ink / no ink (each cell is half a percent of the card's width). Two drawings are
// the same when nearly every inked cell of each has ink of the other within TOL cells (1% of the card's width), checked
// both ways and over only a little slack (a cell or two of shift, a degree of turn, 2% of size), because the card has
// already been straightened by its corners. A drawing that is merely similar (the same three waves drawn again) puts its
// strokes a few percent away and fails. A scan must agree with at least two of the three scans made when the card was set up.

export const GW = 200, GH = 120, GN = GW * GH;
export const TOL = 2;            // cells (1% of the card's width)
export const MATCH = 0.8;        // share of strokes that must line up, both ways
export const ENROLL = 0.86;      // the three setup scans must agree at least this well with each other
const SHIFTS = [-2, -1, 0, 1, 2];  // the corners are found to within about 1% of the width
const TURNS = [-1.2, 0, 1.2];    // degrees
const SIZES = [0.98, 1, 1.02];

/** The ink of a straightened card (RGBA, any size, normally scan.ts CARD_W x CARD_H) as GW x GH cells, 1 = ink. */
export function cardInk(rgba: ArrayLike<number>, w: number, h: number): Uint8Array {
  // the darkest channel, against the paper around it (a box of about a tenth of the card), so light and pen colour don't matter
  const plane = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) plane[i] = Math.min(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
  const r = Math.max(4, Math.round(w / 20)), bg = boxBlur(plane, w, h, r);
  const dark = new Float32Array(GN), cnt = new Float32Array(GN);
  for (let y = 0; y < h; y++) {
    const gy = Math.min(GH - 1, Math.floor((y * GH) / h));
    for (let x = 0; x < w; x++) {
      const i = y * w + x, d = (bg[i] - plane[i]) / Math.max(bg[i], 40);
      const g = gy * GW + Math.min(GW - 1, Math.floor((x * GW) / w));
      dark[g] += d > 0.16 ? 1 : 0; cnt[g]++;
    }
  }
  const bits = new Uint8Array(GN);
  for (let i = 0; i < GN; i++) bits[i] = cnt[i] && dark[i] / cnt[i] >= 0.34 ? 1 : 0;
  // specks with no inked neighbour (dust, a glint) aren't drawing
  const out = new Uint8Array(GN);
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const i = y * GW + x; if (!bits[i]) continue;
    let nb = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if ((dx || dy) && xx >= 0 && yy >= 0 && xx < GW && yy < GH) nb += bits[yy * GW + xx]; }
    if (nb >= 2) out[i] = 1;
  }
  // the outer rim: where a card's edge, its shadow or the table shows if the corners were found a little off
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (x < RIM || y < RIM || x >= GW - RIM || y >= GH - RIM) out[y * GW + x] = 0;
  return out;
}
const RIM = 3;

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = -r; x <= r; x++) s += src[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) { tmp[y * w + x] = s / (2 * r + 1); s += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)]; }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) { out[y * w + x] = s / (2 * r + 1); s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; }
  }
  return out;
}

/** Several reads of one card (frames a moment apart) into one: a cell is ink when most reads say so. */
export function vote(reads: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(GN), need = Math.floor(reads.length / 2) + 1;
  for (let i = 0; i < GN; i++) { let s = 0; for (const r of reads) s += r[i]; out[i] = s >= need ? 1 : 0; }
  return out;
}

export type Quality = { ok: true } | { ok: false; reason: "blank" | "dark"; message: string };

/** Whether a scan can be read at all: some drawing, and not a dark photo. There's no rule about how much is drawn: what
 *  protects a card is that strokes must land within 1% of the card's width of where they were, which a few confident
 *  curves pass only with the card in hand (The user's three simple cards score 0.13 to 0.38 against each other, 0.8 opens). */
export function quality(bits: Uint8Array): Quality {
  let ink = 0;
  for (let i = 0; i < GN; i++) ink += bits[i];
  const share = ink / GN;
  if (share < 0.004) return { ok: false, reason: "blank", message: "I can't see a drawing on the card. Use a dark pen, in good light." };
  if (share > 0.35) return { ok: false, reason: "dark", message: "That's too dark to read. Use a white card and more light." };
  return { ok: true };
}

/** Distance (in cells, capped) from every cell to the nearest ink: two passes of a 3-4 chamfer. */
function distances(bits: Uint8Array): Uint8Array {
  const INF = 255, d = new Uint16Array(GN);
  for (let i = 0; i < GN; i++) d[i] = bits[i] ? 0 : INF * 3;
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const i = y * GW + x; let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + 3);
    if (y > 0) { v = Math.min(v, d[i - GW] + 3); if (x > 0) v = Math.min(v, d[i - GW - 1] + 4); if (x < GW - 1) v = Math.min(v, d[i - GW + 1] + 4); }
    d[i] = v;
  }
  for (let y = GH - 1; y >= 0; y--) for (let x = GW - 1; x >= 0; x--) {
    const i = y * GW + x; let v = d[i];
    if (x < GW - 1) v = Math.min(v, d[i + 1] + 3);
    if (y < GH - 1) { v = Math.min(v, d[i + GW] + 3); if (x < GW - 1) v = Math.min(v, d[i + GW + 1] + 4); if (x > 0) v = Math.min(v, d[i + GW - 1] + 4); }
    d[i] = v;
  }
  const out = new Uint8Array(GN);
  for (let i = 0; i < GN; i++) out[i] = Math.min(255, Math.round(d[i] / 3));
  return out;
}

const points = (bits: Uint8Array) => { const p: number[] = []; for (let i = 0; i < GN; i++) if (bits[i]) p.push(i % GW, (i / GW) | 0); return p; };

/** How alike two drawings are, 0 to 1: the smaller of the share of A's ink near B's and of B's near A's, at the best of
 *  a few small alignments. The alignments are searched with a quarter of the ink, then the best is measured with all of it,
 *  which keeps a comparison to a few milliseconds (the Worker does up to three per scan). */
export function score(a: Uint8Array, b: Uint8Array): number {
  const pa = points(a), pb = points(b);
  if (!pa.length || !pb.length) return 0;
  const da = distances(a), db = distances(b), cx = GW / 2, cy = GH / 2;
  const near = (pts: number[], dist: Uint8Array, m: number[], step: number) => {
    let hit = 0, n = 0;
    for (let i = 0; i < pts.length; i += 2 * step) {
      const x = pts[i] - cx, y = pts[i + 1] - cy;
      const tx = Math.round(m[0] * x + m[1] * y + m[2] + cx), ty = Math.round(m[3] * x + m[4] * y + m[5] + cy);
      n++;
      if (tx >= 0 && ty >= 0 && tx < GW && ty < GH && dist[ty * GW + tx] <= TOL) hit++;
    }
    return n ? hit / n : 0;
  };
  let best = -1, at: number[][] = [];
  for (const deg of TURNS) for (const s of SIZES) {
    const t = (deg * Math.PI) / 180, c = Math.cos(t) * s, sn = Math.sin(t) * s, k = 1 / (s * s);
    for (const dy of SHIFTS) for (const dx of SHIFTS) {
      // A moved onto B, and B moved back onto A with the inverse
      const fwd = [c, -sn, dx, sn, c, dy];
      const inv = [c * k, sn * k, -(c * dx + sn * dy) * k, -sn * k, c * k, -(-sn * dx + c * dy) * k];
      const ab = near(pa, db, fwd, 4);
      if (ab <= best) continue;
      const v = Math.min(ab, near(pb, da, inv, 4));
      if (v > best) { best = v; at = [fwd, inv]; }
    }
  }
  return best < 0 ? 0 : Math.min(near(pa, db, at[0], 1), near(pb, da, at[1], 1));
}

/** Whether a scan is the card set up with these scans: it must agree with at least two of them. */
export function matchesCard(scan: Uint8Array, setup: Uint8Array[]): boolean {
  const need = Math.min(2, setup.length);
  let yes = 0, left = setup.length;
  for (const e of setup) { if (score(scan, e) >= MATCH) yes++; left--; if (yes >= need) return true; if (yes + left < need) return false; }
  return false;
}

// ---- how a read travels: one bit a cell, base64

export function packBits(bits: Uint8Array): string {
  let s = "";
  for (let i = 0; i < GN; i += 8) { let b = 0; for (let k = 0; k < 8; k++) b |= (bits[i + k] ? 1 : 0) << k; s += String.fromCharCode(b); }
  return btoa(s);
}
export function unpackBits(b64: unknown): Uint8Array | null {
  if (typeof b64 !== "string" || b64.length > 6000) return null;
  let s: string;
  try { s = atob(b64); } catch { return null; }
  if (s.length !== GN / 8) return null;
  const out = new Uint8Array(GN);
  for (let i = 0; i < GN; i++) out[i] = (s.charCodeAt(i >> 3) >> (i & 7)) & 1;
  return out;
}
