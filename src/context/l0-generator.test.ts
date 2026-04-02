import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateL0 } from './l0-generator.js';
import type { CodebaseContext } from '../scanner/types.js';
import type { Constraint } from '../constraints/schema.js';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `reins-l0-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function minimalContext(overrides?: Partial<CodebaseContext>): CodebaseContext {
  return {
    structure: { files: [], directories: [{ path: 'src' }, { path: 'tests' }] },
    stack: { language: ['typescript'], framework: ['express'], packageManager: 'pnpm', buildTool: '', testFramework: 'vitest' },
    architecture: { pattern: 'api', layers: [] },
    testing: { framework: 'vitest' },
    dependencies: { direct: {}, dev: {} },
    conventions: {},
    keyFiles: {},
    ...overrides,
  } as unknown as CodebaseContext;
}

function makeConstraint(overrides?: Partial<Constraint>): Constraint {
  return {
    id: 'test-1',
    rule: 'Use Prisma ORM, never raw SQL',
    severity: 'critical',
    scope: 'global',
    source: 'inferred',
    enforcement: { soft: false, hook: false },
    ...overrides,
  } as Constraint;
}

let tmpDir: string;
beforeEach(() => { tmpDir = makeTmpDir(); });
afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

describe('generateL0', () => {
  it('creates CLAUDE.md when it does not exist', () => {
    generateL0(tmpDir, minimalContext(), [makeConstraint()]);
    const path = join(tmpDir, 'CLAUDE.md');
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, 'utf-8');
    expect(content).toContain('<!-- reins-managed -->');
    expect(content).toContain('<!-- /reins-managed -->');
  });

  it('includes stack information', () => {
    generateL0(tmpDir, minimalContext(), []);
    const content = readFileSync(join(tmpDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('express');
    expect(content).toContain('typescript');
    expect(content).toContain('pnpm');
  });

  it('includes critical constraints', () => {
    const constraints = [
      makeConstraint({ id: 'c1', rule: 'Always use TypeScript strict mode', severity: 'critical' }),
      makeConstraint({ id: 'c2', rule: 'No console.log in production', severity: 'critical' }),
    ];
    generateL0(tmpDir, minimalContext(), constraints);
    const content = readFileSync(join(tmpDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('Always use TypeScript strict mode');
    expect(content).toContain('No console.log in production');
  });

  it('does not include non-critical constraints', () => {
    const constraints = [
      makeConstraint({ id: 'c1', rule: 'Critical rule', severity: 'critical' }),
      makeConstraint({ id: 'c2', rule: 'Just helpful', severity: 'helpful' }),
    ];
    generateL0(tmpDir, minimalContext(), constraints);
    const content = readFileSync(join(tmpDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('Critical rule');
    expect(content).not.toContain('Just helpful');
  });

  it('includes commands section', () => {
    generateL0(tmpDir, minimalContext(), []);
    const content = readFileSync(join(tmpDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('## Commands');
    expect(content).toContain('pnpm run');
  });

  it('appends to existing CLAUDE.md without markers', () => {
    const existing = '# My Project\n\nCustom content here.\n';
    writeFileSync(join(tmpDir, 'CLAUDE.md'), existing, 'utf-8');
    generateL0(tmpDir, minimalContext(), []);
    const content = readFileSync(join(tmpDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('Custom content here.');
    expect(content).toContain('<!-- reins-managed -->');
  });

  it('replaces managed section in existing CLAUDE.md', () => {
    const existing = '# My Project\n\n<!-- reins-managed -->\nold content\n<!-- /reins-managed -->\n\nUser section\n';
    writeFileSync(join(tmpDir, 'CLAUDE.md'), existing, 'utf-8');
    generateL0(tmpDir, minimalContext(), [makeConstraint({ rule: 'New rule' })]);
    const content = readFileSync(join(tmpDir, 'CLAUDE.md'), 'utf-8');
    expect(content).not.toContain('old content');
    expect(content).toContain('New rule');
    expect(content).toContain('User section');
  });

  it('includes project map with top-level directories', () => {
    generateL0(tmpDir, minimalContext(), []);
    const content = readFileSync(join(tmpDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('`src/`');
  });

  it('shows message when no critical constraints', () => {
    generateL0(tmpDir, minimalContext(), []);
    const content = readFileSync(join(tmpDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('No critical constraints detected');
  });
});
