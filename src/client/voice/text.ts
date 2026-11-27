// Turning a streaming reply into things to say: whole sentences as soon as they're ready (so speech starts early), with the
// markdown taken out. Pure, so tests/unit/voice.test.mts can load it in Node.

// A full stop after one of these doesn't end the sentence.
const NOT_THE_END = /(?:\b(?:Mr|Mrs|Ms|Dr|St|vs|etc|e\.g|i\.e|Jr|Sr|Prof)|\b[A-Z])\.$/;
const BOUNDARY = /[.!?…]+["'”’)\]]*(?=\s)|\n+/g;

/** Splits off the finished sentences. Very short ones wait to join the next, so speech doesn't sound chopped up. */
/** What a small speech model writes when there's nothing to write: sound labels, and a few stock phrases from its training. */
export function cleanHeard(text: string, voicedMs: number) {
  const t = text.replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, " ").replace(/\s+/g, " ").trim();
  const bare = t.toLowerCase().replace(/[^a-z ]/g, "").trim();
  if (!bare || bare === "you") return "";
  if (/^(thank you|thanks|thanks for watching|thank you for watching|bye)$/.test(bare) && voicedMs < 500) return "";
  return t;
}

export function takeSentences(buffer: string, min = 24): { done: string[]; rest: string } {
  const done: string[] = [];
  let start = 0;
  for (const m of buffer.matchAll(BOUNDARY)) {
    const end = (m.index ?? 0) + m[0].length, piece = buffer.slice(start, end).trim(), newline = m[0].startsWith("\n");
    if (!piece) { start = end; continue; }
    if (!newline && (NOT_THE_END.test(piece) || piece.length < min)) continue;
    done.push(piece);
    start = end;
  }
  return { done, rest: buffer.slice(start).replace(/^\s+/, "") };
}

const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}'\s]/gu, " ").split(/\s+/).filter(Boolean);

/**
 * The recognizer also hears the assistant through the speakers. This takes its words off the front of what was heard: a word
 * counts as echo if it sits next to its real neighbour from what was said. Matching pairs rather than single words means
 * "what about the membrane" isn't thrown away just because those words came up somewhere in the reply.
 */
export function stripEcho(heard: string, spoken: string): string {
  const said = words(spoken), raw = heard.trim().split(/\s+/).filter(Boolean);
  if (!said.length || !raw.length) return raw.join(" ");
  const single = new Set(said), pairs = new Set(said.slice(1).map((w, i) => `${said[i]} ${w}`));
  const ts = raw.map((r) => words(r).join(""));
  const echo = (i: number) => single.has(ts[i]) && (ts.length === 1 || (i > 0 && pairs.has(`${ts[i - 1]} ${ts[i]}`)) || (i + 1 < ts.length && pairs.has(`${ts[i]} ${ts[i + 1]}`)));
  let start = 0;
  while (start < raw.length && echo(start)) start++;
  return raw.slice(start).join(" ");
}

const CUT_IN = new Set(["stop", "wait", "hold", "no", "nope", "hey", "sorry", "actually", "okay", "ok", "yeah", "yes", "but"]);
/** Has the user really started talking? Two new words, or one word people use to cut in. A single stray word isn't enough. */
export function wantsIn(heard: string, spoken: string): boolean {
  const ts = words(heard);
  if (ts.length >= 2) return true;
  return ts.length === 1 && CUT_IN.has(ts[0]) && !words(spoken).slice(-6).includes(ts[0]);
}

/** What a piece of markdown sounds like read aloud. */
export function speakable(md: string): string {
  return md
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?:;]|$)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/** What the transcription model returns, as far as live voice reads it. */
export interface HeardRaw {
  transcription_info?: { duration?: number; duration_after_vad?: number };
  segments?: { end?: number; text?: string; no_speech_prob?: number; avg_logprob?: number; words?: { end?: number }[] }[];
}
/** From the model's answer: the words, how long the recording is, and how long it has been quiet since the last word. */
export function heardFrom(r: HeardRaw): { text: string; duration: number; quiet: number } {
  const duration = r.transcription_info?.duration ?? 0;
  const segments = (r.segments ?? []).filter((x) => (x.text ?? "").trim() && !((x.no_speech_prob ?? 0) > 0.8 && (x.avg_logprob ?? 0) < -1));
  const text = segments.map((x) => (x.text ?? "").trim()).join(" ").replace(/\s+/g, " ").trim();
  if (!text || r.transcription_info?.duration_after_vad === 0) return { text: "", duration, quiet: duration };
  const last = segments[segments.length - 1], end = last.words?.length ? last.words[last.words.length - 1].end ?? last.end ?? duration : last.end ?? duration;
  return { text, duration, quiet: Math.max(0, duration - end) };
}
