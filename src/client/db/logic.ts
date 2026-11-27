import { spanLabel } from "../time.ts"; // .ts so the unit tests can load this file in plain Node
import type { DbSchema, Filter, Note, Op, Option, Prop, PropType, PropValue, Sort, View } from "../types";

export const uid = () => Math.random().toString(36).slice(2, 9);
export const COLORS = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];

export const PROP_TYPES: { type: PropType; label: string; icon: string }[] = [
  { type: "text", label: "Text", icon: "Aa" }, { type: "number", label: "Number", icon: "#" },
  { type: "select", label: "Select", icon: "◉" }, { type: "multi_select", label: "Multi-select", icon: "☰" },
  { type: "status", label: "Status", icon: "◐" }, { type: "date", label: "Date", icon: "📅" },
  { type: "checkbox", label: "Checkbox", icon: "☑" }, { type: "url", label: "URL", icon: "🔗" },
  { type: "email", label: "Email", icon: "✉" }, { type: "phone", label: "Phone", icon: "☎" },
  { type: "relation", label: "Relation", icon: "↗" }, { type: "rollup", label: "Rollup", icon: "Σ" },
  { type: "formula", label: "Formula", icon: "ƒ" }, { type: "created_time", label: "Created time", icon: "🕐" },
  { type: "last_edited_time", label: "Last edited time", icon: "🕑" },
];
export const typeIcon = (t: PropType) => (t === "title" ? "Aa" : PROP_TYPES.find((p) => p.type === t)?.icon ?? "•");

const opt = (name: string, color: string): Option => ({ id: uid(), name, color });
export const newView = (type: View["type"] = "table", name?: string): View => ({
  id: uid(), name: name ?? type[0].toUpperCase() + type.slice(1), type, filters: [], filter_mode: "and", sorts: [], hidden: [],
});

export function defaultSchema(): DbSchema {
  return {
    properties: [
      { id: "title", name: "Name", type: "title" },
      { id: "status", name: "Status", type: "status", options: [opt("Not started", "gray"), opt("In progress", "blue"), opt("Done", "green")] },
      { id: "date", name: "Date", type: "date" },
      { id: "tags", name: "Tags", type: "multi_select", options: [] },
    ],
    views: [newView("table", "Table")],
  };
}

export function parseSchema(raw: unknown): DbSchema {
  try {
    const s = (typeof raw === "string" ? JSON.parse(raw) : raw) as DbSchema;
    if (Array.isArray(s?.properties) && s.properties.length) {
      if (!Array.isArray(s.views) || !s.views.length) s.views = [newView()];
      return s;
    }
  } catch { /* fall through */ }
  return defaultSchema();
}

export function parseProps(p: unknown): Record<string, PropValue> {
  if (p && typeof p === "object") return p as Record<string, PropValue>;
  try { return JSON.parse(String(p ?? "{}")) ?? {}; } catch { return {}; }
}

// ---------------------------------------------------------------- values

export interface DbCtx { schema: DbSchema; related: Map<string, { schema: DbSchema; rows: Note[] }>; depth?: number }

const isDateObj = (v: unknown): v is { start: string; end?: string } => !!v && typeof v === "object" && !Array.isArray(v) && "start" in (v as object);
export const dateStart = (v: unknown): string => (isDateObj(v) ? v.start : typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : "");
export const dateEnd = (v: unknown): string => (isDateObj(v) && v.end ? v.end : "");

export function getValue(row: Note, prop: Prop, ctx: DbCtx): unknown {
  switch (prop.type) {
    case "title": return row.title;
    case "created_time": return new Date(row.created_at).toISOString().slice(0, 10);
    case "last_edited_time": return new Date(row.updated_at).toISOString().slice(0, 10);
    case "formula": return evalFormula(prop.formula ?? "", row, ctx);
    case "rollup": return computeRollup(row, prop, ctx);
    default: return parseProps(row.props)[prop.id];
  }
}

