// The Study tab's data: subjects (with a test date), and for every page with flashcards its subject, done / excluded
// state and how well it's known (mastered / learning / new, from the spaced-repetition rows). Used by the API
// (index.ts) and by the assistant's study tools (agent.ts). See migrations/0010_study_subjects.sql.
import * as N from "./notes";
import { agentCtx } from "./identity";
import * as Vault from "./vault";
import { cardId, countCards } from "../client/study/cards";
import { existingQuestions } from "../client/study/generated";
import { cleanGrade, isGraded, type ExamGrade } from "../client/study/coach";

export const COLORS = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"] as const;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A card counts as mastered once its review interval reaches three weeks. */
export const MASTERED_DAYS = 21;

export class StudyError extends Error {}

export interface Subject { id: string; name: string; color: string; icon: string | null; exam_date: string | null; position: number; done_at: number | null; created_at: number; /** its class in Grades (an option id), or null for the class with the same name */ grade_class: string | null }
export interface Deck {
  id: string; title: string; icon: string | null; cards: number; due: number; new: number; learning: number; mastered: number;
  last_studied: number | null; updated_at: number; subject_id: string | null; excluded: boolean; pinned: boolean; done_at: number | null; exam_ids: string[];
}
/** A test inside a subject: its name, date and the pages it covers. */
export interface Exam { id: string; subject_id: string; name: string; exam_date: string | null; position: number; done_at: number | null; created_at: number; page_ids: string[]; grade: ExamGrade | null }

export async function listSubjects(db: D1Database): Promise<Subject[]> {
  const rows = (await db.prepare("SELECT id, name, color, icon, exam_date, position, done_at, created_at, grade_class FROM study_subjects WHERE owner_id = {owner} ORDER BY position, created_at").all<Subject>()).results;
  return Promise.all(rows.map(async (r) => ({ ...r, name: (await Vault.open("study_subjects", r.id, "name", r.name)) ?? "", icon: r.icon ? await Vault.open("study_subjects", r.id, "icon", r.icon) : null })));
}

export async function listExams(db: D1Database): Promise<Exam[]> {
  const [rows, links] = await Promise.all([
    db.prepare("SELECT id, subject_id, name, exam_date, position, done_at, created_at, grade FROM study_exams WHERE owner_id = {owner} ORDER BY position, created_at").all<Omit<Exam, "page_ids" | "grade"> & { grade: string | null }>(),
    db.prepare("SELECT exam_id, note_id FROM study_exam_pages WHERE owner_id = {owner}").all<{ exam_id: string; note_id: string }>(),
  ]);
  const pages = new Map<string, string[]>();
  for (const l of links.results) pages.set(l.exam_id, [...(pages.get(l.exam_id) ?? []), l.note_id]);
  return Promise.all(rows.results.map(async (r) => ({ ...r, name: (await Vault.open("study_exams", r.id, "name", r.name)) ?? "", page_ids: pages.get(r.id) ?? [], grade: await openGrade(r.id, r.grade) })));
}

async function openGrade(id: string, v: string | null): Promise<ExamGrade | null> {
  if (!v) return null;
  try { return JSON.parse((await Vault.open("study_exams", id, "grade", v)) ?? "null") as ExamGrade | null; } catch { return null; }
}

// ---------------------------------------------------------------- the real grade, after the test
/** Saves the grade the user got: a row in Grades (class = the subject, made if Grades has no such class, category Test), the
 *  test marked done, and what practice predicted kept beside it. One undoable change. Or `skip`: done, nothing recorded. */
