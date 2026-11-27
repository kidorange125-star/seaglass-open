// Settings > Assistant permissions: what Waffle may do on its own, what it asks about first, and what it never does.
// worker/approvals.ts keeps the settings and enforces them.
import { useEffect, useState } from "react";
import { api, type AgentPermissions, type PermLevel } from "../api";
import { useStore } from "../store";
import { agentName } from "../persona";
import { IClose } from "../ui-icons";

type Kind = keyof AgentPermissions;
const ROWS: { kind: Kind; title: string; what: string }[] = [
  { kind: "add", title: "Add things", what: "New pages, database rows, tasks and study sessions" },
  { kind: "edit", title: "Edit things", what: "Change pages, rows, subjects and tests" },
  { kind: "delete", title: "Move to the trash", what: "Pages can be brought back from the trash" },
  { kind: "memory", title: "Remember facts about you", what: "Short notes it keeps to help you later" },
  { kind: "routines", title: "Set up routines", what: "Jobs that run by themselves on a schedule" },
  { kind: "web", title: "Search the web", what: "Look things up and read web pages" },
];
const PRESETS: { id: "careful" | "balanced" | "free"; title: string; what: string }[] = [
  { id: "careful", title: "Ask before changes", what: "Approve every change first" },
  { id: "balanced", title: "Ask before deleting", what: "Adds and edits freely, asks before trashing" },
  { id: "free", title: "Act freely", what: "Does it, and you can undo anything" },
];
const LEVELS: { id: PermLevel; label: string }[] = [{ id: "allow", label: "Allow" }, { id: "ask", label: "Ask" }, { id: "never", label: "Never" }];
const same = (a: AgentPermissions, b: AgentPermissions) => (Object.keys(a) as Kind[]).every((k) => a[k] === b[k]);

export function PermissionsDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [perm, setPerm] = useState<AgentPermissions | null>(null);
  const [presets, setPresets] = useState<Record<string, AgentPermissions>>({});
  useEffect(() => { api.agentPermissions().then((r) => { setPerm(r.permissions); setPresets(r.presets); }).catch((e) => s.toast((e as Error).message)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onClose]);

  const save = async (next: AgentPermissions) => {
    const before = perm; setPerm(next);
    try { setPerm((await api.setAgentPermissions(next)).permissions); } catch (e) { setPerm(before); s.toast((e as Error).message); }
  };
  const current = perm ? PRESETS.find((p) => presets[p.id] && same(presets[p.id], perm))?.id ?? "custom" : null;
  const name = agentName();

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal perms" role="dialog" aria-label="Assistant permissions" onMouseDown={(e) => e.stopPropagation()}>
        <div className="memory-head">
          <div><b>What {name} can do</b><small>{name} only acts when you ask it to. Choose what it does straight away and what it checks with you first. Every change can be undone.</small></div>
          <button className="ghost icon-btn" aria-label="Close" onClick={onClose}><IClose size={18} /></button>
        </div>
        {perm && (
          <>
            <div className="w-choices perm-presets" role="radiogroup" aria-label="Presets">
              {PRESETS.map((p) => (
                <button key={p.id} type="button" role="radio" aria-checked={current === p.id} className={current === p.id ? "on" : ""} onClick={() => presets[p.id] && void save(presets[p.id])}>
                  <b>{p.title}</b><small>{p.what}</small>
                </button>
              ))}
            </div>
            {current === "custom" && <p className="muted perm-custom">Your own mix:</p>}
            <ul className="perm-rows">
              {ROWS.map((r) => (
                <li key={r.kind}>
                  <div><b>{r.title}</b><small>{r.what}</small></div>
                  <div className="seg" role="radiogroup" aria-label={r.title}>
                    {LEVELS.filter((l) => r.kind !== "web" || l.id !== "ask").map((l) => (
                      <button key={l.id} role="radio" aria-checked={perm[r.kind] === l.id} className={perm[r.kind] === l.id ? "on" : ""} onClick={() => void save({ ...perm, [r.kind]: l.id })}>
                        {r.kind === "web" && l.id === "never" ? "Off" : l.label}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
            <p className="muted perm-note">Routines, quick actions and live voice can't stop to ask, so they skip anything set to Ask. Apps you connect over MCP, like Claude, ask in their own way.</p>
          </>
        )}
      </div>
    </div>
  );
}