function computeRollup(row: Note, prop: Prop, ctx: DbCtx): unknown {
  const r = prop.rollup;
  if (!r || (ctx.depth ?? 0) > 3) return null;
  const rel = ctx.schema.properties.find((p) => p.id === r.relation);
  const target = rel?.relation ? ctx.related.get(rel.relation.database_id) : undefined;
  if (!rel || !target) return null;
  const ids = (parseProps(row.props)[rel.id] as string[] | undefined) ?? [];
  const rows = ids.map((id) => target.rows.find((x) => x.id === id)).filter(Boolean) as Note[];
  const tp = target.schema.properties.find((p) => p.id === r.property);
  const sub: DbCtx = { schema: target.schema, related: ctx.related, depth: (ctx.depth ?? 0) + 1 };
  const vals = rows.map((x) => (tp ? getValue(x, tp, sub) : x.title));
  const nums = vals.map((v) => Number(v)).filter((n) => Number.isFinite(n));
  switch (r.fn) {
    case "count": return rows.length;
    case "sum": return nums.reduce((a, b) => a + b, 0);
    case "avg": return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    case "min": return nums.length ? Math.min(...nums) : null;
    case "max": return nums.length ? Math.max(...nums) : null;
    case "unique": return [...new Set(vals.map((v) => display(tp, v, sub)).filter(Boolean))].join(", ");
    case "percent_checked": return rows.length ? Math.round((vals.filter(Boolean).length / rows.length) * 100) : 0;
  }
}

export const optionOf = (prop: Prop, id: unknown) => prop.options?.find((o) => o.id === id);

// Text form of any value, used for display in compact views, filtering and sorting.
export function display(prop: Prop | undefined, v: unknown, ctx?: DbCtx): string {
  if (v === null || v === undefined || v === "") return "";
  if (!prop) return String(v);
  switch (prop.type) {
    case "select": case "status": return optionOf(prop, v)?.name ?? "";
    case "multi_select": return ((v as string[]) ?? []).map((id) => optionOf(prop, id)?.name ?? "").filter(Boolean).join(", ");
    case "checkbox": return v ? "Yes" : "No";
    case "date": case "created_time": case "last_edited_time": {
      const s = dateStart(v), e = dateEnd(v);
      if (!s) return "";
      const w = isDateObj(v) ? (v as { start_time?: string; end_time?: string }) : {};
      return spanLabel({ start: s, end: e || undefined, start_time: w.start_time, end_time: w.end_time }, fmtDay);
    }
    case "number": return fmtNumber(Number(v), prop.number_format);
    case "relation": return ((v as string[]) ?? []).map((id) => ctx?.related.get(prop.relation?.database_id ?? "")?.rows.find((r) => r.id === id)?.title ?? "").filter(Boolean).join(", ");
    case "formula": case "rollup": return Array.isArray(v) ? v.join(", ") : typeof v === "number" ? fmtNumber(v) : isDateStr(v) ? fmtDay(String(v)) : String(v);
    default: return String(v);
  }
}
const isDateStr = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
export const fmtDay = (iso: string) => { const d = new Date(iso.slice(0, 10) + "T00:00:00"); return isNaN(+d) ? iso : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); };
export const fmtNumber = (n: number, f?: string) => {
  if (!Number.isFinite(n)) return "";
  const s = n.toLocaleString("en-US", { maximumFractionDigits: 6 });
  return f === "percent" ? `${s}%` : f === "dollar" ? `$${s}` : s;
};

// ---------------------------------------------------------------- filtering, sorting, grouping

