// The signed-in person (set by App from /api/session), for small personal touches like Home's greeting.
import type { Account, Household } from "./api";

let me: Account | null = null;
export const setMe = (a: Account | null | undefined) => { me = a ?? null; };
export const myName = () => me?.display_name ?? "";

let home: Household | null = null;
export const setHome = (h: Household | null | undefined) => { home = h ?? null; };
/** True when this Seaglass is a household (so the shared Family space exists). */
export const isHousehold = () => home?.mode === "household";
export const homeName = () => home?.name || "Family";

let ai: { mode: "on" | "later" | "off"; connected: boolean } | null = null;
export const setAi = (a: typeof ai | undefined) => { ai = a ?? null; };
/** Whether this copy uses AI at all right now: on, and connected to Claude (setup's choice, Settings > Setup & status). */
export const aiReady = () => !ai || (ai.mode === "on" && ai.connected);

/** The assistant shows only in your own space, with AI on and connected. */
export const showAssistant = () => aiReady() && new URLSearchParams(location.search).get("space") !== "family";
