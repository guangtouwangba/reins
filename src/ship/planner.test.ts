import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { planExecution } from './planner.js';
import type { Feature } from '../features/types.js';
import type { ClaudeRunResult } from './types.js';

let tmp: string;
let runDir: string;

beforeEach(() => {
  tmp = join(tmpdir(), `reins-planner-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmp, { recursive: true });
  runDir = join(tmp, '.reins', 'runs', 'test-run');
  mkdirSync(runDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function fixture(overrides: Partial<Feature> = {}): Feature {
  return {
    id: 'test',
    title: 'Test feature',
    status: 'todo',
    priority: 100,
    depends_on: [],
    created_at: '2026-04-07T10:00:00.000Z',
    updated_at: '2026-04-07T10:00:00.000Z',
    last_run_id: null,
    last_failure: null,
    body: '\n## What\nSomething.\n',
    ...overrides,
  };
}

function mockSpawnReturning(stdout: string, exitCode = 0): (...args: unknown[]) => Promise<ClaudeRunResult> {
  return async () => ({
    exitCode,
    stdout,
    stderr: '',
    durationMs: 42,
    timedOut: false,
    tokenUsage: undefined,
  });
}

// ---------------------------------------------------------------------------
// Fallback paths
// ---------------------------------------------------------------------------

describe('planExecution fallback', () => {
  it('returns source=fallback when planner_enabled=false', async () => {
    const features = [fixture({ id: 'a' }), fixture({ id: 'b' })];
    const plan = await planExecution(tmp, features, 3, runDir, { plannerEnabled: false });
    expect(plan.source).toBe('fallback');
    expect(plan.steps.length).toBe(2);
    expect(plan.steps.every(s => s.mode === 'serial')).toBe(true);
  });

  it('returns source=fallback for a single feature (no point planning)', async () => {
    const plan = await planExecution(tmp, [fixture({ id: 'solo' })], 3, runDir, {});
    expect(plan.source).toBe('fallback');
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.features).toEqual(['solo']);
  });

  it('returns source=fallback for empty feature list', async () => {
    const plan = await planExecution(tmp, [], 3, runDir, {});
    expect(plan.source).toBe('fallback');
    expect(plan.steps).toEqual([]);
  });

  it('fallback topological sort places deps before dependents', async () => {
    const features = [
      fixture({ id: 'c', depends_on: ['a', 'b'], priority: 1 }),
      fixture({ id: 'b', depends_on: ['a'], priority: 5 }),
      fixture({ id: 'a', depends_on: [], priority: 10 }),
    ];
    const plan = await planExecution(tmp, features, 3, runDir, { plannerEnabled: false });
    const order = plan.steps.map(s => s.features[0]);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('fallback tie-breaks by priority then created_at', async () => {
    const features = [
      fixture({ id: 'x', priority: 5, created_at: '2026-01-02T00:00:00Z' }),
      fixture({ id: 'y', priority: 5, created_at: '2026-01-01T00:00:00Z' }),
      fixture({ id: 'z', priority: 3, created_at: '2026-01-03T00:00:00Z' }),
    ];
    const plan = await planExecution(tmp, features, 3, runDir, { plannerEnabled: false });
    const order = plan.steps.map(s => s.features[0]);
    // z has lowest priority → first. y before x on created_at tie-break.
    expect(order).toEqual(['z', 'y', 'x']);
  });

  it('fallback plan forces parallelism to 1 (all serial)', async () => {
    const features = [fixture({ id: 'a' }), fixture({ id: 'b' })];
    const plan = await planExecution(tmp, features, 5, runDir, { plannerEnabled: false });
    expect(plan.parallelism).toBe(1);
  });

  it('throws on dependency cycle', async () => {
    const features = [
      fixture({ id: 'a', depends_on: ['b'] }),
      fixture({ id: 'b', depends_on: ['a'] }),
    ];
    await expect(
      planExecution(tmp, features, 3, runDir, { plannerEnabled: true, spawn: mockSpawnReturning('{}') }),
    ).rejects.toThrow(/cycle/i);
  });
});

// ---------------------------------------------------------------------------
// AI path
// ---------------------------------------------------------------------------

describe('planExecution AI path', () => {
  const twoFeatures = [
    fixture({ id: 'a', scope: ['src/a/**'] }),
    fixture({ id: 'b', scope: ['src/b/**'] }),
  ];

  it('uses the injected spawn and returns source=ai on valid JSON', async () => {
    const response = JSON.stringify({
      steps: [{ mode: 'parallel', features: ['a', 'b'], reason: 'different modules' }],
      parallelism: 2,
      estimated_minutes: 10,
    });
    const plan = await planExecution(tmp, twoFeatures, 3, runDir, {
      spawn: mockSpawnReturning(response),
    });
    expect(plan.source).toBe('ai');
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.mode).toBe('parallel');
    expect(plan.steps[0]?.features).toEqual(['a', 'b']);
    expect(plan.parallelism).toBe(2);
  });

  it('accepts JSON wrapped in ```json fences', async () => {
    const response =
      'Here is the plan:\n```json\n' +
      JSON.stringify({
        steps: [{ mode: 'serial', features: ['a'], reason: 'first' }, { mode: 'serial', features: ['b'], reason: 'second' }],
        parallelism: 1,
        estimated_minutes: 5,
      }) +
      '\n```\n';
    const plan = await planExecution(tmp, twoFeatures, 3, runDir, {
      spawn: mockSpawnReturning(response),
    });
    expect(plan.source).toBe('ai');
    expect(plan.steps).toHaveLength(2);
  });

  it('falls back to source=fallback on invalid JSON', async () => {
    const plan = await planExecution(tmp, twoFeatures, 3, runDir, {
      spawn: mockSpawnReturning('nope not json at all'),
    });
    expect(plan.source).toBe('fallback');
  });

  it('falls back when a feature is missing from the plan', async () => {
    const response = JSON.stringify({
      steps: [{ mode: 'serial', features: ['a'], reason: 'forgot b' }],
      parallelism: 1,
      estimated_minutes: 5,
    });
    const plan = await planExecution(tmp, twoFeatures, 3, runDir, {
      spawn: mockSpawnReturning(response),
    });
    expect(plan.source).toBe('fallback');
  });

  it('falls back when the plan has an unknown feature id', async () => {
    const response = JSON.stringify({
      steps: [
        { mode: 'serial', features: ['a'], reason: '' },
        { mode: 'serial', features: ['b'], reason: '' },
        { mode: 'serial', features: ['ghost'], reason: '' },
      ],
      parallelism: 1,
      estimated_minutes: 5,
    });
    const plan = await planExecution(tmp, twoFeatures, 3, runDir, {
      spawn: mockSpawnReturning(response),
    });
    expect(plan.source).toBe('fallback');
  });

  it('falls back when the plan duplicates a feature', async () => {
    const response = JSON.stringify({
      steps: [
        { mode: 'serial', features: ['a', 'a'], reason: '' },
        { mode: 'serial', features: ['b'], reason: '' },
      ],
      parallelism: 1,
      estimated_minutes: 5,
    });
    const plan = await planExecution(tmp, twoFeatures, 3, runDir, {
      spawn: mockSpawnReturning(response),
    });
    expect(plan.source).toBe('fallback');
  });

  it('falls back when depends_on is violated', async () => {
    const features = [
      fixture({ id: 'a', depends_on: [] }),
      fixture({ id: 'b', depends_on: ['a'] }),
    ];
    // Plan puts b before a — violates depends_on
    const response = JSON.stringify({
      steps: [
        { mode: 'serial', features: ['b'], reason: '' },
        { mode: 'serial', features: ['a'], reason: '' },
      ],
      parallelism: 1,
      estimated_minutes: 5,
    });
    const plan = await planExecution(tmp, features, 3, runDir, {
      spawn: mockSpawnReturning(response),
    });
    expect(plan.source).toBe('fallback');
  });

  it('splits a parallel step with overlapping scope globs', async () => {
    const features = [
      fixture({ id: 'a', scope: ['src/auth/**'] }),
      fixture({ id: 'b', scope: ['src/auth/login/**'] }), // overlaps with a
      fixture({ id: 'c', scope: ['src/other/**'] }),
    ];
    const response = JSON.stringify({
      steps: [{ mode: 'parallel', features: ['a', 'b', 'c'], reason: 'all parallel' }],
      parallelism: 3,
      estimated_minutes: 15,
    });
    const plan = await planExecution(tmp, features, 3, runDir, {
      spawn: mockSpawnReturning(response),
    });
    expect(plan.source).toBe('ai');
    // a and b conflict → split. c is safe with one of them. Should end up with 2 steps.
    expect(plan.steps.length).toBeGreaterThanOrEqual(2);
    // Every feature should appear exactly once across the split
    const allIds = plan.steps.flatMap(s => s.features);
    expect(allIds.sort()).toEqual(['a', 'b', 'c']);
  });

  it('clamps parallelism to maxParallelism', async () => {
    const response = JSON.stringify({
      steps: [{ mode: 'parallel', features: ['a', 'b'], reason: '' }],
      parallelism: 10,
      estimated_minutes: 5,
    });
    const plan = await planExecution(tmp, twoFeatures, 3, runDir, {
      spawn: mockSpawnReturning(response),
    });
    expect(plan.parallelism).toBe(3);
  });

  it('falls back when the spawn throws', async () => {
    const plan = await planExecution(tmp, twoFeatures, 3, runDir, {
      spawn: async () => { throw new Error('spawn failed'); },
    });
    expect(plan.source).toBe('fallback');
  });

  it('falls back when spawn exits non-zero', async () => {
    const plan = await planExecution(tmp, twoFeatures, 3, runDir, {
      spawn: mockSpawnReturning('{}', 1),
    });
    expect(plan.source).toBe('fallback');
  });

  it('writes plan.json and planner-raw.log to runDir', async () => {
    const response = JSON.stringify({
      steps: [{ mode: 'parallel', features: ['a', 'b'], reason: 'x' }],
      parallelism: 2,
      estimated_minutes: 5,
    });
    await planExecution(tmp, twoFeatures, 3, runDir, {
      spawn: mockSpawnReturning(response),
    });
    expect(existsSync(join(runDir, 'plan.json'))).toBe(true);
    expect(existsSync(join(runDir, 'planner-raw.log'))).toBe(true);
    const plan = JSON.parse(readFileSync(join(runDir, 'plan.json'), 'utf-8'));
    expect(plan.source).toBe('ai');
  });

  it('writes plan.json even on fallback (no planner-raw.log when spawn not called)', async () => {
    await planExecution(tmp, twoFeatures, 3, runDir, { plannerEnabled: false });
    expect(existsSync(join(runDir, 'plan.json'))).toBe(true);
    const plan = JSON.parse(readFileSync(join(runDir, 'plan.json'), 'utf-8'));
    expect(plan.source).toBe('fallback');
  });
});