export async function logGrade(db: D1Database, id: string, b: { score?: unknown; outof?: unknown; skip?: unknown }, practice: number | null, today: string) {
  const exam = (await listExams(db)).find((e) => e.id === id);
  if (!exam) throw new StudyError("That test is gone.");
  if (isGraded(exam.grade)) throw new StudyError(`${exam.name} already has a grade (${exam.grade.pct}%). Undo that one first.`);
  const now = Date.now();
  const save = async (g: ExamGrade) => {
    await db.prepare("UPDATE study_exams SET grade = ?, done_at = COALESCE(done_at, ?), updated_at = ? WHERE owner_id = {owner} AND (id = ?)")
      .bind(await Vault.seal("study_exams", id, "grade", JSON.stringify(g)), now, now, id).run();
    return { ...exam, grade: g, done_at: exam.done_at ?? now };
  };
  if (b.skip === true) return save({ skipped: true, at: now });
  const got = cleanGrade(b.score, b.outof);
  if (!got) throw new StudyError("Type the score you got, and what it was out of (100 if you leave it empty).");

  const ctx = await agentCtx(db, "grade you logged"); // written for them, like an accepted plan, so undoRun can take it back
  // the database itself (if this is the first grade) is its own change, so Undo takes back the row, not all of Grades
  const g = await N.ensureGradesDb(db, await agentCtx(db, "grade you logged"));
  let row_id: string | null = null;
  if (!g.trashed) { // a Grades database the user threw away stays thrown away
    const gdb = await N.getNote(db, g.id);
    const schema = JSON.parse(gdb?.db_schema ?? "{}") as { properties?: { id: string; options?: { id: string; name: string; color: string }[] }[] };
    const cls = schema.properties?.find((p) => p.id === "class");
    const subject = (await listSubjects(db)).find((s) => s.id === exam.subject_id);
    let opt = subject && cls?.options?.find((o) => o.name.trim().toLowerCase() === subject.name.trim().toLowerCase());
    if (subject && cls && !opt) { // the subject becomes a class in Grades
      opt = { id: crypto.randomUUID().slice(0, 8), name: subject.name, color: (COLORS as readonly string[]).includes(subject.color) ? subject.color : "gray" };
      cls.options = [...(cls.options ?? []), opt];
      await N.patchNote(db, g.id, { db_schema: schema }, ctx);
    }
    const row = await N.createNote(db, { parent_id: g.id, title: exam.name, props: { ...(opt ? { class: opt.id } : {}), category: "test", score: got.score, outof: got.outof, date: { start: exam.exam_date ?? today } } }, ctx);
    row_id = row.id;
  }
  return save({ ...got, practice, row_id, run_id: ctx.runId, at: now });
}

/** Undo a logged grade (or a skip): the Grades row comes back out and the test is open again. */
export async function clearGrade(db: D1Database, id: string) {
  const exam = (await listExams(db)).find((e) => e.id === id);
  if (!exam) throw new StudyError("That test is gone.");
  if (isGraded(exam.grade) && exam.grade.run_id) await N.undoRun(db, exam.grade.run_id, { force: true });
  await db.prepare("UPDATE study_exams SET grade = NULL, done_at = NULL, updated_at = ? WHERE owner_id = {owner} AND (id = ?)").bind(Date.now(), id).run();
  return { ...exam, grade: null, done_at: null };
}

/** A subject's date: the soonest open test still ahead, else the most recent one. Its own date counts until it has tests. */
function nextDate(s: Subject, exams: Exam[], today: string) {
  const dates = [s.exam_date, ...exams.filter((e) => e.subject_id === s.id && !e.done_at).map((e) => e.exam_date)].filter((d): d is string => !!d).sort();
  return dates.find((d) => d >= today) ?? dates.pop() ?? null;
}

/** Every page worth listing: has flashcards, was put in a subject / pinned, or has been studied (`studied`). Most recently edited 400 pages are scanned. */
export async function overview(db: D1Database, today: string, studied?: Set<string>): Promise<{ subjects: Subject[]; exams: Exam[]; decks: Deck[] }> {
  if (!DAY.test(today)) throw new StudyError("today must be YYYY-MM-DD");
  const [raw, exams, notes, prog, pages] = await Promise.all([
    listSubjects(db),
    listExams(db),
    db.prepare("SELECT id, title, icon, html, updated_at FROM notes WHERE owner_id = {owner} AND (deleted_at IS NULL AND kind = 'page') ORDER BY updated_at DESC LIMIT 400").all<{ id: string; title: string; icon: string | null; html: string; updated_at: number }>(),
    db.prepare(`SELECT note_id, SUM(CASE WHEN due <= ?1 THEN 1 ELSE 0 END) AS due, COUNT(*) AS seen,
                SUM(CASE WHEN interval >= ?2 THEN 1 ELSE 0 END) AS mastered, MAX(updated_at) AS last FROM study WHERE owner_id = {owner} GROUP BY note_id`)
      .bind(today, MASTERED_DAYS).all<{ note_id: string; due: number; seen: number; mastered: number; last: number }>(),
    db.prepare("SELECT note_id, subject_id, excluded, pinned, done_at FROM study_pages WHERE owner_id = {owner}").all<{ note_id: string; subject_id: string | null; excluded: number; pinned: number; done_at: number | null }>(),
  ]);
  const progOf = new Map(prog.results.map((r) => [r.note_id, r]));
  const pageOf = new Map(pages.results.map((r) => [r.note_id, r]));
  const subjects = raw.map((s) => ({ ...s, exam_date: nextDate(s, exams, today) }));
  const known = new Set(subjects.map((s) => s.id));
  const examsOf = new Map<string, string[]>();
  for (const e of exams) for (const id of e.page_ids) examsOf.set(id, [...(examsOf.get(id) ?? []), e.id]);
  const decks: Deck[] = [];
  for (const r of notes.results) {
    const pg = pageOf.get(r.id);
    const n = await N.openNote(r);
    const cards = countCards(n.html ?? "");
    if (!cards && !pg?.pinned && !(pg?.subject_id && known.has(pg.subject_id)) && !studied?.has(r.id) && !examsOf.has(r.id)) continue;
    const p = progOf.get(r.id);
    const seen = Math.min(cards, p?.seen ?? 0), mastered = Math.min(seen, p?.mastered ?? 0);
    decks.push({
      id: r.id, title: n.title ?? "", icon: n.icon ?? null, cards, due: p?.due ?? 0, new: Math.max(0, cards - seen), learning: seen - mastered, mastered,
      last_studied: p?.last ?? null, updated_at: r.updated_at, subject_id: pg?.subject_id && known.has(pg.subject_id) ? pg.subject_id : null,
      excluded: !!pg?.excluded, pinned: !!pg?.pinned, done_at: pg?.done_at ?? null, exam_ids: examsOf.get(r.id) ?? [],
    });
  }
  return { subjects, exams, decks };
}

