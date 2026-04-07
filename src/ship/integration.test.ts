import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import yaml from 'js-yaml';

import { runShip } from './index.js';
import type { ClaudeRunResult, RunSummary } from './types.js';
import type { Feature } from '../features/types.js';
import { writeFeature } from '../features/index.js';

/**
 * End-to-end integration tests for `reins ship`. These run against a
 * real git repo fixture in a temp dir and use a mocked
 * `spawnClaudeHeadless` to simulate Claude Code's behavior without
 * calling the real binary. Everything else (git, filesystem, run log,
 * plan JSON, status transitions) exercises the real code paths.
 *
 * Four scenarios are covered:
 *
 * 1. **Happy path** — spawn touches a marker file, all verify layers
 *    pass, feature goes `done`, git log shows a new commit with the
 *    reins footer.
 * 2. **Retry path** — spawn fails once then succeeds, attempts=2, same
 *    final state.
 * 3. **Blocked path** — verify always fails, feature goes `blocked`
 *    with `last_failure` populated.
 * 4. **Dry run** — plan is produced, no spawn is called, no commit.
 */
let tmp: string;

function git(cmd: string, cwd: string = tmp): void {
  execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function initFixture(): void {
  git('git init -q -b main');
  git('git config user.email "test@example.com"');
  git('git config user.name "test"');
  git('git config commit.gpgsign false');
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'fixture' }), 'utf-8');
  writeFileSync(join(tmp, 'README.md'), '# fixture\n', 'utf-8');
  git('git add .');
  git('git commit -q -m "initial"');
}

function writeConstraints(extra: Record<string, unknown> = {}): void {
  mkdirSync(join(tmp, '.reins'), { recursive: true });
  const config = {
    version: 1,
    generated_at: new Date().toISOString(),
    project: { name: 'fixture', type: 'library' },
    stack: {
      primary_language: 'typescript',
      framework: 'none',
      test_framework: 'vitest',
      package_manager: 'pnpm',
    },
    constraints: [],
    pipeline: {
      pre_commit: ['true'],
      feature_verify: ['echo feature-verify ok'],
      ...extra,
    },
  };
  writeFileSync(join(tmp, '.reins', 'constraints.yaml'), yaml.dump(config), 'utf-8');
}

function writeFixtureFeature(overrides: Partial<Feature> = {}): void {
  mkdirSync(join(tmp, '.reins', 'features'), { recursive: true });
  const feature: Feature = {
    id: '001-marker',
    title: 'Create a marker file',
    status: 'todo',
    priority: 100,
    depends_on: [],
    created_at: '2026-04-07T10:00:00.000Z',
    updated_at: '2026-04-07T10:00:00.000Z',
    last_run_id: null,
    last_failure: null,
    body: '\n## What\nTouch a marker file to prove the implement step ran.\n\n## Acceptance\n- [ ] marker.txt exists\n',
    ...overrides,
  };
  writeFeature(join(tmp, '.reins', 'features', `${feature.id}.md`), feature);
}

/**
 * Mock spawn that simulates Claude Code writing a marker file on each
 * successful call. Flip `succeedsAfterCall` to make the first N calls
 * fail.
 */
function mockClaude(opts: { succeedsAfterCall?: number } = {}): () => Promise<ClaudeRunResult> {
  const succeedsAfter = opts.succeedsAfterCall ?? 0;
  let call = 0;
  return async () => {
    call++;
    if (call <= succeedsAfter) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `simulated failure (call ${call}/${succeedsAfter})`,
        durationMs: 5,
        timedOut: false,
      };
    }
    // Simulate the implement step by touching a marker file at tmp/marker.txt
    writeFileSync(join(tmp, 'marker.txt'), `ran on call ${call}\n`, 'utf-8');
    return {
      exitCode: 0,
      stdout: `wrote marker.txt on call ${call}`,
      stderr: '',
      durationMs: 5,
      timedOut: false,
    };
  };
}

