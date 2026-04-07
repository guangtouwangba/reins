/**
 * Minimal promise pool — runs at most `limit` tasks concurrently and
 * returns their results in the same order as the input array.
 *
 * Used by the ship runner's parallel step dispatcher. We deliberately
 * avoid a dependency like `p-limit` — this is ~20 lines of code and
 * lives outside any hot path.
 *
 * Behavior:
 * - `limit <= 0` is treated as `limit = 1`
 * - `limit >= tasks.length` runs everything in parallel
 * - If any task rejects, the returned promise rejects with the first
 *   such error. Tasks that had already started keep running to
 *   completion in the background (there's no way to cancel a Promise);
 *   callers that need cancellation should pass an AbortSignal into
 *   their own task implementations.
 */
export async function pLimit<T>(
  limit: number,
  tasks: Array<() => Promise<T>>,
): Promise<T[]> {
  const cap = Math.max(1, limit | 0);
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;
  let firstError: unknown = undefined;

  const worker = async (): Promise<void> => {
    while (true) {
      const i = nextIndex++;
      if (i >= tasks.length) return;
      const task = tasks[i];
      if (!task) return;
      try {
        results[i] = await task();
      } catch (err) {
        if (firstError === undefined) firstError = err;
        // Continue draining so in-flight tasks finish; we'll throw at the end.
      }
    }
  };

  const workers: Array<Promise<void>> = [];
  for (let w = 0; w < Math.min(cap, tasks.length); w++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  if (firstError !== undefined) throw firstError;
  return results;
}
