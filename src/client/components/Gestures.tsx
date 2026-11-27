// App-wide touch gestures on phones and tablets (the pieces that aren't tied to one component):
//  - swipe in from the left edge: opens the sidebar on Home, goes back everywhere else, closes the side peek or Jeff
//  - swipe the open sidebar to the left to close it (it follows your finger, the dimming fades with it)
//  - drag Jeff's header, or a full-screen window's header, down to close it
//  - slide along the tab bar to move the selection, let go to open that tab
// Sheets (menus) handle their own drag-down in ui.tsx (useSheet); task rows in Tasks.tsx.
import { useEffect, useRef } from "react";
import { useStore } from "../store";
import { committed, isTouch, reduceMotion, settle, SPRING, swipe } from "../gestures";

const phone = () => matchMedia("(max-width: 859px)").matches;
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel);
const covered = () => !!$(".popover, .fixed-pop, .block-menu, .suggest-pop, .modal-back, .spot-back, .study");

/** Slides the sidebar out, fading the dimming with it, then closes it. */
export function closeDrawer(toggle: () => void) {
  const sb = $(".sidebar"), scrim = $(".scrim");
  if (!sb || reduceMotion()) { toggle(); return; }
  scrim?.animate([{ opacity: getComputedStyle(scrim).opacity }, { opacity: 0 }], { duration: 260, fill: "forwards" });
  settle(sb, "translateX(-105%)", toggle, 260);
}

