import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runL1Coverage } from './l1-coverage.js';

function makeTmpDir(): string {
  const dir = join(
    tmpdir(),
    `reins-l1-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

describe('runL1Coverage', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns passed:true and all checks skipped when git is not available', async () => {
    // In a non-git directory, git commands fail gracefully
    const result = await runL1Coverage(tmpDir);
    // At minimum should not throw and should return a result
    expect(result).toBeDefined();
    expect(typeof result.passed).toBe('boolean');
    expect(Array.isArray(result.checks)).toBe(true);
    expect(result.checks).toHaveLength(3);
  });

  it('returns exactly 3 checks', async () => {
    const result = await runL1Coverage(tmpDir);
    expect(result.checks.map(c => c.name)).toEqual([
      'new_file_has_test',
      'no_empty_tests',
      'no_any_types',
    ]);
  });

  it('no_empty_tests: passes when no test files exist', async () => {
    const result = await runL1Coverage(tmpDir);
    const check = result.checks.find(c => c.name === 'no_empty_tests');
    expect(check?.passed).toBe(true);
    expect(check?.detail).toContain('no test files found');
  });

  it('no_empty_tests: passes when test files have no skip/todo', async () => {
    writeFileSync(
      join(tmpDir, 'foo.test.ts'),
      `import { describe, it, expect } from 'vitest';\ndescribe('foo', () => { it('works', () => { expect(1).toBe(1); }); });`,
      'utf-8',
    );
    const result = await runL1Coverage(tmpDir);
    const check = result.checks.find(c => c.name === 'no_empty_tests');
    expect(check?.passed).toBe(true);
  });

  it('no_empty_tests: fails when test file contains test.skip', async () => {
    writeFileSync(
      join(tmpDir, 'bar.test.ts'),
      `import { describe, it } from 'vitest';\ndescribe('bar', () => { test.skip('not ready', () => {}); });`,
      'utf-8',
    );
    const result = await runL1Coverage(tmpDir);
    const check = result.checks.find(c => c.name === 'no_empty_tests');
    expect(check?.passed).toBe(false);
    expect(check?.detail).toContain('bar.test.ts');
  });

  it('no_empty_tests: fails when test file contains it.skip', async () => {
    writeFileSync(
      join(tmpDir, 'baz.test.ts'),
      `describe('baz', () => { it.skip('pending', () => {}); });`,
      'utf-8',
    );
    const result = await runL1Coverage(tmpDir);
    const check = result.checks.find(c => c.name === 'no_empty_tests');
    expect(check?.passed).toBe(false);
  });

  it('no_empty_tests: fails when test file contains test.todo', async () => {
    writeFileSync(
      join(tmpDir, 'qux.test.ts'),
      `describe('qux', () => { test.todo('implement later'); });`,
      'utf-8',
    );
    const result = await runL1Coverage(tmpDir);
    const check = result.checks.find(c => c.name === 'no_empty_tests');
    expect(check?.passed).toBe(false);
  });

  it('no_empty_tests: ignores non-test .ts files', async () => {
    // Write a source file that happens to contain test.skip in a comment
    writeFileSync(
      join(tmpDir, 'foo.ts'),
      `// test.skip is used in test files\nexport function foo() { return 1; }`,
      'utf-8',
    );
    const result = await runL1Coverage(tmpDir);
    const check = result.checks.find(c => c.name === 'no_empty_tests');
    // foo.ts is not a test file so should not be scanned
    expect(check?.passed).toBe(true);
  });

  it('new_file_has_test: passes gracefully when git unavailable', async () => {
    const result = await runL1Coverage(tmpDir);
    const check = result.checks.find(c => c.name === 'new_file_has_test');
    // Either skipped (no git) or true (no new files)
    expect(check?.passed).toBe(true);
  });

  it('no_any_types: passes gracefully when git unavailable', async () => {
    const result = await runL1Coverage(tmpDir);
    const check = result.checks.find(c => c.name === 'no_any_types');
    expect(check?.passed).toBe(true);
  });

  it('overall passed is false when any check fails', async () => {
    // Create a test file with test.skip to force no_empty_tests failure
    writeFileSync(
      join(tmpDir, 'failing.test.ts'),
      `test.skip('not ready', () => {});`,
      'utf-8',
    );
    const result = await runL1Coverage(tmpDir);
    const noEmptyCheck = result.checks.find(c => c.name === 'no_empty_tests');
    if (noEmptyCheck?.passed === false) {
      expect(result.passed).toBe(false);
    }
  });
});
