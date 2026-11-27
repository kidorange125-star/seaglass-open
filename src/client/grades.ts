// Grade math for the Grades database (pure, unit tested in tests/unit/grades.test.mjs).

/** US letter bands with +/-: the lowest percent of each. */
export const BANDS: [number, string][] = [[93, "A"], [90, "A-"], [87, "B+"], [83, "B"], [80, "B-"], [77, "C+"], [73, "C"], [70, "C-"], [67, "D+"], [63, "D"], [60, "D-"]];

/** US letter grade with +/- (93 A, 90 A-, 87 B+, ...). */
export function letter(pct: number) {
  return BANDS.find(([min]) => pct >= min)?.[1] ?? "F";
}
/** Weighted average per class: sum(score x weight) / sum(out of x weight). */
export function classAverages(rows: { props: Record<string, unknown> }[], className: (id: unknown) => string) {
  const acc = new Map<string, { got: number; max: number; n: number }>();
  for (const r of rows) {
    const g = gradeOf(r.props);
    if (!g) continue;
    const k = className(r.props.class) || "No class";
    const a = acc.get(k) ?? { got: 0, max: 0, n: 0 };
    a.got += g.score * g.weight; a.max += g.outof * g.weight; a.n++;
    acc.set(k, a);
  }
  return [...acc.entries()].map(([name, a]) => ({ name, pct: (a.got / a.max) * 100, n: a.n })).sort((x, y) => x.name.localeCompare(y.name));
}

/** A graded row's numbers, or null when it isn't graded yet (or doesn't make sense). Weight defaults to 1. */
export function gradeOf(props: Record<string, unknown>): { score: number; outof: number; weight: number } | null {
  const blank = (v: unknown) => v === undefined || v === null || v === "";
  if (blank(props.score) || blank(props.outof)) return null;
  const score = Number(props.score), outof = Number(props.outof), weight = blank(props.weight) ? 1 : Number(props.weight);
  if (!Number.isFinite(score) || !Number.isFinite(outof) || outof <= 0 || !Number.isFinite(weight) || weight <= 0) return null;
  return { score, outof, weight };
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/** The percent the user needs on one more graded item, worth `weight` like the others, for the class to end at `target` percent.
 *  0 or less: The user's already safe; over 100: out of reach. Null with nothing graded yet. */
export function neededFor(grades: { score: number; outof: number; weight: number }[], target: number, weight = 1) {
  if (!grades.length) return null;
  const got = grades.reduce((n, g) => n + g.score * g.weight, 0), max = grades.reduce((n, g) => n + g.outof * g.weight, 0);
  const avgOut = max / grades.reduce((n, g) => n + g.weight, 0); // the new item's size: a typical one
  return round1(((target / 100) * (max + avgOut * weight) - got) / (avgOut * weight) * 100);
}

/** Before a test: where the class stands, what keeps the current letter, and what reaches the next one (if it can). */
export function testOutlook(grades: { score: number; outof: number; weight: number }[], weight = 1) {
  if (!grades.length) return null;
  const pct = round1((grades.reduce((n, g) => n + g.score * g.weight, 0) / grades.reduce((n, g) => n + g.outof * g.weight, 0)) * 100);
  const now = letter(pct), i = BANDS.findIndex(([, l]) => l === now);
  const floor = i >= 0 ? BANDS[i][0] : null;
  const keep = floor === null ? null : { letter: now, need: Math.max(0, neededFor(grades, floor, weight)!) };
  const up = i === 0 ? null : (() => { const [min, l] = i > 0 ? BANDS[i - 1] : BANDS[BANDS.length - 1]; const need = neededFor(grades, min, weight)!; return need <= 100 ? { letter: l, need: Math.max(0, need) } : null; })();
  return { pct, letter: now, keep, up };
}

/** One sentence for the hub and the test screen. */
export function outlookLine(o: NonNullable<ReturnType<typeof testOutlook>>, test: string) {
  const parts: string[] = [];
  if (o.keep) parts.push(o.keep.need <= 0 ? `Your ${o.keep.letter} is safe whatever happens on ${test}` : o.keep.need > 100 ? `Even 100% on ${test} won't hold your ${o.keep.letter}` : `You need ${Math.ceil(o.keep.need)}% on ${test} to keep your ${o.keep.letter}`);
  if (o.up && o.up.need > 0) parts.push(`${Math.ceil(o.up.need)}% gets you ${/^[AEF]/.test(o.up.letter) ? "an" : "a"} ${o.up.letter}`);
  return parts.join("; ") + ".";
}
