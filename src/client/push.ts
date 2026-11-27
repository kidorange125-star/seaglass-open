// Task notifications on this device (Web Push). Works in Chrome/Edge/Firefox on Windows and Mac, and on
// iPhone/iPad (iOS 16.4+) once Seaglass is added to the Home Screen and opened from there.
import { api } from "./api";

export type PushState =
  | "unsupported"   // no service worker / Push API here
  | "needs-install" // iPhone/iPad in Safari: add to Home Screen first
  | "denied"        // the user blocked notifications for this site
  | "off"           // allowed or not asked yet, but this device isn't subscribed
  | "on";

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
export const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** A short name for this device, shown in the device list. */
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) || isIOS() ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "Device";
  const app = standalone() ? "app" : /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "browser";
  return `${os} · ${app}`;
}

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  addEventListener("load", () => { void navigator.serviceWorker.register("/sw.js").catch(() => {}); });
}

const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const sameKey = (sub: PushSubscription, key: Uint8Array) => {
  const k = sub.options.applicationServerKey;
  if (!k) return true; // can't tell; assume it's ours
  const a = new Uint8Array(k);
  return a.length === key.length && a.every((b, i) => b === key[i]);
};
function fromB64url(s: string) {
  const t = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "=".repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
async function registration() {
  return (await navigator.serviceWorker.getRegistration("/")) ?? navigator.serviceWorker.register("/sw.js");
}

export async function pushState(): Promise<PushState> {
  if (isIOS() && !standalone()) return "needs-install";
  if (!supported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const sub = await (await registration()).pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

/** The browser's current subscription address, if any (to mark "this device" in the list). */
export async function currentEndpoint(): Promise<string | null> {
  if (!supported()) return null;
  return (await (await registration()).pushManager.getSubscription())?.endpoint ?? null;
}

const save = (sub: PushSubscription) => {
  const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  return api.pushSubscribe({ endpoint: j.endpoint, keys: j.keys, tz: timeZone(), label: deviceLabel() });
};

/** Must run from a tap/click (browsers only show the permission prompt for one). Pass the server key when you
 *  already have it: iOS only shows the prompt if it is the first thing the tap does, before any network request. */
export async function enablePush(knownKey?: string | null): Promise<PushState> {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm === "denied" ? "denied" : "off";
  const key = knownKey ?? (await api.push()).key;
  if (!key) throw new Error("Notifications aren't set up on the server yet (VAPID_PRIVATE_KEY is missing).");
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const raw = fromB64url(key);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, raw)) { await sub.unsubscribe(); sub = null; }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw });
  await save(sub);
  return "on";
}

export async function disablePush() {
  const sub = await (await registration()).pushManager.getSubscription();
  if (!sub) return;
  await api.pushUnsubscribe(sub.endpoint).catch(() => {});
  await sub.unsubscribe();
}

/** On every app start: keep the server's copy of this device's subscription (and time zone) current.
 *  Browsers, iOS especially, can replace a subscription at any time. */
export async function syncPush() {
  try {
    if (!supported() || Notification.permission !== "granted") return;
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    const { key } = await api.push();
    if (key && !sameKey(sub, fromB64url(key))) {
      // The server's key changed: subscribe again with the new one (no prompt, permission is already granted).
      await sub.unsubscribe();
      await save(await reg!.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64url(key) }));
      return;
    }
    await save(sub);
  } catch { /* offline or blocked: try again next start */ }
}
