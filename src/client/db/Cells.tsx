import { ReactNode, useEffect, useRef, useState } from "react";
import { DatePicker, toDateVal } from "../components/DatePicker";
import { ArrowUp, Plus, X } from "lucide-react";
import { PageIcon } from "../icons";
import { swallowNextClick, useSheet } from "../components/ui";
import type { Note, Option, Prop, PropValue } from "../types";
import { COLORS, dateStart, DbCtx, display, getValue, optionOf } from "./logic";

// Popover anchored to a clicked element but positioned with `fixed`, so scrolling tables can't clip it.
export function FixedPop({ anchor, onClose, children, width = 260 }: { anchor: DOMRect; onClose: () => void; children: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(anchor.bottom + 4);
  const close = useSheet(ref, onClose);
  useEffect(() => {
    const h = ref.current?.offsetHeight ?? 0;
    if (anchor.bottom + 4 + h > innerHeight) setTop(Math.max(8, anchor.top - h - 4));
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { swallowNextClick(); close(); } };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    const t = setTimeout(() => addEventListener("mousedown", down), 0);
    addEventListener("keydown", key);
    return () => { clearTimeout(t); removeEventListener("mousedown", down); removeEventListener("keydown", key); };
  }, [anchor, close]);
  return <div ref={ref} className="popover fixed-pop" style={{ left: Math.max(8, Math.min(anchor.left, innerWidth - width - 12)), top, width }}>{children}</div>;
}

export const Chip = ({ o, small }: { o: Pick<Option, "name" | "color">; small?: boolean }) => <span className={`chip tag-${o.color} ${small ? "sm" : ""}`}>{o.name}</span>;

export interface CellActions {
  setProp: (row: Note, propId: string, value: PropValue) => void;
  createOption: (propId: string, name: string) => Option;
  open: (id: string) => void;
}
interface CellProps { prop: Prop; row: Note; ctx: DbCtx; act: CellActions; readOnly?: boolean }

// Read-only rendering (board cards, gallery, list, calendar).
export function CellView({ prop, row, ctx }: Omit<CellProps, "act">) {
  const v = getValue(row, prop, ctx);
  if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) return null;
  if (prop.type === "select" || prop.type === "status") { const o = optionOf(prop, v); return o ? <Chip o={o} small /> : null; }
  if (prop.type === "multi_select") return <>{((v as string[]) ?? []).map((id) => { const o = optionOf(prop, id); return o ? <Chip key={id} o={o} small /> : null; })}</>;
  if (prop.type === "checkbox") return <span>{v ? "☑" : "☐"}</span>;
  if (prop.type === "url") return <a className="lnk" href={String(v)} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>{String(v)}</a>;
  if (prop.type === "relation") return <>{display(prop, v, ctx).split(", ").filter(Boolean).map((t, i) => <span key={i} className="chip tag-gray sm">{t}</span>)}</>;
  return <span>{display(prop, v, ctx)}</span>;
}

function TextInput({ value, type = "text", onCommit, placeholder }: { value: string; type?: string; onCommit: (v: string) => void; placeholder?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return <input className="cell-input" type={type} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)}
    onBlur={() => v !== value && onCommit(v)} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setV(value); (e.target as HTMLInputElement).blur(); } }} />;
}