/** Every flashcard on these pages (or every page with progress) and where it stands in the schedule. */
export async function flashcardProgress(db: D1Database, today: string, ids?: string[]) {
  const rows = (await db.prepare("SELECT note_id, card_id, ease, interval, reps, lapses, due, updated_at FROM study WHERE owner_id = {owner}").all<{ note_id: string; card_id: string; ease: number; interval: number; reps: number; lapses: number; due: string; updated_at: number }>()).results;
  const byNote = new Map<string, typeof rows>();
  for (const r of rows) byNote.set(r.note_id, [...(byNote.get(r.note_id) ?? []), r]);
  const pages = [];
  for (const id of (ids?.length ? ids : [...byNote.keys()]).slice(0, 50)) {
    const n = await N.getNote(db, id);
    if (!n || n.deleted_at) continue;
    const seen = new Map((byNote.get(id) ?? []).map((r) => [r.card_id, r]));
    const cards = [...new Set(existingQuestions(n.html ?? ""))].map((question) => {
      const r = seen.get(cardId(question));
      return r ? { question, status: r.interval >= MASTERED_DAYS ? "mastered" : "learning", due: r.due, is_due: r.due <= today, interval_days: r.interval, ease: Math.round(r.ease * 100) / 100, reviews: r.reps, lapses: r.lapses, last_reviewed: new Date(r.updated_at).toISOString() }
        : { question, status: "new", due: null, is_due: false, interval_days: 0, ease: null, reviews: 0, lapses: 0, last_reviewed: null };
    }).sort((a, b) => b.lapses - a.lapses);
    pages.push({ page_id: id, title: n.title ?? "", cards: cards.length, due: cards.filter((c) => c.is_due).length, new: cards.filter((c) => c.status === "new").length, mastered: cards.filter((c) => c.status === "mastered").length, lapses: cards.reduce((t, c) => t + c.lapses, 0), flashcards: cards });
  }
  return { today, pages };
}

const cleanName = (v: unknown, what = "A subject") => {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  if (!s || s.length > 60) throw new StudyError(`${what} needs a name (up to 60 characters)`);
  return s;
};
/** One emoji, or "" / null for none. undefined leaves it alone. */
const cleanIcon = (v: unknown) => {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (typeof v !== "string" || v.length > 16 || !/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(v) || /[\p{L}<>]/u.test(v)) throw new StudyError("icon must be a single emoji");
  return v;
};
const UUID = /^[0-9a-f-]{36}$/;
/** The real pages among these ids. */
async function realPages(db: D1Database, v: unknown): Promise<string[]> {
  if (!Array.isArray(v) || v.length > 100 || !v.every((x) => typeof x === "string" && UUID.test(x))) throw new StudyError("pages must be a list of page ids (100 at most)");
  const ids = [...new Set(v as string[])];
  if (!ids.length) return [];
  const found = await db.prepare(`SELECT id FROM notes WHERE owner_id = {owner} AND (kind = 'page' AND deleted_at IS NULL AND id IN (${ids.map(() => "?").join(",")}))`).bind(...ids).all<{ id: string }>();
  return found.results.map((r) => r.id);
}
const cleanColor = (v: unknown) => {
  if (v === undefined) return undefined;
  if (typeof v !== "string" || !(COLORS as readonly string[]).includes(v)) throw new StudyError(`color must be one of ${COLORS.join(", ")}`);
  return v;
};
const cleanDay = (v: unknown) => {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (typeof v !== "string" || !DAY.test(v)) throw new StudyError("exam_date must be YYYY-MM-DD (or empty to clear it)");
  return v;
};

