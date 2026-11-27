// Ends the boot screen in index.html: once the app has something to show, it fades out, after letting the glass settle
// (its animation lasts about 1.1 s from page load; a shorter wait if reduced motion is on). If this never runs, the screen
// gives up by itself after 9 s (the boot-giveup animation), so a broken start never leaves it covering the app.
const SETTLE_MS = 1050;

let done = false;
export function bootDone() {
  if (done) return;
  done = true;
  const el = document.getElementById("boot");
  if (!el) return;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wait = still ? 0 : Math.max(0, SETTLE_MS - performance.now());
  setTimeout(() => {
    el.classList.add("out");
    setTimeout(() => el.remove(), still ? 0 : 400);
  }, wait);
}
