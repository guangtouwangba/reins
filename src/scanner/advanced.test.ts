import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyzeAST } from './ast-analyzer.js';
import { analyzeGitHistory } from './git-analyzer.js';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `reins-advanced-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
// AST Analyzer
// ---------------------------------------------------------------------------

describe('analyzeAST', () => {
  it('returns partial CodebaseContext with conventions', () => {
    const result = analyzeAST(tmpDir, []);
    expect(result).toHaveProperty('conventions');
    expect(result.conventions).toHaveProperty('importStyle');
  });

  it('handles empty sample files gracefully', () => {
    const result = analyzeAST(tmpDir, []);
    expect(result.conventions!.importStyle).toBe('mixed');
  });

  it('handles non-existent sample files gracefully', () => {
    const result = analyzeAST(tmpDir, ['nonexistent/file.ts', 'also/missing.ts']);
    expect(result.conventions!.importStyle).toBeDefined();
  });

  it('detects relative imports from TypeScript file', () => {
    const srcDir = join(tmpDir, 'src');
    mkdirSync(srcDir, { recursive: true });
    const filePath = join(srcDir, 'index.ts');
    writeFileSync(
      filePath,
      `import { foo } from './utils';\nimport { bar } from '../lib/helper';\nimport { baz } from '../../core';\n`,
      'utf-8',
    );
    const result = analyzeAST(tmpDir, [filePath]);
    expect(result.conventions!.importStyle).toBe('relative');
  });

  it('detects alias imports', () => {
    const filePath = join(tmpDir, 'index.ts');
    writeFileSync(
      filePath,
      `import { a } from '@/utils';\nimport { b } from '@/lib';\nimport { c } from '@/helpers';\nimport { d } from '@/services';\n`,
      'utf-8',
    );
    const result = analyzeAST(tmpDir, [filePath]);
    expect(result.conventions!.importStyle).toBe('alias');
  });

  it('detects absolute/external imports', () => {
    const filePath = join(tmpDir, 'index.ts');
    writeFileSync(
      filePath,
      `import React from 'react';\nimport { useState } from 'react';\nimport express from 'express';\nimport lodash from 'lodash';\n`,
      'utf-8',
    );
    const result = analyzeAST(tmpDir, [filePath]);
    expect(result.conventions!.importStyle).toBe('absolute');
  });
});

// ---------------------------------------------------------------------------
// Git Analyzer
// ---------------------------------------------------------------------------

describe('analyzeGitHistory', () => {
  it('returns empty analysis for non-git directory', () => {
    const result = analyzeGitHistory(tmpDir);
    expect(result.hotDirectories).toEqual([]);
    expect(result.highChurnFiles).toEqual([]);
    expect(result.activeContributors).toBe(0);
    expect(result.totalCommits).toBe(0);
  });

  it('returns correctly shaped object', () => {
    const result = analyzeGitHistory(tmpDir);
    expect(result).toHaveProperty('hotDirectories');
    expect(result).toHaveProperty('highChurnFiles');
    expect(result).toHaveProperty('activeContributors');
    expect(result).toHaveProperty('totalCommits');
    expect(Array.isArray(result.hotDirectories)).toBe(true);
    expect(Array.isArray(result.highChurnFiles)).toBe(true);
    expect(typeof result.activeContributors).toBe('number');
    expect(typeof result.totalCommits).toBe('number');
  });

  it('handles git errors gracefully without throwing', () => {
    // Calling on non-git dir should not throw
    expect(() => analyzeGitHistory('/tmp/definitely-not-a-git-repo-xyz')).not.toThrow();
  });
});
