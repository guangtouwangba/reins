import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectCommands, runL0Static } from './l0-static.js';
import { shouldExit, buildExitCondition } from './exit-condition.js';
import { evaluate } from './evaluator.js';
import { getDefaultConfig } from '../state/config.js';
import type { ExitCondition, EvalResult, L0Result } from './types.js';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `reins-eval-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writePackageJson(dir: string, scripts: Record<string, string>): void {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts }), 'utf-8');
}

// ---------------------------------------------------------------------------
// detectCommands
// ---------------------------------------------------------------------------

describe('detectCommands', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('detects lint and test but not typecheck when absent', () => {
    writePackageJson(tmpDir, { lint: 'eslint .', test: 'vitest run' });
    const detected = detectCommands(tmpDir);
    expect(detected.lint.command).toContain('lint');
    expect(detected.test.command).toContain('test');
    expect(detected.typecheck.command).toBeNull();
  });

  it('detects pnpm when pnpm-lock.yaml is present', () => {
    writeFileSync(join(tmpDir, 'pnpm-lock.yaml'), '', 'utf-8');
    writePackageJson(tmpDir, { lint: 'eslint .' });
    const detected = detectCommands(tmpDir);
    expect(detected.packageManager).toBe('pnpm');
    expect(detected.lint.command).toBe('pnpm run lint');
  });

  it('detects yarn when yarn.lock is present', () => {
    writeFileSync(join(tmpDir, 'yarn.lock'), '', 'utf-8');
    writePackageJson(tmpDir, { test: 'jest' });
    const detected = detectCommands(tmpDir);
    expect(detected.packageManager).toBe('yarn');
  });

  it('defaults to npm when no lockfile present', () => {
    writePackageJson(tmpDir, {});
    const detected = detectCommands(tmpDir);
    expect(detected.packageManager).toBe('npm');
  });

  it('treats echo-prefixed scripts as missing', () => {
    writePackageJson(tmpDir, { lint: 'echo no linter configured', test: 'vitest run' });
    const detected = detectCommands(tmpDir);
    expect(detected.lint.command).toBeNull();
    expect(detected.test.command).not.toBeNull();
  });

  it('returns null commands when no package.json exists', () => {
    const detected = detectCommands(tmpDir);
    expect(detected.lint.command).toBeNull();
    expect(detected.typecheck.command).toBeNull();
    expect(detected.test.command).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// runL0Static
// ---------------------------------------------------------------------------

describe('runL0Static', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('returns passed:true and all skipped when no scripts detected', async () => {
    const result = await runL0Static(tmpDir);
    expect(result.passed).toBe(true);
    expect(result.commands.every(c => c.skipped)).toBe(true);
  });

  it('runs a passing command and returns passed:true', async () => {
    // Use a non-echo script so it is not filtered out by detectCommands
    writePackageJson(tmpDir, { lint: 'true' });
    const result = await runL0Static(tmpDir);
    expect(result.passed).toBe(true);
    const lintResult = result.commands.find(c => c.name === 'lint');
    expect(lintResult?.skipped).toBe(false);
    expect(lintResult?.exitCode).toBe(0);
  });

  it('stops after first failure in failFast mode', async () => {
    writePackageJson(tmpDir, { lint: 'exit 1', test: 'echo should-not-run' });
    const result = await runL0Static(tmpDir, { failFast: true });
    expect(result.passed).toBe(false);
    // typecheck and test should not have run (lint failed first)
    const testResult = result.commands.find(c => c.name === 'test');
    expect(testResult).toBeUndefined();
  });

  it('null command produces a skipped result entry', async () => {
    writePackageJson(tmpDir, { lint: 'echo ok' });
    const result = await runL0Static(tmpDir);
    const typecheckResult = result.commands.find(c => c.name === 'typecheck');
    expect(typecheckResult?.skipped).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// shouldExit
// ---------------------------------------------------------------------------

describe('shouldExit', () => {
  const base: ExitCondition = {
    L0_passed: true,
    L1_passed: true,
    L2_passed: true,
    L3_passed: true,
    L4_confidence: 100,
    iterationCount: 0,
    maxIterations: 50,
  };

  it('exits when max iterations reached regardless of profile', () => {
    const cond = { ...base, iterationCount: 50, maxIterations: 50 };
    expect(shouldExit(cond, 'relaxed').exit).toBe(true);
    expect(shouldExit(cond, 'strict').exit).toBe(true);
    expect(shouldExit(cond, 'default').exit).toBe(true);
  });

  it('relaxed: exits when L0 passed', () => {
    expect(shouldExit({ ...base, L0_passed: true }, 'relaxed').exit).toBe(true);
  });

  it('relaxed: does not exit when L0 failed', () => {
    expect(shouldExit({ ...base, L0_passed: false }, 'relaxed').exit).toBe(false);
  });

  it('relaxed: exits when L0 passed even if L1 is false', () => {
    expect(shouldExit({ ...base, L0_passed: true, L1_passed: false }, 'relaxed').exit).toBe(true);
  });

  it('default: exits when L0 and L1 both pass', () => {
    expect(shouldExit({ ...base, L0_passed: true, L1_passed: true }, 'default').exit).toBe(true);
  });

  it('default: does not exit when L0 fails', () => {
    expect(shouldExit({ ...base, L0_passed: false }, 'default').exit).toBe(false);
  });

  it('strict: exits when L0+L1+L2+L4>=80 all pass', () => {
    expect(shouldExit({ ...base, L4_confidence: 80 }, 'strict').exit).toBe(true);
  });

  it('strict: does not exit when L4_confidence < 80', () => {
    expect(shouldExit({ ...base, L4_confidence: 79 }, 'strict').exit).toBe(false);
  });

  it('fullstack: requires L3 as well', () => {
    expect(shouldExit({ ...base, L3_passed: false }, 'fullstack').exit).toBe(false);
    expect(shouldExit({ ...base, L3_passed: true }, 'fullstack').exit).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildExitCondition
// ---------------------------------------------------------------------------

describe('buildExitCondition', () => {
  it('maps L0Result.passed to L0_passed', () => {
    const l0: L0Result = { passed: false, commands: [], detectedPackageManager: 'npm' };
    const evalResult: EvalResult = { l0, l1: null, l2: null, l3: null, l4: null };
    const cond = buildExitCondition(evalResult, 0, getDefaultConfig());
    expect(cond.L0_passed).toBe(false);
  });

  it('stubs L1-L4 as passing values', () => {
    const l0: L0Result = { passed: true, commands: [], detectedPackageManager: 'npm' };
    const evalResult: EvalResult = { l0, l1: null, l2: null, l3: null, l4: null };
    const cond = buildExitCondition(evalResult, 0, getDefaultConfig());
    expect(cond.L1_passed).toBe(true);
    expect(cond.L2_passed).toBe(true);
    expect(cond.L3_passed).toBe(true);
    expect(cond.L4_confidence).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// evaluate (integration)
// ---------------------------------------------------------------------------

describe('evaluate', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('returns EvalResult with l0 and l1 populated, l2/l3/l4 null for default profile', async () => {
    const result = await evaluate(tmpDir, 'default');
    expect(result.l0).toBeDefined();
    expect(result.l1).not.toBeNull();
    expect(result.l1?.checks).toHaveLength(3);
    expect(result.l2).toBeNull();
    expect(result.l3).toBeNull();
    expect(result.l4).toBeNull();
  });

  it('returns l0.passed true when only echo scripts present', async () => {
    writePackageJson(tmpDir, { test: 'echo ok' });
    // echo script is treated as missing → all skipped → passed
    const result = await evaluate(tmpDir, 'default');
    expect(result.l0.passed).toBe(true);
  });
});