export const OPS: Record<string, { op: Op; label: string; needsValue: boolean }[]> = {
  text: [{ op: "contains", label: "contains", needsValue: true }, { op: "not_contains", label: "does not contain", needsValue: true }, { op: "is", label: "is", needsValue: true }, { op: "is_not", label: "is not", needsValue: true }, { op: "starts", label: "starts with", needsValue: true }, { op: "empty", label: "is empty", needsValue: false }, { op: "not_empty", label: "is not empty", needsValue: false }],
  number: [{ op: "is", label: "=", needsValue: true }, { op: "is_not", label: "≠", needsValue: true }, { op: "gt", label: ">", needsValue: true }, { op: "gte", label: "≥", needsValue: true }, { op: "lt", label: "<", needsValue: true }, { op: "lte", label: "≤", needsValue: true }, { op: "empty", label: "is empty", needsValue: false }, { op: "not_empty", label: "is not empty", needsValue: false }],
  select: [{ op: "is", label: "is", needsValue: true }, { op: "is_not", label: "is not", needsValue: true }, { op: "empty", label: "is empty", needsValue: false }, { op: "not_empty", label: "is not empty", needsValue: false }],
  multi: [{ op: "contains", label: "contains", needsValue: true }, { op: "not_contains", label: "does not contain", needsValue: true }, { op: "empty", label: "is empty", needsValue: false }, { op: "not_empty", label: "is not empty", needsValue: false }],
  date: [{ op: "is", label: "is", needsValue: true }, { op: "before", label: "is before", needsValue: true }, { op: "after", label: "is after", needsValue: true }, { op: "empty", label: "is empty", needsValue: false }, { op: "not_empty", label: "is not empty", needsValue: false }],
  checkbox: [{ op: "checked", label: "is checked", needsValue: false }, { op: "unchecked", label: "is unchecked", needsValue: false }],
  relation: [{ op: "empty", label: "is empty", needsValue: false }, { op: "not_empty", label: "is not empty", needsValue: false }],
};
export const opGroup = (t: PropType) =>
  t === "number" ? "number" : t === "select" || t === "status" ? "select" : t === "multi_select" ? "multi" : t === "date" || t === "created_time" || t === "last_edited_time" ? "date" : t === "checkbox" ? "checkbox" : t === "relation" ? "relation" : "text";

function matches(row: Note, f: Filter, ctx: DbCtx): boolean {
  const prop = ctx.schema.properties.find((p) => p.id === f.prop);
  if (!prop) return true;
  const v = getValue(row, prop, ctx);
  const text = display(prop, v, ctx).toLowerCase();
  const q = String(f.value ?? "").toLowerCase();
  const empty = v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length) || (isDateObj(v) && !v.start);
  switch (f.op) {
    case "empty": return empty;
    case "not_empty": return !empty;
    case "checked": return !!v;
    case "unchecked": return !v;
    case "contains": return prop.type === "multi_select" ? ((v as string[]) ?? []).includes(String(f.value)) : text.includes(q);
    case "not_contains": return prop.type === "multi_select" ? !((v as string[]) ?? []).includes(String(f.value)) : !text.includes(q);
    case "starts": return text.startsWith(q);
    case "is": return prop.type === "number" ? Number(v) === Number(f.value) : prop.type === "select" || prop.type === "status" ? v === f.value : opGroup(prop.type) === "date" ? dateStart(v) === String(f.value) : text === q;
    case "is_not": return prop.type === "number" ? Number(v) !== Number(f.value) : prop.type === "select" || prop.type === "status" ? v !== f.value : text !== q;
    case "gt": return Number(v) > Number(f.value);
    case "gte": return Number(v) >= Number(f.value);
    case "lt": return !empty && Number(v) < Number(f.value);
    case "lte": return !empty && Number(v) <= Number(f.value);
    case "before": return !!dateStart(v) && dateStart(v) < String(f.value);
    case "after": return !!dateStart(v) && dateStart(v) > String(f.value);
  }
}

