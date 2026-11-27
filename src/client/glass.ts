// Liquid Glass for the controls layer (tab bar, nav buttons, sheets, menus, toasts, Spotlight, phone toolbar).
// Modeled on Apple's material (WWDC25 "Meet Liquid Glass"): it bends and concentrates light at its edges (lensing)
// instead of only blurring, its rim catches light (specular highlights that follow the shape and the pointer), it
// lights up from within where you touch it, and it materializes by ramping the lensing up rather than fading.
//
// Modes on <html data-glass>: "lens" (Chromium: real refraction with an SVG displacement map behind each element),
// "css" (Safari/Firefox, which can't filter a backdrop through SVG: the same material without the bending), "off".
// The look itself is in glass.css.

export type GlassMode = "lens" | "css" | "off";
const KEY = "sg.glass";

/** The controls that get the material. Keep in sync with glass.css. */
export const GLASS_SELECTOR = [
  ".tabbar .tb-pill", ".tabbar .tb-search", ".nav-back", ".open-sb", ".phone-tb", ".toasts > div", ".spot", ".page > .topbar > .status",
  ".popover:not(:has(.popover, .fixed-pop))", ".fixed-pop", ".block-menu", ".suggest-pop", ".color-pop",
].join(",");

const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
/** Chromium can run an SVG filter on the backdrop. Safari accepts the CSS but draws nothing, so don't feature-test. */
const canLens = () => {
  const brands = (navigator as { userAgentData?: { brands?: { brand: string }[] } }).userAgentData?.brands ?? [];
  return brands.some((b) => /Chromium|Google Chrome|Microsoft Edge/.test(b.brand));
};

export function glassEnabled() { return read() !== "off"; }
export function setGlassEnabled(on: boolean) {
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* storage unavailable */ }
  apply();
}

// How tinted the glass is, like iOS 27's Liquid Glass slider: 0 = Ultra Clear, 100 = Fully Tinted. The default
// leans tinted (iOS 27 made glass less transparent by default).
const LEVEL_KEY = "sg.glass.level";
export const DEFAULT_LEVEL = 60;
export function glassLevel(): number {
  try { const v = Number(localStorage.getItem(LEVEL_KEY)); return localStorage.getItem(LEVEL_KEY) !== null && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : DEFAULT_LEVEL; } catch { return DEFAULT_LEVEL; }
}
export function setGlassLevel(v: number) {
  try { localStorage.setItem(LEVEL_KEY, String(Math.round(v))); } catch { /* storage unavailable */ }
  applyLevel();
  for (const el of tracked) lens(el, false); // the frost is inside the lens filter
}
function applyLevel() {
  const t = glassLevel() / 100, s = document.documentElement.style;
  s.setProperty("--lg-a", (0.08 + 0.74 * t).toFixed(3));          // small controls: tint
  s.setProperty("--lg-a-big", (0.5 + 0.46 * t).toFixed(3));       // sheets and menus
  s.setProperty("--lg-blur", `${(1.5 + 10 * t).toFixed(1)}px`);
  s.setProperty("--lg-blur-big", `${(14 + 18 * t).toFixed(1)}px`);
}
function modeNow(): GlassMode {
  const v = read();
  if (v === "off") return "off";
  if (v === "css") return "css"; // forces the Safari look (for testing)
  return canLens() ? "lens" : "css";
}

// ---------------------------------------------------------------- lensing (Chromium)
// For each glass element: a displacement map the size of the element. Inside a bezel along the rounded edge every
// pixel samples the backdrop a little further out along the edge's normal, so the background bends around the rim
// like light through the edge of a thick piece of glass. Larger elements bend more (Apple: "more pronounced lensing").

const SVG_NS = "http://www.w3.org/2000/svg";
let defs: SVGDefsElement | null = null;
const maps = new Map<string, string>();      // size key -> data URL
const filters = new WeakMap<Element, { id: string; key: string; disp: SVGFEDisplacementMapElement; img: SVGFEImageElement; filter: SVGFilterElement }>();
let seq = 0;

function ensureDefs() {
  if (defs) return defs;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", "0"); svg.setAttribute("height", "0"); svg.setAttribute("aria-hidden", "true");
  svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
  defs = document.createElementNS(SVG_NS, "defs");
  svg.appendChild(defs);
  document.body.appendChild(svg);
  return defs;
}

