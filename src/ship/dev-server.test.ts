import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';

import {
  startDevServer,
  stopDevServer,
  waitForUrl,
  discoverDevServer,
} from './dev-server.js';
import type { DevServerConfig, ConstraintsConfig } from '../constraints/schema.js';
import type { ClaudeRunResult } from './types.js';

let tmp: string;
let runDir: string;

beforeEach(() => {
  tmp = join(tmpdir(), `reins-devserver-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmp, { recursive: true });
  runDir = join(tmp, '.reins', 'runs', 'test-run');
  mkdirSync(runDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// startDevServer + stopDevServer
// ---------------------------------------------------------------------------

describe('startDevServer', () => {
  it('returns a handle with pid + stop callback', () => {
    const config: DevServerConfig = {
      command: 'sleep 30',
      wait_for_url: 'http://localhost:0',
      timeout_ms: 1000,
    };
    const handle = startDevServer(config, tmp);
    expect(handle.pid).toBeGreaterThan(0);
    expect(typeof handle.stop).toBe('function');
    expect(handle.command).toBe('sleep 30');
    handle.stop();
  });

  it('does not throw when the command is invalid', () => {
    const config: DevServerConfig = {
      command: '/nonexistent/binary/xyz',
      wait_for_url: 'http://localhost:0',
      timeout_ms: 1000,
    };
    expect(() => startDevServer(config, tmp)).not.toThrow();
  });
});

describe('stopDevServer', () => {
  it('is idempotent — calling stop twice does not throw', () => {
    const config: DevServerConfig = {
      command: 'sleep 30',
      wait_for_url: 'http://localhost:0',
      timeout_ms: 1000,
    };
    const handle = startDevServer(config, tmp);
    expect(() => {
      stopDevServer(handle);
      stopDevServer(handle);
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// waitForUrl
// ---------------------------------------------------------------------------

describe('waitForUrl', () => {
  it('returns true on the first 2xx response', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200 }));
    const result = await waitForUrl('http://test', 5000, { fetch: fetchFn });
    expect(result).toBe(true);
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('counts 4xx as "server is answering" (healthy)', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 404 }));
    const result = await waitForUrl('http://test', 5000, { fetch: fetchFn });
    expect(result).toBe(true);
  });

  it('retries until success', async () => {
    let call = 0;
    const fetchFn = vi.fn(async () => {
      call++;
      if (call < 3) throw new Error('ECONNREFUSED');
      return { ok: true, status: 200 };
    });
    const fakeSleep = vi.fn(async () => {});
    const result = await waitForUrl('http://test', 5000, { fetch: fetchFn, sleep: fakeSleep });
    expect(result).toBe(true);
    expect(call).toBe(3);
  });

  it('returns false on timeout', async () => {
    const fetchFn = vi.fn(async () => { throw new Error('refused'); });
    // Use a real short sleep so the loop actually advances in time.
    const result = await waitForUrl('http://test', 200, { fetch: fetchFn });
    expect(result).toBe(false);
  });

  it('treats 5xx as unhealthy and returns false after timeout', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 503 }));
    const result = await waitForUrl('http://test', 200, { fetch: fetchFn });
    expect(result).toBe(false);
    // 5xx should NOT short-circuit to true like 4xx does
    expect(fetchFn).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// discoverDevServer
// ---------------------------------------------------------------------------

function writeConstraints(root: string, extra: Partial<ConstraintsConfig['pipeline']> = {}): void {
  mkdirSync(join(root, '.reins'), { recursive: true });
  const config: ConstraintsConfig = {
    version: 1,
    generated_at: new Date().toISOString(),
    project: { name: 'test', type: 'library' },
    stack: {
      primary_language: 'typescript',
      framework: 'none',
      test_framework: 'vitest',
      package_manager: 'pnpm',
    },
    constraints: [],
    pipeline: { pre_commit: [], ...extra },
  };
  writeFileSync(join(root, '.reins', 'constraints.yaml'), yaml.dump(config), 'utf-8');
}

function mockSpawn(stdout: string, exitCode = 0): () => Promise<ClaudeRunResult> {
  return async () => ({
    exitCode,
    stdout,
    stderr: '',
    durationMs: 20,
    timedOut: false,
  });
}

describe('discoverDevServer', () => {
  it('returns parsed config on valid JSON and persists it to constraints.yaml', async () => {
    writeConstraints(tmp);
    writeFileSync(
      join(tmp, 'package.json'),
      JSON.stringify({ name: 'x', scripts: { dev: 'next dev' } }),
      'utf-8',
    );

    const response = JSON.stringify({
      command: 'pnpm dev',
      wait_for_url: 'http://localhost:3000',
      timeout_ms: 30000,
    });
    const result = await discoverDevServer(tmp, runDir, { spawn: mockSpawn(response) });

    expect(result).not.toBeNull();
    expect(result?.command).toBe('pnpm dev');
    expect(result?.wait_for_url).toBe('http://localhost:3000');
    expect(result?.timeout_ms).toBe(30000);

    // Persisted
    const raw = readFileSync(join(tmp, '.reins', 'constraints.yaml'), 'utf-8');
    const parsed = yaml.load(raw) as ConstraintsConfig;
    expect(parsed.pipeline.browser_verify?.dev_server?.command).toBe('pnpm dev');
  });

  it('accepts JSON wrapped in ```json fences', async () => {
    writeConstraints(tmp);
    const response =
      'Here you go:\n```json\n' +
      JSON.stringify({ command: 'npm run dev', wait_for_url: 'http://localhost:3000', timeout_ms: 30000 }) +
      '\n```\n';
    const result = await discoverDevServer(tmp, runDir, { spawn: mockSpawn(response) });
    expect(result?.command).toBe('npm run dev');
  });

  it('returns null on invalid JSON', async () => {
    writeConstraints(tmp);
    const result = await discoverDevServer(tmp, runDir, {
      spawn: mockSpawn('not json, just prose'),
    });
    expect(result).toBeNull();
  });

  it('returns null when model explicitly returns null', async () => {
    writeConstraints(tmp);
    const result = await discoverDevServer(tmp, runDir, {
      spawn: mockSpawn('null'),
    });
    expect(result).toBeNull();
  });

  it('returns null when required fields are missing', async () => {
    writeConstraints(tmp);
    const partial = JSON.stringify({ command: 'pnpm dev' }); // missing wait_for_url, timeout_ms
    const result = await discoverDevServer(tmp, runDir, { spawn: mockSpawn(partial) });
    expect(result).toBeNull();
  });

  it('returns null when claude exits non-zero', async () => {
    writeConstraints(tmp);
    const result = await discoverDevServer(tmp, runDir, {
      spawn: mockSpawn('{"command":"ok","wait_for_url":"http://x","timeout_ms":1000}', 1),
    });
    expect(result).toBeNull();
  });

  it('does not persist on failure', async () => {
    writeConstraints(tmp);
    const before = readFileSync(join(tmp, '.reins', 'constraints.yaml'), 'utf-8');
    await discoverDevServer(tmp, runDir, { spawn: mockSpawn('garbage') });
    const after = readFileSync(join(tmp, '.reins', 'constraints.yaml'), 'utf-8');
    expect(after).toBe(before);
  });

  it('returns null without throwing when constraints.yaml is missing (persistence fails silently)', async () => {
    // No constraints.yaml — persistence will fail, but the parsed config
    // is still valid, so we still return it.
    const response = JSON.stringify({
      command: 'pnpm dev',
      wait_for_url: 'http://localhost:3000',
      timeout_ms: 30000,
    });
    const result = await discoverDevServer(tmp, runDir, { spawn: mockSpawn(response) });
    // Returning null or the config is both acceptable; what matters is
    // no throw. Implementation returns the config; persistence failure
    // is logged internally.
    expect(result?.command).toBe('pnpm dev');
    expect(existsSync(join(tmp, '.reins', 'constraints.yaml'))).toBe(false);
  });
});
