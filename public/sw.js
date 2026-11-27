// Seaglass service worker: task notifications (push) and offline reading.
//
// Offline reading, kept deliberately small so a deploy is never stuck behind an old copy of the app:
//  - page loads and API reads of notes, the page list, tasks and flashcards: NETWORK FIRST. You always get the live
//    version when you're online; the last copy is only used when the network fails or takes over 5 seconds.
//  - hashed build files (/assets/*) and uploaded files (/files/*): cache first (their names never change).
//  - everything else (all writes, sign-in, sync polling, Jeff, notifications, AI) is never touched.
// Caches are named sg-* and are deleted by the app on log out.

const CACHE = "sg-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith("sg-") && k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

// Reads worth keeping offline. Anything not listed here goes straight to the network.
const READS = /^\/api\/(tree|home|recent|notes\/[0-9a-f-]{36}(\/children|\/history)?|study\/[0-9a-f-]{36}|study-due|study-streak|memories|chats|tasks)$/;

const sameOrigin = (url) => url.origin === self.location.origin;

async function networkFirst(req, key, waitMs) {
  const cache = await caches.open(CACHE);
  const net = fetch(req).then((res) => { if (res.ok && res.status === 200) cache.put(key, res.clone()); return res; });
  try {
    return await Promise.race([net, new Promise((_, no) => setTimeout(() => no(new Error("slow")), waitMs))]);
  } catch {
    const hit = await cache.match(key);
    if (hit) { net.catch(() => {}); return hit; }
    return net; // nothing cached: wait for the network (or fail like normal)
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.status === 200) cache.put(req, res.clone());
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (!sameOrigin(url)) return;
  if (req.mode === "navigate") {
    // The app shell: always the same page (the app routes itself), so one key.
    if (url.pathname === "/" || url.pathname === "/index.html") e.respondWith(networkFirst(req, "/", 4000));
    return;
  }
  if (url.pathname.startsWith("/assets/")) { e.respondWith(cacheFirst(req)); return; }
  if (url.pathname.startsWith("/files/")) { e.respondWith(cacheFirst(req)); return; }
  if (READS.test(url.pathname)) e.respondWith(networkFirst(req, url.pathname + url.search, 5000));
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: "Seaglass", body: e.data ? e.data.text() : "" }; }
  const title = d.title || "Seaglass";
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || "",
    tag: d.tag || undefined,
    renotify: !!d.tag,
    requireInteraction: !!(d.tag && String(d.tag).startsWith("paper-")), // a Paper Lock request stays up until answered
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: d.url || "/#/tasks", id: d.id || null },
    actions: Array.isArray(d.actions) ? d.actions.slice(0, 2) : [],
  }));
});

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

self.addEventListener("notificationclick", (e) => {
  const n = e.notification;
  const { url, id } = n.data || {};
  n.close();
  if ((e.action === "done" || e.action === "snooze") && id) {
    e.waitUntil(fetch("/api/push/action", {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action: e.action, today: today() }),
    }).then(async (r) => {
      if (!r.ok) await self.registration.showNotification("Couldn't update the task", { body: "Open Seaglass and try there.", icon: "/icon-192.png", data: { url, id } });
    }).catch(() => {}));
    return;
  }
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
    if (win) {
      await win.focus();
      win.postMessage({ type: "seaglass:open", id, url });
      return;
    }
    await self.clients.openWindow(url || "/#/tasks");
  })());
});
