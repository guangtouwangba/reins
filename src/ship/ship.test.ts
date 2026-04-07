import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import yaml from 'js-yaml';

import { runPreCommit, runFeatureVerify } from './verify.js';
import { checkScopeDrift } from './drift-check.js';

let tmp: string;

beforeEach(() => {
  tmp = join(tmpdir(), `reins-ship-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmp, { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeConstraints(projectRoot: string, pipeline: Record<string, unknown>): void {
  const reinsDir = join(projectRoot, '.reins');
  mkdirSync(reinsDir, { recursive: true });
  const config = {
    version: 1,
    generated_at: new Date().toISOString(),
    project: { name: 'test', type: 'library' },
    stack: { primary_language: 'typescript', framework: 'none', test_framework: 'vitest', package_manager: 'pnpm' },
    constraints: [],
    pipeline,
  };
  writeFileSync(join(reinsDir, 'constraints.yaml'), yaml.dump(config), 'utf-8');
}

// ---------------------------------------------------------------------------
// runPreCommit
// ---------------------------------------------------------------------------

describe('runPreCommit', () => {
  it('returns passed+skipped when no pre_commit commands configured', () => {
    writeConstraints(tmp, { pre_commit: [] });
    const result = runPreCommit(tmp);
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it('returns passed+skipped when constraints.yaml does not exist', () => {
    const result = runPreCommit(tmp);
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it('passes when all commands exit 0', () => {
    writeConstraints(tmp, { pre_commit: ['true', 'echo ok'] });
    const result = runPreCommit(tmp);
    expect(result.passed).toBe(true);
    expect(result.skipped).toBeFalsy();
  });

  it('short-circuits on first failing command and reports it', () => {
    writeConstraints(tmp, { pre_commit: ['true', 'false', 'echo should-not-run > should-not-run.txt'] });
    const result = runPreCommit(tmp);
    expect(result.passed).toBe(false);
    expect(result.failure?.command).toBe('false');
    expect(result.failure?.exit_code).not.toBe(0);
  });

  it('captures stdout+stderr of the failing command', () => {
    writeConstraints(tmp, {
      pre_commit: ['sh -c "echo onstdout; echo onstderr >&2; exit 7"'],
    });
    const result = runPreCommit(tmp);
    expect(result.passed).toBe(false);
    expect(result.failure?.exit_code).toBe(7);
    expect(result.failure?.output).toMatch(/onstdout|onstderr/);
  });

  it('tolerates a corrupted constraints.yaml without throwing', () => {
    const reinsDir = join(tmp, '.reins');
    mkdirSync(reinsDir, { recursive: true });
    writeFileSync(join(reinsDir, 'constraints.yaml'), '{{{ not yaml', 'utf-8');
    const result = runPreCommit(tmp);
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runFeatureVerify
// ---------------------------------------------------------------------------

describe('runFeatureVerify', () => {
  it('reads pipeline.feature_verify specifically (not pre_commit)', () => {
    writeConstraints(tmp, { pre_commit: ['false'], feature_verify: ['true'] });
    const result = runFeatureVerify(tmp);
    expect(result.passed).toBe(true);
  });

  it('returns passed+skipped when feature_verify is empty', () => {
    writeConstraints(tmp, { pre_commit: ['echo'], feature_verify: [] });
    const result = runFeatureVerify(tmp);
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it('returns passed+skipped when feature_verify is undefined', () => {
    writeConstraints(tmp, { pre_commit: ['echo'] });
    const result = runFeatureVerify(tmp);
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it('short-circuits on failure', () => {
    writeConstraints(tmp, { feature_verify: ['true', 'exit 3'] });
    const result = runFeatureVerify(tmp);
    expect(result.passed).toBe(false);
    expect(result.failure?.exit_code).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// checkScopeDrift
// ---------------------------------------------------------------------------

describe('checkScopeDrift', () => {
  function initGitRepo(root: string): void {
    execSync('git init -q', { cwd: root });
    execSync('git config user.email test@example.com', { cwd: root });
    execSync('git config user.name test', { cwd: root });
  }

  it('returns empty arrays when scopeGlobs is undefined', () => {
    initGitRepo(tmp);
    writeFileSync(join(tmp, 'a.ts'), '// a\n');
    const result = checkScopeDrift(tmp, undefined);
    expect(result.touchedFiles).toEqual([]);
    expect(result.outOfScope).toEqual([]);
  });

  it('returns empty arrays when scopeGlobs is []', () => {
    initGitRepo(tmp);
    writeFileSync(join(tmp, 'a.ts'), '// a\n');
    const result = checkScopeDrift(tmp, []);
    expect(result.touchedFiles).toEqual([]);
    expect(result.outOfScope).toEqual([]);
  });

  it('classifies in-scope vs out-of-scope touched files', () => {
    initGitRepo(tmp);
    mkdirSync(join(tmp, 'src'), { recursive: true });
    mkdirSync(join(tmp, 'docs'), { recursive: true });
    writeFileSync(join(tmp, 'src', 'a.ts'), '// a\n');
    writeFileSync(join(tmp, 'docs', 'readme.md'), '# doc\n');

    const result = checkScopeDrift(tmp, ['src/**']);
    expect(result.touchedFiles.sort()).toEqual(['docs/readme.md', 'src/a.ts']);
    expect(result.outOfScope).toEqual(['docs/readme.md']);
  });

  it('treats out-of-scope as empty when all files match scope', () => {
    initGitRepo(tmp);
    mkdirSync(join(tmp, 'src'), { recursive: true });
    writeFileSync(join(tmp, 'src', 'a.ts'), '// a\n');
    writeFileSync(join(tmp, 'src', 'b.ts'), '// b\n');

    const result = checkScopeDrift(tmp, ['src/**']);
    expect(result.outOfScope).toEqual([]);
    expect(result.touchedFiles.length).toBe(2);
  });

  it('supports multiple scope globs (any-match)', () => {
    initGitRepo(tmp);
    mkdirSync(join(tmp, 'app'), { recursive: true });
    mkdirSync(join(tmp, 'lib'), { recursive: true });
    mkdirSync(join(tmp, 'other'), { recursive: true });
    writeFileSync(join(tmp, 'app', 'a.ts'), '// a\n');
    writeFileSync(join(tmp, 'lib', 'b.ts'), '// b\n');
    writeFileSync(join(tmp, 'other', 'c.ts'), '// c\n');

    const result = checkScopeDrift(tmp, ['app/**', 'lib/**']);
    expect(result.outOfScope).toEqual(['other/c.ts']);
  });

  it('returns empty arrays when git is not a repository (no throw)', () => {
    // tmp has no git init — git status will fail
    const result = checkScopeDrift(tmp, ['src/**']);
    expect(result.touchedFiles).toEqual([]);
    expect(result.outOfScope).toEqual([]);
  });
});
