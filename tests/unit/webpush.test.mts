// Web Push encryption and VAPID against RFC 8291 Appendix A. Run: node --experimental-strip-types tests/unit/webpush.test.mts
import { b64url, encryptPayload, jwkFromRaw, unb64url, vapidAuth, isPushEndpoint, rawPublicKey } from "../../src/worker/webpush.ts";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => { if (cond) pass++; else { fail++; console.log("FAIL", name, extra); } };

// RFC 8291 Appendix A
const V = {
  plaintext: "V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  header: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  ciphertext: "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ",
};

const serverJwk = jwkFromRaw(unb64url(V.asPublic), V.asPrivate);
const body = await encryptPayload(unb64url(V.plaintext), { endpoint: "https://x", p256dh: V.uaPublic, auth: V.auth }, { serverJwk, salt: unb64url(V.salt) });
const header = unb64url(V.header), ct = unb64url(V.ciphertext);
ok("header is 86 bytes", body.slice(0, 86).length === 86 && header.length === 86);
ok("header matches RFC", b64url(body.slice(0, 86)) === b64url(header), b64url(body.slice(0, 86)));
ok("ciphertext matches RFC", b64url(body.slice(86)) === b64url(ct), b64url(body.slice(86)));
ok("total length", body.length === header.length + ct.length);

// Round trip with a fresh key: decrypt as the browser would.
async function decrypt(msg: Uint8Array, uaJwk: JsonWebKey, uaPub: Uint8Array, auth: Uint8Array) {
  const salt = msg.slice(0, 16), idlen = msg[20], asPub = msg.slice(21, 21 + idlen), ctext = msg.slice(21 + idlen);
  const priv = await crypto.subtle.importKey("jwk", uaJwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const pub = await crypto.subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: pub }, priv, 256));
  const h = async (s: Uint8Array, k: Uint8Array, info: Uint8Array, n: number) => new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: s, info }, await crypto.subtle.importKey("raw", k, "HKDF", false, ["deriveBits"]), n * 8));
  const te = new TextEncoder();
  const ikm = await h(auth, shared, new Uint8Array([...te.encode("WebPush: info\0"), ...uaPub, ...asPub]), 32);
  const cek = await h(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await h(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]), ctext));
  return new TextDecoder().decode(pt.slice(0, pt.lastIndexOf(2)));
}
const ua = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
const uaPub = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey) as ArrayBuffer);
const uaAuth = crypto.getRandomValues(new Uint8Array(16));
const msg = await encryptPayload(new TextEncoder().encode('{"title":"Hi"}'), { endpoint: "https://x", p256dh: b64url(uaPub), auth: b64url(uaAuth) });
ok("round trip decrypts", (await decrypt(msg, await crypto.subtle.exportKey("jwk", ua.privateKey), uaPub, uaAuth)) === '{"title":"Hi"}');
const msg2 = await encryptPayload(new TextEncoder().encode('{"title":"Hi"}'), { endpoint: "https://x", p256dh: b64url(uaPub), auth: b64url(uaAuth) });
ok("fresh salt and key each time", b64url(msg.slice(0, 86)) !== b64url(msg2.slice(0, 86)));

// VAPID: a valid ES256 JWT for the endpoint's origin, verifiable with the advertised public key.
const vapid = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
const vjwk = await crypto.subtle.exportKey("jwk", vapid.privateKey);
const auth = await vapidAuth("https://fcm.googleapis.com/fcm/send/abc123", vjwk, "https://seaglass.example", 1_700_000_000_000);
const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(auth);
ok("vapid header shape", !!m, auth);
if (m) {
  const claims = JSON.parse(new TextDecoder().decode(unb64url(m[2])));
  ok("aud is push origin", claims.aud === "https://fcm.googleapis.com");
  ok("sub", claims.sub === "https://seaglass.example");
  ok("exp 12h", claims.exp === 1_700_000_000 + 12 * 3600);
  ok("k is raw public key", m[4] === b64url(rawPublicKey(vjwk)) && unb64url(m[4]).length === 65);
  const pub = await crypto.subtle.importKey("raw", unb64url(m[4]), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  ok("signature verifies", await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, unb64url(m[3]), new TextEncoder().encode(`${m[1]}.${m[2]}`)));
  ok("header alg", JSON.parse(new TextDecoder().decode(unb64url(m[1]))).alg === "ES256");
}

ok("endpoint fcm", isPushEndpoint("https://fcm.googleapis.com/fcm/send/x"));
ok("endpoint apple", isPushEndpoint("https://web.push.apple.com/QW1"));
ok("endpoint mozilla", isPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x"));
ok("endpoint windows", isPushEndpoint("https://wns2-bl2p.notify.windows.com/w/?token=x"));
ok("endpoint rejects http", !isPushEndpoint("http://fcm.googleapis.com/x"));
ok("endpoint rejects others", !isPushEndpoint("https://evil.example/fcm.googleapis.com"));
ok("endpoint rejects lookalike", !isPushEndpoint("https://fcm.googleapis.com.evil.example/x"));

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