function compare(a: unknown, b: unknown, prop: Prop, ctx: DbCtx, dir = 1): number {
  const ea = a === null || a === undefined || a === "", eb = b === null || b === undefined || b === "";
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1; // empties always last, whatever the direction
  return dir * compareValues(a, b, prop, ctx);
}
function compareValues(a: unknown, b: unknown, prop: Prop, ctx: DbCtx): number {
  if (prop.type === "number" || (typeof a === "number" && typeof b === "number")) return Number(a) - Number(b);
  if (prop.type === "date" || prop.type === "created_time" || prop.type === "last_edited_time") return dateStart(a).localeCompare(dateStart(b));
  if (prop.type === "select" || prop.type === "status") {
    const ia = prop.options?.findIndex((o) => o.id === a) ?? 0, ib = prop.options?.findIndex((o) => o.id === b) ?? 0;
    return ia - ib; // option order, like Notion
  }
  if (prop.type === "checkbox") return Number(!!a) - Number(!!b);
  return display(prop, a, ctx).localeCompare(display(prop, b, ctx), undefined, { numeric: true, sensitivity: "base" });
}

export function applyView(rows: Note[], view: View, ctx: DbCtx, search = ""): Note[] {
  let out = rows.filter((r) => !r.is_template);
  if (search.trim()) { const q = search.toLowerCase(); out = out.filter((r) => r.title.toLowerCase().includes(q) || ctx.schema.properties.some((p) => display(p, getValue(r, p, ctx), ctx).toLowerCase().includes(q))); }
  const fs = view.filters.filter((f) => ctx.schema.properties.some((p) => p.id === f.prop));
  if (fs.length) out = out.filter((r) => (view.filter_mode === "or" ? fs.some((f) => matches(r, f, ctx)) : fs.every((f) => matches(r, f, ctx))));
  const sorts = view.sorts.filter((s) => ctx.schema.properties.some((p) => p.id === s.prop));
  if (sorts.length) {
    out = [...out].sort((x, y) => {
      for (const s of sorts) {
        const p = ctx.schema.properties.find((q) => q.id === s.prop)!;
        const c = compare(getValue(x, p, ctx), getValue(y, p, ctx), p, ctx, s.dir === "desc" ? -1 : 1);
        if (c) return c;
      }
      return 0;
    });
  } else out = [...out].sort((a, b) => a.position - b.position || a.created_at - b.created_at);
  return out;
}

export interface Group { key: string; label: string; color?: string; rows: Note[] }
export function groupRows(rows: Note[], prop: Prop | undefined, ctx: DbCtx): Group[] {
  if (!prop) return [{ key: "_all", label: "", rows }];
  const groups = new Map<string, Group>();
  const add = (key: string, label: string, color: string | undefined, row: Note) => { const g = groups.get(key) ?? { key, label, color, rows: [] }; g.rows.push(row); groups.set(key, g); };
  if (prop.type === "select" || prop.type === "status" || prop.type === "multi_select") {
    for (const o of prop.options ?? []) groups.set(o.id, { key: o.id, label: o.name, color: o.color, rows: [] });
    groups.set("_none", { key: "_none", label: "No " + prop.name.toLowerCase(), rows: [] });
  }
  for (const r of rows) {
    const v = getValue(r, prop, ctx);
    if (prop.type === "multi_select") { const ids = (v as string[]) ?? []; if (!ids.length) add("_none", "No " + prop.name.toLowerCase(), undefined, r); else ids.forEach((id) => add(id, optionOf(prop, id)?.name ?? id, optionOf(prop, id)?.color, r)); }
    else if (prop.type === "select" || prop.type === "status") { const o = optionOf(prop, v); add(o ? o.id : "_none", o ? o.name : "No " + prop.name.toLowerCase(), o?.color, r); }
    else if (prop.type === "checkbox") add(v ? "yes" : "no", v ? "Checked" : "Unchecked", undefined, r);
    else { const t = display(prop, v, ctx); add(t || "_none", t || "Empty", undefined, r); }
  }
  const out = [...groups.values()];
  return (prop.type === "select" || prop.type === "status" || prop.type === "multi_select") ? out.filter((g) => g.rows.length || g.key !== "_none") : out;
}

// ---------------------------------------------------------------- formulas
// A small, safe expression language (no eval): prop("Name"), if(), math, text, and date helpers.

