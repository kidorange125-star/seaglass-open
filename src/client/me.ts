// The signed-in person (set by App from /api/session), for small personal touches like Home's greeting.
import type { Account } from "./api";

let me: Account | null = null;
export const setMe = (a: Account | null | undefined) => { me = a ?? null; };
export const myName = () => me?.display_name ?? "";