export function CellEdit({ prop, row, ctx, act, readOnly }: CellProps) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [q, setQ] = useState("");
  const v = getValue(row, prop, ctx);
  const set = (val: PropValue) => act.setProp(row, prop.id, val);
  const open = (e: React.MouseEvent) => { if (!readOnly) setAnchor(e.currentTarget.getBoundingClientRect()); };
  const close = () => { setAnchor(null); setQ(""); };

  switch (prop.type) {
    case "title": return <TextInput value={row.title} placeholder="Untitled" onCommit={(t) => act.setProp(row, "title", t)} />;
    case "text": case "url": case "email": case "phone":
      return readOnly ? <CellView prop={prop} row={row} ctx={ctx} /> : <TextInput value={(v as string) ?? ""} type={prop.type === "email" ? "email" : prop.type === "url" ? "url" : "text"} onCommit={set} />;
    case "number": return readOnly ? <CellView prop={prop} row={row} ctx={ctx} /> : <TextInput value={v === undefined || v === null ? "" : String(v)} type="number" onCommit={(s) => set(s === "" ? null : Number(s))} />;
    case "checkbox": return <input type="checkbox" className="cell-check" checked={!!v} disabled={readOnly} onChange={(e) => set(e.target.checked)} />;
    case "formula": case "rollup": case "created_time": case "last_edited_time": return <span className="ro"><CellView prop={prop} row={row} ctx={ctx} /></span>;
    case "date": {
      // The shared picker (DatePicker.tsx). On My tasks' Due it's the due date, with an optional earlier start.
      const tasksDue = ctx.schema.system === "tasks" && prop.id === "due";
      return (
        <>
          <button className="cell-btn" onClick={open}>{dateStart(v) ? display(prop, v) : <span className="muted">Empty</span>}</button>
          {anchor && <FixedPop anchor={anchor} onClose={close} width={296}>
            <DatePicker tasks={tasksDue} value={toDateVal(v)} onChange={(d) => set(d as PropValue)} />
          </FixedPop>}
        </>
      );
    }
    case "select": case "status": {
      const cur = optionOf(prop, v);
      const opts = (prop.options ?? []).filter((o) => o.name.toLowerCase().includes(q.toLowerCase()));
      return (
        <>
          <button className="cell-btn" onClick={open}>{cur ? <Chip o={cur} /> : <span className="muted">Empty</span>}</button>
          {anchor && <FixedPop anchor={anchor} onClose={close}>
            <input autoFocus placeholder="Search or create…" value={q} onChange={(ev) => setQ(ev.target.value)} onKeyDown={(ev) => { if (ev.key === "Enter" && q.trim()) { const ex = prop.options?.find((o) => o.name.toLowerCase() === q.trim().toLowerCase()); set((ex ?? act.createOption(prop.id, q.trim())).id); close(); } }} />
            {opts.map((o) => <button key={o.id} className="opt" onClick={() => { set(o.id); close(); }}><Chip o={o} /></button>)}
            {q.trim() && !prop.options?.some((o) => o.name.toLowerCase() === q.trim().toLowerCase()) && <button className="opt" onClick={() => { set(act.createOption(prop.id, q.trim()).id); close(); }}>Create <Chip o={{ name: q.trim(), color: "gray" }} /></button>}
            {cur && <button className="ghost" onClick={() => { set(null); close(); }}>Clear</button>}
          </FixedPop>}
        </>
      );
    }
    case "multi_select": {
      const ids = (v as string[]) ?? [];
      const opts = (prop.options ?? []).filter((o) => o.name.toLowerCase().includes(q.toLowerCase()));
      const toggle = (id: string) => set(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
      return (
        <>
          <button className="cell-btn" onClick={open}>{ids.length ? ids.map((id) => { const o = optionOf(prop, id); return o && <Chip key={id} o={o} />; }) : <span className="muted">Empty</span>}</button>
          {anchor && <FixedPop anchor={anchor} onClose={close}>
            <input autoFocus placeholder="Search or create…" value={q} onChange={(ev) => setQ(ev.target.value)} onKeyDown={(ev) => { if (ev.key === "Enter" && q.trim()) { const ex = prop.options?.find((o) => o.name.toLowerCase() === q.trim().toLowerCase()); const id = (ex ?? act.createOption(prop.id, q.trim())).id; if (!ids.includes(id)) set([...ids, id]); setQ(""); } }} />
            {opts.map((o) => <button key={o.id} className="opt" onClick={() => toggle(o.id)}><input type="checkbox" readOnly checked={ids.includes(o.id)} /><Chip o={o} /></button>)}
            {q.trim() && !prop.options?.some((o) => o.name.toLowerCase() === q.trim().toLowerCase()) && <button className="opt" onClick={() => { set([...ids, act.createOption(prop.id, q.trim()).id]); setQ(""); }}>Create <Chip o={{ name: q.trim(), color: "gray" }} /></button>}
          </FixedPop>}
        </>
      );
    }
    case "relation": {
      const ids = (v as string[]) ?? [];
      const target = ctx.related.get(prop.relation?.database_id ?? "");
      const rows = (target?.rows ?? []).filter((r) => !r.is_template && (r.title || "New page").toLowerCase().includes(q.toLowerCase())).slice(0, 40);
      return (
        <>
          <button className="cell-btn" onClick={open}>{ids.length ? display(prop, ids, ctx).split(", ").filter(Boolean).map((t, i) => <span key={i} className="chip tag-gray">{t}</span>) : <span className="muted">{target ? "Empty" : "Pick a database in settings"}</span>}</button>
          {anchor && target && <FixedPop anchor={anchor} onClose={close}>
            <input autoFocus placeholder="Search rows…" value={q} onChange={(ev) => setQ(ev.target.value)} />
            {rows.map((r) => <button key={r.id} className="opt" onClick={() => set(ids.includes(r.id) ? ids.filter((x) => x !== r.id) : [...ids, r.id])}><input type="checkbox" readOnly checked={ids.includes(r.id)} /><PageIcon icon={r.icon} size={15} /> {r.title || "New page"}</button>)}
            {!rows.length && <p className="muted">No rows</p>}
          </FixedPop>}
        </>
      );
    }
  }
}

export function OptionEditor({ prop, onChange }: { prop: Prop; onChange: (opts: Option[]) => void }) {
  const opts = prop.options ?? [];
  return (
    <div className="opt-editor">
      {opts.map((o, i) => (
        <div key={o.id} className="row">
          <select value={o.color} onChange={(e) => onChange(opts.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))} className={`tag-${o.color}`}>{COLORS.map((c) => <option key={c}>{c}</option>)}</select>
          <input value={o.name} onChange={(e) => onChange(opts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <button className="ghost" title="Move up" disabled={!i} onClick={() => { const a = [...opts]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; onChange(a); }}><ArrowUp size={14} /></button>
          <button className="ghost danger" onClick={() => onChange(opts.filter((_, j) => j !== i))}><X size={14} /></button>
        </div>
      ))}
      <button className="ghost" onClick={() => onChange([...opts, { id: Math.random().toString(36).slice(2, 9), name: `Option ${opts.length + 1}`, color: COLORS[opts.length % COLORS.length] }])}><Plus size={14} /> Add option</button>
    </div>
  );
}