type V = number | string | boolean | null | Date | V[];
type Ast = { t: "num"; v: number } | { t: "str"; v: string } | { t: "id"; name: string } | { t: "call"; name: string; args: Ast[] } | { t: "bin"; op: string; l: Ast; r: Ast } | { t: "un"; op: string; e: Ast };

function tokenize(src: string) {
  const toks: { k: "num" | "str" | "id" | "op"; v: string }[] = [];
  const re = /\s*(?:(\d+(?:\.\d+)?)|"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([A-Za-z_][\w]*)|(==|!=|<=|>=|&&|\|\||[-+*/%^<>(),!]))/y;
  let m: RegExpExecArray | null;
  let i = 0;
  while (i < src.length && /\S/.test(src.slice(i))) {
    re.lastIndex = i; m = re.exec(src);
    if (!m) throw new Error(`Unexpected character near "${src.slice(i, i + 8).trim()}"`);
    if (m[1] !== undefined) toks.push({ k: "num", v: m[1] }); else if (m[2] !== undefined) toks.push({ k: "str", v: m[2].replace(/\\(.)/g, "$1") });
    else if (m[3] !== undefined) toks.push({ k: "str", v: m[3].replace(/\\(.)/g, "$1") }); else if (m[4] !== undefined) toks.push({ k: "id", v: m[4] }); else toks.push({ k: "op", v: m[5] });
    i = re.lastIndex;
  }
  return toks;
}

function parse(src: string): Ast {
  const toks = tokenize(src); let p = 0;
  const peek = () => toks[p]; const isOp = (v: string) => peek()?.k === "op" && peek().v === v;
  const eat = (v: string) => { if (!isOp(v)) throw new Error(`Expected "${v}"`); p++; };
  const level = (ops: string[], next: () => Ast): Ast => { let l = next(); while (peek()?.k === "op" && ops.includes(peek().v)) { const op = toks[p++].v; l = { t: "bin", op, l, r: next() }; } return l; };
  const primary = (): Ast => {
    const t = toks[p++]; if (!t) throw new Error("Unexpected end");
    if (t.k === "num") return { t: "num", v: Number(t.v) };
    if (t.k === "str") return { t: "str", v: t.v };
    if (t.k === "id") { if (isOp("(")) { p++; const args: Ast[] = []; if (!isOp(")")) { do args.push(or()); while (isOp(",") && p++ >= 0); } eat(")"); return { t: "call", name: t.v.toLowerCase(), args }; } return { t: "id", name: t.v.toLowerCase() }; }
    if (t.v === "(") { const e = or(); eat(")"); return e; }
    throw new Error(`Unexpected "${t.v}"`);
  };
  const unary = (): Ast => { if (isOp("-") || isOp("!")) { const op = toks[p++].v; return { t: "un", op, e: unary() }; } return power(); };
  const power = (): Ast => { const b = primary(); if (isOp("^")) { p++; return { t: "bin", op: "^", l: b, r: unary() }; } return b; };
  const mul = () => level(["*", "/", "%"], unary), add = () => level(["+", "-"], mul), cmp = () => level(["<", ">", "<=", ">="], add), eq = () => level(["==", "!="], cmp), and = () => level(["&&"], eq);
  function or(): Ast { return level(["||"], and); }
  const ast = or(); if (p < toks.length) throw new Error(`Unexpected "${toks[p].v}"`); return ast;
}

const cache = new Map<string, Ast | Error>();
const toNum = (v: V): number => (typeof v === "number" ? v : typeof v === "boolean" ? Number(v) : v instanceof Date ? +v : v === null ? 0 : Number(v));
const toDate = (v: V): Date => (v instanceof Date ? v : new Date(String(v).slice(0, 10) + "T00:00:00"));
const truthy = (v: V) => (Array.isArray(v) ? v.length > 0 : !!v);
export const toStr = (v: V): string => v === null ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : Array.isArray(v) ? v.map(toStr).join(", ") : typeof v === "number" ? String(Math.round(v * 1e10) / 1e10) : String(v);
const day = 86400000;

export function evalFormula(src: string, row: Note, ctx: DbCtx): unknown {
  if (!src.trim()) return null;
  let ast = cache.get(src);
  if (!ast) { try { ast = parse(src); } catch (e) { ast = e as Error; } cache.set(src, ast); }
  if (ast instanceof Error) return `⚠ ${ast.message}`;
  if ((ctx.depth ?? 0) > 4) return "⚠ circular";
  const sub = { ...ctx, depth: (ctx.depth ?? 0) + 1 };
  const getProp = (name: string): V => {
    const p = ctx.schema.properties.find((x) => x.name.toLowerCase() === name.toLowerCase() || x.id === name);
    if (!p) throw new Error(`No property "${name}"`);
    const v = getValue(row, p, sub);
    if (p.type === "date" || p.type === "created_time" || p.type === "last_edited_time") return dateStart(v) ? toDate(dateStart(v)) : null;
    if (p.type === "select" || p.type === "status") return optionOf(p, v)?.name ?? null;
    if (p.type === "multi_select") return ((v as string[]) ?? []).map((id) => optionOf(p, id)?.name ?? "");
    if (p.type === "relation") return ((v as string[]) ?? []).map((id) => ctx.related.get(p.relation?.database_id ?? "")?.rows.find((r) => r.id === id)?.title ?? "");
    if (p.type === "checkbox") return !!v;
    if (p.type === "number") return v === undefined || v === null || v === "" ? null : Number(v);
    return (v ?? null) as V;
  };
  try { const out = ev(ast, getProp); return out instanceof Date ? out.toISOString().slice(0, 10) : out; } catch (e) { return `⚠ ${(e as Error).message}`; }
}

function ev(n: Ast, getProp: (name: string) => V): V {
  const E = (x: Ast) => ev(x, getProp);
  switch (n.t) {
    case "num": case "str": return n.v;
    case "id": if (n.name === "true") return true; if (n.name === "false") return false; if (n.name === "null") return null; throw new Error(`Unknown name "${n.name}"`);
    case "un": return n.op === "-" ? -toNum(E(n.e)) : !truthy(E(n.e));
    case "bin": {
      if (n.op === "&&") return truthy(E(n.l)) && truthy(E(n.r));
      if (n.op === "||") return truthy(E(n.l)) || truthy(E(n.r));
      const a = E(n.l), b = E(n.r);
      switch (n.op) {
        case "+": return typeof a === "string" || typeof b === "string" || Array.isArray(a) ? toStr(a) + toStr(b) : toNum(a) + toNum(b);
        case "-": return toNum(a) - toNum(b); case "*": return toNum(a) * toNum(b); case "/": return toNum(b) === 0 ? null : toNum(a) / toNum(b);
        case "%": return toNum(a) % toNum(b); case "^": return Math.pow(toNum(a), toNum(b));
        case "==": return toStr(a) === toStr(b); case "!=": return toStr(a) !== toStr(b);
        case "<": return toNum(a) < toNum(b); case ">": return toNum(a) > toNum(b); case "<=": return toNum(a) <= toNum(b); case ">=": return toNum(a) >= toNum(b);
      }
      throw new Error(`Bad operator ${n.op}`);
    }
    case "call": {
      const f = n.name, a = n.args;
      if (f === "if") return truthy(E(a[0])) ? E(a[1]) : a[2] ? E(a[2]) : null;
      if (f === "ifs") { for (let i = 0; i + 1 < a.length; i += 2) if (truthy(E(a[i]))) return E(a[i + 1]); return a.length % 2 ? E(a[a.length - 1]) : null; }
      const v = a.map(E);
      switch (f) {
        case "prop": return getProp(toStr(v[0]));
        case "and": return v.every(truthy); case "or": return v.some(truthy); case "not": return !truthy(v[0]);
        case "empty": return v[0] === null || v[0] === "" || (Array.isArray(v[0]) && !v[0].length);
        case "concat": return v.map(toStr).join(""); case "join": return (Array.isArray(v[0]) ? v[0] : [v[0]]).map(toStr).join(v[1] === undefined ? ", " : toStr(v[1]));
        case "length": return Array.isArray(v[0]) ? v[0].length : toStr(v[0]).length;
        case "lower": return toStr(v[0]).toLowerCase(); case "upper": return toStr(v[0]).toUpperCase(); case "trim": return toStr(v[0]).trim();
        case "contains": return Array.isArray(v[0]) ? v[0].map(toStr).includes(toStr(v[1])) : toStr(v[0]).toLowerCase().includes(toStr(v[1]).toLowerCase());
        case "replace": return toStr(v[0]).replace(toStr(v[1]), toStr(v[2])); case "replaceall": return toStr(v[0]).split(toStr(v[1])).join(toStr(v[2]));
        case "substring": case "slice": return toStr(v[0]).slice(toNum(v[1]), v[2] === undefined ? undefined : toNum(v[2]));
        case "tostring": case "format": return toStr(v[0]); case "tonumber": { const x = Number(toStr(v[0]).replace(/[^\d.\-]/g, "")); return Number.isFinite(x) ? x : null; }
        case "round": { const d = v[1] === undefined ? 0 : toNum(v[1]); return Math.round(toNum(v[0]) * 10 ** d) / 10 ** d; }
        case "floor": return Math.floor(toNum(v[0])); case "ceil": return Math.ceil(toNum(v[0])); case "abs": return Math.abs(toNum(v[0])); case "sqrt": return Math.sqrt(toNum(v[0]));
        case "pow": return Math.pow(toNum(v[0]), toNum(v[1])); case "mod": return toNum(v[0]) % toNum(v[1]);
        case "min": return Math.min(...v.flat().map(toNum)); case "max": return Math.max(...v.flat().map(toNum)); case "sum": return v.flat().map(toNum).reduce((x, y) => x + y, 0);
        case "now": case "today": return toDate(new Date().toISOString().slice(0, 10));
        case "year": return toDate(v[0]).getFullYear(); case "month": return toDate(v[0]).getMonth() + 1; case "date": case "day": return toDate(v[0]).getDate();
        case "dateadd": { const d = toDate(v[0]), k = toNum(v[1]), u = toStr(v[2]); if (u.startsWith("month")) d.setMonth(d.getMonth() + k); else if (u.startsWith("year")) d.setFullYear(d.getFullYear() + k); else d.setDate(d.getDate() + k * (u.startsWith("week") ? 7 : 1)); return d; }
        case "datebetween": { const k = toStr(v[2] ?? "days"), diff = (+toDate(v[0]) - +toDate(v[1])) / day; return k.startsWith("week") ? Math.trunc(diff / 7) : k.startsWith("month") ? Math.trunc(diff / 30.4375) : k.startsWith("year") ? Math.trunc(diff / 365.25) : Math.round(diff); }
        case "formatdate": return toDate(v[0]).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
      }
      throw new Error(`Unknown function ${f}()`);
    }
  }
}

export const formulaHelp = 'prop("Name"), if(cond, a, b), concat(), round(n, 2), dateBetween(prop("Due"), today(), "days"), …';

export function newProp(type: PropType, name: string): Prop {
  const p: Prop = { id: uid(), name, type };
  if (type === "select" || type === "multi_select") p.options = [];
  if (type === "status") p.options = [opt("Not started", "gray"), opt("In progress", "blue"), opt("Done", "green")];
  if (type === "rollup") p.rollup = { relation: "", property: "", fn: "count" };
  if (type === "number") p.number_format = "number";
  return p;
}
export const newOption = opt;
export const SORT_DEFAULT: Sort = { prop: "title", dir: "asc" };