export async function createSubject(db: D1Database, b: { name?: unknown; color?: unknown; icon?: unknown; exam_date?: unknown }): Promise<Subject> {
  const name = cleanName(b.name);
  const subjects = await listSubjects(db);
  const same = subjects.find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (same) return same;
  if (subjects.length >= 50) throw new StudyError("That's a lot of subjects: delete one first (50 at most)");
  const now = Date.now(), id = crypto.randomUUID();
  const color = cleanColor(b.color) ?? COLORS[(subjects.length + 5) % COLORS.length];
  const exam = cleanDay(b.exam_date) ?? null;
  const position = Math.max(0, ...subjects.map((s) => s.position)) + 1, icon = cleanIcon(b.icon) ?? null;
  await db.prepare("INSERT INTO study_subjects (owner_id, id, name, color, icon, exam_date, position, done_at, created_at, updated_at) VALUES ({owner}, ?,?,?,?,?,?,NULL,?,?)")
    .bind(id, await Vault.seal("study_subjects", id, "name", name), color, icon ? await Vault.seal("study_subjects", id, "icon", icon) : null, exam, position, now, now).run();
  return { id, name, color, icon, exam_date: exam, position, done_at: null, created_at: now, grade_class: null };
}

/** Finds a subject by id or (case-insensitive) name. */
export async function findSubject(db: D1Database, ref: unknown): Promise<Subject> {
  const r = typeof ref === "string" ? ref.trim() : "";
  const subjects = await listSubjects(db);
  const s = subjects.find((x) => x.id === r) ?? subjects.find((x) => x.name.toLowerCase() === r.toLowerCase());
  if (!s) throw new StudyError(`No subject "${r}". Subjects: ${subjects.map((x) => x.name).join(", ") || "none yet"}`);
  return s;
}

export async function updateSubject(db: D1Database, id: string, b: { name?: unknown; color?: unknown; icon?: unknown; exam_date?: unknown; position?: unknown; done?: unknown; grade_class?: unknown }): Promise<Subject> {
  const cur = await findSubject(db, id);
  const name = b.name === undefined ? cur.name : cleanName(b.name);
  const color = cleanColor(b.color) ?? cur.color;
  const exam = b.exam_date === undefined ? cur.exam_date : cleanDay(b.exam_date) ?? null;
  const position = typeof b.position === "number" && Number.isFinite(b.position) ? b.position : cur.position;
  const done_at = b.done === undefined ? cur.done_at : b.done ? cur.done_at ?? Date.now() : null;
  const given = cleanIcon(b.icon), icon = given === undefined ? cur.icon : given;
  const grade_class = b.grade_class === undefined ? cur.grade_class : typeof b.grade_class === "string" && /^[\w-]{1,64}$/.test(b.grade_class) ? b.grade_class : null;
  await db.prepare("UPDATE study_subjects SET name = ?, color = ?, icon = ?, exam_date = ?, position = ?, done_at = ?, grade_class = ?, updated_at = ? WHERE owner_id = {owner} AND (id = ?)")
    .bind(await Vault.seal("study_subjects", cur.id, "name", name), color, icon ? await Vault.seal("study_subjects", cur.id, "icon", icon) : null, exam, position, done_at, grade_class, Date.now(), cur.id).run();
  return { ...cur, name, color, icon, exam_date: exam, position, done_at, grade_class };
}

