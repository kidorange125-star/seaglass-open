// What Waffle remembers about you: facts it saved with its remember tool (or you added here). It sees them in
// every chat. You can add, edit and delete them; nothing here is note content, so it isn't in page history.
import { useEffect, useState } from "react";
import { api, type Memory } from "../api";
import { useStore } from "../store";
import { JeffAvatar } from "../icons";
import { IClose, IPlus, ITrash } from "../ui-icons";
import { timeAgo } from "./ui";
import { agentName } from "../persona";

const SOURCE = (): Record<string, string> => ({ agent: agentName(), mcp: "Claude", user: "You" });

export function MemoryDialog() {
  const s = useStore();
  const [items, setItems] = useState<Memory[] | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  const load = () => api.memories().then(setItems).catch((e) => { setItems([]); s.toast((e as Error).message); });
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !editing) s.setMemoryOpen(false); };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  }, [editing, s]);

  const add = async () => {
    const text = draft.trim(); if (!text) return;
    try { await api.addMemory(text); setDraft(""); await load(); } catch (e) { s.toast((e as Error).message); }
  };
  const save = async () => {
    if (!editing) return;
    try { await api.updateMemory(editing.id, editing.text); setEditing(null); await load(); } catch (e) { s.toast((e as Error).message); }
  };
  const remove = async (id: string) => { setItems((xs) => xs?.filter((x) => x.id !== id) ?? xs); try { await api.deleteMemory(id); } catch (e) { s.toast((e as Error).message); void load(); } };

  return (
    <div className="modal-back" onMouseDown={() => s.setMemoryOpen(false)}>
      <div className="modal memory" role="dialog" aria-label={`${agentName()}'s memory`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="memory-head">
          <JeffAvatar size={36} />
          <div><b>{agentName()}'s memory</b><small>Things {agentName()} remembers about you and uses in every chat. Say "remember that…" in a chat, or add one here.</small></div>
          <button className="ghost icon-btn" aria-label="Close" onClick={() => s.setMemoryOpen(false)}><IClose size={18} /></button>
        </div>
        <form className="memory-add" onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. My Algebra tests are on Fridays" maxLength={500} />
          <button className="primary" disabled={!draft.trim()}><IPlus size={16} /> Add</button>
        </form>
        <div className="memory-list">
          {items === null ? <div className="skeleton" style={{ height: 40 }} />
            : !items.length ? <p className="memory-empty">Nothing yet. {agentName()} saves things you share about yourself, like your classes, schedule and how you like your notes.</p>
            : items.map((m) => (
              <div key={m.id} className="memory-row">
                {editing?.id === m.id ? (
                  <form className="memory-edit" onSubmit={(e) => { e.preventDefault(); void save(); }}>
                    <input autoFocus value={editing.text} maxLength={500} onChange={(e) => setEditing({ id: m.id, text: e.target.value })} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setEditing(null); } }} />
                    <button className="primary">Save</button>
                  </form>
                ) : (
                  <>
                    <button className="memory-text" title="Edit" onClick={() => setEditing({ id: m.id, text: m.text })}>{m.text}<small>{SOURCE()[m.source] ?? m.source} · {timeAgo(m.updated_at)}</small></button>
                    <button className="ghost icon-btn" aria-label={`Forget: ${m.text}`} title="Forget" onClick={() => void remove(m.id)}><ITrash size={16} /></button>
                  </>
                )}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
