import { useMemo, useState } from "react";
import { coverCss } from "../covers";
import { ArrowUpRight, ChevronLeft, ChevronRight, Copy, Plus, Trash2 } from "lucide-react";
import { PageIcon, PropIcon } from "../icons";
import type { DbSchema, Note, Prop, PropValue, View } from "../types";
import { CellEdit, CellView, Chip, type CellActions } from "./Cells";
import { dateEnd, dateStart, DbCtx, groupRows, type Group } from "./logic";

export interface ViewActions extends CellActions {
  addRow: (init?: { props?: Record<string, PropValue>; title?: string }) => Promise<Note>;
  deleteRow: (id: string) => void;
  duplicateRow: (id: string) => void;
  openPropMenu: (propId: string, rect: DOMRect) => void;
  addProp: () => void;
}
export interface VP { rows: Note[]; schema: DbSchema; view: View; ctx: DbCtx; act: ViewActions; visible: Prop[] }

const groupProp = (schema: DbSchema, view: View) => schema.properties.find((p) => p.id === view.group_by);
const titleProp = (schema: DbSchema) => schema.properties.find((p) => p.type === "title")!;
const groupable = (p: Prop) => ["select", "status", "multi_select", "checkbox"].includes(p.type);
export const groupInitial = (p: Prop | undefined, g: Group): Record<string, PropValue> => {
  if (!p || g.key === "_all" || g.key === "_none") return {};
  if (p.type === "multi_select") return { [p.id]: [g.key] };
  if (p.type === "checkbox") return { [p.id]: g.key === "yes" };
  return groupable(p) ? { [p.id]: g.key } : {};
};
const Icon = ({ row }: { row: Note }) => <span className="ico"><PageIcon icon={row.icon} size={16} /></span>;

// ---------------------------------------------------------------- table

export function TableView({ rows, schema, view, ctx, act, visible }: VP) {
  const gp = groupProp(schema, view);
  const groups = useMemo(() => groupRows(rows, gp, ctx), [rows, gp, ctx]);
  const tp = titleProp(schema);
  const cols = visible.length + 2;
  return (
    <div className="dbtable-wrap">
      <table className="dbtable">
        <thead>
          <tr>
            <th className="c-title" onClick={(e) => act.openPropMenu(tp.id, e.currentTarget.getBoundingClientRect())}><span className="ti"><PropIcon type="title" /></span>{tp.name}</th>
            {visible.map((p) => <th key={p.id} onClick={(e) => act.openPropMenu(p.id, e.currentTarget.getBoundingClientRect())}><span className="ti"><PropIcon type={p.type} /></span>{p.name}</th>)}
            <th className="c-add"><button className="ghost icon-btn" style={{ width: 26, height: 26 }} title="Add a property" onClick={act.addProp}><Plus size={15} /></button></th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.key}>
            {gp && <tr className="grp"><td colSpan={cols}>{g.color ? <Chip o={{ name: g.label, color: g.color }} /> : <b>{g.label}</b>} <span className="muted">{g.rows.length}</span></td></tr>}
            {g.rows.map((r) => (
              <tr key={r.id} data-row={r.id} className="dbrow">
                <td className="c-title"><div className="rowline"><Icon row={r} /><CellEdit prop={tp} row={r} ctx={ctx} act={act} /><button className="open" onClick={() => act.open(r.id)}><ArrowUpRight size={12} /> Open</button></div></td>
                {visible.map((p) => <td key={p.id}><CellEdit prop={p} row={r} ctx={ctx} act={act} /></td>)}
                <td className="c-del"><button className="ghost icon-btn" style={{ width: 26, height: 26 }} title="Duplicate" onClick={() => act.duplicateRow(r.id)}><Copy size={14} /></button><button className="ghost danger icon-btn" style={{ width: 26, height: 26 }} title="Delete" onClick={() => act.deleteRow(r.id)}><Trash2 size={14} /></button></td>
              </tr>
            ))}
            <tr className="addrow"><td colSpan={cols} onClick={() => void act.addRow({ props: groupInitial(gp, g) })}><Plus size={15} /> New</td></tr>
          </tbody>
        ))}
      </table>
      <div className="dbcount muted">{rows.length} {rows.length === 1 ? "row" : "rows"}</div>
    </div>
  );
}

// ---------------------------------------------------------------- board

