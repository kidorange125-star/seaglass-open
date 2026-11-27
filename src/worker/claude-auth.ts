import Anthropic from "@anthropic-ai/sdk";
import { oidcFederationProvider } from "@anthropic-ai/sdk/lib/credentials/oidc-federation";
import type { Env } from "./env";

// ---------------------------------------------------------------------------------------------
// How the Worker authenticates to the Claude API.
//
// Preferred: Workload Identity Federation. The Worker is its own OIDC issuer: it signs a short-lived
// ES256 JWT (fresh jti each time) and serves its discovery document and public keys at
// <PUBLIC_URL>/wif. The SDK's oidcFederationProvider exchanges that JWT at /v1/oauth/token for a
// short-lived Claude API token and refreshes it before expiry. No long-lived API key is stored.
//
// Fallback: ANTHROPIC_API_KEY (or "mock" for the scripted test model).
// ---------------------------------------------------------------------------------------------

export type AuthMode = "wif" | "api_key" | "mock" | "none";

const WIF_VARS = ["PUBLIC_URL", "WIF_SIGNING_KEY", "ANTHROPIC_FEDERATION_RULE_ID", "ANTHROPIC_ORGANIZATION_ID", "ANTHROPIC_SERVICE_ACCOUNT_ID"] as const;

export function wifMissing(env: Env): string[] {
  return WIF_VARS.filter((k) => !env[k]);
}

export function authMode(env: Env): AuthMode {
  if (!wifMissing(env).length) return "wif";
  if (env.ANTHROPIC_API_KEY === "mock") return "mock";
  if (env.ANTHROPIC_API_KEY) return "api_key";
  return "none";
}

export const issuerUrl = (env: Env) => `${(env.PUBLIC_URL ?? "").replace(/\/+$/, "")}/wif`;

// ---------------------------------------------------------------- signing keys

interface SigningJwk { kty: "EC"; crv: "P-256"; x: string; y: string; d?: string; kid?: string }
const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlText = (s: string) => b64url(new TextEncoder().encode(s));

/** RFC 7638 thumbprint, used as the key id when the JWK doesn't carry one. */
async function thumbprint(k: SigningJwk) {
  const canonical = JSON.stringify({ crv: k.crv, kty: k.kty, x: k.x, y: k.y });
  return b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)));
}

/** WIF_SIGNING_KEY is one private JWK, or an array of them for rotation (the first one signs; all are published). */
function parseKeys(env: Env): SigningJwk[] {
  const raw = env.WIF_SIGNING_KEY;
  if (!raw) return [];
  const parsed = JSON.parse(raw) as SigningJwk | SigningJwk[];
  const keys = Array.isArray(parsed) ? parsed : [parsed];
  for (const k of keys) if (k.kty !== "EC" || k.crv !== "P-256" || !k.x || !k.y) throw new Error("WIF_SIGNING_KEY must be an EC P-256 JWK (run npm run wif:keygen)");
  return keys;
}

export async function publicJwks(env: Env) {
  const keys = parseKeys(env);
  return { keys: await Promise.all(keys.map(async (k) => ({ kty: "EC", crv: "P-256", x: k.x, y: k.y, kid: k.kid ?? (await thumbprint(k)), alg: "ES256", use: "sig" }))) };
}

export function openidConfiguration(env: Env) {
  const issuer = issuerUrl(env);
  return {
    issuer,
    jwks_uri: `${issuer}/jwks.json`,
    response_types_supported: ["id_token"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["ES256"],
    claims_supported: ["iss", "sub", "aud", "iat", "nbf", "exp", "jti"],
  };
}

/** Signs a fresh identity token for one token exchange. */
export async function mintIdentityToken(env: Env, lifetimeSeconds = 300): Promise<string> {
  const [k] = parseKeys(env);
  if (!k?.d) throw new Error("WIF_SIGNING_KEY has no private part (d)");
  const kid = k.kid ?? (await thumbprint(k));
  const key = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: k.x, y: k.y, d: k.d, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", typ: "JWT", kid };
  const claims = {
    iss: issuerUrl(env),
    sub: env.WIF_SUBJECT || "seaglass",
    aud: env.WIF_AUDIENCE || "https://api.anthropic.com",
    iat: now,
    nbf: now,
    exp: now + lifetimeSeconds,
    jti: crypto.randomUUID(), // single-use: Anthropic rejects a reused jti
  };
  const input = `${b64urlText(JSON.stringify(header))}.${b64urlText(JSON.stringify(claims))}`;
  // WebCrypto ECDSA signatures are already in the raw r||s form that JWS ES256 expects.
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(input));
  return `${input}.${b64url(sig)}`;
}

// ---------------------------------------------------------------- client

// One client per isolate and configuration, so the SDK's token cache is reused across requests.
let cached: { key: string; client: Anthropic } | null = null;

export function claudeClient(env: Env): Anthropic {
  const mode = authMode(env);
  const key = mode === "wif"
    ? `wif:${env.ANTHROPIC_FEDERATION_RULE_ID}:${env.ANTHROPIC_SERVICE_ACCOUNT_ID}:${env.ANTHROPIC_WORKSPACE_ID ?? ""}:${env.PUBLIC_URL}`
    : `key:${env.ANTHROPIC_API_KEY?.slice(-6)}`;
  if (cached?.key === key) return cached.client;
  let client: Anthropic;
  if (mode === "wif") {
    client = new Anthropic({
      credentials: oidcFederationProvider({
        identityTokenProvider: () => mintIdentityToken(env),
        federationRuleId: env.ANTHROPIC_FEDERATION_RULE_ID!,
        organizationId: env.ANTHROPIC_ORGANIZATION_ID!,
        serviceAccountId: env.ANTHROPIC_SERVICE_ACCOUNT_ID!,
        workspaceId: env.ANTHROPIC_WORKSPACE_ID || undefined,
        baseURL: "https://api.anthropic.com",
        fetch: (input, init) => fetch(input, init),
      }),
    });
  } else if (mode === "api_key") {
    client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  } else {
    throw new Error("The Claude API isn't configured (no workload identity federation and no API key).");
  }
  cached = { key, client };
  return client;
}
