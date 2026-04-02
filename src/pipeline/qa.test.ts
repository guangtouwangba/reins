import { describe, it, expect } from 'vitest';
import { runQA } from './qa.js';
import type { QAConfig } from './qa.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `reins-qa-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('runQA', () => {
  it('returns passed with empty commands', async () => {
    const config: QAConfig = { pre_commit: [], post_develop: [] };
    const result = await runQA('/tmp', config);
    expect(result.passed).toBe(true);
    expect(result.results).toEqual([]);
  });

  it('runs pre_commit commands and returns success', async () => {
    const tmpDir = makeTmpDir();
    try {
      const config: QAConfig = { pre_commit: ['echo "lint ok"'], post_develop: [] };
      const result = await runQA(tmpDir, config);
      expect(result.passed).toBe(true);
      expect(result.results).toHaveLength(1);
      expect(result.results[0]!.command).toBe('echo "lint ok"');
      expect(result.results[0]!.success).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('runs post_develop commands after pre_commit', async () => {
    const tmpDir = makeTmpDir();
    try {
      const config: QAConfig = {
        pre_commit: ['echo "pre"'],
        post_develop: ['echo "post"'],
      };
      const result = await runQA(tmpDir, config);
      expect(result.passed).toBe(true);
      expect(result.results).toHaveLength(2);
      expect(result.results[0]!.command).toBe('echo "pre"');
      expect(result.results[1]!.command).toBe('echo "post"');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('stops on first failing command', async () => {
    const tmpDir = makeTmpDir();
    try {
      const config: QAConfig = {
        pre_commit: ['exit 1', 'echo "should not run"'],
        post_develop: [],
      };
      const result = await runQA(tmpDir, config);
      expect(result.passed).toBe(false);
      expect(result.results).toHaveLength(1);
      expect(result.results[0]!.success).toBe(false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('records duration for each command', async () => {
    const tmpDir = makeTmpDir();
    try {
      const config: QAConfig = { pre_commit: ['echo "fast"'], post_develop: [] };
      const result = await runQA(tmpDir, config);
      expect(result.results[0]!.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('captures command output', async () => {
    const tmpDir = makeTmpDir();
    try {
      const config: QAConfig = { pre_commit: ['echo "hello world"'], post_develop: [] };
      const result = await runQA(tmpDir, config);
      expect(result.results[0]!.output).toContain('hello world');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
