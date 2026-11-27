// Spoken replies for live voice. The keys stay on the Worker; the app sends one sentence at a time and plays what comes back.
// ElevenLabs if ELEVENLABS_API_KEY is set, otherwise Gemini through OpenRouter if OPENROUTER_API_KEY is set. With neither, the
// app uses the device's own voice. Replies are private: nothing here logs their text.
import type { Env } from "./env";

type VoiceEnv = Pick<Env, "ELEVENLABS_API_KEY" | "ELEVENLABS_VOICE_ID" | "OPENROUTER_API_KEY">;
export type VoiceProvider = "elevenlabs" | "gemini";
export const MAX_SPEAK_CHARS = 1200;
const DEFAULT_ELEVEN_VOICE = "JBFqnCBsd6RMkjVDRZzb";
const GEMINI_MODEL = "google/gemini-3.8-flash-lite-tts";

export class VoiceError extends Error {}
export const voiceProvider = (env: VoiceEnv): VoiceProvider | null => (env.ELEVENLABS_API_KEY ? "elevenlabs" : env.OPENROUTER_API_KEY ? "gemini" : null);

async function failure(r: Response): Promise<never> {
  const detail = await r.text().catch(() => "");
  if (/quota|credit|insufficient/i.test(detail) || r.status === 402) throw new VoiceError("The voice service is out of credits.");
  if (r.status === 401 || r.status === 403) throw new VoiceError("The voice service rejected its key.");
  if (r.status === 429) throw new VoiceError("The voice service is busy.");
  throw new VoiceError(`The voice service returned an error (${r.status}).`);
}

/** The audio for one piece of text: MP3 from ElevenLabs, or raw 24 kHz 16-bit PCM from Gemini. */
export async function speak(env: VoiceEnv, text: string, fetcher: typeof fetch = fetch): Promise<Response> {
  const headers = { "Content-Type": "application/octet-stream", "Cache-Control": "no-store" };
  if (env.ELEVENLABS_API_KEY) {
    const voice = encodeURIComponent(env.ELEVENLABS_VOICE_ID || DEFAULT_ELEVEN_VOICE);
    const r = await fetcher(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream?output_format=mp3_44100_64`, {
      method: "POST", headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: "eleven_flash_v2_5" }),
    });
    if (!r.ok) await failure(r);
    return new Response(r.body, { headers: { ...headers, "Content-Type": "audio/mpeg" } });
  }
  if (env.OPENROUTER_API_KEY) {
    const r = await fetcher("https://openrouter.ai/api/v1/audio/speech", {
      method: "POST", headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: GEMINI_MODEL, input: text, voice: "Achird", response_format: "pcm", instructions: "Warm, relaxed and conversational, like a friend talking." }),
    });
    if (!r.ok) await failure(r);
    return new Response(r.body, { headers: { ...headers, "Content-Type": "audio/pcm" } });
  }
  throw new VoiceError("No voice service is set up.");
}
