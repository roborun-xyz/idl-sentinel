/** Continuously refill available slots; one slow item does not block the next batch. */
export async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  work: (item: T) => Promise<void>,
  shouldContinue: () => boolean = () => true
): Promise<number> {
  let next = 0;
  let completed = 0;
  const workers = await Promise.allSettled(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length && shouldContinue()) {
        const item = items[next++];
        await work(item);
        completed++;
      }
    })
  );
  const failed = workers.find((worker) => worker.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
  return completed;
}
