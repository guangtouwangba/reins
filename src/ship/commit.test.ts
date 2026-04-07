import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, chmodSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import { detectCommitStyle, buildCommitMessage, commitFeature } from './commit.js';
import type { Feature } from '../features/types.js';

let tmp: string;

function initRepo(dir: string): void {
  const git = (cmd: string) => execSync(cmd, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  mkdirSync(dir, { recursive: true });
  git('git init -q -b main');
  git('git config user.email "test@example.com"');
  git('git config user.name "test"');
  git('git config commit.gpgsign false');
}

function makeCommit(dir: string, filename: string, content: string, msg: string): void {
  writeFileSync(join(dir, filename), content, 'utf-8');
  execSync(`git add ${JSON.stringify(filename)}`, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  execSync(`git commit -q -m ${JSON.stringify(msg)}`, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
}

function fixture(overrides: Partial<Feature> = {}): Feature {
  return {
    id: '001-test',
    title: 'Email login',
    status: 'in-progress',
    priority: 100,
    depends_on: [],
    created_at: '2026-04-07T10:00:00.000Z',
    updated_at: '2026-04-07T10:00:00.000Z',
    last_run_id: null,
    last_failure: null,
    body: '',
    ...overrides,
  };
}

beforeEach(() => {
  tmp = join(tmpdir(), `reins-commit-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  initRepo(tmp);
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// detectCommitStyle
// ---------------------------------------------------------------------------

describe('detectCommitStyle', () => {
  it('returns override verbatim when not "auto"', () => {
    expect(detectCommitStyle(tmp, 'conventional')).toBe('conventional');
    expect(detectCommitStyle(tmp, 'free')).toBe('free');
  });

  it('returns "free" for an empty repo', () => {
    expect(detectCommitStyle(tmp, 'auto')).toBe('free');
  });

  it('returns "conventional" when >=80% of log matches the pattern', () => {
    // 5 conventional, 0 non-conventional → 100%
    makeCommit(tmp, 'a.ts', '1\n', 'feat: first');
    makeCommit(tmp, 'b.ts', '1\n', 'fix: second');
    makeCommit(tmp, 'c.ts', '1\n', 'chore: third');
    makeCommit(tmp, 'd.ts', '1\n', 'docs: fourth');
    makeCommit(tmp, 'e.ts', '1\n', 'refactor: fifth');
    expect(detectCommitStyle(tmp, 'auto')).toBe('conventional');
  });

  it('returns "free" when <80% matches', () => {
    // 2 conventional, 3 free → 40%
    makeCommit(tmp, 'a.ts', '1\n', 'feat: first');
    makeCommit(tmp, 'b.ts', '1\n', 'fix: second');
    makeCommit(tmp, 'c.ts', '1\n', 'plain old message');
    makeCommit(tmp, 'd.ts', '1\n', 'another plain');
    makeCommit(tmp, 'e.ts', '1\n', 'yet another');
    expect(detectCommitStyle(tmp, 'auto')).toBe('free');
  });

  it('accepts scoped conventional commits like feat(api):', () => {
    makeCommit(tmp, 'a.ts', '1\n', 'feat(api): new endpoint');
    makeCommit(tmp, 'b.ts', '1\n', 'fix(ui): button');
    makeCommit(tmp, 'c.ts', '1\n', 'chore(deps): bump');
    makeCommit(tmp, 'd.ts', '1\n', 'feat(auth): login');
    makeCommit(tmp, 'e.ts', '1\n', 'test(unit): coverage');
    expect(detectCommitStyle(tmp, 'auto')).toBe('conventional');
  });
});

// ---------------------------------------------------------------------------
// buildCommitMessage
// ---------------------------------------------------------------------------

describe('buildCommitMessage', () => {
  it('builds a conventional subject with reins footer', () => {
    const msg = buildCommitMessage(fixture(), 'run-42', 1, 'conventional');
    expect(msg).toMatch(/^feat: Email login\n\nReins-feature-id: 001-test\nReins-run-id: run-42\nReins-attempts: 1$/);
  });

  it('builds a free subject (no prefix)', () => {
    const msg = buildCommitMessage(fixture(), 'run-42', 2, 'free');
    expect(msg.startsWith('Email login\n\n')).toBe(true);
    expect(msg).toContain('Reins-feature-id: 001-test');
    expect(msg).toContain('Reins-attempts: 2');
  });

  it('applies a custom template with all placeholders', () => {
    const template = '[{id}] {title} (attempt {attempts} of run {run_id})';
    const msg = buildCommitMessage(fixture(), 'RUN-1', 3, 'custom', template);
    expect(msg).toBe('[001-test] Email login (attempt 3 of run RUN-1)');
  });

  it('falls back to free style when custom has no template', () => {
    const msg = buildCommitMessage(fixture(), 'run-1', 1, 'custom');
    expect(msg.startsWith('Email login\n\n')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// commitFeature
// ---------------------------------------------------------------------------

describe('commitFeature', () => {
  it('returns success with sha on a clean commit', () => {
    writeFileSync(join(tmp, 'new.ts'), 'export const x = 1;\n', 'utf-8');
    const result = commitFeature(tmp, fixture(), 'run-1', 1, 'conventional');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.sha).toMatch(/^[a-f0-9]{40}$/);
      // The commit message should be visible in git log
      const log = execSync('git log -1 --format=%B', { cwd: tmp, encoding: 'utf-8' });
      expect(log).toContain('feat: Email login');
      expect(log).toContain('Reins-feature-id: 001-test');
    }
  });

  it('returns failure with hookOutput when pre-commit hook rejects', () => {
    // Install a failing pre-commit hook
    const hookPath = join(tmp, '.git', 'hooks', 'pre-commit');
    writeFileSync(
      hookPath,
      '#!/bin/sh\necho "HOOK_REJECTS" >&2\nexit 1\n',
      'utf-8',
    );
    chmodSync(hookPath, 0o755);

    writeFileSync(join(tmp, 'new.ts'), 'export const x = 1;\n', 'utf-8');
    const result = commitFeature(tmp, fixture(), 'run-1', 1, 'conventional');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.hookOutput).toContain('HOOK_REJECTS');
    }
  });

  it('returns failure with clear message when nothing is staged', () => {
    const result = commitFeature(tmp, fixture(), 'run-1', 1, 'conventional');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.hookOutput).toMatch(/nothing to commit/i);
    }
  });

  it('includes custom template in the final commit subject', () => {
    writeFileSync(join(tmp, 'new.ts'), '1\n', 'utf-8');
    const template = 'ship({id}): {title}';
    commitFeature(tmp, fixture(), 'RUN', 1, 'custom', template);
    const log = execSync('git log -1 --format=%s', { cwd: tmp, encoding: 'utf-8' }).trim();
    expect(log).toBe('ship(001-test): Email login');
  });
});

// ---------------------------------------------------------------------------
// Invariant: never --no-verify
// ---------------------------------------------------------------------------

describe('commit.ts source invariant', () => {
  it('never invokes git with --no-verify', () => {
    const source = readFileSync(
      join(process.cwd(), 'src', 'ship', 'commit.ts'),
      'utf-8',
    );

    // Strip all comments (line + block) so prose mentions of "--no-verify"
    // in docstrings don't trip the invariant. Only actual code should be
    // inspected for the flag.
    const codeOnly = source
      .replace(/\/\*[\s\S]*?\*\//g, '')  // block comments
      .replace(/\/\/[^\n]*/g, '');        // line comments

    expect(codeOnly).not.toContain('--no-verify');
  });
});
