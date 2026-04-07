import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';

import { runBrowserVerify } from './browser-verify.js';
import type { Feature } from '../features/types.js';
import type {
  BrowserVerifyConfig,
  ConstraintsConfig,
  DevServerConfig,
} from '../constraints/schema.js';
import type { SpecGenResult } from './spec-gen.js';
import type { DevServerHandle } from './dev-server.js';

let tmp: string;
let runDir: string;

beforeEach(() => {
  tmp = join(tmpdir(), `reins-browser-verify-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
    body: '\n## What\nLogin\n\n## Browser test\n1. Go to /login\n2. Click sign in\n',
    ...overrides,
  };
}

function writeConstraintsWith(browserVerify?: BrowserVerifyConfig): void {
  mkdirSync(join(tmp, '.reins'), { recursive: true });
  const config: ConstraintsConfig = {
    version: 1,
    generated_at: new Date().toISOString(),
    project: { name: 'test', type: 'library' },
    stack: { primary_language: 'typescript', framework: 'none', test_framework: 'vitest', package_manager: 'pnpm' },
    constraints: [],
    pipeline: {
      pre_commit: [],
      ...(browserVerify ? { browser_verify: browserVerify } : {}),
    },
  };
  writeFileSync(join(tmp, '.reins', 'constraints.yaml'), yaml.dump(config), 'utf-8');
}

const validDevServer: DevServerConfig = {
  command: 'pnpm dev',
  wait_for_url: 'http://localhost:3000',
  timeout_ms: 5000,
};

const validBrowserVerify: BrowserVerifyConfig = {
  command: 'pnpm playwright test',
  spec_dir: 'e2e/reins-generated',
  dev_server: validDevServer,
};

/** Build a mock DevServerHandle that tracks whether stop() was called. */
function mockHandle(): DevServerHandle & { stopped: boolean } {
  const handle = {
    pid: 999,
    child: null as unknown as import('node:child_process').ChildProcess,
    command: 'mock',
    stopped: false,
    stop: () => { handle.stopped = true; },
  };
  return handle;
}

// ---------------------------------------------------------------------------
// Skip paths
// ---------------------------------------------------------------------------

describe('runBrowserVerify skip paths', () => {
  it('returns passed+skipped when pipeline.browser_verify is not configured', async () => {
    writeConstraintsWith();
    const result = await runBrowserVerify(fixture(), tmp, runDir);
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it('returns passed+skipped when the feature has no Browser test section', async () => {
    writeConstraintsWith(validBrowserVerify);
    const result = await runBrowserVerify(
      fixture({ body: '\n## What\nBackend only\n' }),
      tmp,
      runDir,
    );
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it('returns passed+skipped when constraints.yaml is missing', async () => {
    // No .reins/constraints.yaml at all
    const result = await runBrowserVerify(fixture(), tmp, runDir);
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it('returns passed+skipped when dev server discovery fails', async () => {
    writeConstraintsWith({
      command: 'pnpm playwright test',
      spec_dir: 'e2e/reins-generated',
      // no dev_server → discovery is triggered
    });
    const result = await runBrowserVerify(fixture(), tmp, runDir, {
      ensureFeatureSpec: async () => ({ action: 'reused', specPath: '/tmp/fake.spec.ts' }),
      discoverDevServer: async () => null, // discovery fails
    });
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Spec gen failure
// ---------------------------------------------------------------------------

describe('runBrowserVerify spec gen', () => {
  it('returns failure when spec generation fails', async () => {
    writeConstraintsWith(validBrowserVerify);
    const result = await runBrowserVerify(fixture(), tmp, runDir, {
      ensureFeatureSpec: async (): Promise<SpecGenResult> => ({
        action: 'failed',
        specPath: '/tmp/fake.spec.ts',
        reason: 'claude refused',
      }),
    });
    expect(result.passed).toBe(false);
    expect(result.failure?.command).toBe('spec generation');
    expect(result.failure?.output).toContain('claude refused');
  });

  it('proceeds past spec gen when action=reused', async () => {
    writeConstraintsWith(validBrowserVerify);
    const handle = mockHandle();
    const result = await runBrowserVerify(fixture(), tmp, runDir, {
      ensureFeatureSpec: async () => ({ action: 'reused', specPath: '/tmp/fake.spec.ts' }),
      startDevServer: () => handle,
      waitForUrl: async () => true,
      runCommand: () => ({ passed: true }),
    });
    expect(result.passed).toBe(true);
    expect(result.skipped).toBeFalsy();
    expect(handle.stopped).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Dev server lifecycle
// ---------------------------------------------------------------------------

describe('runBrowserVerify dev server lifecycle', () => {
  it('starts, waits, runs the command, stops on success', async () => {
    writeConstraintsWith(validBrowserVerify);
    const handle = mockHandle();
    const startSpy = vi.fn(() => handle);
    const waitSpy = vi.fn(async () => true);
    const cmdSpy = vi.fn(() => ({ passed: true as const }));

    const result = await runBrowserVerify(fixture(), tmp, runDir, {
      ensureFeatureSpec: async () => ({ action: 'generated', specPath: '/tmp/fake.spec.ts' }),
      startDevServer: startSpy,
      waitForUrl: waitSpy,
      runCommand: cmdSpy,
    });

    expect(result.passed).toBe(true);
    expect(startSpy).toHaveBeenCalledOnce();
    expect(waitSpy).toHaveBeenCalledWith('http://localhost:3000', 5000, expect.any(Object));
    expect(cmdSpy).toHaveBeenCalledWith('pnpm playwright test', tmp, 600_000);
    expect(handle.stopped).toBe(true);
  });

  it('stops the dev server in a finally block when the command fails', async () => {
    writeConstraintsWith(validBrowserVerify);
    const handle = mockHandle();

    const result = await runBrowserVerify(fixture(), tmp, runDir, {
      ensureFeatureSpec: async () => ({ action: 'generated', specPath: '/tmp/fake.spec.ts' }),
      startDevServer: () => handle,
      waitForUrl: async () => true,
      runCommand: () => ({ passed: false, exit_code: 1, output: 'test failed' }),
    });

    expect(result.passed).toBe(false);
    expect(result.failure?.output).toBe('test failed');
    expect(handle.stopped).toBe(true);
  });

  it('stops the dev server when waitForUrl times out', async () => {
    writeConstraintsWith(validBrowserVerify);
    const handle = mockHandle();

    const result = await runBrowserVerify(fixture(), tmp, runDir, {
      ensureFeatureSpec: async () => ({ action: 'generated', specPath: '/tmp/fake.spec.ts' }),
      startDevServer: () => handle,
      waitForUrl: async () => false,
      runCommand: () => ({ passed: true }),
    });

    expect(result.passed).toBe(false);
    expect(result.failure?.command).toMatch(/wait/);
    expect(handle.stopped).toBe(true);
  });

  it('stops the dev server even when runCommand throws', async () => {
    writeConstraintsWith(validBrowserVerify);
    const handle = mockHandle();

    await expect(
      runBrowserVerify(fixture(), tmp, runDir, {
        ensureFeatureSpec: async () => ({ action: 'generated', specPath: '/tmp/fake.spec.ts' }),
        startDevServer: () => handle,
        waitForUrl: async () => true,
        runCommand: () => { throw new Error('boom'); },
      }),
    ).rejects.toThrow('boom');

    expect(handle.stopped).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Discovery on first run
// ---------------------------------------------------------------------------

describe('runBrowserVerify discovery path', () => {
  it('triggers discoverDevServer when browser_verify.dev_server is missing', async () => {
    writeConstraintsWith({
      command: 'pnpm playwright test',
      spec_dir: 'e2e/reins-generated',
    });
    const discoverSpy = vi.fn(async () => validDevServer);
    const handle = mockHandle();

    const result = await runBrowserVerify(fixture(), tmp, runDir, {
      ensureFeatureSpec: async () => ({ action: 'generated', specPath: '/tmp/fake.spec.ts' }),
      discoverDevServer: discoverSpy,
      startDevServer: () => handle,
      waitForUrl: async () => true,
      runCommand: () => ({ passed: true }),
    });

    expect(discoverSpy).toHaveBeenCalledOnce();
    expect(result.passed).toBe(true);
  });
});
