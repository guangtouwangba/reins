import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runShip, type RunShipDeps } from './index.js';
import { writeFeature } from '../features/index.js';
import type { Feature } from '../features/types.js';
import type {
  ExecutionPlan,
  FeatureRunResult,
} from './types.js';
import type { WorktreeHandle } from './worktree.js';
import type { CommitStyle } from './commit.js';

let tmp: string;

beforeEach(() => {
  tmp = join(tmpdir(), `reins-orch-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmp, { recursive: true });
  mkdirSync(join(tmp, '.reins', 'features'), { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function fixture(id: string, overrides: Partial<Feature> = {}): Feature {
  return {
    id,
    title: `Feature ${id}`,
    status: 'todo',
    priority: 100,
    depends_on: [],
    created_at: '2026-04-07T10:00:00.000Z',
    updated_at: '2026-04-07T10:00:00.000Z',
    last_run_id: null,
    last_failure: null,
    body: '\n## What\nA feature.\n',
    ...overrides,
  };
}

function writeFeatureFile(id: string, overrides: Partial<Feature> = {}): void {
  writeFeature(join(tmp, '.reins', 'features', `${id}.md`), fixture(id, overrides));
}

function doneResult(id: string, attempts = 1): FeatureRunResult {
  return {
    id,
    status: 'done',
    attempts,
    duration_ms: 100,
    commit_sha: `sha-${id}`,
  };
}

function blockedResult(id: string, attempts = 3): FeatureRunResult {
  return {
    id,
    status: 'blocked',
    attempts,
    duration_ms: 100,
    failure: {
      stage: 'feature_verify',
      command: 'pnpm test',
      exit_code: 1,
      output: 'test failed',
    },
  };
}

/** Builds a minimal `RunShipDeps` where every dep is a mock. */
function mockDeps(overrides: Partial<RunShipDeps> = {}): Partial<RunShipDeps> {
  return {
    loadFeatures: () => [],
    planExecution: async () => ({
      steps: [],
      parallelism: 1,
      estimated_minutes: 0,
      source: 'fallback' as const,
    }),
    runFeature: async (feature) => doneResult(feature.id),
    detectCommitStyle: (): CommitStyle => 'conventional',
    createWorktree: (_root, featureId) => ({
      featureId,
      path: join(tmp, '.reins', 'wt', featureId),
      branchName: `reins/feature-${featureId}`,
      baseCommit: 'base',
    }),
    rebaseAndMerge: () => ({ success: true, sha: 'merged-sha' }),
    removeWorktree: () => {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('runShip happy path', () => {
  it('returns an empty summary when no todo features exist', async () => {
    const summary = await runShip(tmp, { deps: mockDeps() });
    expect(summary.features).toEqual([]);
    expect(summary.totals.done).toBe(0);
    expect(summary.totals.blocked).toBe(0);
  });

  it('runs a single serial step with 2 features and marks both done', async () => {
    writeFeatureFile('a');
    writeFeatureFile('b');

    const plan: ExecutionPlan = {
      steps: [
        { mode: 'serial', features: ['a'], reason: '' },
        { mode: 'serial', features: ['b'], reason: '' },
      ],
      parallelism: 1,
      estimated_minutes: 5,
      source: 'ai',
    };

    const summary = await runShip(tmp, {
      deps: mockDeps({
        loadFeatures: () => [fixture('a'), fixture('b')],
        planExecution: async () => plan,
      }),
    });

    expect(summary.totals.done).toBe(2);
    expect(summary.totals.blocked).toBe(0);
    expect(summary.features.map(f => f.id)).toEqual(['a', 'b']);
  });

  it('writes run.json with the summary', async () => {
    writeFeatureFile('a');
    const plan: ExecutionPlan = {
      steps: [{ mode: 'serial', features: ['a'], reason: '' }],
      parallelism: 1,
      estimated_minutes: 1,
      source: 'ai',
    };
    const summary = await runShip(tmp, {
      deps: mockDeps({
        loadFeatures: () => [fixture('a')],
        planExecution: async () => plan,
      }),
    });

    const runDirPath = join(tmp, '.reins', 'runs', summary.id);
    expect(existsSync(join(runDirPath, 'run.json'))).toBe(true);
    const parsed = JSON.parse(readFileSync(join(runDirPath, 'run.json'), 'utf-8'));
    expect(parsed.totals.done).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// only, dry-run, no-commit, max-parallelism overrides
// ---------------------------------------------------------------------------

describe('runShip CLI overrides', () => {
  it('--only filters the feature set before planning', async () => {
    writeFeatureFile('a');
    writeFeatureFile('b');
    writeFeatureFile('c');
    const seen: Feature[] = [];
    await runShip(tmp, {
      only: ['a', 'c'],
      deps: mockDeps({
        loadFeatures: () => [fixture('a'), fixture('b'), fixture('c')],
        planExecution: async (_root, features) => {
          seen.push(...features);
          return {
            steps: features.map(f => ({ mode: 'serial' as const, features: [f.id], reason: '' })),
            parallelism: 1,
            estimated_minutes: 0,
            source: 'ai',
          };
        },
      }),
    });
    expect(seen.map(f => f.id).sort()).toEqual(['a', 'c']);
  });

  it('--dry-run writes the plan but does not call runFeature', async () => {
    writeFeatureFile('a');
    const runFeatureSpy = vi.fn(async (f: Feature) => doneResult(f.id));
    await runShip(tmp, {
      dryRun: true,
      deps: mockDeps({
        loadFeatures: () => [fixture('a')],
        planExecution: async () => ({
          steps: [{ mode: 'serial', features: ['a'], reason: '' }],
          parallelism: 1,
          estimated_minutes: 0,
          source: 'fallback',
        }),
        runFeature: runFeatureSpy,
      }),
    });
    expect(runFeatureSpy).not.toHaveBeenCalled();
  });

  it('--parallel 1 forces planner_enabled=false (fallback plan)', async () => {
    writeFeatureFile('a');
    writeFeatureFile('b');
    let capturedPlannerEnabled: boolean | undefined;
    const planExecutionMock: RunShipDeps['planExecution'] = async (
      _root,
      _features,
      _maxParallelism,
      _runDir,
      deps,
    ) => {
      capturedPlannerEnabled = deps?.plannerEnabled;
      return {
        steps: [
          { mode: 'serial', features: ['a'], reason: '' },
          { mode: 'serial', features: ['b'], reason: '' },
        ],
        parallelism: 1,
        estimated_minutes: 0,
        source: 'fallback',
      };
    };
    await runShip(tmp, {
      maxParallelism: 1,
      deps: mockDeps({
        loadFeatures: () => [fixture('a'), fixture('b')],
        planExecution: planExecutionMock,
      }),
    });
    expect(capturedPlannerEnabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Parallel step dispatch
// ---------------------------------------------------------------------------

describe('runShip parallel step', () => {
  it('creates worktrees for parallel features and rebases successful ones', async () => {
    writeFeatureFile('a');
    writeFeatureFile('b');

    const createSpy = vi.fn(
      (_root: string, featureId: string): WorktreeHandle => ({
        featureId,
        path: join(tmp, '.reins', 'wt', featureId),
        branchName: `reins/feature-${featureId}`,
        baseCommit: 'base',
      }),
    );
    const rebaseSpy = vi.fn(() => ({ success: true as const, sha: 'merged' }));
    const removeSpy = vi.fn();

    await runShip(tmp, {
      deps: mockDeps({
        loadFeatures: () => [fixture('a'), fixture('b')],
        planExecution: async () => ({
          steps: [{ mode: 'parallel', features: ['a', 'b'], reason: 'both parallel' }],
          parallelism: 2,
          estimated_minutes: 0,
          source: 'ai',
        }),
        createWorktree: createSpy,
        rebaseAndMerge: rebaseSpy,
        removeWorktree: removeSpy,
      }),
    });

    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(rebaseSpy).toHaveBeenCalledTimes(2);
    expect(removeSpy).toHaveBeenCalledTimes(2);
  });

  it('converts done → blocked when rebase conflicts', async () => {
    writeFeatureFile('a');
    writeFeatureFile('b');

    const summary = await runShip(tmp, {
      deps: mockDeps({
        loadFeatures: () => [fixture('a'), fixture('b')],
        planExecution: async () => ({
          steps: [{ mode: 'parallel', features: ['a', 'b'], reason: '' }],
          parallelism: 2,
          estimated_minutes: 0,
          source: 'ai',
        }),
        rebaseAndMerge: () => ({ success: false as const, conflict: 'merge conflict in src/a.ts' }),
      }),
    });

    expect(summary.totals.done).toBe(0);
    expect(summary.totals.blocked).toBe(2);
    const first = summary.features[0];
    expect(first?.failure?.stage).toBe('rebase');
    expect(first?.failure?.output).toContain('merge conflict');
  });

  it('drops commit_sha when rebase conflict converts done → blocked', async () => {
    // Regression: rebase-converted-blocked features used to keep the
    // worktree's commit sha, which misleads users because that sha
    // never landed on the main branch.
    writeFeatureFile('a');
    const summary = await runShip(tmp, {
      deps: mockDeps({
        loadFeatures: () => [fixture('a')],
        planExecution: async () => ({
          steps: [{ mode: 'parallel', features: ['a'], reason: '' }],
          parallelism: 1,
          estimated_minutes: 0,
          source: 'ai',
        }),
        // runFeature returns done with a worktree-local sha
        runFeature: async () => ({
          id: 'a',
          status: 'done',
          attempts: 1,
          duration_ms: 100,
          commit_sha: 'worktree-local-sha',
        }),
        // ...but rebase conflicts
        rebaseAndMerge: () => ({ success: false as const, conflict: 'boom' }),
      }),
    });

    expect(summary.totals.blocked).toBe(1);
    const r = summary.features[0];
    expect(r?.status).toBe('blocked');
    expect(r?.commit_sha).toBeUndefined();
  });

  it('preserves the worktree for blocked features (no removeWorktree call)', async () => {
    writeFeatureFile('a');
    const removeSpy = vi.fn();
    await runShip(tmp, {
      deps: mockDeps({
        loadFeatures: () => [fixture('a')],
        planExecution: async () => ({
          steps: [{ mode: 'parallel', features: ['a'], reason: '' }],
          parallelism: 1,
          estimated_minutes: 0,
          source: 'ai',
        }),
        runFeature: async () => blockedResult('a'),
        removeWorktree: removeSpy,
      }),
    });
    expect(removeSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Blocked pause
// ---------------------------------------------------------------------------

describe('runShip blocked pause', () => {
  it('does not proceed to next step after any blocked feature', async () => {
    writeFeatureFile('a');
    writeFeatureFile('b');
    writeFeatureFile('c');

    const runFeatureSpy = vi.fn(async (feature: Feature) => {
      if (feature.id === 'b') return blockedResult('b');
      return doneResult(feature.id);
    });

    const summary = await runShip(tmp, {
      deps: mockDeps({
        loadFeatures: () => [fixture('a'), fixture('b'), fixture('c')],
        planExecution: async () => ({
          steps: [
            { mode: 'serial', features: ['a'], reason: '' },
            { mode: 'serial', features: ['b'], reason: '' },
            { mode: 'serial', features: ['c'], reason: '' },
          ],
          parallelism: 1,
          estimated_minutes: 0,
          source: 'ai',
        }),
        runFeature: runFeatureSpy,
      }),
    });

    expect(runFeatureSpy).toHaveBeenCalledTimes(2); // a + b, not c
    expect(summary.totals.done).toBe(1);
    expect(summary.totals.blocked).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Lock file
// ---------------------------------------------------------------------------

describe('runShip lock file', () => {
  it('refuses to run when another ship lock exists', async () => {
    writeFeatureFile('a');
    // Manually create the lock
    mkdirSync(join(tmp, '.reins', 'runs'), { recursive: true });
    writeFileSync(join(tmp, '.reins', 'runs', '.lock'), '9999 other-run', 'utf-8');

    await expect(
      runShip(tmp, { deps: mockDeps({ loadFeatures: () => [fixture('a')] }) }),
    ).rejects.toThrow(/Another reins ship run is in progress/);
  });

  it('releases the lock after a successful run', async () => {
    writeFeatureFile('a');
    await runShip(tmp, {
      deps: mockDeps({
        loadFeatures: () => [fixture('a')],
        planExecution: async () => ({
          steps: [{ mode: 'serial', features: ['a'], reason: '' }],
          parallelism: 1,
          estimated_minutes: 0,
          source: 'ai',
        }),
      }),
    });
    expect(existsSync(join(tmp, '.reins', 'runs', '.lock'))).toBe(false);
  });
});
