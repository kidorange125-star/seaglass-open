import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

// Everything the Worker is bound to. See wrangler.jsonc and docs/SETUP.md.
export interface Env {
  /** The database. Inside the Worker it is always wrapped (scope.ts): the system's, or one person's. */
  DB: D1Database;
  /** The unwrapped database, kept by fetch/scheduled so a person's scope can be made from it (scope.ts asPerson). */
  RAW?: D1Database;
  /** Set by fetch() for /api/s/family/... requests (src/shared/space.ts). */
  SPACE?: "family";
  /** The signed-in person's name, kept with each change made in the Family space so history says who. */
  ACTOR?: string;
  /** Where each key in use came from: a Worker secret, or saved in the app (keys.ts). */
  KEY_SOURCES?: Record<string, "secret" | "saved">;
  FILES: R2Bucket;
  /** Workers AI (Whisper, embeddings). Absent in some test setups, so features check for it. */
  AI?: Ai;
  OAUTH_KV: KVNamespace;
  /** Injected by OAuthProvider for the /authorize page. */
  OAUTH_PROVIDER: OAuthHelpers;
  /** Needed to make the first account on a deployed copy (the setup screen asks for it). Any phrase; set it when deploying. */
  SETUP_CODE?: string;
  /** Local test suites only: "1" skips sign-in on localhost (auth.ts devOpen). Never set it on a deployed copy. */
  AUTH_OPEN?: string;
  /** Where a new copy's assistant permissions start: careful (ask before changes, the default), balanced or free. */
  DEFAULT_AGENT_PERMISSIONS?: string;
  /** Public origin of the deployed Worker, e.g. https://seaglass.example.workers.dev (no trailing slash). */
  PUBLIC_URL?: string;
  /** Claude API: either an API key (or "mock"), or workload identity federation below. */
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_FEDERATION_RULE_ID?: string;
  ANTHROPIC_ORGANIZATION_ID?: string;
  ANTHROPIC_SERVICE_ACCOUNT_ID?: string;
  ANTHROPIC_WORKSPACE_ID?: string;
  /** Private EC P-256 JWK (JSON) the Worker signs its own identity tokens with. Generate with `npm run wif:keygen`. */
  WIF_SIGNING_KEY?: string;
  /** Private EC P-256 JWK (JSON) that signs Web Push messages (VAPID). Generate with `npm run push:keygen`. */
  VAPID_PRIVATE_KEY?: string;
  /** 32 random bytes, base64: encrypts everything private in D1 and R2 (see vault.ts). Generate with `npm run data:keygen`. LOSING IT LOSES THE DATA. */
  DATA_KEY?: string;
  /** Natural voices for live voice (worker/voice.ts): ElevenLabs if set, else Gemini through OpenRouter. Without either the app uses the device's voice. */
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_VOICE_ID?: string;
  OPENROUTER_API_KEY?: string;
  /** Old DATA_KEY values (comma separated) kept so data sealed with them can still be read while you rotate. */
  DATA_KEY_PREVIOUS?: string;
  /** "1" once every row is encrypted: plaintext is then refused instead of tolerated. A Worker secret (production only). */
  VAULT_STRICT?: string;
  /** Optional overrides for the identity token's subject and audience. */
  WIF_SUBJECT?: string;
  WIF_AUDIENCE?: string;
}
