// Sending imported pages in batches that can't sink the whole import. A batch is all or nothing on the Worker (one
// database batch), so when one fails (a page too big once sealed, a request that ran out of time) it's split in half and
// each half sent again, down to one page; a page that still fails is skipped and the import goes on. A retried page the
// Worker already has ("already exists": the first try worked but its answer was lost) counts as made.
export type Answer = { made: number; failed: { id: string; title: string; error: string }[]; cut: string[] };
export type Sender<T> = (batch: T[]) => Promise<Answer>;
const EXISTS = /already exists/;

export async function sendAll<T extends { id: string; title: string }>(
  batches: T[][], send: Sender<T>, onDone: (n: number) => void, firstMust?: string,
): Promise<{ made: number; failed: { id: string; title: string; error: string }[]; cut: string[] }> {
  let made = 0;
  const failed: Answer["failed"] = [], cut: string[] = [];
  const go = async (batch: T[], retry: boolean): Promise<void> => {
    try {
      const r = await send(batch);
      made += r.made;
      for (const f of r.failed) { if (retry && EXISTS.test(f.error)) made++; else failed.push(f); }
      cut.push(...r.cut);
      onDone(batch.length);
    } catch (e) {
      if (batch.length > 1) { const half = Math.ceil(batch.length / 2); await go(batch.slice(0, half), true); await go(batch.slice(half), true); return; }
      if (firstMust && batch[0].id === firstMust) throw e;
      failed.push({ id: batch[0].id, title: batch[0].title, error: (e as Error).message || "couldn't be saved" });
      onDone(1);
    }
  };
  for (const b of batches) await go(b, false);
  if (firstMust && failed.some((f) => f.id === firstMust)) throw new Error(failed.find((f) => f.id === firstMust)!.error);
  return { made, failed, cut };
}
