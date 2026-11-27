// "Move to…": pick a new parent for a page, like Notion's Move to menu. Lists every page you could move it
// under (not itself, not anything inside it, not database rows or templates), with search and its path.
import { useMemo, useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import { PageIcon } from "../icons";
import { Popover } from "./ui";
import { IHome } from "../ui-icons";
import type { TreeNode } from "../types";

export function MovePicker({ id, onClose }: { id: string; onClose: () => void }) {
  const s = useStore();
  const [q, setQ] = useState("");
  const me = s.byId.get(id);

  const targets = useMemo(() => {
    // Everything inside this page is off limits (you can't move a page into its own sub-page).
    const inside = new Set([id]);
    for (let grew = true; grew;) { grew = false; for (const n of s.tree) if (n.parent_id && inside.has(n.parent_id) && !inside.has(n.id)) { inside.add(n.id); grew = true; } }
    const isRow = (n: TreeNode) => !!n.parent_id && s.byId.get(n.parent_id)?.kind === "database";
    return s.tree.filter((n) => n.kind === "page" && !inside.has(n.id) && !isRow(n) && !n.is_template && n.id !== me?.parent_id);
  }, [s.tree, s.byId, id, me?.parent_id]);

  const path = (n: TreeNode) => {
    const out: string[] = [];
    for (let p = n.parent_id ? s.byId.get(n.parent_id) : undefined; p && out.length < 3; p = p.parent_id ? s.byId.get(p.parent_id) : undefined) out.unshift(p.title || "New page");
    return out.join(" / ");
  };
  const query = q.trim().toLowerCase();
  const shown = targets.filter((n) => !query || (n.title || "new page").toLowerCase().includes(query)).slice(0, 60);

  const move = async (parent: TreeNode | null) => {
    onClose();
    try {
      await api.patch(id, { parent_id: parent ? parent.id : null });
      await s.refreshTree();
      s.toast(`Moved to ${parent ? parent.title || "New page" : "Private"}`);
    } catch (e) { s.toast((e as Error).message); }
  };

  return (
    <Popover onClose={onClose} className="move-pop">
      <input autoFocus className="move-search" placeholder="Move page to…" value={q} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && shown[0]) void move(shown[0]); }} />
      <div className="move-list">
        {!query && me?.parent_id && (
          <button onClick={() => void move(null)}><span className="move-ico"><IHome size={18} /></span><span className="move-t"><b>Private</b><small>Top level of your sidebar</small></span></button>
        )}
        {shown.map((n) => (
          <button key={n.id} onClick={() => void move(n)}>
            <span className="move-ico"><PageIcon icon={n.icon} kind={n.kind} size={18} /></span>
            <span className="move-t"><b>{n.title || "New page"}</b>{path(n) && <small>{path(n)}</small>}</span>
          </button>
        ))}
        {!shown.length && <p className="move-empty">No pages match.</p>}
      </div>
    </Popover>
  );
}
