import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { spawnClaudeHeadless, parseTokenUsage } from './claude-spawn.js';
import { createRunDir, writeAttemptLog, writeRunSummary } from './run-log.js';
import type { RunSummary } from './types.js';

let tmp: string;

beforeEach(() => {
  tmp = join(tmpdir(), `reins-spawn-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmp, { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// spawnClaudeHeadless
// ---------------------------------------------------------------------------

describe('spawnClaudeHeadless', () => {
  it('captures stdout from a successful stand-in process', async () => {
    const result = await spawnClaudeHeadless('hello world', {
      cwd: tmp,
      timeoutMs: 10_000,
      logDir: tmp,
      binary: '/bin/sh',
      buildArgs: (p) => ['-c', `echo "received: ${p}"`],
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('received: hello world');
    expect(result.timedOut).toBe(false);
  });

  it('reports non-zero exit codes without throwing', async () => {
    const result = await spawnClaudeHeadless('ignored', {
      cwd: tmp,
      timeoutMs: 10_000,
      logDir: tmp,
      binary: '/bin/sh',
      buildArgs: () => ['-c', 'echo failing; exit 7'],
    });
    expect(result.exitCode).toBe(7);
    expect(result.stdout).toContain('failing');
    expect(result.timedOut).toBe(false);
  });

  it('kills the child and sets timedOut when the timeout fires', async () => {
    const result = await spawnClaudeHeadless('ignored', {
      cwd: tmp,
      timeoutMs: 150,
      logDir: tmp,
      binary: '/bin/sh',
      buildArgs: () => ['-c', 'sleep 5; echo should-not-reach'],
    });
    expect(result.timedOut).toBe(true);
    expect(result.stdout).not.toContain('should-not-reach');
    // Exit code is whatever the killed process reports; typically null/signal-driven.
  }, 10_000);

  it('propagates AbortSignal to the child', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const result = await spawnClaudeHeadless('ignored', {
      cwd: tmp,
      timeoutMs: 10_000,
      logDir: tmp,
      signal: controller.signal,
      binary: '/bin/sh',
      buildArgs: () => ['-c', 'sleep 5; echo should-not-reach'],
    });
    expect(result.stdout).not.toContain('should-not-reach');
  }, 10_000);

  it('returns an error result without throwing for a missing binary', async () => {
    const result = await spawnClaudeHeadless('ignored', {
      cwd: tmp,
      timeoutMs: 5_000,
      logDir: tmp,
      binary: '/nonexistent/binary/that/should/not/exist',
      buildArgs: () => [],
    });
    expect(result.exitCode).toBe(-1);
    expect(result.stderr).toMatch(/spawn error/i);
  });

  it('writes an attempt log file to logDir', async () => {
    const logDir = join(tmp, 'logs');
    mkdirSync(logDir, { recursive: true });

    await spawnClaudeHeadless('my prompt here', {
      cwd: tmp,
      timeoutMs: 5_000,
      logDir,
      binary: '/bin/sh',
      buildArgs: (p) => ['-c', `echo "got: ${p}"`],
    });

    const files = readdirSync(logDir).filter(f => f.startsWith('claude-') && f.endsWith('.log'));
    expect(files.length).toBe(1);
    const fileName = files[0];
    if (!fileName) throw new Error('expected claude log file');
    const content = readFileSync(join(logDir, fileName), 'utf-8');
    expect(content).toContain('BINARY:');
    expect(content).toContain('EXIT: 0');
    expect(content).toContain('DURATION_MS:');
    expect(content).toContain('--- PROMPT ---');
    expect(content).toContain('my prompt here');
    expect(content).toContain('--- STDOUT ---');
    expect(content).toContain('got: my prompt here');
  });

  it('merges opts.env into the child environment', async () => {
    const result = await spawnClaudeHeadless('ignored', {
      cwd: tmp,
      timeoutMs: 5_000,
      logDir: tmp,
      env: { REINS_TEST_MARKER: 'present' },
      binary: '/bin/sh',
      buildArgs: () => ['-c', 'echo MARKER=$REINS_TEST_MARKER'],
    });
    expect(result.stdout).toContain('MARKER=present');
  });
});

// ---------------------------------------------------------------------------
// parseTokenUsage
// ---------------------------------------------------------------------------

describe('parseTokenUsage', () => {
  it('returns undefined on empty input', () => {
    expect(parseTokenUsage('')).toBeUndefined();
  });

  it('returns undefined on unparseable input without throwing', () => {
    expect(parseTokenUsage('random output with no token counts')).toBeUndefined();
    expect(parseTokenUsage('{{{ malformed json ')).toBeUndefined();
  });

  it('parses "input_tokens: 1234, output_tokens: 567" shape', () => {
    expect(parseTokenUsage('input_tokens: 1234, output_tokens: 567')).toEqual({
      input: 1234,
      output: 567,
    });
  });

  it('parses "Input: X tokens Output: Y tokens" shape', () => {
    expect(parseTokenUsage('Input: 1000 tokens\nOutput: 200 tokens')).toEqual({
      input: 1000,
      output: 200,
    });
  });

  it('parses "X input Y output" shape', () => {
    expect(parseTokenUsage('Summary: 50 input, 120 output')).toEqual({
      input: 50,
      output: 120,
    });
  });
});

// ---------------------------------------------------------------------------
// run-log
// ---------------------------------------------------------------------------

describe('createRunDir', () => {
  it('creates a .reins/runs/<iso>-<suffix>/ directory', () => {
    const runDir = createRunDir(tmp);
    expect(existsSync(runDir)).toBe(true);
    expect(runDir).toContain(join(tmp, '.reins', 'runs'));
    // Basename is an ISO-ish string with a random suffix — no ':' on disk
    const base = runDir.slice(runDir.lastIndexOf('/') + 1);
    expect(base).not.toContain(':');
    // Format: 2026-04-07T12-34-56-789Z-<4 chars>
    expect(base).toMatch(/Z-[a-z0-9]{4}$/);
  });

  it('produces unique paths for back-to-back invocations', () => {
    const a = createRunDir(tmp);
    const b = createRunDir(tmp);
    expect(a).not.toBe(b);
  });
});

describe('writeAttemptLog', () => {
  it('creates <runDir>/<featureId>/attempt-N/ with each artifact', () => {
    const runDir = createRunDir(tmp);
    writeAttemptLog(runDir, '001-test', 1, {
      'implement-prompt.md': 'prompt body',
      'pre_commit-output.log': 'lint ok',
    });

    const attemptDir = join(runDir, '001-test', 'attempt-1');
    expect(existsSync(attemptDir)).toBe(true);
    expect(readFileSync(join(attemptDir, 'implement-prompt.md'), 'utf-8')).toBe('prompt body');
    expect(readFileSync(join(attemptDir, 'pre_commit-output.log'), 'utf-8')).toBe('lint ok');
  });

  it('does not throw on write failure for a read-only-ish path', () => {
    // Point at a nonexistent, unreachable path. mkdir may succeed or fail
    // depending on the platform — but the function must never throw.
    expect(() =>
      writeAttemptLog('/nonexistent/reins-runs-fake', 'x', 1, { 'a.log': 'content' }),
    ).not.toThrow();
  });
});

describe('writeRunSummary', () => {
  it('serializes a RunSummary to run.json as valid JSON', () => {
    const runDir = createRunDir(tmp);
    const summary: RunSummary = {
      id: 'test-id',
      started_at: '2026-04-07T10:00:00.000Z',
      finished_at: '2026-04-07T10:05:00.000Z',
      duration_ms: 300_000,
      features: [
        {
          id: '001-a',
          status: 'done',
          attempts: 1,
          duration_ms: 150_000,
          commit_sha: 'abc123',
        },
      ],
      totals: {
        done: 1,
        blocked: 0,
        duration_ms: 150_000,
      },
    };

    writeRunSummary(runDir, summary);
    const path = join(runDir, 'run.json');
    expect(existsSync(path)).toBe(true);
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    expect(parsed.id).toBe('test-id');
    expect(parsed.features).toHaveLength(1);
    expect(parsed.features[0].status).toBe('done');
    expect(parsed.totals.done).toBe(1);
  });
});