export function BoardView({ rows, schema, view, ctx, act, visible }: VP) {
  const gp = groupProp(schema, view) ?? schema.properties.find((p) => p.type === "status" || p.type === "select");
  const [over, setOver] = useState<string | null>(null);
  if (!gp) return <p className="muted pad">Add a Select or Status property to use the board view.</p>;
  const groups = groupRows(rows, gp, ctx);
  const drop = (g: Group, id: string) => {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    const val = gp.type === "multi_select" ? (g.key === "_none" ? [] : [g.key]) : gp.type === "checkbox" ? g.key === "yes" : g.key === "_none" ? null : g.key;
    act.setProp(row, gp.id, val as PropValue);
  };
  return (
    <div className="board">
      {groups.map((g) => (
        <div key={g.key} className={`col ${over === g.key ? "over" : ""}`} onDragOver={(e) => { e.preventDefault(); setOver(g.key); }} onDragLeave={() => setOver(null)}
          onDrop={(e) => { e.preventDefault(); setOver(null); drop(g, e.dataTransfer.getData("text/plain")); }}>
          <div className="col-head">{g.color ? <Chip o={{ name: g.label, color: g.color }} /> : <b>{g.label}</b>} <span className="muted">{g.rows.length}</span></div>
          {g.rows.map((r) => (
            <div key={r.id} className="bcard" draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", r.id)} onClick={() => act.open(r.id)}>
              <div className="bt"><Icon row={r} />{r.title || "New page"}</div>
              {visible.filter((p) => p.id !== gp.id).map((p) => <div key={p.id} className="bp"><CellView prop={p} row={r} ctx={ctx} /></div>)}
            </div>
          ))}
          <button className="ghost addcard" onClick={() => void act.addRow({ props: groupInitial(gp, g) })}><Plus size={15} /> New</button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- list

export function ListView({ rows, schema, view, ctx, act, visible }: VP) {
  const gp = groupProp(schema, view);
  const groups = groupRows(rows, gp, ctx);
  return (
    <div className="dblist">
      {groups.map((g) => (
        <div key={g.key}>
          {gp && <div className="grp-head">{g.color ? <Chip o={{ name: g.label, color: g.color }} /> : <b>{g.label}</b>} <span className="muted">{g.rows.length}</span></div>}
          {g.rows.map((r) => (
            <div key={r.id} className="lrow" onClick={() => act.open(r.id)}>
              <Icon row={r} /><span className="lt">{r.title || "New page"}</span>
              <span className="lprops">{visible.map((p) => <span key={p.id} className="lp"><CellView prop={p} row={r} ctx={ctx} /></span>)}</span>
            </div>
          ))}
          <div className="lrow add" onClick={() => void act.addRow({ props: groupInitial(gp, g) })}><Plus size={15} /> New</div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- gallery

export function GalleryView({ rows, ctx, act, visible }: VP) {
  return (
    <div className="gallery">
      {rows.map((r) => (
        <div key={r.id} className="gcard" onClick={() => act.open(r.id)}>
          <div className="gcover" style={r.cover ? { background: coverCss(r.cover) } : undefined}>{!r.cover && <PageIcon icon={r.icon} size={38} />}</div>
          <div className="gbody"><b>{r.icon ? `${r.icon} ` : ""}{r.title || "New page"}</b>
            {visible.map((p) => <div key={p.id} className="bp"><CellView prop={p} row={r} ctx={ctx} /></div>)}</div>
        </div>
      ))}
      <div className="gcard add" onClick={() => void act.addRow()}><Plus size={15} /> New</div>
    </div>
  );
}

// ---------------------------------------------------------------- calendar

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDay = (s: string, n: number) => { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n); return iso(d); };
const diffDays = (a: string, b: string) => Math.round((+new Date(a + "T00:00:00") - +new Date(b + "T00:00:00")) / 86400000);

export function CalendarView({ rows, schema, view, ctx, act }: VP) {
  const dp = schema.properties.find((p) => p.id === view.date_prop) ?? schema.properties.find((p) => p.type === "date");
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  if (!dp) return <p className="muted pad">Add a Date property to use the calendar.</p>;
  const first = new Date(cursor); first.setDate(1 - first.getDay());
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(first); d.setDate(first.getDate() + i); return iso(d); });
  const today = iso(new Date());
  const span = (r: Note) => { const v = r.props ? JSON.parse(typeof r.props === "string" ? r.props : JSON.stringify(r.props))[dp.id] : null; const s = dateStart(v); return s ? { s, e: dateEnd(v) || s } : null; };
  const spans = new Map(rows.map((r) => [r.id, span(r)]));
  const move = (id: string, day: string) => {
    const r = rows.find((x) => x.id === id), sp = spans.get(id);
    if (!r) return;
    const shift = sp ? diffDays(day, sp.s) : 0;
    act.setProp(r, dp.id, { start: day, ...(sp && sp.e !== sp.s ? { end: addDay(sp.e, shift) } : {}) });
  };
  const noDate = rows.filter((r) => !spans.get(r.id));
  return (
    <div className="cal">
      <div className="cal-nav">
        <button className="icon-btn" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}><ChevronLeft size={16} /></button>
        <b>{cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</b>
        <button className="icon-btn" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}><ChevronRight size={16} /></button>
        <button className="ghost" onClick={() => { const d = new Date(); d.setDate(1); setCursor(d); }}>Today</button>
      </div>
      <div className="cal-grid">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="dow">{d}</div>)}
        {days.map((day) => (
          <div key={day} className={`day ${day === today ? "today" : ""} ${new Date(day + "T00:00:00").getMonth() !== cursor.getMonth() ? "other" : ""}`}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); move(e.dataTransfer.getData("text/plain"), day); }}>
            <div className="dn"><span>{Number(day.slice(8))}</span><button className="ghost" title="Add" onClick={() => void act.addRow({ props: { [dp.id]: { start: day } } })}><Plus size={14} /></button></div>
            {rows.filter((r) => { const s = spans.get(r.id); return s && day >= s.s && day <= s.e; }).map((r) => (
              <div key={r.id} className="cev" draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", r.id)} onClick={() => act.open(r.id)}>{r.icon} {r.title || "New page"}</div>
            ))}
          </div>
        ))}
      </div>
      {noDate.length > 0 && <div className="nodate"><b className="muted">No date</b>{noDate.map((r) => <span key={r.id} className="cev" onClick={() => act.open(r.id)}>{r.title || "New page"}</span>)}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- timeline

export function TimelineView({ rows, schema, view, ctx, act }: VP) {
  const sp = schema.properties.find((p) => p.id === view.date_prop) ?? schema.properties.find((p) => p.type === "date");
  const ep = schema.properties.find((p) => p.id === view.end_date_prop);
  if (!sp) return <p className="muted pad">Add a Date property to use the timeline.</p>;
  const spans = rows.map((r) => {
    const props = typeof r.props === "string" ? JSON.parse(r.props) : r.props;
    const sv = props?.[sp.id], ev = ep ? props?.[ep.id] : null;
    const s = dateStart(sv); const e = dateEnd(sv) || dateStart(ev) || s;
    return { r, s, e: e < s ? s : e };
  });
  const dated = spans.filter((x) => x.s);
  const W = 34;
  const min = dated.length ? addDay(dated.reduce((m, x) => (x.s < m ? x.s : m), dated[0].s), -3) : iso(new Date());
  const maxRaw = dated.length ? dated.reduce((m, x) => (x.e > m ? x.e : m), dated[0].e) : addDay(min, 30);
  const total = Math.min(240, Math.max(30, diffDays(maxRaw, min) + 8));
  const ticks = Array.from({ length: total }, (_, i) => addDay(min, i));
  const today = diffDays(iso(new Date()), min);
  return (
    <div className="tl-wrap">
      <div className="tl" style={{ width: total * W + 180 }}>
        <div className="tl-head" style={{ paddingLeft: 180 }}>
          {ticks.map((t, i) => <div key={t} style={{ width: W }} className={`tick ${new Date(t + "T00:00:00").getDay() % 6 === 0 ? "we" : ""}`}>{i === 0 || t.endsWith("-01") ? <b>{new Date(t + "T00:00:00").toLocaleDateString(undefined, { month: "short" })}</b> : null}<span>{Number(t.slice(8))}</span></div>)}
        </div>
        {today >= 0 && today < total && <div className="tl-today" style={{ left: 180 + today * W + W / 2 }} />}
        {dated.map(({ r, s, e }) => (
          <div key={r.id} className="tl-row">
            <div className="tl-name" onClick={() => act.open(r.id)}>{r.icon} {r.title || "New page"}</div>
            <div className="tl-bar" style={{ left: 180 + diffDays(s, min) * W, width: (diffDays(e, s) + 1) * W - 4 }} onClick={() => act.open(r.id)} title={`${s} → ${e}`}>{r.title || "New page"}</div>
          </div>
        ))}
        <div className="tl-row"><div className="tl-name add" onClick={() => void act.addRow({ props: { [sp.id]: { start: iso(new Date()) } } })}><Plus size={15} /> New</div></div>
        {spans.some((x) => !x.s) && <div className="nodate"><b className="muted">No date</b>{spans.filter((x) => !x.s).map(({ r }) => <span key={r.id} className="cev" onClick={() => act.open(r.id)}>{r.title || "New page"}</span>)}</div>}
      </div>
    </div>
  );
}
