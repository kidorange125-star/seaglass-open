// Live voice: splitting a streaming reply into sentences, making it readable aloud, and what gets sent to the voice services.
import { cleanHeard, heardFrom, speakable, stripEcho, takeSentences, wantsIn } from "../../src/client/voice/text.ts";
import { MAX_SPEAK_CHARS, speak, VoiceError, voiceProvider } from "../../src/worker/voice.ts";

let ok = 0, bad = 0;
const eq = (what: string, got: unknown, want: unknown) => { const a = JSON.stringify(got), b = JSON.stringify(want); if (a === b) ok++; else { bad++; console.log(`FAIL ${what}\n  got  ${a}\n  want ${b}`); } };

eq("a finished sentence is taken, the unfinished one waits", takeSentences("Osmosis moves water across a membrane. And then the"), { done: ["Osmosis moves water across a membrane."], rest: "And then the" });
eq("no whitespace yet means it may not be finished", takeSentences("Osmosis moves water across a membrane.").done, []);
eq("a short sentence joins the next", takeSentences("Sure thing. Osmosis moves water across a membrane. ").done, ["Sure thing. Osmosis moves water across a membrane."]);
eq("decimals don't split", takeSentences("The average came out to 3.5 points overall this time. ").done, ["The average came out to 3.5 points overall this time."]);
eq("abbreviations don't split", takeSentences("You should email Dr. Patel about the lab report today. ").done, ["You should email Dr. Patel about the lab report today."]);
eq("initials don't split", takeSentences("The president was Harry S. Truman at the end of the war. ").done, ["The president was Harry S. Truman at the end of the war."]);
eq("questions and exclamations end sentences", takeSentences("Do you want to go over it again? I think that would help! ").done, ["Do you want to go over it again?", "I think that would help!"]);
eq("a closing quote stays with its sentence", takeSentences('She said it was "the best answer so far." Then she left the room after that. ').done, ['She said it was "the best answer so far."', "Then she left the room after that."]);
eq("a new line ends a piece, however short", takeSentences("Yes\nOkay then").done, ["Yes"]);
eq("empty", takeSentences(""), { done: [], rest: "" });

eq("bold and italics", speakable("This is **really** *important* now"), "This is really important now");
eq("snake_case survives", speakable("the study_sets table"), "the study_sets table");
eq("links keep their words", speakable("See [Britannica](https://x.com/a) for more"), "See Britannica for more");
eq("bare links go", speakable("Read https://x.com/a today"), "Read today");
eq("headings and bullets", speakable("# Title\n- one\n2. two"), "Title one two");
eq("code blocks aren't read", speakable("Here:\n```js\nlet x\n```\ndone"), "Here: done");
eq("inline code loses its ticks", speakable("use `npm test` now"), "use npm test now");
eq("nothing left to say", speakable("```\ncode\n```"), "");

// talking over it
const SAID = "Osmosis moves water across a membrane from low to high concentration.";
eq("the assistant's own words are its echo", stripEcho("osmosis moves water across", SAID), "");
eq("punctuation and case don't matter", stripEcho("Osmosis, moves WATER!", SAID), "");
eq("their words after the echo are kept", stripEcho("across a membrane wait what about ions", SAID), "wait what about ions");
eq("words that came up, but not in that order, are their", stripEcho("what about the membrane", SAID), "what about the membrane");
eq("one stray echoed word goes", stripEcho("membrane", SAID), "");
eq("before it has said anything, everything is their", stripEcho("hello there", ""), "hello there");
eq("two new words is talking", wantsIn("wait what", SAID), true);
eq("one cut-in word is enough", wantsIn("stop", SAID), true);
eq("one other word isn't", wantsIn("purple", SAID), false);
eq("nothing isn't", wantsIn("", SAID), false);
eq("a cut-in word it just said is an echo", wantsIn("actually", "That one is actually"), false);
eq("a very short first sentence can go straight out", takeSentences("Sure, happy to. Osmosis is", 8).done, ["Sure, happy to."]);

// a small model on the phone
eq("clean: keeps real words", cleanHeard(" What should I study tonight?", 1500), "What should I study tonight?");
eq("clean: drops sound labels", cleanHeard(" [BLANK_AUDIO]", 1500), "");
eq("clean: drops labels inside speech", cleanHeard(" (coughs) Hello there [music]", 1500), "Hello there");
eq("clean: a lone 'you' is always a phantom", cleanHeard(" you", 2000), "");
eq("clean: a stock phrase from a blip is a phantom", cleanHeard(" Thank you.", 300), "");
eq("clean: but the user can really say thank you", cleanHeard(" Thank you.", 800), "Thank you.");

