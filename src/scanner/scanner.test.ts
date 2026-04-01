import { describe, it, expect } from 'vitest';
import { detectStack } from './stack-detector.js';
import { detectTests } from './test-detector.js';
import { detectRules } from './rule-detector.js';
import { analyzePatterns } from './pattern-analyzer.js';
import { emptyCodebaseContext } from './types.js';
import { scan } from './scan.js';
import { join } from 'node:path';

describe('stack-detector', () => {
  it('detects TypeScript + pnpm from file signals', () => {
    const files = ['package.json', 'tsconfig.json', 'pnpm-lock.yaml', 'src/index.ts'];
    const result = detectStack(files, '/tmp', 'L0');
    expect(result.language).toContain('typescript');
    expect(result.language).toContain('javascript');
    expect(result.packageManager).toBe('pnpm');
  });

  it('detects Next.js framework', () => {
    const files = ['package.json', 'next.config.ts', 'pnpm-lock.yaml'];
    const result = detectStack(files, '/tmp', 'L0');
    expect(result.framework).toContain('next.js');
  });

  it('detects Go project', () => {
    const files = ['go.mod', 'main.go', 'go.sum'];
    const result = detectStack(files, '/tmp', 'L0');
    expect(result.language).toContain('go');
  });

  it('detects Rust project', () => {
    const files = ['Cargo.toml', 'src/main.rs'];
    const result = detectStack(files, '/tmp', 'L0');
    expect(result.language).toContain('rust');
  });
});

describe('test-detector', () => {
  it('detects vitest from config file', () => {
    const files = ['vitest.config.ts', 'src/foo.test.ts'];
    const result = detectTests(files, '/tmp', 'L0');
    expect(result.framework).toBe('vitest');
    expect(result.pattern).toBe('*.test.*');
  });

  it('detects __tests__ pattern', () => {
    const files = ['src/__tests__/foo.ts', 'jest.config.js'];
    const result = detectTests(files, '/tmp', 'L0');
    expect(result.framework).toBe('jest');
    expect(result.pattern).toBe('__tests__/');
  });

  it('detects Go test pattern', () => {
    const files = ['main.go', 'main_test.go'];
    const result = detectTests(files, '/tmp', 'L0');
    expect(result.pattern).toBe('*_test.go');
  });
});

describe('rule-detector', () => {
  it('detects TypeScript strict mode in this project', () => {
    const projectRoot = join(import.meta.dirname, '../..');
    const files = ['tsconfig.json', 'package.json'];
    const result = detectRules(files, projectRoot);
    expect(result.typeCheck).toBe(true);
  });
});

describe('pattern-analyzer', () => {
  it('detects monorepo pattern', async () => {
    const dirs = ['packages', 'packages/core', 'packages/ui'];
    const files = ['package.json', 'packages/core/index.ts'];
    const result = await analyzePatterns(files, dirs);
    expect(result.architecture.pattern).toBe('monorepo');
  });

  it('detects layered pattern', async () => {
    const dirs = ['src', 'src/api', 'src/service', 'src/repository', 'src/model'];
    const files = ['src/api/routes.ts', 'src/service/user.ts'];
    const result = await analyzePatterns(files, dirs);
    expect(result.architecture.pattern).toBe('layered');
  });

  it('detects camelCase naming', async () => {
    const files = ['src/userService.ts', 'src/authHelper.ts', 'src/dataStore.ts'];
    const dirs = ['src'];
    const result = await analyzePatterns(files, dirs);
    expect(result.conventions.naming).toBe('camelCase');
  });

  it('detects kebab-case naming', async () => {
    const files = ['src/user-service.ts', 'src/auth-helper.ts', 'src/data-store.ts'];
    const dirs = ['src'];
    const result = await analyzePatterns(files, dirs);
    expect(result.conventions.naming).toBe('kebab-case');
  });
});

describe('scan (integration)', () => {
  it('scans the reins project itself', async () => {
    const projectRoot = join(import.meta.dirname, '../..');
    const context = await scan(projectRoot, 'L0-L2');
    expect(context.stack.language).toContain('typescript');
    expect(context.stack.packageManager).toBe('pnpm');
    expect(context.testing.framework).toBe('vitest');
    expect(context.structure.files.length).toBeGreaterThan(0);
    expect(context.keyFiles.lockfile).toBeTruthy();
  });
});
