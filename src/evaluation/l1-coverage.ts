import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { execSync } from 'node:child_process';

export interface CoverageCheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

export interface CoverageResult {
  passed: boolean;
  checks: CoverageCheckResult[];
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function getStagedNewFiles(projectRoot: string): string[] | null {
  try {
    const output = execSync('git diff --cached --name-only --diff-filter=A', {
      cwd: projectRoot,
      encoding: 'utf-8',
      timeout: 10_000,
    });
    return output
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0);
  } catch {
    return null;
  }
}

function getStagedModifiedFiles(projectRoot: string): string[] | null {
  try {
    const output = execSync('git diff --cached --name-only --diff-filter=AM', {
      cwd: projectRoot,
      encoding: 'utf-8',
      timeout: 10_000,
    });
    return output
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Check 1: new_file_has_test
// ---------------------------------------------------------------------------

function checkNewFileHasTest(projectRoot: string): CoverageCheckResult {
  const newFiles = getStagedNewFiles(projectRoot);

  if (newFiles === null) {
    return {
      name: 'new_file_has_test',
      passed: true,
      detail: 'git not available — skipped',
    };
  }

  const newTsFiles = newFiles.filter(
    f =>
      (f.endsWith('.ts') || f.endsWith('.tsx')) &&
      !f.includes('.test.') &&
      !f.includes('.spec.') &&
      !f.includes('__tests__'),
  );

  if (newTsFiles.length === 0) {
    return {
      name: 'new_file_has_test',
      passed: true,
      detail: 'no new TypeScript source files',
    };
  }

  const missing: string[] = [];
  for (const file of newTsFiles) {
    const dir = dirname(file);
    const base = basename(file, file.endsWith('.tsx') ? '.tsx' : '.ts');
    const testTs = join(projectRoot, dir, `${base}.test.ts`);
    const testTsx = join(projectRoot, dir, `${base}.test.tsx`);
    const specTs = join(projectRoot, dir, `${base}.spec.ts`);
    const specTsx = join(projectRoot, dir, `${base}.spec.tsx`);
    if (
      !existsSync(testTs) &&
      !existsSync(testTsx) &&
      !existsSync(specTs) &&
      !existsSync(specTsx)
    ) {
      missing.push(file);
    }
  }

  if (missing.length === 0) {
    return {
      name: 'new_file_has_test',
      passed: true,
      detail: `all ${newTsFiles.length} new file(s) have corresponding tests`,
    };
  }

  return {
    name: 'new_file_has_test',
    passed: false,
    detail: `missing tests for: ${missing.join(', ')}`,
  };
}

// ---------------------------------------------------------------------------
// Check 2: no_empty_tests
// ---------------------------------------------------------------------------

function findTestFiles(projectRoot: string): string[] {
  const results: string[] = [];

  function walk(dir: string): void {
    let entries: Array<{ name: string; isDir: boolean }>;
    try {
      entries = readdirSync(dir, { withFileTypes: true })
        .map(e => ({ name: e.name, isDir: e.isDirectory() }));
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDir) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        walk(join(dir, entry.name));
      } else if (
        entry.name.endsWith('.test.ts') ||
        entry.name.endsWith('.test.tsx') ||
        entry.name.endsWith('.spec.ts') ||
        entry.name.endsWith('.spec.tsx')
      ) {
        results.push(join(dir, entry.name));
      }
    }
  }

  walk(projectRoot);
  return results;
}

function checkNoEmptyTests(projectRoot: string): CoverageCheckResult {
  const testFiles = findTestFiles(projectRoot);

  if (testFiles.length === 0) {
    return {
      name: 'no_empty_tests',
      passed: true,
      detail: 'no test files found',
    };
  }

  const pattern = /\b(test\.skip|test\.todo|it\.skip)\b/;
  const violations: string[] = [];

  for (const file of testFiles) {
    try {
      const content = readFileSync(file, 'utf-8');
      if (pattern.test(content)) {
        violations.push(file.replace(projectRoot + '/', ''));
      }
    } catch {
      // skip unreadable files
    }
  }

  if (violations.length === 0) {
    return {
      name: 'no_empty_tests',
      passed: true,
      detail: `${testFiles.length} test file(s) checked, no skipped/todo tests`,
    };
  }

  return {
    name: 'no_empty_tests',
    passed: false,
    detail: `skipped/todo tests found in: ${violations.join(', ')}`,
  };
}

// ---------------------------------------------------------------------------
// Check 3: no_any_types
// ---------------------------------------------------------------------------

function checkNoAnyTypes(projectRoot: string): CoverageCheckResult {
  const modifiedFiles = getStagedModifiedFiles(projectRoot);

  if (modifiedFiles === null) {
    return {
      name: 'no_any_types',
      passed: true,
      detail: 'git not available — skipped',
    };
  }

  const tsFiles = modifiedFiles.filter(
    f =>
      (f.endsWith('.ts') || f.endsWith('.tsx')) &&
      !f.includes('.test.') &&
      !f.includes('.spec.') &&
      !f.includes('__tests__'),
  );

  if (tsFiles.length === 0) {
    return {
      name: 'no_any_types',
      passed: true,
      detail: 'no modified TypeScript source files',
    };
  }

  const anyPattern = /:\s*any\b/;
  const violations: string[] = [];

  for (const file of tsFiles) {
    const fullPath = join(projectRoot, file);
    if (!existsSync(fullPath)) continue;
    try {
      const content = readFileSync(fullPath, 'utf-8');
      if (anyPattern.test(content)) {
        violations.push(file);
      }
    } catch {
      // skip unreadable files
    }
  }

  if (violations.length === 0) {
    return {
      name: 'no_any_types',
      passed: true,
      detail: `${tsFiles.length} modified file(s) checked, no ': any' found`,
    };
  }

  return {
    name: 'no_any_types',
    passed: false,
    detail: `': any' type found in: ${violations.join(', ')}`,
  };
}

// ---------------------------------------------------------------------------
// L1 entry point
// ---------------------------------------------------------------------------

export async function runL1Coverage(projectRoot: string): Promise<CoverageResult> {
  const checks = [
    checkNewFileHasTest(projectRoot),
    checkNoEmptyTests(projectRoot),
    checkNoAnyTypes(projectRoot),
  ];

  const passed = checks.every(c => c.passed);
  return { passed, checks };
}