// the server's ear
const seg = (text: string, end: number, extra = {}) => ({ text, end, no_speech_prob: 0, avg_logprob: -0.2, ...extra });
eq("heard: words and the quiet since the last one", heardFrom({ transcription_info: { duration: 5, duration_after_vad: 3.2 }, segments: [{ ...seg(" What should I study?", 2.9), words: [{ end: 0.5 }, { end: 2.5 }] }] }), { text: "What should I study?", duration: 5, quiet: 2.5 });
eq("heard: without word times, the segment's end", heardFrom({ transcription_info: { duration: 4 }, segments: [seg(" Hi there", 1.5)] }).quiet, 2.5);
eq("heard: several segments join", heardFrom({ transcription_info: { duration: 6 }, segments: [seg(" One.", 2), seg(" Two.", 5.5)] }), { text: "One. Two.", duration: 6, quiet: 0.5 });
eq("heard: silence", heardFrom({ transcription_info: { duration: 3, duration_after_vad: 0 }, segments: [] }), { text: "", duration: 3, quiet: 3 });
eq("heard: no speech found means no words, whatever the model wrote", heardFrom({ transcription_info: { duration: 3, duration_after_vad: 0 }, segments: [seg(" Thank you.", 1)] }).text, "");
eq("heard: a segment the model itself doubts is dropped", heardFrom({ transcription_info: { duration: 3 }, segments: [seg(" you", 1, { no_speech_prob: 0.9, avg_logprob: -1.4 })] }).text, "");
eq("heard: an empty answer", heardFrom({}), { text: "", duration: 0, quiet: 0 });

eq("no keys, no provider", voiceProvider({}), null);
eq("ElevenLabs wins when both are set", voiceProvider({ ELEVENLABS_API_KEY: "a", OPENROUTER_API_KEY: "b" }), "elevenlabs");
eq("OpenRouter alone", voiceProvider({ OPENROUTER_API_KEY: "b" }), "gemini");
eq("there's a limit per sentence", MAX_SPEAK_CHARS > 200, true);

const stub = (status = 200, body = "audio") => { const calls: { url: string; init: RequestInit }[] = []; const f = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(body, { status }); }) as unknown as typeof fetch; return { f, calls }; };
{
  const { f, calls } = stub();
  const r = await speak({ ELEVENLABS_API_KEY: "k1" }, "Hello there", f);
  eq("ElevenLabs: streaming endpoint with Flash output", calls[0].url.startsWith("https://api.elevenlabs.io/v1/text-to-speech/") && calls[0].url.includes("/stream?output_format=mp3_44100_64"), true);
  eq("ElevenLabs: key in its header", (calls[0].init.headers as Record<string, string>)["xi-api-key"], "k1");
  eq("ElevenLabs: the text and the fast model", JSON.parse(calls[0].init.body as string), { text: "Hello there", model_id: "eleven_flash_v2_5" });
  eq("ElevenLabs: comes back as MP3", r.headers.get("Content-Type"), "audio/mpeg");
  eq("not cached", r.headers.get("Cache-Control"), "no-store");
}
{
  const { f, calls } = stub();
  await speak({ ELEVENLABS_API_KEY: "k1", ELEVENLABS_VOICE_ID: "myvoice" }, "Hi", f);
  eq("a chosen voice is used", calls[0].url.includes("/text-to-speech/myvoice/stream"), true);
}
{
  const { f, calls } = stub();
  const r = await speak({ OPENROUTER_API_KEY: "k2" }, "Hello", f);
  const sent = JSON.parse(calls[0].init.body as string);
  eq("Gemini: OpenRouter's speech endpoint", calls[0].url, "https://openrouter.ai/api/v1/audio/speech");
  eq("Gemini: bearer key", (calls[0].init.headers as Record<string, string>).Authorization, "Bearer k2");
  eq("Gemini: model, text and raw audio", [sent.model, sent.input, sent.response_format], ["google/gemini-3.8-flash-lite-tts", "Hello", "pcm"]);
  eq("Gemini: comes back as PCM", r.headers.get("Content-Type"), "audio/pcm");
}
const failsWith = async (status: number, body: string) => { try { await speak({ ELEVENLABS_API_KEY: "k" }, "x", stub(status, body).f); return ""; } catch (e) { return e instanceof VoiceError ? e.message : "wrong error"; } };
eq("out of credits", await failsWith(401, '{"detail":{"status":"quota_exceeded"}}'), "The voice service is out of credits.");
eq("bad key", await failsWith(401, "{}"), "The voice service rejected its key.");
eq("busy", await failsWith(429, "{}"), "The voice service is busy.");
eq("other", await failsWith(500, "{}"), "The voice service returned an error (500).");

console.log(`${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
