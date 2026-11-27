// The assistant's name and picture. Seaglass Open's assistant is Waffle, a small cyan star drawn in code (waffle.tsx).
// Kept as a module (with the same functions as before) so the rest of the app doesn't care which assistant it is.
import { useSyncExternalStore } from "react";

export type PersonaId = "waffle";
export const PERSONAS: { id: PersonaId; name: string; blurb: string }[] = [{ id: "waffle", name: "Waffle", blurb: "A star with eyes that spins when it thinks" }];
const current: PersonaId = "waffle";
document.documentElement.dataset.persona = current;

export const persona = () => current;
/** The assistant's name for UI text ("Ask Waffle", "Waffle's memory"). */
export const agentName = () => "Waffle";
/** Re-renders the caller when the assistant changes (it doesn't in Seaglass Open). */
export const usePersona = () => useSyncExternalStore(() => () => {}, () => current);
export async function choosePersona(_id: PersonaId) { /* one assistant */ }
export async function syncPersona() { /* one assistant */ }
