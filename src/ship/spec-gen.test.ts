import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { ensureFeatureSpec } from './spec-gen.js';
import type { Feature } from '../features/types.js';
import type { BrowserVerifyConfig } from '../constraints/schema.js';
import type { ClaudeRunOptions, ClaudeRunResult } from './types.js';

let tmp: string;
let runDir: string;

beforeEach(() => {
  tmp = join(tmpdir(), `reins-specgen-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmp, { recursive: true });
  runDir = join(tmp, '.reins', 'runs', 'test-run');
  mkdirSync(runDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function fixture(overrides: Partial<Feature> = {}): Feature {
  return {
    id: '001-login',
    title: 'Login',
    status: 'todo',
    priority: 100,
    depends_on: [],
    created_at: '2026-04-07T10:00:00.000Z',
    updated_at: '2026-04-07T10:00:00.000Z',
    last_run_id: null,
    last_failure: null,
    body: '\n## What\nEmail + password login.\n\n## Browser test\n1. Go to /login\n2. Fill email and password\n3. Click Sign in\n4. Expect /dashboard\n',
    ...overrides,
  };
}

const browserVerifyConfig: BrowserVerifyConfig = {
  command: 'pnpm playwright test',
  spec_dir: 'e2e/reins-generated',
};

/** Mock spawn that touches the target spec file (simulates claude writing it). */
function spawnThatWrites(specPath: string): (prompt: string, opts: ClaudeRunOptions) => Promise<ClaudeRunResult> {
  return async (prompt, _opts) => {
    mkdirSync(join(specPath, '..'), { recursive: true });
    writeFileSync(specPath, `// auto-generated\nconsole.log(${JSON.stringify(prompt.slice(0, 20))});\n`, 'utf-8');
    return { exitCode: 0, stdout: 'wrote file', stderr: '', durationMs: 10, timedOut: false };
  };
}

/** Mock spawn that exits 0 but writes nothing. */
function spawnThatDoesNothing(): () => Promise<ClaudeRunResult> {
  return async () => ({
    exitCode: 0,
    stdout: 'I thought about it',
    stderr: '',
    durationMs: 5,
    timedOut: false,
  });
}

function spawnThatFails(stderr: string): () => Promise<ClaudeRunResult> {
  return async () => ({
    exitCode: 1,
    stdout: '',
    stderr,
    durationMs: 5,
    timedOut: false,
  });
}

// ---------------------------------------------------------------------------
// Reused
// ---------------------------------------------------------------------------

describe('ensureFeatureSpec reused', () => {
  it("returns action='reused' when a spec already exists at the target path", async () => {
    const specPath = join(tmp, 'e2e/reins-generated/001-login.spec.ts');
    mkdirSync(join(tmp, 'e2e/reins-generated'), { recursive: true });
    writeFileSync(specPath, '// hand-written\n', 'utf-8');

    const spawnSpy = vi.fn();
    const result = await ensureFeatureSpec(
      fixture(),
      tmp,
      browserVerifyConfig,
      runDir,
      { spawn: spawnSpy },
    );

    expect(result.action).toBe('reused');
    expect(result.specPath).toBe(specPath);
    expect(spawnSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Skipped
// ---------------------------------------------------------------------------

describe('ensureFeatureSpec skipped', () => {
  it("returns action='skipped' when the feature body has no '## Browser test' section", async () => {
    const spawnSpy = vi.fn();
    const result = await ensureFeatureSpec(
      fixture({ body: '\n## What\nJust a backend feature.\n' }),
      tmp,
      browserVerifyConfig,
      runDir,
      { spawn: spawnSpy },
    );

    expect(result.action).toBe('skipped');
    expect(result.reason).toMatch(/Browser test/);
    expect(spawnSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Generated
// ---------------------------------------------------------------------------

describe('ensureFeatureSpec generated', () => {
  it("returns action='generated' when claude writes the spec file", async () => {
    const specPath = join(tmp, 'e2e/reins-generated/001-login.spec.ts');
    const result = await ensureFeatureSpec(
      fixture(),
      tmp,
      browserVerifyConfig,
      runDir,
      { spawn: spawnThatWrites(specPath) },
    );

    expect(result.action).toBe('generated');
    expect(result.specPath).toBe(specPath);
    expect(existsSync(specPath)).toBe(true);
  });

  it('creates the spec_dir before spawning', async () => {
    const specDir = join(tmp, 'e2e/reins-generated');
    expect(existsSync(specDir)).toBe(false);

    const specPath = join(specDir, '001-login.spec.ts');
    await ensureFeatureSpec(
      fixture(),
      tmp,
      browserVerifyConfig,
      runDir,
      { spawn: spawnThatWrites(specPath) },
    );

    expect(existsSync(specDir)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Failed
// ---------------------------------------------------------------------------

describe('ensureFeatureSpec failed', () => {
  it("returns action='failed' when claude exits 0 but no file is written", async () => {
    const result = await ensureFeatureSpec(
      fixture(),
      tmp,
      browserVerifyConfig,
      runDir,
      { spawn: spawnThatDoesNothing() },
    );

    expect(result.action).toBe('failed');
    expect(result.reason).toMatch(/no file was written/);
  });

  it("returns action='failed' when claude exits non-zero", async () => {
    const result = await ensureFeatureSpec(
      fixture(),
      tmp,
      browserVerifyConfig,
      runDir,
      { spawn: spawnThatFails('model refused') },
    );

    expect(result.action).toBe('failed');
    expect(result.reason).toMatch(/exited 1/);
    expect(result.reason).toMatch(/model refused/);
  });

  it("returns action='failed' when spawn throws", async () => {
    const result = await ensureFeatureSpec(
      fixture(),
      tmp,
      browserVerifyConfig,
      runDir,
      { spawn: async () => { throw new Error('spawn boom'); } },
    );

    expect(result.action).toBe('failed');
    expect(result.reason).toMatch(/spawn boom/);
  });
});
