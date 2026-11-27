// A database's view shown on another page (#24, the editor's "dbView" block in nodes.tsx). Pick a database, then it works
// like the database itself (edit rows, switch views, filter); the view picked here is kept in the block, so the same
// database can show its board on one page and its chart on another. Changes save to the database.
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import { PageIcon } from "../icons";
import type { Note } from "../types";
import { DatabaseView } from "./DatabaseView";

export function LinkedDatabase({ dbId, viewId, onPick, onView, editable }: { dbId: string; viewId: string; onPick: (id: string) => void; onView: (id: string) => void; editable: boolean }) {
  const store = useStore();
  const [note, setNote] = useState<Note | null>(null);
  const [gone, setGone] = useState(false);
  const pending = useRef<Record<string, unknown>>({});
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!dbId) return;
    let on = true;
    api.get(dbId).then((n) => { if (on) { if (n.kind === "database" && !n.deleted_at) setNote(n); else setGone(true); } }).catch(() => on && setGone(true));
    return () => { on = false; };
  }, [dbId]);
  const flush = () => { const p = pending.current; pending.current = {}; if (Object.keys(p).length) api.patch(dbId, p).catch((e) => store.toast(`Couldn't save: ${(e as Error).message}`)); };
  useEffect(() => () => { window.clearTimeout(timer.current); flush(); }, [dbId]); // eslint-disable-line react-hooks/exhaustive-deps
  const edit = (patch: Record<string, unknown>, now = false) => {
    setNote((n) => (n ? ({ ...n, ...patch, ...(patch.db_schema && typeof patch.db_schema !== "string" ? { db_schema: JSON.stringify(patch.db_schema) } : {}) } as Note) : n));
    pending.current = { ...pending.current, ...patch };
    window.clearTimeout(timer.current);
    if (now) flush(); else timer.current = window.setTimeout(flush, 500);
  };

  if (!dbId) {
    const dbs = store.tree.filter((n) => n.kind === "database" && !n.is_template);
    return (
      <div className="ldb-pick">
        <b>Show a database here</b>
        {dbs.length ? <div className="ldb-list">{dbs.map((d) => <button key={d.id} disabled={!editable} onClick={() => onPick(d.id)}><PageIcon icon={d.icon} kind="database" size={16} /> {d.title || "Untitled"}</button>)}</div>
          : <p className="muted">No databases yet. Make one with / and "Database", then link it here.</p>}
      </div>
    );
  }
  if (gone) return <div className="ldb-pick muted">The linked database was deleted or moved to the trash.{editable && <> <button className="ghost" onClick={() => onPick("")}>Pick another</button></>}</div>;
  if (!note) return <div className="skeleton" style={{ height: 120 }} />;
  return (
    <div className="ldb">
      <a className="ldb-title" href={`#/p/${note.id}`} onClick={(e) => { e.preventDefault(); store.go(`/p/${note.id}`); }}><PageIcon icon={note.icon} kind="database" size={18} /> {note.title || "Untitled"}</a>
      <DatabaseView note={note} edit={edit} embed={{ viewId, onView }} />
    </div>
  );
}
