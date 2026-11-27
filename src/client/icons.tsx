import { useId } from "react";
import { logoSvg } from "./logo";
import { IDatabase, IPage } from "./ui-icons";
import { usePersona } from "./persona";
import { Waffle, type WaffleMode } from "./waffle";
export { Waffle, type WaffleMode } from "./waffle";
import {
  ArrowUpRight, Calendar, CircleChevronDown, CircleDot, Clock, Database, FileText, FunctionSquare, Hash, History, KanbanSquare as Kanban,
  LayoutGrid, List, Mail, Phone, Rows3, Sigma, SquareCheck, Table2, Type, Link as LinkIcon, GanttChart, LineChart,
} from "lucide-react";
import type { PropType, ViewType } from "./types";

// Brand mark: one piece of sea glass, drawn in the same thick ink line as Jeff (The user's sketch style).
// A worn, slightly lopsided shard with a frosted green fill and a single glint. No gradient, no badge.
// The Seaglass mark (logo.ts holds its shapes and colours; `npm run icons` redraws the favicon, app icons and boot screen).
export function Logo({ size = 28 }: { size?: number }) {
  const id = `lg${useId().replace(/:/g, "")}`;
  return <svg className="logo" width={size} height={size} style={{ width: size, height: size }} viewBox="0 0 64 64" aria-hidden dangerouslySetInnerHTML={{ __html: logoSvg(id) }} />;
}

/** The assistant's face at small sizes (sidebar, buttons, search). Seaglass Open's assistant is Waffle, drawn in code. */
export function JeffFace({ size = 20 }: { size?: number }) {
  return <Waffle size={size} />;
}

// A page's icon: The user's emoji, or a clean default glyph.
export function PageIcon({ icon, kind, size = 16 }: { icon?: string | null; kind?: string; size?: number }) {
  if (icon) return <span className="emo" style={{ fontSize: size * 0.95 }}>{icon}</span>;
  return kind === "database" ? <IDatabase size={size + 2} /> : <IPage size={size + 2} />;
}

const PROP: Record<PropType, typeof Type> = {
  title: Type, text: Type, number: Hash, select: CircleChevronDown, multi_select: List, status: CircleDot, date: Calendar,
  checkbox: SquareCheck, url: LinkIcon, email: Mail, phone: Phone, created_time: Clock, last_edited_time: History,
  relation: ArrowUpRight, rollup: Sigma, formula: FunctionSquare,
};
export function PropIcon({ type, size = 14 }: { type: PropType; size?: number }) {
  const I = PROP[type] ?? Type;
  return <I size={size} strokeWidth={1.9} />;
}

const VIEW: Record<ViewType, typeof Type> = { table: Table2, board: Kanban, list: Rows3, gallery: LayoutGrid, calendar: Calendar, timeline: GanttChart, chart: LineChart };
export function ViewIcon({ type, size = 14 }: { type: ViewType; size?: number }) {
  const I = VIEW[type];
  return <I size={size} strokeWidth={1.9} />;
}

// The assistant (Waffle) at larger sizes, and as a round avatar (the chat header, the floating button).
export function Jeff({ size = 28, className = "" }: { size?: number; body?: boolean; className?: string }) {
  return <Waffle size={size} className={className} />;
}

export function JeffAvatar({ size = 56, mode = "idle" }: { size?: number; mode?: WaffleMode }) {
  return <span className="waffle-avatar" style={{ width: size, height: size }} aria-hidden><Waffle size={Math.round(size * 0.9)} mode={mode} /></span>;
}

