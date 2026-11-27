import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineQueued } from "./offline";
import { api, ApiError, Conflict } from "./api";
import { useStore } from "./store";
import type { Note } from "./types";

const fetchNote = (id: string): Promise<Note> => api.get(id);

export type SaveState = "saved" | "saving" | "conflict" | "error" | "offline";

// The editor adds invisible block ids (data-id) when a page opens. That is normalization, not an edit.
const stripBlockIds = (html: string) =>
  html.replace(/<[a-z0-9]+\b[^>]*>/gi, (tag) => (/data-type="(mention|child-page)"/.test(tag) ? tag : tag.replace(/ data-id="[0-9a-f-]{36}"/g, "")));

// Loads one note and autosaves edits. All writes go through one promise chain so autosave,
// icon/cover changes and so on can never race each other and trip the revision check.
export function useNote(id: string) {
  const store = useStore();
  const [note, setNote] = useState<Note | null>(null);
  const [missing, setMissing] = useState(false);
  const [status, setStatus] = useState<SaveState>("saved");
  const [version, setVersion] = useState(0);
  const [conflict, setConflict] = useState<Note | null>(null);
  const ref = useRef<Note | null>(null);
  ref.current = note;
  const serverHtml = useRef<string | null>(null); // last HTML known to be on the server
  const pending = useRef<Record<string, unknown>>({});
  const chain = useRef<Promise<void>>(Promise.resolve());
  const timer = useRef<number | undefined>(undefined);
  const storeRef = useRef(store);
  storeRef.current = store;

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    chain.current = chain.current.then(async () => {
      const patch = pending.current;
      const n = ref.current;
      if (!n || !Object.keys(patch).length) return;
      pending.current = {};
      setStatus("saving");
      try {
        let saved: Note | null = null;
        const rest: Record<string, unknown> = { ...patch };
        if (!saved || Object.keys(rest).length) saved = await api.patch(id, { ...rest, revision: n.revision });
        setNote((cur) => (cur ? { ...cur, revision: saved!.revision, updated_at: saved!.updated_at } : cur));
        ref.current = { ...(ref.current ?? n), revision: saved.revision };
        serverHtml.current = saved.html;
        setStatus("saved");
        const t: Record<string, unknown> = {};
        for (const k of ["title", "icon", "favorite", "locked", "is_template", "parent_id", "position"]) if (k in patch) t[k] = patch[k];
        if (Object.keys(t).length) storeRef.current.patchTreeLocal(id, { ...t, updated_at: saved.updated_at });
        if ("parent_id" in patch) void storeRef.current.refreshTree();
      } catch (e) {
        // Offline: the edit is safe in the device queue (offline.ts); it is sent when the connection returns.
        if (e instanceof OfflineQueued) { setStatus("offline"); return; }
        if (e instanceof Conflict) { pending.current = { ...patch, ...pending.current }; setConflict(e.current); setStatus("conflict"); }
        else { pending.current = { ...patch, ...pending.current }; setStatus("error"); if (e instanceof ApiError && e.status === 423) { setStatus("saved"); pending.current = {}; storeRef.current.toast("This page is locked"); void load(true); } }
      }
    });
    return chain.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Loads the note from the server. A response that arrives late must never clobber newer local state:
  // ignore it if I have unsaved edits, or if it is older than the revision I already hold. Pass force to
  // replace the content regardless (explicit reloads: "Load latest", imports).
  const load = useCallback(async (force = false) => {
    try {
      const n = await fetchNote(id);
      const cur = ref.current;
      if (!force && cur) {
        if (Object.keys(pending.current).length || n.revision <= cur.revision) return;
      }
      setNote(n); ref.current = n; serverHtml.current = n.html; setVersion((v) => v + 1); setMissing(false);
    } catch (e) { if (e instanceof ApiError && e.status === 404) setMissing(true); }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  // Save whatever is pending when leaving the page.
  useEffect(() => () => { void flush(); }, [flush]);

  // Pick up changes made elsewhere (agent, other device) when the tab regains focus.
  useEffect(() => {
    const f = async () => {
      if (document.hidden || Object.keys(pending.current).length || !ref.current) return;
      try {
        const fresh = await fetchNote(id);
        if (fresh.revision !== ref.current?.revision && !Object.keys(pending.current).length) { setNote(fresh); ref.current = fresh; setVersion((v) => v + 1); }
      } catch { /* ignore */ }
    };
    addEventListener("focus", f); document.addEventListener("visibilitychange", f);
    return () => { removeEventListener("focus", f); document.removeEventListener("visibilitychange", f); };
  }, [id]);

  // Another part of the app (sidebar move/rename/favorite...) patched this note: adopt its revision and
  // metadata so our next autosave doesn't trip a false conflict. Content changes by someone else are
  // left alone on purpose, so the real conflict banner still appears for those.
  useEffect(() => {
    const h = (e: Event) => {
      const { id: nid, note: fresh } = (e as CustomEvent<{ id: string; note: Note }>).detail;
      const cur = ref.current;
      if (nid !== id || !cur || fresh.revision <= cur.revision) return;
      if (fresh.html !== cur.html && !("html" in pending.current)) return;
      const merged: Record<string, unknown> = { ...cur };
      const own: string[] = [];
      for (const [k, v] of Object.entries(fresh)) if (k !== "html" && k !== "text" && !own.includes(k) && !(k in pending.current)) merged[k] = v;
      ref.current = merged as unknown as Note;
      setNote(ref.current);
    };
    addEventListener("seaglass:note-patched", h);
    return () => removeEventListener("seaglass:note-patched", h);
  }, [id]);

  // The agent (or an undo) changed notes: reload this page unless I have unsaved edits.
  useEffect(() => {
    const h = () => { if (!Object.keys(pending.current).length) void load(); };
    addEventListener("seaglass:agent-changed", h);
    return () => removeEventListener("seaglass:agent-changed", h);
  }, [load]);

  const edit = useCallback((patch: Record<string, unknown>, immediate = false) => {
    // Editor normalization (block ids only) is not a change: don't mark the page dirty or schedule a save.
    const keys = Object.keys(patch);
    if (keys.length === 1 && keys[0] === "html" && !("html" in pending.current) && serverHtml.current !== null
      && stripBlockIds(String(patch.html)) === stripBlockIds(serverHtml.current)) return;
    setNote((n) => (n ? { ...n, ...patch } as Note : n));
    ref.current = ref.current ? ({ ...ref.current, ...patch } as Note) : ref.current;
    pending.current = { ...pending.current, ...patch };
    if (immediate) void flush();
    else { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => void flush(), 650); }
  }, [flush]);

  const reloadLatest = useCallback(() => { pending.current = {}; setConflict(null); setStatus("saved"); void load(true); }, [load]);
  const keepMine = useCallback(() => {
    if (conflict && ref.current) { ref.current = { ...ref.current, revision: conflict.revision }; setNote(ref.current); }
    setConflict(null); void flush();
  }, [conflict, flush]);

  return { note, missing, status, edit, flush, version, conflict, reloadLatest, keepMine, reload: () => load(true), setNote };
}
