// The assistant's prompt (worker/persona.ts): Seaglass Open's assistant is Waffle, with a few lines of its own personality.
import { systemFor, voiceLine, WAFFLE } from "../../src/worker/persona.ts";

let ok = 0, bad = 0;
const check = (name: string, cond: boolean) => { if (cond) ok++; else { bad++; console.log("FAIL", name); } };

const base = "You are Jeff, the built-in assistant of Seaglass. Jeff keeps notes tidy.";
const out = systemFor(base);
check("the prompt names Waffle", out.startsWith("You are Waffle, the built-in assistant") && out.includes("Waffle keeps notes tidy"));
check("and no other assistant", !/\bJeff\b/.test(out));
check("Waffle's own lines are added once", out.endsWith(WAFFLE) && out.split(WAFFLE).length === 2);
check("the one-line voice for one-shot prompts is Waffle's", voiceLine().startsWith("You are Waffle"));
check("nothing in it assumes the user's gender", !/\b(The user|them|their|she|her)\b/i.test(WAFFLE + voiceLine()));

console.log(`${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
