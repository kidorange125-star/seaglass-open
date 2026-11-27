// Handwriting strokes (src/client/handwriting/ink.ts). node --experimental-strip-types tests/unit/ink.test.mts
import { bounds, eraseAt, LINE, paperHeight, parseInk, PAPER_MIN, snapToLines, thin, widthAt, type Stroke } from "../../src/client/handwriting/ink.ts";

let fails = 0, n = 0;
const eq = (what: string, got: unknown, want: unknown) => { n++; if (JSON.stringify(got) !== JSON.stringify(want)) { fails++; console.log(`FAIL ${what}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); } };
const S = (points: [number, number, number][], tool: Stroke["tool"] = "pen", size = 2.5): Stroke => ({ tool, color: "#1f2328", size, points });

eq("width: the pen follows pressure", [widthAt(S([]), 0) < widthAt(S([]), 1), widthAt(S([]), 0) > 0], [true, true]);
eq("width: no pressure reads as a steady middle", widthAt(S([]), 0) === widthAt(S([]), 0.5), true);
eq("width: the highlighter doesn't change", [widthAt(S([], "highlighter", 18), 0.1), widthAt(S([], "highlighter", 18), 1)], [18, 18]);
eq("thin: close points dropped, the last one kept", thin([[0, 0, 0.5], [0.3, 0, 0.5], [0.6, 0, 0.5], [5, 0, 0.5], [5.2, 0, 0.6]]).map((p) => p[0]), [0, 5, 5.2]);
eq("thin: rounded to tenths", thin([[1.234, 5.678, 0.4567]]), [[1.2, 5.7, 0.46]]);
const a = S([[0, 0, 0.5], [100, 0, 0.5]]), b = S([[0, 50, 0.5], [100, 50, 0.5]]);
eq("eraser: a stroke passing near goes, by its line not just its points", eraseAt([a, b], 50, 3).length, 1);
eq("eraser: the other stays", eraseAt([a, b], 50, 3)[0], b);
eq("eraser: far away, nothing goes", eraseAt([a, b], 50, 25).length, 2);
eq("bounds include the line's width", bounds([S([[10, 10, 1], [20, 30, 1]])])!.x0 < 10, true);
eq("bounds of nothing", bounds([]), null);
eq("paper: at least the minimum, else the writing plus a margin", [paperHeight([]), paperHeight([S([[0, 900, 0.5]])]) > 900], [PAPER_MIN, true]);
eq("parse: a good drawing", parseInk({ v: 1, width: 800, height: 500, strokes: [a] })?.strokes.length, 1);
eq("parse: junk strokes are dropped", parseInk({ v: 1, width: 800, height: 500, strokes: [a, { tool: "laser", color: "#000000", size: 2, points: [] }, { ...a, color: "red" }, { ...a, points: [[1, "x", 0]] }] })?.strokes.length, 1);
eq("parse: not a drawing", [parseInk(null), parseInk({ v: 2, width: 1, strokes: [] }), parseInk({ v: 1, strokes: [] })], [null, null, null]);

// snap to lines
const word = [S([[100, 120, 0.5], [110, 80, 0.5], [120, 120, 0.5]]), S([[125, 100, 0.5], [140, 100, 0.5], [150, 121, 0.5]])]; // big, crooked, between lines
const snapped = snapToLines(word)!;
const ys = snapped.flatMap((s) => s.points.map((p) => p[1])), xs = snapped.flatMap((s) => s.points.map((p) => p[0]));
eq("snap: the writing sits on a line", Math.max(...ys) <= 4 * LINE && Math.max(...ys) >= 4 * LINE - 6, true);
eq("snap: resized to fit the line", Math.max(...ys) - Math.min(...ys) <= LINE * 0.75, true);
eq("snap: the left edge stays put", Math.min(...xs), 100);
eq("snap: tiny writing grows, but only so much", (() => { const t = snapToLines([S([[10, 60, 0.5], [12, 54, 0.5], [14, 60, 0.5]])])!; const y = t[0].points.map((p) => p[1]); const h = Math.max(...y) - Math.min(...y); return h > 6 && h <= 6 * 1.8 + 0.2; })(), true);
eq("snap: a drawing taller than two lines is left alone", snapToLines([S([[0, 0, 0.5], [0, 200, 0.5]])]), null);
eq("snap: a highlighter mark is left alone", snapToLines([S([[0, 60, 0.5], [80, 60, 0.5]], "highlighter", 18)]), null);
eq("snap: a dot is left alone", snapToLines([S([[5, 60, 0.5]])]), null);
eq("snap: pressure and pen size kept", [snapped[0].points[0][2], snapped[0].size], [0.5, 2.5]);
console.log(fails ? `${fails} of ${n} failed` : `${n} passed`);
process.exit(fails ? 1 : 0);