export function MobileGestures() {
  // Listeners are attached once; they read the latest store through a ref (re-attaching on every render would
  // cut a drag short, since opening the drawer mid-swipe re-renders).
  const store = useStore();
  const ref = useRef(store);
  ref.current = store;
  useEffect(() => {
    if (!isTouch()) return;
    const s = new Proxy({} as typeof store, { get: (_o, k) => ref.current[k as keyof typeof store] });
    const offs: (() => void)[] = [];
    const W = () => innerWidth;

    // ---- edge swipe: sidebar on Home, otherwise close the top panel or go back
    let mode: "drawer" | "back" | "peek" | "agent" | null = null;
    let target: HTMLElement | null = null;
    offs.push(swipe(document.body, {
      axis: "x", dir: 1,
      canStart: (t) => phone() && t.clientX < 24 && !covered() && !(s.sidebarOpen && $(".sidebar")),
      onStart: () => {
        if ($(".agent") && s.agentOpen) { mode = "agent"; target = $(".agent"); }
        else if (s.peekId && $(".peek")) { mode = "peek"; target = $(".peek"); }
        else if (s.route.kind === "home") { mode = "drawer"; s.toggleSidebar(); target = null; }
        else { mode = "back"; target = $(".main"); }
        if (target) { target.style.boxShadow = "-18px 0 40px rgba(0,0,0,.18)"; }
      },
      onMove: (d) => {
        if (mode === "drawer") {
          const sb = target ?? (target = $(".sidebar"));
          if (!sb) return;
          sb.style.animation = "none";
          const w = sb.offsetWidth;
          sb.style.transform = `translateX(${Math.min(0, d - w)}px)`;
          const scrim = $(".scrim"); if (scrim) { scrim.style.animation = "none"; scrim.style.opacity = String(Math.min(1, d / w)); }
          return;
        }
        if (target) target.style.transform = `translateX(${Math.max(0, d)}px)`;
      },
      onEnd: (d, v) => {
        const el = target; const m = mode; mode = null; target = null;
        if (m === "drawer") {
          const sb = el ?? $(".sidebar"), scrim = $(".scrim");
          if (!sb) return;
          if (committed(d, v, sb.offsetWidth, 1, 0.3)) { settle(sb, "none"); if (scrim) scrim.style.opacity = ""; }
          else closeDrawer(s.toggleSidebar);
          return;
        }
        if (!el) return;
        const done = () => { el.style.boxShadow = ""; };
        if (!committed(d, v, W(), 1, 0.33)) { settle(el, "none", done); return; }
        settle(el, `translateX(${W()}px)`, () => {
          done();
          if (m === "agent") s.setAgentOpen(false);
          else if (m === "peek") s.setPeek(null);
          else {
            (window as { __sgSkipVT?: boolean }).__sgSkipVT = true; // already animated: no page transition on top
            s.goBack();
            requestAnimationFrame(() => { el.style.transform = ""; if (!reduceMotion()) el.animate([{ transform: "translateX(-24%)", opacity: 0.6 }, { transform: "none", opacity: 1 }], { duration: 300, easing: SPRING }); });
          }
        }, 220);
      },
    }));

    // ---- the open sidebar: swipe it away to the left
    offs.push(swipe(document.body, {
      axis: "x", dir: -1,
      canStart: (_t, e) => phone() && !!(e.target as Element).closest?.(".sidebar, .scrim") && !covered(),
      onStart: () => { const sb = $(".sidebar"); if (sb) sb.style.animation = "none"; },
      onMove: (d) => {
        const sb = $(".sidebar"); if (!sb) return;
        sb.style.transform = `translateX(${Math.min(0, d)}px)`;
        const scrim = $(".scrim"); if (scrim) scrim.style.opacity = String(Math.max(0, 1 + d / sb.offsetWidth));
      },
      onEnd: (d, v) => {
        const sb = $(".sidebar"); if (!sb) return;
        if (committed(d, v, sb.offsetWidth, -1, 0.3)) closeDrawer(s.toggleSidebar);
        else { settle(sb, "none"); const scrim = $(".scrim"); if (scrim) scrim.style.opacity = ""; }
      },
    }));

    // ---- Jeff (full screen on phones) and full-screen windows: drag the header down to close
    let sheet: HTMLElement | null = null, grabbed: HTMLElement | null = null;
    offs.push(swipe(document.body, {
      axis: "y", dir: 1,
      canStart: (_t, e) => {
        const head = (e.target as Element).closest?.(".agent .ag-head, .modal .memory-head");
        grabbed = head ? (head.closest(".agent, .modal") as HTMLElement) : null;
        return phone() && !!grabbed && !$(".popover, .fixed-pop");
      },
      onStart: () => { sheet = grabbed; },
      onMove: (d) => { if (sheet) sheet.style.transform = `translateY(${Math.max(0, d)}px)`; },
      onEnd: (d, v) => {
        const el = sheet; sheet = null; if (!el) return;
        if (!committed(d, v, innerHeight, 1, 0.25)) { settle(el, "none"); return; }
        settle(el, `translateY(${innerHeight}px)`, () => {
          if (el.classList.contains("agent")) s.setAgentOpen(false);
          else dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); // the windows close on Escape
        }, 240);
      },
    }));

    // ---- tab bar: slide along it to move the selection, let go to open that tab
    let tb: { rect: DOMRect; moved: boolean; x0: number } | null = null;
    const tabs = () => [...document.querySelectorAll<HTMLElement>(".tabbar .tb-pill > a, .tabbar .tb-pill > button")];
    const onTbStart = (e: TouchEvent) => {
      const pill = (e.target as Element).closest?.(".tb-pill") as HTMLElement | null;
      if (!pill || document.documentElement.dataset.glass === "off") { tb = null; return; }
      tb = { rect: pill.getBoundingClientRect(), moved: false, x0: e.touches[0].clientX };
    };
    const indexAt = (x: number, r: DOMRect) => { const n = Math.max(1, tabs().length), cell = (r.width - 8) / n; return Math.max(0, Math.min(n - 1, (x - r.left - 4 - cell / 2) / cell)); };
    const onTbMove = (e: TouchEvent) => {
      if (!tb) return;
      const x = e.touches[0].clientX;
      if (!tb.moved && Math.abs(x - tb.x0) < 10) return;
      tb.moved = true; e.preventDefault();
      const sel = $(".tabbar .tb-sel"); if (!sel) return;
      sel.hidden = false; sel.classList.add("dragging");
      sel.style.setProperty("--i", indexAt(x, tb.rect).toFixed(3));
    };
    const onTbEnd = (e: TouchEvent) => {
      if (!tb) return;
      const was = tb; tb = null;
      const sel = $(".tabbar .tb-sel");
      sel?.classList.remove("dragging");
      if (!was.moved) return;
      const i = Math.round(indexAt(e.changedTouches[0].clientX, was.rect));
      sel?.style.removeProperty("--i");
      tabs()[i]?.click();
    };
    document.addEventListener("touchstart", onTbStart, { passive: true });
    document.addEventListener("touchmove", onTbMove, { passive: false });
    document.addEventListener("touchend", onTbEnd);
    offs.push(() => { document.removeEventListener("touchstart", onTbStart); document.removeEventListener("touchmove", onTbMove); document.removeEventListener("touchend", onTbEnd); });

    return () => offs.forEach((f) => f());
  }, []);
  return null;
}
