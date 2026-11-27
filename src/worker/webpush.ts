// Web Push from the Worker with nothing but WebCrypto:
//   - RFC 8291 message encryption (aes128gcm) so only the subscribed browser can read the payload
//   - RFC 8292 VAPID: an ES256 token that proves the push came from this app's key
// The VAPID private key is a P-256 JWK kept in the VAPID_PRIVATE_KEY secret (`npm run push:keygen`).
// Pure module (no imports) so tests/unit/webpush.test.mts can check it against the RFC's test vector.

export interface PushSub { endpoint: string; p256dh: string; auth: string }

const enc = new TextEncoder();
type Bytes = Uint8Array<ArrayBuffer>;
const utf8 = (s: string): Bytes => new Uint8Array(enc.encode(s));

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64url(s: string): Bytes {
  const t = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "=".repeat((4 - (t.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const concat = (...parts: Uint8Array[]): Bytes => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}

/** The uncompressed public point (65 bytes, 0x04 || x || y) of a P-256 JWK. */
export function rawPublicKey(jwk: JsonWebKey): Bytes {
  if (!jwk.x || !jwk.y) throw new Error("JWK has no public point");
  return concat(new Uint8Array([4]), unb64url(jwk.x), unb64url(jwk.y));
}
/** A JWK for a P-256 key from its raw public point (and optional private scalar d). */
export function jwkFromRaw(pub: Uint8Array, d?: string): JsonWebKey {
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("not an uncompressed P-256 public key");
  return { kty: "EC", crv: "P-256", x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33)), ...(d ? { d } : {}), ext: true };
}

/**
 * Encrypts a payload for one subscription (a single aes128gcm record). `fixed` pins the server key pair and
 * salt, for the RFC test vector only; normally both are fresh for every message.
 */
export async function encryptPayload(plaintext: Bytes, sub: PushSub, fixed?: { serverJwk: JsonWebKey; salt: Bytes }) {
  const uaPublic = unb64url(sub.p256dh), authSecret = unb64url(sub.auth);
  let serverPrivate: CryptoKey, serverPublic: Bytes;
  if (fixed) {
    serverPrivate = await crypto.subtle.importKey("jwk", fixed.serverJwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    serverPublic = rawPublicKey(fixed.serverJwk);
  } else {
    const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    serverPrivate = pair.privateKey;
    serverPublic = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  }
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, serverPrivate, 256));

  const keyInfo = concat(utf8("WebPush: info\0"), uaPublic, serverPublic);
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);
  const cek = await hkdf(salt, ikm, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, utf8("Content-Encoding: nonce\0"), 12);

  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const padded = concat(plaintext, new Uint8Array([2])); // 0x02: the last (and only) record
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, padded));

  const header = new Uint8Array(21 + serverPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096); // record size
  header[20] = serverPublic.length;
  header.set(serverPublic, 21);
  return concat(header, ciphertext);
}

/** The VAPID Authorization header for a push endpoint. `subject` must be an https: or mailto: URL. */
export async function vapidAuth(endpoint: string, privateJwk: JsonWebKey, subject: string, now = Date.now()) {
  const aud = new URL(endpoint).origin;
  const head = b64url(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64url(utf8(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey("jwk", { ...privateJwk, key_ops: undefined, ext: undefined }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, utf8(`${head}.${body}`)); // raw r||s, as JWS wants
  return `vapid t=${head}.${body}.${b64url(sig)}, k=${b64url(rawPublicKey(privateJwk))}`;
}

export type PushResult = { ok: true; status: number } | { ok: false; status: number; gone: boolean; detail: string };

/** Sends one message. `gone` means the subscription is dead (unsubscribed, expired) and should be deleted. */
export async function sendPush(sub: PushSub, payload: unknown, privateJwk: JsonWebKey, subject: string, opts: { ttl?: number; urgency?: "normal" | "high"; topic?: string } = {}): Promise<PushResult> {
  const body = await encryptPayload(utf8(JSON.stringify(payload)), sub);
  const headers: Record<string, string> = {
    Authorization: await vapidAuth(sub.endpoint, privateJwk, subject),
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(opts.ttl ?? 3600),
    Urgency: opts.urgency ?? "high",
  };
  // A topic replaces an undelivered message with the same topic (max 32 url-safe chars).
  if (opts.topic) headers.Topic = opts.topic.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
  let res: Response;
  try {
    res = await fetch(sub.endpoint, { method: "POST", headers, body });
  } catch (e) {
    return { ok: false, status: 0, gone: false, detail: (e as Error).message };
  }
  if (res.ok) return { ok: true, status: res.status };
  const detail = (await res.text().catch(() => "")).slice(0, 300);
  return { ok: false, status: res.status, gone: res.status === 404 || res.status === 410, detail };
}

/** Allowed push services. Subscriptions pointing anywhere else are refused, so the Worker can't be used
 *  to POST to arbitrary URLs. */
export function isPushEndpoint(endpoint: string): boolean {
  let u: URL;
  try { u = new URL(endpoint); } catch { return false; }
  if (u.protocol !== "https:") return false;
  const h = u.hostname;
  return h === "fcm.googleapis.com" || h === "android.googleapis.com" || h === "updates.push.services.mozilla.com"
    || h.endsWith(".push.apple.com") || h === "web.push.apple.com" || h.endsWith(".notify.windows.com");
}