/** Deletes a subject and its tests; the pages stay, just without a subject. */
export async function deleteSubject(db: D1Database, id: string) {
  const s = await findSubject(db, id);
  await db.batch([
    db.prepare("DELETE FROM study_exam_pages WHERE owner_id = {owner} AND (exam_id IN (SELECT id FROM study_exams WHERE owner_id = {owner} AND (subject_id = ?)))").bind(s.id),
    db.prepare("DELETE FROM study_exams WHERE owner_id = {owner} AND (subject_id = ?)").bind(s.id),
    db.prepare("DELETE FROM study_subjects WHERE owner_id = {owner} AND (id = ?)").bind(s.id),
    db.prepare("UPDATE study_pages SET subject_id = NULL, updated_at = ? WHERE owner_id = {owner} AND (subject_id = ?)").bind(Date.now(), s.id),
  ]);
  return s;
}

// ---------------------------------------------------------------- tests inside a subject
/** Finds a test by id or (case-insensitive) name, optionally within one subject. */
export async function findExam(db: D1Database, ref: unknown, subject?: unknown): Promise<Exam> {
  const r = typeof ref === "string" ? ref.trim() : "";
  const within = subject ? (await findSubject(db, subject)).id : null;
  const all = (await listExams(db)).filter((e) => !within || e.subject_id === within);
  const byId = all.find((e) => e.id === r);
  if (byId) return byId;
  const named = all.filter((e) => e.name.toLowerCase() === r.toLowerCase());
  if (named.length > 1) throw new StudyError(`More than one test is called "${r}": say which subject`);
  if (!named.length) throw new StudyError(`No test "${r}". Tests: ${all.map((e) => e.name).join(", ") || "none yet"}`);
  return named[0];
}

/** The statements that make a test cover exactly these pages. Its pages also go in its subject. */
function examPageStmts(db: D1Database, exam: string, subject: string, pages: string[], replace: boolean) {
  const now = Date.now();
  return [
    ...(replace ? [db.prepare("DELETE FROM study_exam_pages WHERE owner_id = {owner} AND (exam_id = ?)").bind(exam)] : []),
    ...pages.flatMap((id) => [
      db.prepare("INSERT OR IGNORE INTO study_exam_pages (owner_id, exam_id, note_id) VALUES ({owner}, ?,?)").bind(exam, id),
      db.prepare(`INSERT INTO study_pages (owner_id, note_id, subject_id, excluded, pinned, done_at, updated_at) VALUES ({owner}, ?,?,0,0,NULL,?)
        ON CONFLICT(note_id) DO UPDATE SET subject_id = excluded.subject_id, updated_at = excluded.updated_at`).bind(id, subject, now),
    ]),
  ];
}

export async function createExam(db: D1Database, b: { subject?: unknown; name?: unknown; exam_date?: unknown; pages?: unknown }): Promise<Exam> {
  const sub = await findSubject(db, b.subject), name = cleanName(b.name, "A test");
  const all = await listExams(db);
  const same = all.find((e) => e.subject_id === sub.id && e.name.toLowerCase() === name.toLowerCase());
  if (same) return same;
  if (all.length >= 300) throw new StudyError("That's a lot of tests: delete some first (300 at most)");
  const id = crypto.randomUUID(), now = Date.now(), pages = b.pages === undefined ? [] : await realPages(db, b.pages);
  const exam_date = cleanDay(b.exam_date) ?? sub.exam_date; // a date set on the subject moves onto its first test
  const position = Math.max(0, ...all.map((e) => e.position)) + 1;
  await db.batch([
    db.prepare("INSERT INTO study_exams (owner_id, id, subject_id, name, exam_date, position, done_at, created_at, updated_at) VALUES ({owner}, ?,?,?,?,?,NULL,?,?)")
      .bind(id, sub.id, await Vault.seal("study_exams", id, "name", name), exam_date, position, now, now),
    db.prepare("UPDATE study_subjects SET exam_date = NULL, updated_at = ? WHERE owner_id = {owner} AND (id = ?)").bind(now, sub.id),
    ...examPageStmts(db, id, sub.id, pages, false),
  ]);
  return { id, subject_id: sub.id, name, exam_date, position, done_at: null, created_at: now, page_ids: pages, grade: null };
}

