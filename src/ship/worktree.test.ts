import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import { createWorktree, rebaseAndMerge, removeWorktree } from './worktree.js';

let tmp: string;

beforeEach(() => {
  tmp = join(tmpdir(), `reins-wt-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmp, { recursive: true });

  // Initialize a real git repo with one commit (so HEAD points somewhere).
  const git = (cmd: string) => execSync(cmd, { cwd: tmp, stdio: ['ignore', 'pipe', 'pipe'] });
  git('git init -q -b main');
  git('git config user.email "test@example.com"');
  git('git config user.name "test"');
  git('git config commit.gpgsign false');
  writeFileSync(join(tmp, 'README.md'), '# root\n', 'utf-8');
  git('git add README.md');
  git('git commit -q -m "initial"');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function commitIn(dir: string, filename: string, content: string, msg: string): void {
  writeFileSync(join(dir, filename), content, 'utf-8');
  execSync(`git add ${JSON.stringify(filename)}`, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  execSync(`git commit -q -m ${JSON.stringify(msg)}`, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
}

function currentSha(dir: string): string {
  return execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf-8' }).trim();
}

// ---------------------------------------------------------------------------
// createWorktree
// ---------------------------------------------------------------------------

describe('createWorktree', () => {
  it('creates a worktree and returns a handle with abs path, branch, baseCommit', () => {
    const handle = createWorktree(tmp, '001-test');
    expect(existsSync(handle.path)).toBe(true);
    expect(handle.path).toContain(join('.reins', 'wt', '001-test'));
    expect(handle.branchName).toBe('reins/feature-001-test');
    expect(handle.baseCommit).toBe(currentSha(tmp));
  });

  it('replaces a stale worktree directory from a previous run', () => {
    const handle1 = createWorktree(tmp, '001-test');
    expect(existsSync(handle1.path)).toBe(true);
    // Simulate a stale worktree: re-create with the same id without explicit remove
    const handle2 = createWorktree(tmp, '001-test');
    expect(existsSync(handle2.path)).toBe(true);
    expect(handle2.path).toBe(handle1.path);
  });
});

// ---------------------------------------------------------------------------
// rebaseAndMerge
// ---------------------------------------------------------------------------

describe('rebaseAndMerge', () => {
  it('cherry-picks a clean commit back onto main', () => {
    const handle = createWorktree(tmp, '001-clean');
    commitIn(handle.path, 'feature.ts', 'export const x = 1;\n', 'feat: add feature');

    const beforeSha = currentSha(tmp);
    const result = rebaseAndMerge(tmp, handle);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.sha).not.toBe(beforeSha);
      // The feature file should now exist in the main checkout
      expect(existsSync(join(tmp, 'feature.ts'))).toBe(true);
      expect(readFileSync(join(tmp, 'feature.ts'), 'utf-8')).toContain('export const x = 1');
    }
  });

  it('returns success with baseCommit when the worktree made no commits', () => {
    const handle = createWorktree(tmp, '001-empty');
    const result = rebaseAndMerge(tmp, handle);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.sha).toBe(handle.baseCommit);
    }
  });

  it('returns a structured conflict when two worktrees touch the same line', () => {
    // Set up a shared file in main first
    writeFileSync(join(tmp, 'shared.ts'), 'export const value = 0;\n', 'utf-8');
    execSync('git add shared.ts && git commit -q -m "add shared"', {
      cwd: tmp,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const wtA = createWorktree(tmp, 'wt-a');
    const wtB = createWorktree(tmp, 'wt-b');

    // Both worktrees change the same line differently
    writeFileSync(join(wtA.path, 'shared.ts'), 'export const value = 1;\n', 'utf-8');
    execSync('git add shared.ts && git commit -q -m "wt-a change"', {
      cwd: wtA.path,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    writeFileSync(join(wtB.path, 'shared.ts'), 'export const value = 2;\n', 'utf-8');
    execSync('git add shared.ts && git commit -q -m "wt-b change"', {
      cwd: wtB.path,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const resultA = rebaseAndMerge(tmp, wtA);
    expect(resultA.success).toBe(true);

    const resultB = rebaseAndMerge(tmp, wtB);
    expect(resultB.success).toBe(false);
    if (!resultB.success) {
      expect(resultB.conflict).toMatch(/cherry-pick/i);
    }

    // Main checkout should not be left mid-cherry-pick
    const status = execSync('git status --porcelain', { cwd: tmp, encoding: 'utf-8' });
    expect(status).not.toMatch(/UU /); // no unmerged entries
  });
});

// ---------------------------------------------------------------------------
// removeWorktree
// ---------------------------------------------------------------------------

describe('removeWorktree', () => {
  it('cleans up the worktree directory after a successful merge', () => {
    const handle = createWorktree(tmp, '001-clean');
    commitIn(handle.path, 'a.ts', '1\n', 'feat');
    rebaseAndMerge(tmp, handle);

    removeWorktree(tmp, handle, false);
    expect(existsSync(handle.path)).toBe(false);
  });

  it('uses force to remove a dirty worktree', () => {
    const handle = createWorktree(tmp, '001-dirty');
    writeFileSync(join(handle.path, 'uncommitted.ts'), '1\n', 'utf-8');

    // Without force: git refuses → helper swallows and continues
    removeWorktree(tmp, handle, false);
    expect(existsSync(handle.path)).toBe(true);

    // With force: removes
    removeWorktree(tmp, handle, true);
    expect(existsSync(handle.path)).toBe(false);
  });

  it('does not throw when asked to remove a nonexistent worktree', () => {
    const fakeHandle = {
      featureId: 'ghost',
      path: join(tmp, '.reins', 'wt', 'ghost'),
      branchName: 'reins/feature-ghost',
      baseCommit: 'deadbeef',
    };
    expect(() => removeWorktree(tmp, fakeHandle, true)).not.toThrow();
  });
});
