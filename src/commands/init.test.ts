import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import { initCommand } from './init.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `reins-init-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });

  // Minimal project fixtures
  writeFileSync(
    join(tmpDir, 'package.json'),
    JSON.stringify({ name: 'test-project', version: '1.0.0', devDependencies: { typescript: '^5.0.0', vitest: '^3.0.0' } }),
    'utf-8',
  );
  writeFileSync(
    join(tmpDir, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true, module: 'ESNext' } }),
    'utf-8',
  );
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('initCommand', () => {
  it('creates .reins/constraints.yaml with valid YAML', async () => {
    await initCommand(tmpDir, { depth: 'L0-L2' });

    const constraintsPath = join(tmpDir, '.reins', 'constraints.yaml');
    expect(existsSync(constraintsPath)).toBe(true);

    const raw = readFileSync(constraintsPath, 'utf-8');
    const parsed = yaml.load(raw) as Record<string, unknown>;
    expect(parsed).toBeTruthy();
    expect(parsed['version']).toBe(1);
    expect(Array.isArray(parsed['constraints'])).toBe(true);
  });

  it('creates CLAUDE.md with fewer than 50 lines', async () => {
    await initCommand(tmpDir, { depth: 'L0-L2' });

    const claudeMdPath = join(tmpDir, 'CLAUDE.md');
    expect(existsSync(claudeMdPath)).toBe(true);

    const content = readFileSync(claudeMdPath, 'utf-8');
    const lineCount = content.split('\n').length;
    expect(lineCount).toBeLessThan(50);
  });

  it('dry-run does not write any files', async () => {
    await initCommand(tmpDir, { depth: 'L0-L2', dryRun: true });

    expect(existsSync(join(tmpDir, 'CLAUDE.md'))).toBe(false);
    // .reins dir may be created by scan(), but constraints.yaml should not exist
    expect(existsSync(join(tmpDir, '.reins', 'constraints.yaml'))).toBe(false);
  });
});
