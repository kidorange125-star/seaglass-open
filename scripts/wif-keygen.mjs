// Generates the private signing key the Worker uses as its own OIDC issuer for
// Claude Platform workload identity federation. Run: npm run wif:keygen
// Then store the printed JSON as a secret:  npx wrangler secret put WIF_SIGNING_KEY
import { webcrypto as crypto } from "node:crypto";

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const { privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const jwk = await crypto.subtle.exportKey("jwk", privateKey);
// RFC 7638 thumbprint as the key id, so rotations are easy to tell apart.
const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
const kid = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)));
const key = { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d, kid };

console.log(JSON.stringify(key));
console.error(`
Key id: ${kid}
This is a PRIVATE key. Don't commit it or paste it anywhere public.
Store it as a Worker secret (paste the single line above when asked):
  npx wrangler secret put WIF_SIGNING_KEY
For local development, put it in .dev.vars as:  WIF_SIGNING_KEY='<the line above>'
To rotate later: publish both keys as a JSON array [new, old] (the first one signs), wait 15+ minutes,
then remove the old one once its tokens have expired.`);
