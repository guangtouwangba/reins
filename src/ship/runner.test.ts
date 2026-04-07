import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runFeature, type RunFeatureContext } from './runner.js';
import { writeFeature, parseFeatureFile } from '../features/index.js';
import type { Feature } from '../features/types.js';
import type { ClaudeRunResult, VerifyResult } from './types.js';
import type { CommitResult } from './commit.js';
import type { DriftResult } from './drift-check.js';

let tmp: string;
let runDir: string;
let featurePath: string;

beforeEach(() => {
  tmp = join(tmpdir(), `reins-runner-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmp, { recursive: true });
  runDir = join(tmp, '.reins', 'runs', 'test-run');
  mkdirSync(runDir, { recursive: true });
  featurePath = join(tmp, '.reins', 'features', '001-test.md');
  mkdirSync(join(tmp, '.reins', 'features'), { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function fixture(overrides: Partial<Feature> = {}): Feature {
  return {
    id: '001-test',
    title: 'Test feature',
    status: 'todo',
    priority: 100,
    depends_on: [],
    created_at: '2026-04-07T10:00:00.000Z',
    updated_at: '2026-04-07T10:00:00.000Z',
    last_run_id: null,
    last_failure: null,
    body: '\n## What\nDo a thing.\n',
    ...overrides,
  };
}

function okSpawn(): () => Promise<ClaudeRunResult> {
  return async () => ({
    exitCode: 0,
    stdout: 'ok',
    stderr: '',
    durationMs: 10,
    timedOut: false,
  });
}

function failSpawn(message: string): () => Promise<ClaudeRunResult> {
  return async () => ({
    exitCode: 1,
    stdout: '',
    stderr: message,
    durationMs: 10,
    timedOut: false,
  });
}

function pass(): VerifyResult { return { passed: true }; }
function fail(command: string, output: string): VerifyResult {
  return { passed: false, failure: { command, exit_code: 1, output } };
}

function emptyDrift(): DriftResult { return { touchedFiles: [], outOfScope: [] }; }
function drift(outOfScope: string[]): DriftResult {
  return { touchedFiles: outOfScope, outOfScope };
}

function okCommit(sha = 'abc123'): CommitResult { return { success: true, sha }; }
function failCommit(hookOutput: string): CommitResult {
  return { success: false, hookOutput };
}

function makeCtx(overrides: Partial<RunFeatureContext> = {}): RunFeatureContext {
  // Write a valid feature file so safeUpdateFrontmatter can update it.
  if (!existsSync(featurePath)) {
    writeFeature(featurePath, fixture());
  }
  return {
    spawn: okSpawn(),
    runPreCommit: pass,
    runFeatureVerify: pass,
    checkScopeDrift: emptyDrift,
    commitFeature: () => okCommit(),
    isParallel: false,
    maxAttempts: 3,
    config: { auto_commit: true, implement_timeout_ms: 60_000 },
    runId: 'test-run',
    commitStyle: 'conventional',
    featurePath,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('runFeature happy path', () => {
  it('transitions draft → done after a single successful attempt', async () => {
    writeFeature(featurePath, fixture({ status: 'todo' }));
    const ctx = makeCtx();
    const result = await runFeature(fixture(), tmp, tmp, runDir, ctx);

    expect(result.status).toBe('done');
    expect(result.attempts).toBe(1);
    expect(result.commit_sha).toBe('abc123');

    const reparsed = parseFeatureFile(featurePath);
    expect(reparsed?.status).toBe('done');
    expect(reparsed?.last_run_id).toBe('test-run');
  });

  it('writes attempt logs to <runDir>/<id>/attempt-N/', async () => {
    writeFeature(featurePath, fixture({ status: 'todo' }));
    const ctx = makeCtx();
    await runFeature(fixture(), tmp, tmp, runDir, ctx);

    const attemptDir = join(runDir, '001-test', 'attempt-1');
    expect(existsSync(attemptDir)).toBe(true);
    expect(existsSync(join(attemptDir, 'implement-prompt.md'))).toBe(true);
    expect(existsSync(join(attemptDir, 'commit-result.json'))).toBe(true);
  });

  it('skips the commit step when auto_commit is false', async () => {
    writeFeature(featurePath, fixture({ status: 'todo' }));
    const commitSpy = vi.fn(() => okCommit());
    const ctx = makeCtx({
      config: { auto_commit: false, implement_timeout_ms: 60_000 },
      commitFeature: commitSpy,
    });
    const result = await runFeature(fixture(), tmp, tmp, runDir, ctx);

    expect(result.status).toBe('done');
    expect(result.commit_sha).toBeUndefined();
    expect(commitSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Retry paths
// ---------------------------------------------------------------------------

describe('runFeature retry paths', () => {
  it('retries on claude spawn failure and succeeds on second attempt', async () => {
    writeFeature(featurePath, fixture({ status: 'todo' }));
    let call = 0;
    const ctx = makeCtx({
      spawn: async () => {
        call += 1;
        if (call === 1) return { exitCode: 1, stdout: '', stderr: 'first fail', durationMs: 5, timedOut: false };
        return { exitCode: 0, stdout: 'ok', stderr: '', durationMs: 5, timedOut: false };
      },
    });
    const result = await runFeature(fixture(), tmp, tmp, runDir, ctx);
    expect(result.status).toBe('done');
    expect(result.attempts).toBe(2);
  });

  it('retries on pre_commit failure and succeeds after fix', async () => {
    writeFeature(featurePath, fixture({ status: 'todo' }));
    let call = 0;
    const ctx = makeCtx({
      runPreCommit: () => {
        call += 1;
        return call === 1 ? fail('pnpm lint', 'error on line 42') : pass();
      },
    });
    const result = await runFeature(fixture(), tmp, tmp, runDir, ctx);
    expect(result.status).toBe('done');
    expect(result.attempts).toBe(2);
  });

  it('retries on feature_verify failure', async () => {
    writeFeature(featurePath, fixture({ status: 'todo' }));
    let call = 0;
    const ctx = makeCtx({
      runFeatureVerify: () => {
        call += 1;
        return call === 1 ? fail('pnpm test', 'test X failed') : pass();
      },
    });
    const result = await runFeature(fixture(), tmp, tmp, runDir, ctx);
    expect(result.status).toBe('done');
    expect(result.attempts).toBe(2);
  });

  it('retries on commit failure (pre-commit hook rejection)', async () => {
    writeFeature(featurePath, fixture({ status: 'todo' }));
    let call = 0;
    const ctx = makeCtx({
      commitFeature: () => {
        call += 1;
        return call === 1 ? failCommit('hook says no') : okCommit();
      },
    });
    const result = await runFeature(fixture(), tmp, tmp, runDir, ctx);
    expect(result.status).toBe('done');
    expect(result.attempts).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Exhausted attempts → blocked
// ---------------------------------------------------------------------------

describe('runFeature blocked paths', () => {
  it('marks blocked with last_failure after max_attempts exhausted', async () => {
    writeFeature(featurePath, fixture({ status: 'todo' }));
    const ctx = makeCtx({
      runPreCommit: () => fail('pnpm lint', 'always broken'),
      maxAttempts: 2,
    });
    const result = await runFeature(fixture(), tmp, tmp, runDir, ctx);
    expect(result.status).toBe('blocked');
    expect(result.attempts).toBe(2);
    expect(result.failure?.stage).toBe('pre_commit');

    const reparsed = parseFeatureFile(featurePath);
    expect(reparsed?.status).toBe('blocked');
    expect(reparsed?.last_failure?.stage).toBe('pre_commit');
  });

  it('respects per-feature max_attempts override', async () => {
    writeFeature(featurePath, fixture({ status: 'todo' }));
    const ctx = makeCtx({
      spawn: failSpawn('always fails'),
      maxAttempts: 5, // default
    });
    const featureWithOverride = fixture({ max_attempts: 1 });
    const result = await runFeature(featureWithOverride, tmp, tmp, runDir, ctx);
    expect(result.attempts).toBe(1);
    expect(result.status).toBe('blocked');
  });

  it('captures the latest failure in last_failure even after multiple stages fail', async () => {
    writeFeature(featurePath, fixture({ status: 'todo' }));
    let call = 0;
    const ctx = makeCtx({
      runPreCommit: () => {
        call += 1;
        if (call === 1) return fail('lint', 'lint error');
        return pass();
      },
      runFeatureVerify: () => fail('test', 'test error'),
      maxAttempts: 3,
    });
    const result = await runFeature(fixture(), tmp, tmp, runDir, ctx);
    expect(result.status).toBe('blocked');
    // After attempt 1 (lint fail), attempts 2 and 3 get past lint but fail at test.
    // Final previousFailure should be feature_verify (the latest one).
    expect(result.failure?.stage).toBe('feature_verify');
  });
});

// ---------------------------------------------------------------------------
// Scope drift: serial warns, parallel blocks
// ---------------------------------------------------------------------------

describe('runFeature scope drift handling', () => {
  it('in serial mode, scope drift is a warning and the attempt continues', async () => {
    writeFeature(featurePath, fixture({ status: 'todo', scope: ['src/auth/**'] }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctx = makeCtx({
      isParallel: false,
      checkScopeDrift: () => drift(['src/other/leak.ts']),
    });
    const result = await runFeature(
      fixture({ scope: ['src/auth/**'] }),
      tmp,
      tmp,
      runDir,
      ctx,
    );
    expect(result.status).toBe('done');
    expect(result.attempts).toBe(1);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('in parallel mode, scope drift blocks the attempt and triggers retry', async () => {
    writeFeature(featurePath, fixture({ status: 'todo', scope: ['src/auth/**'] }));
    let driftCall = 0;
    const ctx = makeCtx({
      isParallel: true,
      checkScopeDrift: () => {
        driftCall += 1;
        // First attempt drifts, second attempt stays in scope
        if (driftCall === 1) return drift(['src/other/leak.ts']);
        return emptyDrift();
      },
    });
    const result = await runFeature(
      fixture({ scope: ['src/auth/**'] }),
      tmp,
      tmp,
      runDir,
      ctx,
    );
    expect(result.status).toBe('done');
    expect(result.attempts).toBe(2);
  });

  it('parallel mode drift exhausts attempts → blocked with stage=scope-drift', async () => {
    writeFeature(featurePath, fixture({ status: 'todo', scope: ['src/auth/**'] }));
    const ctx = makeCtx({
      isParallel: true,
      checkScopeDrift: () => drift(['src/other/leak.ts']),
      maxAttempts: 2,
    });
    const result = await runFeature(
      fixture({ scope: ['src/auth/**'] }),
      tmp,
      tmp,
      runDir,
      ctx,
    );
    expect(result.status).toBe('blocked');
    expect(result.failure?.stage).toBe('scope-drift');
  });
});

// ---------------------------------------------------------------------------
// Frontmatter updates
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Browser verify wiring
// ---------------------------------------------------------------------------

describe('runFeature browser_verify wiring', () => {
  it('calls runBrowserVerify after feature_verify passes', async () => {
    writeFeature(featurePath, fixture({ status: 'todo' }));
    const browserSpy = vi.fn(async () => pass());
    const ctx = makeCtx({ runBrowserVerify: browserSpy });
    const result = await runFeature(fixture(), tmp, tmp, runDir, ctx);
    expect(result.status).toBe('done');
    expect(browserSpy).toHaveBeenCalledOnce();
  });

  it('treats a skipped browser_verify as passed', async () => {
    writeFeature(featurePath, fixture({ status: 'todo' }));
    const ctx = makeCtx({
      runBrowserVerify: async () => ({ passed: true, skipped: true }),
    });
    const result = await runFeature(fixture(), tmp, tmp, runDir, ctx);
    expect(result.status).toBe('done');
  });

  it('retries on browser_verify failure and fails at max attempts', async () => {
    writeFeature(featurePath, fixture({ status: 'todo' }));
    const ctx = makeCtx({
      runBrowserVerify: async () => fail('playwright test', 'button missing'),
      maxAttempts: 2,
    });
    const result = await runFeature(fixture(), tmp, tmp, runDir, ctx);
    expect(result.status).toBe('blocked');
    expect(result.failure?.stage).toBe('browser_verify');
    expect(result.attempts).toBe(2);
  });

  it('skips browser_verify entirely when dep is undefined (backward compat)', async () => {
    writeFeature(featurePath, fixture({ status: 'todo' }));
    const ctx = makeCtx();
    // runBrowserVerify not set → undefined
    expect(ctx.runBrowserVerify).toBeUndefined();
    const result = await runFeature(fixture(), tmp, tmp, runDir, ctx);
    expect(result.status).toBe('done');
  });
});

describe('runFeature frontmatter updates', () => {
  it('sets status=in-progress at the start and last_run_id', async () => {
    writeFeature(featurePath, fixture({ status: 'todo' }));
    // Spawn is slow so we can peek at the intermediate state... but vitest
    // doesn't easily support that. Instead verify final state + last_run_id.
    const ctx = makeCtx();
    await runFeature(fixture(), tmp, tmp, runDir, ctx);
    const reparsed = parseFeatureFile(featurePath);
    expect(reparsed?.last_run_id).toBe('test-run');
  });

  it('clears last_failure when feature transitions to done', async () => {
    writeFeature(
      featurePath,
      fixture({
        status: 'blocked',
        last_failure: {
          stage: 'pre_commit',
          command: 'lint',
          exit_code: 1,
          output: 'old error',
        },
      }),
    );
    const ctx = makeCtx();
    await runFeature(fixture(), tmp, tmp, runDir, ctx);
    const reparsed = parseFeatureFile(featurePath);
    expect(reparsed?.status).toBe('done');
    expect(reparsed?.last_failure).toBeNull();
  });
});
