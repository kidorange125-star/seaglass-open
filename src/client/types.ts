export interface TreeNode {
  id: string; parent_id: string | null; kind: "page" | "database"; title: string; icon: string | null;
  favorite: number; position: number; is_template: number; locked: number; updated_at: number; created_at: number;
  /** "Hide from AI": Jeff, Claude and AI features can't see this page or anything under it. */
  ai_hidden?: number;
  /** Set on built-in databases: "tasks" is the to-do list. */
  system?: string | null;
}
export interface Note extends TreeNode {
  html: string; text: string; cover: string | null; full_width: number; small_text: number; font: string;
  props: string; db_schema: string | null; share_slug: string | null; revision: number; deleted_at: number | null;
  /** Hidden from AI because a page above it is. */
  ai_hidden_inherited?: boolean;
}
export interface SearchHit extends TreeNode { snippet?: string }

// ---- databases
export type PropType =
  | "title" | "text" | "number" | "select" | "multi_select" | "status" | "date" | "checkbox" | "url" | "email"
  | "phone" | "created_time" | "last_edited_time" | "relation" | "rollup" | "formula";
export interface Option { id: string; name: string; color: string }
export interface Prop {
  id: string; name: string; type: PropType; options?: Option[];
  number_format?: "number" | "percent" | "dollar";
  relation?: { database_id: string };
  rollup?: { relation: string; property: string; fn: "count" | "sum" | "avg" | "min" | "max" | "unique" | "percent_checked" };
  formula?: string;
}
export type Op =
  | "contains" | "not_contains" | "is" | "is_not" | "starts" | "empty" | "not_empty" | "gt" | "lt" | "gte" | "lte"
  | "before" | "after" | "checked" | "unchecked";
export interface Filter { id: string; prop: string; op: Op; value?: string | number }
export interface Sort { prop: string; dir: "asc" | "desc" }
export type ViewType = "table" | "board" | "list" | "gallery" | "calendar" | "timeline" | "chart";
/** A chart view's settings (db/chart.ts). */
export interface ChartCfg {
  kind: "line" | "bar";
  /** The across axis: a date, select or status property (or the title). */
  x: string;
  /** A number, formula or rollup property, or "count". */
  y: string;
  /** Optional: show y as a percent of this property (Score of Out of). */
  of?: string;
  agg: "avg" | "sum";
  /** Optional: one line (or bar colour) per value of this select or status property, e.g. Class. */
  series?: string;
}
export interface View {
  id: string; name: string; type: ViewType; filters: Filter[]; filter_mode: "and" | "or"; sorts: Sort[];
  group_by?: string; hidden: string[]; date_prop?: string; end_date_prop?: string; chart?: ChartCfg;
}
export interface DbSchema { properties: Prop[]; views: View[]; /** Set on built-in databases: "tasks" is the to-do list. */ system?: string }
export type PropValue = string | number | boolean | string[] | null | undefined | { start: string; end?: string; start_time?: string; end_time?: string };