beforeEach(() => {
  tmp = join(tmpdir(), `reins-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmp, { recursive: true });
  initFixture();
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 1. Happy path
// ---------------------------------------------------------------------------

describe('runShip integration — happy path', () => {
  it('implements a feature, verifies, commits, and reports done', async () => {
    writeConstraints();
    writeFixtureFeature();

    const summary = await runShip(tmp, {
      deps: {
        spawn: mockClaude(),
        plannerDeps: { plannerEnabled: false },
      },
    });

    expect(summary.totals.done).toBe(1);
    expect(summary.totals.blocked).toBe(0);
    expect(summary.features).toHaveLength(1);

    // Feature file transitioned to done
    const reparsed = yaml.load(
      readFileSync(join(tmp, '.reins', 'features', '001-marker.md'), 'utf-8')
        .split('---')[1] ?? '',
    ) as Record<string, unknown>;
    expect(reparsed['status']).toBe('done');

    // run.json exists and has the feature
    const runDir = join(tmp, '.reins', 'runs', summary.id);
    expect(existsSync(join(runDir, 'run.json'))).toBe(true);
    expect(existsSync(join(runDir, 'plan.json'))).toBe(true);

    const runJson = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf-8')) as RunSummary;
    expect(runJson.totals.done).toBe(1);
    expect(runJson.features[0]?.id).toBe('001-marker');
    expect(runJson.features[0]?.status).toBe('done');
    expect(runJson.features[0]?.commit_sha).toBeTruthy();

    // Real git commit on main with the reins footer
    const log = execSync('git log -1 --format=%B', { cwd: tmp, encoding: 'utf-8' });
    expect(log).toContain('Create a marker file');
    expect(log).toContain('Reins-feature-id: 001-marker');
    expect(log).toContain('Reins-run-id:');
    expect(log).toContain('Reins-attempts: 1');

    // The marker file exists and is part of the commit
    expect(existsSync(join(tmp, 'marker.txt'))).toBe(true);
  });

  it('writes an attempt log directory for the successful run', async () => {
    writeConstraints();
    writeFixtureFeature();

    const summary = await runShip(tmp, {
      deps: {
        spawn: mockClaude(),
        plannerDeps: { plannerEnabled: false },
      },
    });

    const attemptDir = join(tmp, '.reins', 'runs', summary.id, '001-marker', 'attempt-1');
    expect(existsSync(attemptDir)).toBe(true);
    const files = readdirSync(attemptDir);
    // At minimum: the implement prompt and one verify result artifact.
    expect(files.some(f => f.includes('implement-prompt'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Retry path
// ---------------------------------------------------------------------------

describe('runShip integration — retry path', () => {
  it('retries claude after one failure and succeeds on attempt 2', async () => {
    writeConstraints();
    writeFixtureFeature();

    // Uses the REAL runFeature state machine with an injected spawn
    // that fails the first call then succeeds, exercising the full
    // failure-feedback → retry → done path.
    const summary = await runShip(tmp, {
      deps: {
        spawn: mockClaude({ succeedsAfterCall: 1 }),
        plannerDeps: { plannerEnabled: false },
      },
    });

    expect(summary.features[0]?.status).toBe('done');
    expect(summary.features[0]?.attempts).toBe(2);
    expect(existsSync(join(tmp, 'marker.txt'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Blocked path
// ---------------------------------------------------------------------------

describe('runShip integration — blocked path', () => {
  it('marks a feature blocked when verify always fails', async () => {
    writeConstraints({
      pre_commit: ['true'],
      feature_verify: ['false'], // always exits 1
    });
    writeFixtureFeature({ max_attempts: 2 });

    const summary = await runShip(tmp, {
      deps: {
        spawn: mockClaude(),
        plannerDeps: { plannerEnabled: false },
      },
    });

    expect(summary.totals.done).toBe(0);
    expect(summary.totals.blocked).toBe(1);

    const runDir = join(tmp, '.reins', 'runs', summary.id);
    const runJson = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf-8')) as RunSummary;
    expect(runJson.features[0]?.status).toBe('blocked');
    expect(runJson.features[0]?.failure).toBeDefined();
    expect(runJson.features[0]?.failure?.stage).toBe('feature_verify');
  });
});

// ---------------------------------------------------------------------------
// 4. Dry run
// ---------------------------------------------------------------------------

describe('runShip integration — dry run', () => {
  it('writes a plan without spawning claude or committing', async () => {
    writeConstraints();
    writeFixtureFeature();

    const summary = await runShip(tmp, {
      dryRun: true,
      deps: {
        spawn: mockClaude(),
        plannerDeps: { plannerEnabled: false },
      },
    });

    // No features ran
    expect(summary.features).toHaveLength(0);
    expect(summary.totals.done).toBe(0);

    // plan.json was written
    const runDir = join(tmp, '.reins', 'runs', summary.id);
    expect(existsSync(join(runDir, 'plan.json'))).toBe(true);

    // No marker was touched (spawn was never called)
    expect(existsSync(join(tmp, 'marker.txt'))).toBe(false);

    // Git log unchanged — still just the initial commit
    const logLines = execSync('git log --oneline', { cwd: tmp, encoding: 'utf-8' })
      .trim()
      .split('\n');
    expect(logLines).toHaveLength(1);

    // Feature stayed in todo
    const reparsed = yaml.load(
      readFileSync(join(tmp, '.reins', 'features', '001-marker.md'), 'utf-8')
        .split('---')[1] ?? '',
    ) as Record<string, unknown>;
    expect(reparsed['status']).toBe('todo');

    // RunSummary.plan is populated per the Phase 2A fix
    expect(summary.plan).toBeDefined();
    expect(summary.plan?.source).toBe('fallback');
  });
});
