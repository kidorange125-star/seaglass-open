// CSV import and export for databases (#24). Export writes the current view's rows and visible properties as a spreadsheet
// would show them (dates as YYYY-MM-DD so they come back in). Import matches columns to properties by name, makes new
// properties for the rest (guessing number, date, checkbox, select or text from the values), and creates choice options as
// it goes. Pure: db/DatabaseView.tsx saves the schema and creates the rows.
import { dateEnd, dateStart, display, getValue, newOption, newProp, COLORS, type DbCtx } from "./logic.ts";
import type { DbSchema, Note, Prop, PropValue } from "../types";

/** RFC 4180, plus a byte order mark, \r\n or \n, and ; or tab as the separator when the header uses one. */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, "");
  const first = t.split(/\r?\n/, 1)[0] ?? "";
  const count = (ch: string) => first.split(ch).length - 1;
  const sep = [",", ";", "\t"].sort((a, b) => count(b) - count(a))[0];
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"' && cell === "") q = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const quote = (v: string) => (/[",\r\n;]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
/** With a byte order mark so Excel reads it as UTF-8. */
export const toCsv = (rows: string[][]) => "﻿" + rows.map((r) => r.map(quote).join(",")).join("\r\n") + "\r\n";

function cellText(p: Prop, v: unknown, ctx: DbCtx) {
  if (v === null || v === undefined || v === "") return "";
  if (p.type === "date" || p.type === "created_time" || p.type === "last_edited_time") { const s = dateStart(v), e = dateEnd(v); return e && e !== s ? `${s} → ${e}` : s; }
  if (p.type === "number") return String(v);
  if (p.type === "checkbox") return v ? "Yes" : "No";
  return display(p, v, ctx);
}
/** The header and one line per row, title first. */
export function exportRows(rows: Note[], schema: DbSchema, visible: Prop[], ctx: DbCtx): string[][] {
  const title = schema.properties.find((p) => p.type === "title")!;
  const cols = [title, ...visible.filter((p) => p.type !== "title")];
  return [cols.map((p) => p.name), ...rows.filter((r) => !r.is_template).map((r) => cols.map((p) => cellText(p, getValue(r, p, ctx), ctx)))];
}

// ---- import
const pad = (n: string) => n.padStart(2, "0");
/** YYYY-MM-DD from "2026-11-10", "2026/11/10", "11/10/2026" (US order) or "Nov 10, 2026". */
export function parseDay(s: string): string | null {
  const v = s.trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(v);
  if (m) return valid(`${m[1]}-${pad(m[2])}-${pad(m[3])}`);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(v);
  if (m) return valid(`${m[3].length === 2 ? `20${m[3]}` : m[3]}-${pad(m[1])}-${pad(m[2])}`);
  if (/^[A-Za-z]{3,9}\.? \d{1,2},? \d{4}$/.test(v)) { const d = new Date(`${v} 12:00`); return isNaN(+d) ? null : `${d.getFullYear()}-${pad(String(d.getMonth() + 1))}-${pad(String(d.getDate()))}`; }
  return null;
}
const valid = (iso: string) => { const d = new Date(`${iso}T12:00:00Z`); return !isNaN(+d) && d.toISOString().slice(0, 10) === iso ? iso : null; };
const parseNum = (s: string) => { const t = s.trim().replace(/[$€£,%\s]/g, ""); return t && /^-?\d*\.?\d+(e-?\d+)?$/i.test(t) ? Number(t) : NaN; };
const YES = /^(yes|y|true|1|x|✓|✔|checked|done)$/i, NO = /^(no|n|false|0|unchecked)?$/i;

/** What type a new column should be, from its values. */
export function guessType(values: string[]): Prop["type"] {
  const v = values.map((x) => x.trim()).filter(Boolean);
  if (!v.length) return "text";
  if (v.every((x) => Number.isFinite(parseNum(x)))) return "number";
  if (v.every((x) => parseDay(x.split("→")[0]) !== null)) return "date";
  if (v.every((x) => YES.test(x) || NO.test(x)) && v.some((x) => YES.test(x)) && v.some((x) => !/^[01]$/.test(x))) return "checkbox";
  const distinct = new Set(v.map((x) => x.toLowerCase()));
  if (distinct.size < v.length && distinct.size <= 12 && v.every((x) => x.length <= 40)) return "select"; // values repeat: a choice
  return "text";
}

export interface ImportPlan { schema: DbSchema; added: string[]; rows: { title: string; props: Record<string, PropValue> }[]; skipped: number }
export function importPlan(base: DbSchema, table: string[][]): ImportPlan {
  const schema: DbSchema = JSON.parse(JSON.stringify(base));
  const [head = [], ...body] = table;
  const title = schema.properties.find((p) => p.type === "title")!;
  const norm = (s: string) => s.trim().toLowerCase();
  let titleCol = head.findIndex((h) => norm(h) === norm(title.name));
  if (titleCol < 0) titleCol = head.findIndex((h) => ["name", "title", "assignment", "task"].includes(norm(h)));
  if (titleCol < 0) titleCol = 0;
  const added: string[] = [];
  const cols: (Prop | null)[] = head.map((h, i) => {
    if (i === titleCol || !h.trim()) return null;
    const found = schema.properties.find((p) => p.type !== "title" && norm(p.name) === norm(h));
    if (found) return ["relation", "rollup", "formula", "created_time", "last_edited_time"].includes(found.type) ? null : found;
    const p = newProp(guessType(body.map((r) => r[i] ?? "")), h.trim().slice(0, 100));
    if (p.type === "select") p.options = [];
    schema.properties.push(p); added.push(p.name);
    return p;
  });
  const option = (p: Prop, name: string) => {
    const n = name.trim().slice(0, 100);
    let o = p.options?.find((x) => norm(x.name) === norm(n));
    if (!o) { o = newOption(n, COLORS[(p.options?.length ?? 0) % COLORS.length]); p.options = [...(p.options ?? []), o]; }
    return o.id;
  };
  const value = (p: Prop, raw: string): PropValue => {
    const s = raw.trim();
    if (!s) return undefined;
    switch (p.type) {
      case "number": { const n = parseNum(s); return Number.isFinite(n) ? n : undefined; }
      case "checkbox": return YES.test(s);
      case "select": case "status": return option(p, s);
      case "multi_select": return s.split(/[,;]/).map((x) => x.trim()).filter(Boolean).map((x) => option(p, x));
      case "date": { const [a, b] = s.split(/\s*(?:→|->)\s*/); const start = parseDay(a ?? ""); if (!start) return undefined; const end = b ? parseDay(b) : null; return end && end !== start ? { start, end } : { start }; }
      default: return s.slice(0, 2000);
    }
  };
  let skipped = 0;
  const rows = body.flatMap((r) => {
    const t = (r[titleCol] ?? "").trim().slice(0, 300);
    const props: Record<string, PropValue> = {};
    cols.forEach((p, i) => { if (p) { const v = value(p, r[i] ?? ""); if (v !== undefined) props[p.id] = v; } });
    if (!t && !Object.keys(props).length) { skipped++; return []; }
    return [{ title: t, props }];
  });
  return { schema, added, rows, skipped };
}
