// Seaglass's own interface icons, drawn on Notion's 20px grid: a light 1.35 stroke, round joins, and a
// few solid shapes where a glyph reads better filled. Used for the app chrome (sidebar, top bar, menus)
// so it doesn't look like a stock icon kit. Content icons (database property types etc.) still use Lucide.
import type { ReactNode, SVGProps } from "react";

type P = { size?: number } & Omit<SVGProps<SVGSVGElement>, "children">;

function Svg({ size = 20, children, ...rest }: P & { children: ReactNode }) {
  return (
    <svg className="ui-ico" width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.35}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      {children}
    </svg>
  );
}

// Regular polygon / star / gear helpers, so shapes are geometrically clean.
const pts = (n: number, r1: number, r2: number, rot = -90, cx = 10, cy = 10) =>
  Array.from({ length: n * 2 }, (_, i) => {
    const r = i % 2 ? r2 : r1, a = ((rot + (i * 180) / n) * Math.PI) / 180;
    return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
  }).join(" ");

export const ISearch = (p: P) => <Svg {...p}><circle cx="8.6" cy="8.6" r="5.1" /><path d="m12.4 12.4 3.9 3.9" strokeWidth="1.55" /></Svg>;
export const IHome = (p: P) => <Svg {...p}><path d="M3.6 8.7 10 3.7l6.4 5v6.6c0 .7-.5 1.2-1.2 1.2h-3.1v-4.1H7.9v4.1H4.8c-.7 0-1.2-.5-1.2-1.2Z" /></Svg>;
// A gear with flat teeth: each tooth is two points on the outer radius, sloping down to the inner one.
const gear = (teeth = 8, ro = 6.9, ri = 5.2, half = 9, slope = 7) => {
  const P = (deg: number, r: number) => { const a = (deg * Math.PI) / 180; return `${(10 + r * Math.cos(a)).toFixed(2)},${(10 + r * Math.sin(a)).toFixed(2)}`; };
  const step = 360 / teeth, out: string[] = [];
  for (let i = 0; i < teeth; i++) { const t = i * step - 90; out.push(P(t - half, ro), P(t + half, ro), P(t + half + slope, ri), P(t + step - half - slope, ri)); }
  return `M${out.join(" L")} Z`;
};
export const ISettings = (p: P) => <Svg {...p}><path d={gear()} /><circle cx="10" cy="10" r="2.3" /></Svg>;
export const ITrash = (p: P) => <Svg {...p}><path d="M3.8 5.6h12.4M8 5.4V4.2c0-.4.3-.7.7-.7h2.6c.4 0 .7.3.7.7v1.2M5.3 5.6l.8 10.1c0 .6.5 1 1.1 1h5.6c.6 0 1-.4 1.1-1l.8-10.1M8.5 8.6v5M11.5 8.6v5" /></Svg>;
export const ICompose = (p: P) => <Svg {...p}><path d="M9.6 3.9H5.4c-.9 0-1.6.7-1.6 1.6v9.1c0 .9.7 1.6 1.6 1.6h9.1c.9 0 1.6-.7 1.6-1.6v-4.2" /><path d="M14.4 3.3a1.5 1.5 0 0 1 2.2 2.2l-6.1 6.1-2.9.7.7-2.9Z" /></Svg>;
export const ICollapse = (p: P) => <Svg {...p}><path d="m10.8 5.6-4.4 4.4 4.4 4.4M15.3 5.6 10.9 10l4.4 4.4" /></Svg>;
export const IMenu = (p: P) => <Svg {...p}><path d="M3.8 5.8h12.4M3.8 10h12.4M3.8 14.2h12.4" /></Svg>;
export const IChevron = (p: P) => <Svg {...p}><path d="m7.8 5.4 4.6 4.6-4.6 4.6" strokeWidth="1.5" /></Svg>;
export const IChevronLeft = (p: P) => <Svg {...p}><path d="m12.4 4.6-5.4 5.4 5.4 5.4" strokeWidth="1.7" /></Svg>;
export const IChevronsRight = (p: P) => <Svg {...p}><path d="m5.2 5.6 4.4 4.4-4.4 4.4M10.6 5.6l4.4 4.4-4.4 4.4" /></Svg>;
export const IExpand = (p: P) => <Svg {...p}><path d="M11.6 4.2h4.2v4.2M15.8 4.2l-4.9 4.9M8.4 15.8H4.2v-4.2M4.2 15.8l4.9-4.9" /></Svg>;
export const IChevronsUpDown = (p: P) => <Svg {...p}><path d="m6.8 7.8 3.2-3.2 3.2 3.2M6.8 12.2l3.2 3.2 3.2-3.2" /></Svg>;
export const IPlus = (p: P) => <Svg {...p}><path d="M10 4.4v11.2M4.4 10h11.2" strokeWidth="1.45" /></Svg>;
export const IMore = (p: P) => <Svg {...p} stroke="none" fill="currentColor"><circle cx="4.6" cy="10" r="1.35" /><circle cx="10" cy="10" r="1.35" /><circle cx="15.4" cy="10" r="1.35" /></Svg>;
export const IComment = (p: P) => <Svg {...p}><path d="M4.2 5.6c0-1 .8-1.8 1.8-1.8h8c1 0 1.8.8 1.8 1.8v6.3c0 1-.8 1.8-1.8 1.8H9.4l-3.3 2.6v-2.6H6c-1 0-1.8-.8-1.8-1.8Z" /></Svg>;
export const IClock = (p: P) => <Svg {...p}><circle cx="10" cy="10" r="6.4" /><path d="M10 6.4V10l2.4 1.6" /></Svg>;
export const IStar = ({ filled, ...p }: P & { filled?: boolean }) => <Svg {...p} fill={filled ? "currentColor" : "none"}><polygon points={pts(5, 6.8, 2.9, -90, 10, 10.6)} /></Svg>;
export const ILink = (p: P) => <Svg {...p}><path d="M8.6 11.4a3 3 0 0 0 4.3 0l2.4-2.4a3 3 0 0 0-4.3-4.3l-.9.9" /><path d="M11.4 8.6a3 3 0 0 0-4.3 0l-2.4 2.4a3 3 0 0 0 4.3 4.3l.9-.9" /></Svg>;
export const ICopy = (p: P) => <Svg {...p}><rect x="7.2" y="7.2" width="9" height="9" rx="1.6" /><path d="M12.8 7.2V5.4c0-.9-.7-1.6-1.6-1.6H5.4c-.9 0-1.6.7-1.6 1.6v5.8c0 .9.7 1.6 1.6 1.6h1.8" /></Svg>;
export const IPencil = (p: P) => <Svg {...p}><path d="M13.4 3.9a1.6 1.6 0 0 1 2.3 2.3l-8.6 8.6-3.3.9.9-3.3Z" /></Svg>;
/** Hidden from AI: an eye with a line through it. */
export const IEyeOff = (p: P) => <Svg {...p}><path d="M3.4 10s2.4-4.6 6.6-4.6c1.1 0 2.1.3 3 .8M16.6 10s-2.4 4.6-6.6 4.6c-1.1 0-2.1-.3-3-.8" /><path d="M8.3 11.7a2.4 2.4 0 0 1 3.4-3.4" /><path d="m4.2 15.8 11.6-11.6" /></Svg>;
export const ILock = (p: P) => <Svg {...p}><rect x="4.6" y="8.8" width="10.8" height="7.6" rx="1.6" /><path d="M7 8.8V6.6a3 3 0 0 1 6 0v2.2" /></Svg>;
export const IDownload = (p: P) => <Svg {...p}><path d="M10 3.8v8.6m-3.6-3.6L10 12.4l3.6-3.6M4.2 15.9h11.6" /></Svg>;
export const IUpload = (p: P) => <Svg {...p}><path d="M10 12.4V3.8M6.4 7.4 10 3.8l3.6 3.6M4.2 15.9h11.6" /></Svg>;
export const ILogout = (p: P) => <Svg {...p}><path d="M8.2 16.2H5.4c-.9 0-1.6-.7-1.6-1.6V5.4c0-.9.7-1.6 1.6-1.6h2.8M12.6 13.6 16.2 10l-3.6-3.6M16 10H8" /></Svg>;
export const IBell = (p: P) => <Svg {...p}><path d="M5.6 13.6V9.2a4.4 4.4 0 0 1 8.8 0v4.4l1.3 1.6H4.3Z" /><path d="M8.4 16.6a1.7 1.7 0 0 0 3.2 0" /></Svg>;
export const IShield = (p: P) => <Svg {...p}><path d="M10 3.4 4.6 5.3v4.3c0 3.3 2.3 5.7 5.4 7 3.1-1.3 5.4-3.7 5.4-7V5.3Z" /><path d="m7.6 10.1 1.7 1.7 3.2-3.4" /></Svg>;
export const ITemplate = (p: P) => <Svg {...p}><rect x="3.8" y="3.8" width="12.4" height="12.4" rx="1.8" /><path d="M3.8 7.9h12.4M8.4 7.9v8.3" /></Svg>;
export const IClose = (p: P) => <Svg {...p}><path d="m5.4 5.4 9.2 9.2M14.6 5.4l-9.2 9.2" /></Svg>;
export const IGlobe = (p: P) => <Svg {...p}><circle cx="10" cy="10" r="6.4" /><path d="M3.6 10h12.8M10 3.6c1.8 1.9 2.7 4 2.7 6.4s-.9 4.5-2.7 6.4c-1.8-1.9-2.7-4-2.7-6.4s.9-4.5 2.7-6.4Z" /></Svg>;
export const IImage = (p: P) => <Svg {...p}><rect x="3.6" y="4.4" width="12.8" height="11.2" rx="1.8" /><circle cx="7.6" cy="8.3" r="1.25" /><path d="m4 14.6 4-3.8 2.7 2.4 2.1-1.8 3.3 3" /></Svg>;
export const ISmile = (p: P) => <Svg {...p}><circle cx="10" cy="10" r="6.4" /><path d="M7.4 11.6c.7 1 1.6 1.5 2.6 1.5s1.9-.5 2.6-1.5" /><circle cx="7.8" cy="8.3" r=".55" fill="currentColor" /><circle cx="12.2" cy="8.3" r=".55" fill="currentColor" /></Svg>;
export const IArrowDown = (p: P) => <Svg {...p}><path d="M10 4.2v11.6M5.6 11.4 10 15.8l4.4-4.4" /></Svg>;