function radiusOf(el: Element, w: number, h: number) {
  const r = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
  return Math.min(r, w / 2, h / 2);
}

/** The displacement map for a w x h rounded rectangle (radius r), as a PNG data URL. R/G = x/y offset around 128. */
function makeMap(w: number, h: number, r: number, bezel: number) {
  const key = `${w}x${h}r${r}b${bezel}`;
  const hit = maps.get(key);
  if (hit) return { key, url: hit };
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5, py = y + 0.5;
      let nx = 0, ny = 0, dist: number;
      const inCornerX = px < r ? r : px > w - r ? w - r : null;
      const inCornerY = py < r ? r : py > h - r ? h - r : null;
      if (inCornerX !== null && inCornerY !== null) {
        const vx = px - inCornerX, vy = py - inCornerY, len = Math.hypot(vx, vy) || 1;
        dist = r - len; nx = vx / len; ny = vy / len;
      } else {
        const l = px, rt = w - px, t = py, b = h - py;
        dist = Math.min(l, rt, t, b);
        if (dist === l) nx = -1; else if (dist === rt) nx = 1; else if (dist === t) ny = -1; else ny = 1;
      }
      const i = (y * w + x) * 4;
      let m = 0;
      if (dist < bezel && dist > -1) { const u = 1 - Math.max(0, dist) / bezel; m = u * u * (3 - 2 * u); } // smooth: strongest at the rim
      // Sample inward from the rim: what's under the edge is stretched outward, like the rim of a convex lens.
      d[i] = 128 - nx * m * 127; d[i + 1] = 128 - ny * m * 127; d[i + 2] = 128; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const url = c.toDataURL("image/png");
  if (maps.size > 60) maps.clear();
  maps.set(key, url);
  return { key, url };
}

function lens(el: HTMLElement, materialize: boolean) {
  // Layout size, not the on-screen box: sheets are measured while they are still scaled down by their entrance.
  const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
  if (w < 8 || h < 8 || w * h > 900_000) return;
  const r = Math.round(radiusOf(el, w, h));
  const big = Math.min(w, h) > 90;
  const bezel = Math.round(Math.max(8, Math.min(big ? 26 : 16, Math.min(w, h) * 0.38)));
  const scale = big ? 46 : 30;
  const { key, url } = makeMap(w, h, r, bezel);
  let f = filters.get(el);
  const frost = String(Math.max(0.5, parseFloat(getComputedStyle(el).getPropertyValue("--lg-b")) || (big ? 20 : 3)));
  if (f && f.key === key) { f.filter.querySelector("feGaussianBlur")?.setAttribute("stdDeviation", frost); return; }
  if (!f) {
    const id = `lg-${++seq}`;
    const filter = document.createElementNS(SVG_NS, "filter");
    filter.setAttribute("id", id);
    filter.setAttribute("filterUnits", "userSpaceOnUse");
    filter.setAttribute("primitiveUnits", "userSpaceOnUse");
    filter.setAttribute("color-interpolation-filters", "sRGB");
    const img = document.createElementNS(SVG_NS, "feImage");
    img.setAttribute("result", "map"); img.setAttribute("preserveAspectRatio", "none");
    // The material's scattering (frost) is part of the filter: Chromium skips CSS functions chained after url().
    const soften = document.createElementNS(SVG_NS, "feGaussianBlur");
    soften.setAttribute("in", "SourceGraphic"); soften.setAttribute("edgeMode", "duplicate"); soften.setAttribute("result", "soft");
    const disp = document.createElementNS(SVG_NS, "feDisplacementMap");
    disp.setAttribute("in", "soft"); disp.setAttribute("in2", "map");
    disp.setAttribute("xChannelSelector", "R"); disp.setAttribute("yChannelSelector", "G");
    disp.setAttribute("scale", materialize && !reduceMotion() ? "0" : String(scale));
    filter.appendChild(img); filter.appendChild(soften); filter.appendChild(disp);
    ensureDefs().appendChild(filter);
    f = { id, key, disp, img, filter };
    filters.set(el, f);
    el.style.setProperty("--lg-lens", `url(#${id})`);
    // Materialize: ramp the bending up instead of fading in.
    if (materialize && !reduceMotion()) {
      const start = performance.now(), dur = 320, target = scale, dispEl = disp;
      const step = (t: number) => { const k = Math.min(1, (t - start) / dur); dispEl.setAttribute("scale", String(target * (1 - Math.pow(1 - k, 3)))); if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    }
  } else if (!materialize) {
    f.disp.setAttribute("scale", String(scale));
  }
  f.key = key;
  f.filter.querySelector("feGaussianBlur")?.setAttribute("stdDeviation", frost);
  for (const [k, v] of [["x", "0"], ["y", "0"], ["width", String(w)], ["height", String(h)]] as const) { f.filter.setAttribute(k, v); f.img.setAttribute(k, v); }
  f.img.setAttribute("href", url);
}

const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------- wiring
let mo: MutationObserver | null = null;
let ro: ResizeObserver | null = null;
const tracked = new Set<HTMLElement>();

/** Desktop panels whose glass is drawn on a ::before layer (they contain menus); they get lensing but not touch light. */
const LAYER_SELECTOR = ".page > .topbar .crumbs, .page > .topbar .actions, .agent.floating";

function scan(materialize: boolean) {
  const desktop = matchMedia("(min-width: 860px)").matches;
  for (const el of document.querySelectorAll<HTMLElement>(desktop ? `${GLASS_SELECTOR},${LAYER_SELECTOR}` : GLASS_SELECTOR)) {
    if (tracked.has(el)) continue;
    tracked.add(el);
    ro?.observe(el);
    lens(el, materialize);
  }
  for (const el of tracked) {
    if (!el.isConnected) {
      tracked.delete(el); ro?.unobserve(el);
      const f = filters.get(el); f?.filter.remove(); filters.delete(el);
    }
  }
}

function startLens() {
  if (mo) return;
  ro = new ResizeObserver((entries) => { for (const e of entries) lens(e.target as HTMLElement, false); });
  let queued = false;
  mo = new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; scan(true); }); });
  mo.observe(document.body, { childList: true, subtree: true });
  scan(false);
}
function stopLens() {
  mo?.disconnect(); ro?.disconnect(); mo = null; ro = null;
  for (const el of tracked) { el.style.removeProperty("--lg-lens"); filters.get(el)?.filter.remove(); filters.delete(el); }
  tracked.clear();
}

