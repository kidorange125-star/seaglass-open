// The Family space (0.2.2): pages, databases, tasks and the calendar that everyone in the household shares. It's a
// scope of its own (owner id "family", src/worker/scope.ts), reached through /api/s/family/... Only the routes below
// work there; everything personal (the assistant, study, memory, settings, notifications) stays in each person's own
// space. Used by the Worker (to refuse anything else) and by the app (to send only these to the Family space).

export const FAMILY = "family";
export const SPACE_PREFIX = "/api/s/family";

/** [method, path] pairs that work in the Family space. Paths are the normal /api/... ones. */
const ROUTES: [string, RegExp][] = [
  ["GET", /^\/api\/(tree|recent|home|search|changes|trash|runs)$/],
  ["POST", /^\/api\/(notes|upload|tasks\/ensure|calendar\/ensure|runs\/undo|runs\/redo)$/],
  ["DELETE", /^\/api\/trash$/],
  ["GET", /^\/api\/notes\/[0-9a-f-]{36}(\/(children|backlinks|comments|history|history\/[\w-]+))?$/],
  ["PATCH", /^\/api\/notes\/[0-9a-f-]{36}$/],
  ["DELETE", /^\/api\/notes\/[0-9a-f-]{36}(\/purge)?$/],
  ["POST", /^\/api\/notes\/[0-9a-f-]{36}\/(restore|duplicate|comments|share|history\/[\w-]+\/restore)$/],
  ["PATCH", /^\/api\/comments\/[\w-]+$/],
  ["DELETE", /^\/api\/comments\/[\w-]+$/],
  ["POST", /^\/api\/runs\/[\w-]+\/(undo|redo)$/],
  ["GET", /^\/api\/unfurl$/],
];

/** True when this request may run in the Family space. */
export const familyAllows = (method: string, path: string) => ROUTES.some(([m, re]) => m === method.toUpperCase() && re.test(path));

/** A page someone shared with you (0.2.3): /api/s/share/<id>/... The Worker checks the level and the branch; these are
 *  the routes the app sends there. */
export const SHARE_PARAM = "share";
const SHARE_ROUTES: [string, RegExp][] = [
  ["GET", /^\/api\/(tree|changes|share-info|unfurl)$/],
  ["GET", /^\/api\/notes\/[0-9a-f-]{36}(\/(children|comments|history|history\/[\w-]+))?$/],
  ["PATCH", /^\/api\/notes\/[0-9a-f-]{36}$/],
  ["POST", /^\/api\/(notes|upload)$/],
  ["POST", /^\/api\/notes\/[0-9a-f-]{36}\/comments$/],
];
export const shareAllows = (method: string, path: string) => SHARE_ROUTES.some(([m, re]) => m === method.toUpperCase() && re.test(path));

/** The Family space is used at all only in a household. */
export const SPACE_PARAM = "space";
