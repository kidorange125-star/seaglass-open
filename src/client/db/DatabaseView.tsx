import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GradeSummary } from "../components/StudyTools";
import { rollRepeat } from "../recur";
import { ArrowUpDown, ChevronDown, CornerUpLeft, Download, Layers, ListFilter, MoreHorizontal, Plus, SlidersHorizontal, Upload, X } from "lucide-react";
import { ChartView } from "./ChartView";
import { chartProps, defaultChart } from "./chart";
import { exportRows, importPlan, parseCsv, toCsv } from "./csv";
import { download } from "../components/ui";
import { PageIcon, PropIcon, ViewIcon } from "../icons";
import { api } from "../api";
import { useStore } from "../store";
import type { DbSchema, Filter, Note, Option, Prop, PropType, PropValue, View, ViewType } from "../types";
import { CellEdit, FixedPop, OptionEditor, type CellActions } from "./Cells";
import {
  applyView, COLORS, DbCtx, defaultSchema, evalFormula, formulaHelp, newOption, newProp, newView, OPS, opGroup, parseProps,
  parseSchema, PROP_TYPES, uid, display,
} from "./logic";
import { BoardView, CalendarView, GalleryView, ListView, TableView, TimelineView, type ViewActions } from "./views";

const VIEW_TYPES: { type: ViewType; label: string }[] = [
  { type: "table", label: "Table" }, { type: "board", label: "Board" }, { type: "list", label: "List" },
  { type: "gallery", label: "Gallery" }, { type: "calendar", label: "Calendar" }, { type: "timeline", label: "Timeline" },
  { type: "chart", label: "Chart" },
];
type Edit = (p: Record<string, unknown>, now?: boolean) => void;

// Shared loader: a database's schema, its rows, and the rows of every database it relates to.
function useDbData(dbId: string, schema: DbSchema, selfRows?: Note[]) {
  const [related, setRelated] = useState<DbCtx["related"]>(new Map());
  const targets = useMemo(() => [...new Set(schema.properties.filter((p) => p.type === "relation" && p.relation?.database_id).map((p) => p.relation!.database_id))], [schema]);
  const key = targets.join(",");
  useEffect(() => {
    let live = true;
    (async () => {
      const m: DbCtx["related"] = new Map();
      for (const t of targets) {
        if (t === dbId && selfRows) { m.set(t, { schema, rows: selfRows }); continue; }
        try { const [d, rows] = await Promise.all([api.get(t), api.children(t)]); m.set(t, { schema: parseSchema(d.db_schema), rows }); } catch { /* target deleted */ }
      }
      if (live) setRelated(m);
    })();
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, dbId, selfRows, schema]);
  return related;
}