function apply() {
  applyLevel();
  const mode = modeNow();
  document.documentElement.dataset.glass = mode;
  if (mode === "lens") startLens(); else stopLens();
}

// Touch and pointer light: the glass lights up from within where you press, and on desktop its specular highlight
// leans toward the pointer. Content scrolled under the bars deepens their shadows (adaptive shadow).
function wireInteraction() {
  const glassAt = (t: EventTarget | null) => (t instanceof Element ? (t.closest(GLASS_SELECTOR) as HTMLElement | null) : null);
  const place = (el: HTMLElement, e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    el.style.setProperty("--lg-x", `${((e.clientX - r.left) / r.width) * 100}%`);
    el.style.setProperty("--lg-y", `${((e.clientY - r.top) / r.height) * 100}%`);
  };
  addEventListener("pointerdown", (e) => {
    if (document.documentElement.dataset.glass === "off") return;
    const el = glassAt(e.target); if (!el) return;
    place(el, e); el.classList.add("lg-lit");
    const off = () => { el.classList.remove("lg-lit"); removeEventListener("pointerup", off); removeEventListener("pointercancel", off); };
    addEventListener("pointerup", off); addEventListener("pointercancel", off);
  }, { passive: true });
  addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse" || document.documentElement.dataset.glass === "off") return;
    const el = glassAt(e.target); if (!el) return;
    place(el, e);
  }, { passive: true });
  let scrolledRaf = 0;
  addEventListener("scroll", (e) => {
    const t = e.target as HTMLElement;
    if (!(t instanceof HTMLElement) || !t.matches(".scroll, .home")) return;
    cancelAnimationFrame(scrolledRaf);
    scrolledRaf = requestAnimationFrame(() => {
      document.documentElement.toggleAttribute("data-lg-top", t.scrollTop > 4);                                   // content under the top controls
      document.documentElement.toggleAttribute("data-lg-end", t.scrollHeight - t.clientHeight - t.scrollTop <= 4); // nothing left under the tab bar
    });
  }, { capture: true, passive: true });
}

export function initGlass() {
  const go = () => { apply(); wireInteraction(); };
  if (document.body) go(); else addEventListener("DOMContentLoaded", go, { once: true });
  addEventListener("storage", (e) => { if (e.key === KEY) apply(); });
}
