import { describe, it, expect } from 'vitest';
import { pLimit } from './concurrency.js';

describe('pLimit', () => {
  it('returns results in input order', async () => {
    const tasks = [1, 2, 3, 4, 5].map(n => async () => n * 10);
    const result = await pLimit(2, tasks);
    expect(result).toEqual([10, 20, 30, 40, 50]);
  });

  it('respects the concurrency cap (never more than `limit` in flight)', async () => {
    let inFlight = 0;
    let peak = 0;
    const tasks = Array.from({ length: 10 }, () => async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise(r => setTimeout(r, 5));
      inFlight--;
      return 1;
    });
    await pLimit(3, tasks);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThanOrEqual(1);
  });

  it('runs strictly sequentially with limit=1', async () => {
    const order: number[] = [];
    const tasks = [1, 2, 3].map(n => async () => {
      order.push(n);
      await new Promise(r => setTimeout(r, 5));
      order.push(n + 100);
      return n;
    });
    await pLimit(1, tasks);
    // Strictly sequential: each task's push-push pair happens together
    expect(order).toEqual([1, 101, 2, 102, 3, 103]);
  });

  it('runs everything in parallel when limit > tasks.length', async () => {
    let inFlight = 0;
    let peak = 0;
    const tasks = Array.from({ length: 3 }, () => async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise(r => setTimeout(r, 5));
      inFlight--;
      return 1;
    });
    await pLimit(10, tasks);
    expect(peak).toBe(3);
  });

  it('propagates the first rejected task error', async () => {
    const tasks = [
      async () => 1,
      async () => { throw new Error('boom'); },
      async () => 3,
    ];
    await expect(pLimit(2, tasks)).rejects.toThrow('boom');
  });

  it('handles an empty task list', async () => {
    const result = await pLimit(4, []);
    expect(result).toEqual([]);
  });

  it('clamps non-positive limit to 1', async () => {
    const order: number[] = [];
    const tasks = [1, 2, 3].map(n => async () => {
      order.push(n);
      return n;
    });
    await pLimit(0, tasks);
    expect(order).toEqual([1, 2, 3]);
  });
});
