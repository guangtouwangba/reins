import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateHooks } from './generator.js';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `reins-hooks-gen-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

let tmpDir: string;
beforeEach(() => { tmpDir = makeTmpDir(); });
afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

describe('generateHooks', () => {
  it('creates .reins/hooks directory', () => {
    generateHooks(tmpDir);
    expect(existsSync(join(tmpDir, '.reins', 'hooks'))).toBe(true);
  });

  it('generates 5 gate hook scripts', () => {
    generateHooks(tmpDir);
    const hooksDir = join(tmpDir, '.reins', 'hooks');
    const expected = ['gate-context.sh', 'gate-pre-edit.sh', 'gate-post-edit.sh', 'gate-pre-bash.sh', 'gate-stop.sh'];
    for (const name of expected) {
      expect(existsSync(join(hooksDir, name))).toBe(true);
    }
  });

  it('generates protection hook', () => {
    generateHooks(tmpDir);
    expect(existsSync(join(tmpDir, '.reins', 'hooks', 'protect-constraints.sh'))).toBe(true);
  });

  it('gate scripts contain exec reins gate command', () => {
    generateHooks(tmpDir);
    const hooksDir = join(tmpDir, '.reins', 'hooks');
    const content = readFileSync(join(hooksDir, 'gate-context.sh'), 'utf-8');
    expect(content).toContain('exec reins gate context');
  });

  it('gate scripts are executable', () => {
    generateHooks(tmpDir);
    const hooksDir = join(tmpDir, '.reins', 'hooks');
    const stat = statSync(join(hooksDir, 'gate-context.sh'));
    expect(stat.mode & 0o111).not.toBe(0);
  });

  it('gate scripts start with shebang', () => {
    generateHooks(tmpDir);
    const content = readFileSync(join(tmpDir, '.reins', 'hooks', 'gate-pre-bash.sh'), 'utf-8');
    expect(content.startsWith('#!/bin/bash')).toBe(true);
  });

  it('returns correct HookConfig array', () => {
    const configs = generateHooks(tmpDir);
    expect(configs.length).toBe(5);
    const ids = configs.map(c => c.constraintId);
    expect(ids).toContain('gate-context');
    expect(ids).toContain('gate-pre-edit');
    expect(ids).toContain('gate-post-edit');
    expect(ids).toContain('gate-pre-bash');
    expect(ids).toContain('gate-stop');
  });

  it('hook configs have correct types', () => {
    const configs = generateHooks(tmpDir);
    const context = configs.find(c => c.constraintId === 'gate-context');
    expect(context!.hookType).toBe('context_inject');
    expect(context!.mode).toBe('block');

    const preBash = configs.find(c => c.constraintId === 'gate-pre-bash');
    expect(preBash!.hookType).toBe('pre_bash');
  });
});