/** Notion's default page glyph: a sheet with a folded corner and two lines of text. */
export const IPage = (p: P) => <Svg {...p}><path d="M5.6 3.4h5.6l3.6 3.6v8.4c0 .7-.5 1.2-1.2 1.2H5.6c-.7 0-1.2-.5-1.2-1.2V4.6c0-.7.5-1.2 1.2-1.2Z" /><path d="M11 3.6V6c0 .6.4 1 1 1h2.6M7.2 10.2h5.6M7.2 12.9h4" /></Svg>;
/** Default database glyph: a small table. */
export const IDatabase = (p: P) => <Svg {...p}><rect x="3.6" y="4.2" width="12.8" height="11.6" rx="1.8" /><path d="M3.6 8.2h12.8M3.6 12h12.8M8.2 8.2v7.6" /></Svg>;
/** Notion's block handle: six dots in two columns. */
export const IGrip = (p: P) => <Svg {...p} stroke="none" fill="currentColor">{[6.2, 10, 13.8].flatMap((y) => [7.4, 12.6].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.3" />))}</Svg>;
/** Checked box, for tasks. */
/** Study: two flashcards, one behind the other. */
export const IStudy = (p: P) => <Svg {...p}><rect x="6.4" y="3.6" width="10" height="8.8" rx="1.8" /><path d="M3.6 7.6v6.6c0 1 .8 1.8 1.8 1.8h8.2" /><path d="M9.2 8h4.4" /></Svg>;
export const ICheckSquare = (p: P) => <Svg {...p}><rect x="3.8" y="3.8" width="12.4" height="12.4" rx="2.4" /><path d="m7 10.2 2.1 2.1L13.2 8" /></Svg>;
/** Calendar, for due dates. */
export const ICalendar = (p: P) => <Svg {...p}><rect x="3.8" y="4.8" width="12.4" height="11.4" rx="1.8" /><path d="M3.8 8.6h12.4M7.2 3.4v2.6M12.8 3.4v2.6" /></Svg>;
/** Flag, for priority. */
export const IFlag = (p: P) => <Svg {...p}><path d="M5.2 16.6V3.8M5.2 4.4h8.6l-1.8 3.3 1.8 3.3H5.2" /></Svg>;
/** Arrow out of a box: open in full. */
export const IOpen = (p: P) => <Svg {...p}><path d="M11 4h5v5M16 4l-6.6 6.6M14.4 11.6v3c0 .9-.7 1.6-1.6 1.6H5.6c-.9 0-1.6-.7-1.6-1.6V7.4c0-.9.7-1.6 1.6-1.6h3" /></Svg>;
/** Up arrow, for send buttons. */
export const IArrowUp = (p: P) => <Svg {...p}><path d="M10 15.8V4.2M5.6 8.6 10 4.2l4.4 4.4" strokeWidth="1.7" /></Svg>;
