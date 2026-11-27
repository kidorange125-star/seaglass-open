// Generates the private key that signs task notifications (Web Push VAPID). Run: npm run push:keygen
// Store the printed JSON as a secret, without it ever touching your screen if you like:
//   node scripts/push-keygen.mjs | npx wrangler secret put VAPID_PRIVATE_KEY
// Changing the key later means every device has to turn notifications on again (Settings > Notifications).
import { webcrypto as crypto } from "node:crypto";

const { privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const jwk = await crypto.subtle.exportKey("jwk", privateKey);
console.log(JSON.stringify({ kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d }));
console.error(`
This is a PRIVATE key. Don't commit it or paste it anywhere public.
Store it as a Worker secret:      npx wrangler secret put VAPID_PRIVATE_KEY
For local development, add to .dev.vars:  VAPID_PRIVATE_KEY='<the line above>'`);