export async function updateExam(db: D1Database, ref: string, b: { subject?: unknown; name?: unknown; exam_date?: unknown; done?: unknown; pages?: unknown; add_pages?: unknown }): Promise<Exam> {
  const cur = await findExam(db, ref, b.subject);
  const name = b.name === undefined ? cur.name : cleanName(b.name, "A test");
  const exam_date = b.exam_date === undefined ? cur.exam_date : cleanDay(b.exam_date) ?? null;
  const done_at = b.done === undefined ? cur.done_at : b.done ? cur.done_at ?? Date.now() : null;
  const pages = b.pages === undefined ? null : await realPages(db, b.pages), add = b.add_pages === undefined ? [] : await realPages(db, b.add_pages);
  await db.batch([
    db.prepare("UPDATE study_exams SET name = ?, exam_date = ?, done_at = ?, updated_at = ? WHERE owner_id = {owner} AND (id = ?)").bind(await Vault.seal("study_exams", cur.id, "name", name), exam_date, done_at, Date.now(), cur.id),
    ...(pages ? examPageStmts(db, cur.id, cur.subject_id, pages, true) : []),
    ...examPageStmts(db, cur.id, cur.subject_id, add, false),
  ]);
  return { ...cur, name, exam_date, done_at, page_ids: [...new Set([...(pages ?? cur.page_ids), ...add])] };
}

/** Deletes a test; its pages stay in the subject. */
export async function deleteExam(db: D1Database, ref: string, subject?: unknown) {
  const e = await findExam(db, ref, subject);
  await db.batch([db.prepare("DELETE FROM study_exam_pages WHERE owner_id = {owner} AND (exam_id = ?)").bind(e.id), db.prepare("DELETE FROM study_exams WHERE owner_id = {owner} AND (id = ?)").bind(e.id)]);
  return e;
}

/** The pages in a subject, by subject id or name. */
export async function subjectPages(db: D1Database, ref: unknown) {
  const s = await findSubject(db, ref);
  return (await db.prepare("SELECT note_id FROM study_pages WHERE owner_id = {owner} AND (subject_id = ?)").bind(s.id).all<{ note_id: string }>()).results.map((r) => r.note_id);
}

export interface PagePatch { subject?: unknown; exam?: unknown; excluded?: unknown; done?: unknown; pinned?: unknown }
/** Changes how a page sits in the Study tab. subject: id or name, "" / null for none. exam: a test to add it to, "" / null to take it out of all of them. */
export async function setPage(db: D1Database, noteId: string, b: PagePatch) {
  const note = await N.getNote(db, noteId);
  if (!note || note.kind !== "page") throw new StudyError("No such page");
  const cur = await db.prepare("SELECT subject_id, excluded, pinned, done_at FROM study_pages WHERE owner_id = {owner} AND (note_id = ?)").bind(noteId)
    .first<{ subject_id: string | null; excluded: number; pinned: number; done_at: number | null }>() ?? { subject_id: null, excluded: 0, pinned: 0, done_at: null };
  let subject_id = cur.subject_id;
  if (b.subject !== undefined) subject_id = b.subject === null || b.subject === "" ? null : (await findSubject(db, b.subject)).id;
  const toExam = b.exam === undefined || b.exam === null || b.exam === "" ? null : await findExam(db, b.exam, subject_id ?? undefined);
  if (toExam) subject_id = toExam.subject_id;
  const flag = (v: unknown, was: number) => (v === undefined ? was : v ? 1 : 0);
  const excluded = flag(b.excluded, cur.excluded), pinned = flag(b.pinned, cur.pinned);
  const done_at = b.done === undefined ? cur.done_at : b.done ? cur.done_at ?? Date.now() : null;
  await db.prepare(`INSERT INTO study_pages (owner_id, note_id, subject_id, excluded, pinned, done_at, updated_at) VALUES ({owner}, ?,?,?,?,?,?)
    ON CONFLICT(note_id) DO UPDATE SET subject_id = excluded.subject_id, excluded = excluded.excluded, pinned = excluded.pinned, done_at = excluded.done_at, updated_at = excluded.updated_at`)
    .bind(noteId, subject_id, excluded, pinned, done_at, Date.now()).run();
  if (toExam) await db.prepare("INSERT OR IGNORE INTO study_exam_pages (owner_id, exam_id, note_id) VALUES ({owner}, ?,?)").bind(toExam.id, noteId).run();
  else if (b.exam === null || b.exam === "") await db.prepare("DELETE FROM study_exam_pages WHERE owner_id = {owner} AND (note_id = ?)").bind(noteId).run();
  if (subject_id !== cur.subject_id) await db.prepare("DELETE FROM study_exam_pages WHERE owner_id = {owner} AND (note_id = ? AND exam_id IN (SELECT id FROM study_exams WHERE owner_id = {owner} AND (subject_id IS NOT ?)))").bind(noteId, subject_id).run(); // a test only covers pages in its subject
  return { page_id: noteId, title: note.title, subject_id, excluded: !!excluded, pinned: !!pinned, done: done_at !== null };
}
