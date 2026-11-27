// Each subject as a class hub (#9) and "what do I need on this test?" (#10). A subject is linked to its class in the Grades
// database (the class it picked, else the one with the same name), so its screen shows the class average and recent grades,
// and the score the next test needs to keep the current letter (and to reach the next). Homework stays in My tasks. The
// assistant sees the same outlook (studyPicture) and pushes harder or eases off to match.
import * as N from "./notes";
import * as Study from "./study";
import { gradeOf, letter, outlookLine, testOutlook } from "../client/grades";

type Opt = { id: string; name: string; color?: string };
type Schema = { system?: string; properties?: { id: string; name: string; type: string; options?: Opt[] }[] };
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Everything in Grades, read once: its class options and each graded row. Null without a Grades database. */
export async function gradeBook(db: D1Database) {
  const g = await db.prepare("SELECT id FROM notes WHERE owner_id = {owner} AND (kind = 'database' AND system = 'grades' AND deleted_at IS NULL) LIMIT 1").first<{ id: string }>();
  if (!g) return null;
  const note = await N.getNote(db, g.id);
  let schema: Schema = {};
  try { schema = JSON.parse(note?.db_schema ?? "{}"); } catch { /* none */ }
  const classes = schema.properties?.find((p) => p.id === "class")?.options ?? [];
  const rows = (await N.listChildren(db, g.id)).flatMap((r) => {
    let p: Record<string, unknown> = {};
    try { p = JSON.parse(r.props || "{}"); } catch { return []; }
    const num = gradeOf(p);
    return num ? [{ id: r.id, title: r.title || "Untitled", class: typeof p.class === "string" ? p.class : null, category: typeof p.category === "string" ? p.category : null, date: (p.date as { start?: string } | undefined)?.start ?? null, ...num }] : [];
  });
  return { id: g.id, classes, rows };
}
type Book = NonNullable<Awaited<ReturnType<typeof gradeBook>>>;

/** A subject's class: the one it picked, else the one with its name. */
export const classOf = (book: Book, s: Study.Subject) => book.classes.find((o) => o.id === s.grade_class) ?? book.classes.find((o) => same(o.name, s.name)) ?? null;

/** Where a subject's class stands before its next test, as numbers and a sentence. */
export function outlookFor(book: Book, s: Study.Subject, exam: { name: string } | null) {
  const cls = classOf(book, s);
  if (!cls) return null;
  const rows = book.rows.filter((r) => r.class === cls.id);
  if (!rows.length) return null;
  const tests = rows.filter((r) => r.category === "test"), weight = tests.length ? tests.reduce((n, r) => n + r.weight, 0) / tests.length : 1;
  const o = testOutlook(rows, weight)!;
  return { ...o, line: exam ? outlookLine(o, exam.name) : null, class: cls.name };
}

/** The hub: the class and its grades, and the next test's outlook. */
export async function hub(db: D1Database, subjectId: string, today: string) {
  const subjects = await Study.listSubjects(db), s = subjects.find((x) => x.id === subjectId);
  if (!s) throw new Study.StudyError("That subject is gone.");
  const exams = (await Study.listExams(db)).filter((e) => e.subject_id === s.id && !e.done_at && e.exam_date && e.exam_date >= today).sort((a, b) => a.exam_date!.localeCompare(b.exam_date!));
  const next = exams[0] ?? null;
  const book = await gradeBook(db);
  const cls = book ? classOf(book, s) : null;
  const graded = book && cls ? book.rows.filter((r) => r.class === cls.id).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")) : [];
  const outlook = book ? outlookFor(book, s, next) : null;
  return {
    class: cls ? { id: cls.id, name: cls.name } : null,
    classes: book?.classes.map((o) => ({ id: o.id, name: o.name })) ?? [],
    linked: !!s.grade_class,
    average: graded.length ? { pct: outlook?.pct ?? null, letter: outlook ? letter(outlook.pct) : null, graded: graded.length } : null,
    grades: graded.slice(0, 8).map((r) => ({ id: r.id, title: r.title, pct: Math.round((r.score / r.outof) * 1000) / 10, date: r.date, category: r.category })),
    next: next ? { id: next.id, name: next.name, exam_date: next.exam_date, outlook: outlook && outlook.line ? { line: outlook.line, keep: outlook.keep, up: outlook.up } : null } : null,
  };
}
