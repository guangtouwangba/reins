import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadE2ECases, runL3E2E } from './l3-e2e.js';
import type { E2ECase } from './l3-e2e.js';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `reins-l3-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = makeTmpDir();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// loadE2ECases
// ---------------------------------------------------------------------------

describe('loadE2ECases', () => {
  it('returns empty array when verification-cases dir does not exist', () => {
    const cases = loadE2ECases(tmpDir);
    expect(cases).toEqual([]);
  });

  it('returns empty array when no e2e files exist', () => {
    mkdirSync(join(tmpDir, '.reins', 'verification-cases'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.reins', 'verification-cases', 'api-test.yaml'),
      'task: api test\ntype: api\n',
      'utf-8',
    );
    const cases = loadE2ECases(tmpDir);
    expect(cases).toEqual([]);
  });

  it('loads valid e2e yaml files', () => {
    mkdirSync(join(tmpDir, '.reins', 'verification-cases'), { recursive: true });
    const caseContent: E2ECase = {
      task: 'Upload and verify file',
      type: 'e2e',
      tool: 'playwright',
      steps: [
        { id: 'step-1', action: 'navigate', url: '/upload' },
        { id: 'step-2', action: 'upload', selector: '#file-input', file: 'test.pdf' },
        { id: 'step-3', action: 'assert', expect: { selector: '.success', visible: true } },
      ],
    };
    writeFileSync(
      join(tmpDir, '.reins', 'verification-cases', 'upload-e2e.yaml'),
      `task: "Upload and verify file"\ntype: e2e\ntool: playwright\nsteps:\n  - id: step-1\n    action: navigate\n    url: /upload\n  - id: step-2\n    action: upload\n    selector: "#file-input"\n    file: test.pdf\n  - id: step-3\n    action: assert\n    expect:\n      selector: .success\n      visible: true\n`,
      'utf-8',
    );
    const cases = loadE2ECases(tmpDir);
    expect(cases.length).toBe(1);
    expect(cases[0]!.type).toBe('e2e');
    expect(cases[0]!.tool).toBe('playwright');
    expect(cases[0]!.steps.length).toBe(3);
  });

  it('skips files without type: e2e', () => {
    mkdirSync(join(tmpDir, '.reins', 'verification-cases'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.reins', 'verification-cases', 'other-e2e.yaml'),
      'task: other\ntype: api\nsteps: []\n',
      'utf-8',
    );
    const cases = loadE2ECases(tmpDir);
    expect(cases).toEqual([]);
  });

  it('skips unparseable yaml files gracefully', () => {
    mkdirSync(join(tmpDir, '.reins', 'verification-cases'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.reins', 'verification-cases', 'broken-e2e.yaml'),
      '{ invalid yaml: [unclosed',
      'utf-8',
    );
    const cases = loadE2ECases(tmpDir);
    expect(cases).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// runL3E2E
// ---------------------------------------------------------------------------

describe('runL3E2E', () => {
  it('returns skipped result with zero cases', async () => {
    const result = await runL3E2E(tmpDir, []);
    expect(result.skipped).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.total).toBe(0);
  });

  it('returns skipped result when Playwright is not available', async () => {
    const cases: E2ECase[] = [
      {
        task: 'test task',
        type: 'e2e',
        tool: 'playwright',
        steps: [
          { id: 's1', action: 'navigate', url: '/' },
          { id: 's2', action: 'assert', expect: { selector: 'h1', visible: true } },
        ],
      },
    ];
    const result = await runL3E2E(tmpDir, cases);
    // Playwright is not installed in test environment → skipped
    expect(result.skipped).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.total).toBe(2); // 2 steps
  });

  it('result has correct shape', async () => {
    const result = await runL3E2E(tmpDir, []);
    expect(result).toHaveProperty('passed');
    expect(result).toHaveProperty('skipped');
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('passedCount');
    expect(result).toHaveProperty('failedCount');
    expect(result).toHaveProperty('results');
    expect(result).toHaveProperty('screenshots');
    expect(Array.isArray(result.results)).toBe(true);
    expect(Array.isArray(result.screenshots)).toBe(true);
  });
});
