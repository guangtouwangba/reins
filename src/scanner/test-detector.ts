import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { TestingInfo } from './types.js';

const TEST_FRAMEWORK_SIGNALS: Record<string, string> = {
  'jest.config.js': 'jest',
  'jest.config.ts': 'jest',
  'jest.config.mjs': 'jest',
  'vitest.config.ts': 'vitest',
  'vitest.config.js': 'vitest',
  'vitest.config.mts': 'vitest',
  'pytest.ini': 'pytest',
  'setup.cfg': 'pytest',
  'conftest.py': 'pytest',
  'phpunit.xml': 'phpunit',
  '.mocharc.yml': 'mocha',
  '.mocharc.json': 'mocha',
};

export function detectTests(
  filePaths: string[],
  projectRoot: string,
  level: 'L0' | 'L1',
): Partial<TestingInfo> {
  const fileNames = new Set(filePaths.map(f => f.split('/').pop() ?? ''));
  const result: Partial<TestingInfo> = {};

  // L0: signal file detection
  for (const [signal, framework] of Object.entries(TEST_FRAMEWORK_SIGNALS)) {
    if (fileNames.has(signal)) {
      result.framework = framework;
      break;
    }
  }

  // Detect test file pattern
  const hasTestDir = filePaths.some(f => f.includes('__tests__/'));
  const hasTestSuffix = filePaths.some(f => /\.test\.(ts|tsx|js|jsx)$/.test(f));
  const hasSpecSuffix = filePaths.some(f => /\.spec\.(ts|tsx|js|jsx)$/.test(f));
  const hasGoTest = filePaths.some(f => f.endsWith('_test.go'));
  const hasPyTest = filePaths.some(f => f.startsWith('test_') || f.includes('/test_'));

  if (hasTestDir) result.pattern = '__tests__/';
  else if (hasTestSuffix) result.pattern = '*.test.*';
  else if (hasSpecSuffix) result.pattern = '*.spec.*';
  else if (hasGoTest) result.pattern = '*_test.go';
  else if (hasPyTest) result.pattern = 'test_*.py';

  // Detect fixtures
  const fixtures = filePaths
    .filter(f => f.includes('fixture') || f.includes('__fixtures__') || f.includes('__mocks__'))
    .map(f => f.split('/').slice(0, -1).join('/'))
    .filter((v, i, a) => a.indexOf(v) === i);
  if (fixtures.length > 0) result.fixtures = fixtures;

  if (level === 'L1') {
    // L1: parse package.json scripts for test command
    const pkgPath = join(projectRoot, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
        const scripts = pkg.scripts as Record<string, string> | undefined;
        if (scripts?.test) {
          if (!result.framework) {
            if (scripts.test.includes('vitest')) result.framework = 'vitest';
            else if (scripts.test.includes('jest')) result.framework = 'jest';
            else if (scripts.test.includes('mocha')) result.framework = 'mocha';
            else if (scripts.test.includes('pytest')) result.framework = 'pytest';
          }
        }
      } catch {
        // invalid package.json
      }
    }
  }

  return result;
}