/** embed: shown on another page (LinkedDatabase.tsx), which keeps its own choice of view. */
export function DatabaseView({ note, edit, embed }: { note: Note; edit: Edit; embed?: { viewId: string; onView: (id: string) => void } }) {
  const store = useStore();
  const schema = useMemo(() => parseSchema(note.db_schema), [note.db_schema]);
  const [rows, setRows] = useState<Note[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [viewId, setViewId] = useState(() => { if (embed) return embed.viewId; try { return localStorage.getItem(`sg.view.${note.id}`) ?? ""; } catch { return ""; } });
  const [search, setSearch] = useState("");
  const [pop, setPop] = useState<null | { kind: "filter" | "sort" | "group" | "props" | "new" | "view" | "addview" | "prop" | "more"; rect: DOMRect; propId?: string }>(null);
  const locked = !!note.locked;

  const related = useDbData(note.id, schema, rows);
  const ctx: DbCtx = useMemo(() => ({ schema, related }), [schema, related]);
  const view = schema.views.find((v) => v.id === viewId) ?? schema.views[0];

  useEffect(() => { if (!note.db_schema) edit({ db_schema: defaultSchema() }, true); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const load = useCallback(() => api.children(note.id).then((r) => { setRows(r); setLoaded(true); }).catch(() => {}), [note.id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    addEventListener("focus", load); addEventListener("seaglass:agent-changed", load);
    return () => { removeEventListener("focus", load); removeEventListener("seaglass:agent-changed", load); };
  }, [load]);

  const saveSchema = (s: DbSchema, now = false) => { if (!locked) edit({ db_schema: s }, now); };
  const upView = (patch: Partial<View>) => saveSchema({ ...schema, views: schema.views.map((v) => (v.id === view.id ? { ...v, ...patch } : v)) });
  const upProp = (id: string, patch: Partial<Prop>, now = false) => saveSchema({ ...schema, properties: schema.properties.map((p) => (p.id === id ? { ...p, ...patch } : p)) }, now);
  const pickView = (id: string) => { setViewId(id); if (embed) { embed.onView(id); return; } try { localStorage.setItem(`sg.view.${note.id}`, id); } catch { /* ignore */ } };

  // CSV (#24): the view as it's shown, out; a spreadsheet in, columns matched to properties by name
  const exportCsv = () => {
    const table = exportRows(shown, schema, visible, ctx);
    download(`${(note.title || "Database").replace(/[\\/:*?"<>|]+/g, " ").trim()}${schema.views.length > 1 ? ` (${view.name})` : ""}.csv`, toCsv(table), "text/csv");
  };
  const importCsv = () => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".csv,text/csv,.tsv,text/tab-separated-values";
    input.onchange = async () => {
      const f = input.files?.[0]; if (!f) return;
      if (f.size > 5 * 1024 * 1024) { store.toast("That file is over 5 MB"); return; }
      const plan = importPlan(schema, parseCsv(await f.text()));
      if (!plan.rows.length) { store.toast("No rows found in that file"); return; }
      if (plan.rows.length > 1000) { store.toast("That's over 1,000 rows. Split the file and import it in parts."); return; }
      if (!(await store.confirm(`Add ${plan.rows.length} row${plan.rows.length === 1 ? "" : "s"} to ${note.title || "this database"}?${plan.added.length ? ` New properties: ${plan.added.join(", ")}.` : ""}`))) return;
      if (plan.schema !== schema) saveSchema(plan.schema, true);
      store.toast(`Importing ${plan.rows.length} rows…`);
      const made: Note[] = [];
      for (const r of plan.rows) { try { made.push(await api.create({ parent_id: note.id, title: r.title, props: r.props })); } catch { /* keep going */ } }
      setRows((rs) => [...rs, ...made]);
      store.toast(`Imported ${made.length} row${made.length === 1 ? "" : "s"}${made.length < plan.rows.length ? ` (${plan.rows.length - made.length} failed)` : ""}`, { label: "Undo", run: async () => { for (const m of made) await api.trash(m.id).catch(() => {}); setRows((rs) => rs.filter((x) => !made.some((m) => m.id === x.id))); store.toast("Import undone"); } });
    };
    input.click();
  };

  const patchRow = (id: string, patch: Record<string, unknown>) => {
    setRows((rs) => rs.map((r) => (r.id === id ? ({ ...r, ...patch, ...(patch.props ? { props: JSON.stringify(patch.props) } : {}) } as Note) : r)));
    api.patch(id, patch).catch((e) => { store.toast(`Couldn't save: ${(e as Error).message}`); void load(); });
  };

  const act: ViewActions = {
    setProp: (row, propId, value) => {
      if (propId === "title") return patchRow(row.id, { title: String(value ?? "") });
      const props = { ...parseProps(row.props), [propId]: value };
      const rolled = rollRepeat(schema, props, localToday());
      if (rolled) store.toast(`Repeating task moved to ${rolled.next}`);
      return patchRow(row.id, { props: rolled ? rolled.props : props });
    },
    createOption: (propId, name) => {
      const p = schema.properties.find((x) => x.id === propId)!;
      const o = newOption(name, COLORS[(p.options?.length ?? 0) % COLORS.length]);
      upProp(propId, { options: [...(p.options ?? []), o] }, true);
      return o;
    },
    open: (id) => store.setPeek(id),
    addRow: async (init) => {
      const n = await api.create({ parent_id: note.id, title: init?.title ?? "", props: init?.props ?? {} });
      setRows((rs) => [...rs, n]);
      requestAnimationFrame(() => (document.querySelector(`tr[data-row="${n.id}"] input`) as HTMLInputElement | null)?.focus());
      return n;
    },
    deleteRow: async (id) => { await api.trash(id); setRows((rs) => rs.filter((r) => r.id !== id)); store.toast("Moved to trash"); },
    duplicateRow: async (id) => { const d = await api.duplicate(id); setRows((rs) => [...rs, d]); },
    openPropMenu: (propId, rect) => setPop({ kind: "prop", rect, propId }),
    addProp: () => {
      const p = newProp("text", `Property ${schema.properties.length}`);
      saveSchema({ ...schema, properties: [...schema.properties, p] }, true);
      const rect = document.querySelector(".dbtable .c-add")?.getBoundingClientRect() ?? new DOMRect(300, 200, 0, 0);
      setTimeout(() => setPop({ kind: "prop", rect, propId: p.id }), 50);
    },
  };

  const shown = useMemo(() => applyView(rows, view, ctx, search), [rows, view, ctx, search]);
  const visible = schema.properties.filter((p) => p.type !== "title" && !view.hidden.includes(p.id));
  const templates = rows.filter((r) => r.is_template);
  const vp = { rows: shown, schema, view, ctx, act, visible };
  const open = (kind: NonNullable<typeof pop>["kind"], e: React.MouseEvent, propId?: string) => setPop({ kind, rect: e.currentTarget.getBoundingClientRect(), propId });

  const body = !loaded ? <p className="muted pad">Loading…</p> : view.type === "chart" ? <ChartView {...vp} /> : view.type === "table" ? <TableView {...vp} /> : view.type === "board" ? <BoardView {...vp} /> : view.type === "list" ? <ListView {...vp} /> : view.type === "gallery" ? <GalleryView {...vp} /> : view.type === "calendar" ? <CalendarView {...vp} /> : <TimelineView {...vp} />;

  return (
    <div className="db">
      {schema.system === "grades" && <GradeSummary schema={schema} rows={rows} />}
      <div className="db-toolbar">
        <div className="tabs">
          {schema.views.map((v) => (
            <button key={v.id} className={`tab ${v.id === view.id ? "on" : ""}`} onClick={(e) => (v.id === view.id ? open("view", e) : pickView(v.id))}>
              <ViewIcon type={v.type} /> {v.name}
            </button>
          ))}
          <button className="ghost icon-btn" title="Add a view" onClick={(e) => open("addview", e)}><Plus size={16} /></button>
        </div>
        <div className="tools">
          <button className={`ghost icon-btn ${view.filters.length ? "active" : ""}`} title={view.filters.length ? `Filter (${view.filters.length})` : "Filter"} onClick={(e) => open("filter", e)}><ListFilter size={16} /><span className="tl">Filter</span></button>
          <button className={`ghost icon-btn ${view.sorts.length ? "active" : ""}`} title={view.sorts.length ? `Sort (${view.sorts.length})` : "Sort"} onClick={(e) => open("sort", e)}><ArrowUpDown size={16} /><span className="tl">Sort</span></button>
          {["table", "board", "list"].includes(view.type) && <button className={`ghost icon-btn ${view.group_by ? "active" : ""}`} title="Group" onClick={(e) => open("group", e)}><Layers size={16} /><span className="tl">Group</span></button>}
          <button className="ghost icon-btn" title="Properties" onClick={(e) => open("props", e)}><SlidersHorizontal size={16} /><span className="tl">Properties</span></button>
          <input className={`db-search ${search ? "has-q" : ""}`} placeholder="Type to search…" title="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className="ghost icon-btn" title="More: CSV import and export" aria-label="More" onClick={(e) => open("more", e)}><MoreHorizontal size={16} /></button>
          <span className="split">
            <button className="primary" onClick={() => void act.addRow()}>New</button>
            <button className="primary" title="New from template" onClick={(e) => open("new", e)}><ChevronDown size={15} /></button>
          </span>
        </div>
      </div>
      {(view.filters.length > 0 || search) && <div className="muted db-note">Showing {shown.length} of {rows.filter((r) => !r.is_template).length} rows</div>}
      {body}

      {pop && (
        <FixedPop anchor={pop.rect} onClose={() => setPop(null)} width={pop.kind === "filter" ? 460 : pop.kind === "prop" ? 320 : 280}>
          {pop.kind === "filter" && <FilterPanel schema={schema} view={view} onChange={upView} ctx={ctx} />}
          {pop.kind === "sort" && <SortPanel schema={schema} view={view} onChange={upView} />}
          {pop.kind === "group" && (
            <>
              <label className="fl">Group by</label>
              <select value={view.group_by ?? ""} onChange={(e) => upView({ group_by: e.target.value || undefined })}>
                <option value="">None</option>
                {schema.properties.filter((p) => ["select", "status", "multi_select", "checkbox"].includes(p.type)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </>
          )}
          {pop.kind === "props" && (
            <>
              {schema.properties.filter((p) => p.type !== "title").map((p) => (
                <label key={p.id} className="switch"><input type="checkbox" checked={!view.hidden.includes(p.id)} onChange={(e) => upView({ hidden: e.target.checked ? view.hidden.filter((h) => h !== p.id) : [...view.hidden, p.id] })} /> <PropIcon type={p.type} /> {p.name}</label>
              ))}
              <button className="ghost" onClick={() => { setPop(null); act.addProp(); }}><Plus size={15} /> New property</button>
            </>
          )}
          {pop.kind === "more" && (
            <>
              <button className="opt" onClick={() => { setPop(null); exportCsv(); }}><Download size={15} /> Export this view as CSV</button>
              {!locked && <button className="opt" onClick={() => { setPop(null); importCsv(); }}><Upload size={15} /> Import CSV</button>}
            </>
          )}
          {pop.kind === "addview" && VIEW_TYPES.map((t) => (
            <button key={t.type} className="opt" onClick={() => { const v = newView(t.type); const dp = schema.properties.find((p) => p.type === "date"); if (dp) v.date_prop = dp.id; if (t.type === "chart") v.chart = defaultChart(schema); saveSchema({ ...schema, views: [...schema.views, v] }, true); pickView(v.id); setPop(null); }}><ViewIcon type={t.type} /> {t.label}</button>
          ))}
          {pop.kind === "view" && <ViewPanel schema={schema} view={view} close={() => setPop(null)} onChange={upView} onDelete={() => { saveSchema({ ...schema, views: schema.views.filter((v) => v.id !== view.id) }, true); pickView(schema.views.find((v) => v.id !== view.id)!.id); setPop(null); }} onDuplicate={() => { const v = { ...view, id: uid(), name: `${view.name} copy` }; saveSchema({ ...schema, views: [...schema.views, v] }, true); pickView(v.id); setPop(null); }} />}
          {pop.kind === "new" && (
            <>
              {templates.map((t) => <button key={t.id} className="opt" onClick={async () => { setPop(null); const n = await api.create({ parent_id: note.id, template_id: t.id, title: t.title.replace(/^template:?\s*/i, "") || "New page" }); setRows((rs) => [...rs, n]); store.go(`/p/${n.id}`); }}><PageIcon icon={t.icon} size={15} /> {t.title || "New page"}</button>)}
              {!templates.length && <p className="muted">No templates yet.</p>}
              <button className="opt" onClick={async () => { setPop(null); const n = await api.create({ parent_id: note.id, title: "Template", is_template: true, props: {} }); setRows((rs) => [...rs, n]); store.go(`/p/${n.id}`); }}><Plus size={15} /> New template</button>
            </>
          )}
          {pop.kind === "prop" && pop.propId && <PropPanel key={pop.propId} prop={schema.properties.find((p) => p.id === pop.propId)} schema={schema} ctx={ctx} sample={shown[0] ?? rows[0]} onChange={(patch) => upProp(pop.propId!, patch)}
            onHide={() => { upView({ hidden: [...view.hidden, pop.propId!] }); setPop(null); }}
            onDelete={() => { saveSchema({ ...schema, properties: schema.properties.filter((p) => p.id !== pop.propId), views: schema.views.map((v) => ({ ...v, filters: v.filters.filter((f) => f.prop !== pop.propId), sorts: v.sorts.filter((s) => s.prop !== pop.propId), group_by: v.group_by === pop.propId ? undefined : v.group_by })) }, true); setPop(null); }}
            databases={store.tree.filter((n) => n.kind === "database")} />}
        </FixedPop>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- popover panels

function FilterPanel({ schema, view, onChange, ctx }: { schema: DbSchema; view: View; onChange: (p: Partial<View>) => void; ctx: DbCtx }) {
  const set = (id: string, patch: Partial<Filter>) => onChange({ filters: view.filters.map((f) => (f.id === id ? { ...f, ...patch } : f)) });
  return (
    <div className="panel">
      {view.filters.map((f, i) => {
        const p = schema.properties.find((x) => x.id === f.prop);
        const ops = OPS[p ? opGroup(p.type) : "text"];
        const needs = ops.find((o) => o.op === f.op)?.needsValue;
        return (
          <div key={f.id} className="row filter-row">
            <span className="muted w40">{i === 0 ? "Where" : <select value={view.filter_mode} onChange={(e) => onChange({ filter_mode: e.target.value as "and" | "or" })}><option value="and">and</option><option value="or">or</option></select>}</span>
            <select value={f.prop} onChange={(e) => { const np = schema.properties.find((x) => x.id === e.target.value)!; set(f.id, { prop: np.id, op: OPS[opGroup(np.type)][0].op, value: "" }); }}>{schema.properties.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
            <select value={f.op} onChange={(e) => set(f.id, { op: e.target.value as Filter["op"] })}>{ops.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}</select>
            {needs && (p && (p.type === "select" || p.type === "status" || p.type === "multi_select")
              ? <select value={String(f.value ?? "")} onChange={(e) => set(f.id, { value: e.target.value })}><option value="">…</option>{p.options?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
              : <input type={p && opGroup(p.type) === "date" ? "date" : p?.type === "number" ? "number" : "text"} value={String(f.value ?? "")} onChange={(e) => set(f.id, { value: e.target.value })} />)}
            <button className="ghost danger" onClick={() => onChange({ filters: view.filters.filter((x) => x.id !== f.id) })}><X size={14} /></button>
          </div>
        );
      })}
      <button className="ghost" onClick={() => { const p = schema.properties[0]; onChange({ filters: [...view.filters, { id: uid(), prop: p.id, op: OPS[opGroup(p.type)][0].op, value: "" }] }); }}><Plus size={15} /> Add filter</button>
      {view.filters.length > 0 && <button className="ghost danger" onClick={() => onChange({ filters: [] })}>Delete all</button>}
      <span className="hide">{ctx.schema.properties.length}</span>
    </div>
  );
}

function SortPanel({ schema, view, onChange }: { schema: DbSchema; view: View; onChange: (p: Partial<View>) => void }) {
  return (
    <div className="panel">
      {view.sorts.map((s, i) => (
        <div key={i} className="row">
          <select value={s.prop} onChange={(e) => onChange({ sorts: view.sorts.map((x, j) => (j === i ? { ...x, prop: e.target.value } : x)) })}>{schema.properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <select value={s.dir} onChange={(e) => onChange({ sorts: view.sorts.map((x, j) => (j === i ? { ...x, dir: e.target.value as "asc" | "desc" } : x)) })}><option value="asc">Ascending</option><option value="desc">Descending</option></select>
          <button className="ghost danger" onClick={() => onChange({ sorts: view.sorts.filter((_, j) => j !== i) })}><X size={14} /></button>
        </div>
      ))}
      <button className="ghost" onClick={() => onChange({ sorts: [...view.sorts, { prop: schema.properties[0].id, dir: "asc" }] })}><Plus size={15} /> Add sort</button>
    </div>
  );
}

function ViewPanel({ schema, view, onChange, onDelete, onDuplicate, close }: { schema: DbSchema; view: View; onChange: (p: Partial<View>) => void; onDelete: () => void; onDuplicate: () => void; close: () => void }) {
  const dates = schema.properties.filter((p) => p.type === "date");
  return (
    <div className="panel">
      <label className="fl">View name</label>
      <input value={view.name} onChange={(e) => onChange({ name: e.target.value })} />
      <label className="fl">Layout</label>
      <select value={view.type} onChange={(e) => onChange({ type: e.target.value as ViewType, date_prop: view.date_prop ?? dates[0]?.id })}>{VIEW_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}</select>
      {(view.type === "calendar" || view.type === "timeline") && <>
        <label className="fl">Date property</label>
        <select value={view.date_prop ?? ""} onChange={(e) => onChange({ date_prop: e.target.value })}>{dates.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      </>}
      {view.type === "chart" && <ChartSettings schema={schema} view={view} onChange={onChange} />}
      {view.type === "timeline" && <>
        <label className="fl">End date property (optional)</label>
        <select value={view.end_date_prop ?? ""} onChange={(e) => onChange({ end_date_prop: e.target.value || undefined })}><option value="">Use range from date</option>{dates.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      </>}
      <div className="row"><button onClick={() => { onDuplicate(); }}>Duplicate</button>{schema.views.length > 1 && <button className="danger" onClick={onDelete}>Delete view</button>}<button className="ghost" onClick={close}>Done</button></div>
    </div>
  );
}

function ChartSettings({ schema, view, onChange }: { schema: DbSchema; view: View; onChange: (p: Partial<View>) => void }) {
  const c = view.chart ?? defaultChart(schema);
  const set = (p: Partial<typeof c>) => onChange({ chart: { ...c, ...p } });
  const { x, y, series } = chartProps(schema);
  return (
    <>
      <label className="fl">Chart</label>
      <select value={c.kind} onChange={(e) => set({ kind: e.target.value as "line" | "bar" })}><option value="line">Line</option><option value="bar">Bars</option></select>
      <label className="fl">Across</label>
      <select value={c.x} onChange={(e) => set({ x: e.target.value })}>{x.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      <label className="fl">Up</label>
      <select value={c.y} onChange={(e) => set({ y: e.target.value })}><option value="count">Count of rows</option>{y.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      {c.y !== "count" && <>
        <label className="fl">As a percent of</label>
        <select value={c.of ?? ""} onChange={(e) => set({ of: e.target.value || undefined })}><option value="">Not a percent</option>{y.filter((p) => p.id !== c.y).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <label className="fl">When several rows share a spot</label>
        <select value={c.agg} onChange={(e) => set({ agg: e.target.value as "avg" | "sum" })}><option value="avg">Average them</option><option value="sum">Add them up</option></select>
      </>}
      <label className="fl">{c.kind === "line" ? "A line for each" : "A colour for each"}</label>
      <select value={c.series ?? ""} onChange={(e) => set({ series: e.target.value || undefined })}><option value="">One for everything</option>{series.filter((p) => p.id !== c.x).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
    </>
  );
}

function PropPanel({ prop, schema, ctx, sample, onChange, onHide, onDelete, databases }: { prop?: Prop; schema: DbSchema; ctx: DbCtx; sample?: Note; onChange: (p: Partial<Prop>) => void; onHide: () => void; onDelete: () => void; databases: { id: string; title: string; icon: string | null }[] }) {
  const [name, setName] = useState(prop?.name ?? "");
  const [formula, setFormula] = useState(prop?.formula ?? "");
  const ft = useRef<number | undefined>(undefined);
  if (!prop) return null;
  const relProps = schema.properties.filter((p) => p.type === "relation");
  const relTarget = prop.rollup ? ctx.related.get(schema.properties.find((p) => p.id === prop.rollup!.relation)?.relation?.database_id ?? "") : undefined;
  const preview = prop.type === "formula" && sample ? display(prop, evalFormula(formula, sample, ctx), ctx) : "";
  return (
    <div className="panel">
      <label className="fl">Name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== prop.name && onChange({ name: name.trim() })} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
      {prop.type !== "title" && <>
        <label className="fl">Type</label>
        <select value={prop.type} onChange={(e) => { const t = e.target.value as PropType; const base = newProp(t, prop.name); onChange({ type: t, options: prop.options?.length && ["select", "multi_select", "status"].includes(t) ? prop.options : base.options, rollup: base.rollup, number_format: base.number_format, relation: t === "relation" ? prop.relation : undefined }); }}>
          {PROP_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
        </select>
      </>}
      {["select", "multi_select", "status"].includes(prop.type) && <><label className="fl">Options</label><OptionEditor prop={prop} onChange={(options) => onChange({ options })} /></>}
      {prop.type === "number" && <><label className="fl">Format</label><select value={prop.number_format ?? "number"} onChange={(e) => onChange({ number_format: e.target.value as Prop["number_format"] })}><option value="number">Number</option><option value="percent">Percent</option><option value="dollar">Dollar</option></select></>}
      {prop.type === "relation" && <><label className="fl">Related database</label>
        <select value={prop.relation?.database_id ?? ""} onChange={(e) => onChange({ relation: { database_id: e.target.value } })}><option value="">Choose…</option>{databases.map((d) => <option key={d.id} value={d.id}>{d.title || "New page"}</option>)}</select></>}
      {prop.type === "rollup" && prop.rollup && <>
        <label className="fl">Relation</label>
        <select value={prop.rollup.relation} onChange={(e) => onChange({ rollup: { ...prop.rollup!, relation: e.target.value, property: "" } })}><option value="">Choose…</option>{relProps.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <label className="fl">Property</label>
        <select value={prop.rollup.property} onChange={(e) => onChange({ rollup: { ...prop.rollup!, property: e.target.value } })}><option value="">Choose…</option>{relTarget?.schema.properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <label className="fl">Calculate</label>
        <select value={prop.rollup.fn} onChange={(e) => onChange({ rollup: { ...prop.rollup!, fn: e.target.value as NonNullable<Prop["rollup"]>["fn"] } })}>
          {[["count", "Count"], ["sum", "Sum"], ["avg", "Average"], ["min", "Min"], ["max", "Max"], ["unique", "Unique values"], ["percent_checked", "Percent checked"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select></>}
      {prop.type === "formula" && <>
        <label className="fl">Formula</label>
        <textarea rows={3} value={formula} placeholder='prop("Price") * prop("Qty")' onChange={(e) => { setFormula(e.target.value); window.clearTimeout(ft.current); ft.current = window.setTimeout(() => onChange({ formula: e.target.value }), 400); }} />
        {preview && <div className="preview">= {preview}</div>}
        <small className="muted">{formulaHelp}</small></>}
      {prop.type !== "title" && <div className="row"><button onClick={onHide}>Hide in view</button><button className="danger" onClick={onDelete}>Delete</button></div>}
    </div>
  );
}

// ---------------------------------------------------------------- row page: property panel

export function RowProperties({ note, edit }: { note: Note; edit: Edit }) {
  const store = useStore();
  const [db, setDb] = useState<Note | null>(null);
  const [siblings, setSiblings] = useState<Note[]>([]);
  useEffect(() => { if (note.parent_id) { api.get(note.parent_id).then(setDb).catch(() => {}); api.children(note.parent_id).then(setSiblings).catch(() => {}); } }, [note.parent_id]);
  const schema = useMemo(() => parseSchema(db?.db_schema), [db]);
  const related = useDbData(db?.id ?? "", schema, siblings);
  const ctx: DbCtx = useMemo(() => ({ schema, related }), [schema, related]);
  if (!db) return null;
  const act: CellActions = {
    setProp: (_row, propId, value: PropValue) => {
      const props = { ...parseProps(note.props), [propId]: value };
      const rolled = rollRepeat(schema, props, localToday());
      if (rolled) store.toast(`Repeating task moved to ${rolled.next}`);
      edit({ props: rolled ? rolled.props : props }, true);
    },
    createOption: (propId, name): Option => {
      const p = schema.properties.find((x) => x.id === propId)!;
      const o = newOption(name, COLORS[(p.options?.length ?? 0) % COLORS.length]);
      const next = { ...schema, properties: schema.properties.map((x) => (x.id === propId ? { ...x, options: [...(x.options ?? []), o] } : x)) };
      setDb({ ...db, db_schema: JSON.stringify(next) });
      void api.patch(db.id, { db_schema: next });
      return o;
    },
    open: (id) => store.setPeek(id),
  };
  const row = { ...note, props: typeof note.props === "string" ? note.props : JSON.stringify(note.props) } as Note;
  return (
    <div className="row-props">
      <a className="muted back" href={`#/p/${db.id}`}><CornerUpLeft size={14} /> <PageIcon icon={db.icon} kind="database" size={14} /> {db.title || "New page"}</a>
      {schema.properties.filter((p) => p.type !== "title").map((p) => (
        <div key={p.id} className="rp"><span className="rp-name"><PropIcon type={p.type} /> {p.name}</span><div className="rp-val"><CellEdit prop={p} row={row} ctx={ctx} act={act} readOnly={!!note.locked} /></div></div>
      ))}
    </div>
  );
}

const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
