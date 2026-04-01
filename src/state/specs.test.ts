import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSpecDir, writeSpecFile, loadSpec, listSpecs, updateSpecStatus } from './specs.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `reins-specs-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('specs', () => {
  it('createSpecDir generates correct ID format and creates directory', () => {
    const id = createSpecDir(tmpDir, 'add avatar upload');
    expect(id).toMatch(/^\d{4}-\d{2}-\d{2}-add-avatar-upload$/);
    expect(existsSync(join(tmpDir, '.reins', 'specs', id))).toBe(true);
  });

  it('writeSpecFile + loadSpec round-trips correctly', () => {
    const id = createSpecDir(tmpDir, 'test feature');
    const specContent = '# Test\n\n## Acceptance Criteria\n- [ ] Feature works\n- [ ] Tests pass\n';
    writeSpecFile(tmpDir, id, 'spec.md', specContent);

    const bundle = loadSpec(tmpDir, id);
    expect(bundle.specContent).toBe(specContent);
    expect(bundle.designContent).toBeNull();
    expect(bundle.tasksContent).toBeNull();
  });

  it('acceptance criteria are parsed from markdown', () => {
    const id = createSpecDir(tmpDir, 'criteria test');
    const spec = '# Test\n## Acceptance Criteria\n- [ ] Criterion A\n- [ ] Criterion B\n- Not a criterion\n';
    writeSpecFile(tmpDir, id, 'spec.md', spec);

    const bundle = loadSpec(tmpDir, id);
    expect(bundle.acceptanceCriteria).toEqual(['Criterion A', 'Criterion B']);
  });

  it('updateSpecStatus transitions correctly', () => {
    const id = createSpecDir(tmpDir, 'status test');
    updateSpecStatus(tmpDir, id, 'confirmed');

    const specs = listSpecs(tmpDir);
    const entry = specs.find(s => s.id === id);
    expect(entry?.status).toBe('confirmed');
    expect(entry?.confirmed).toBeDefined();
  });

  it('throws on missing spec directory', () => {
    expect(() => loadSpec(tmpDir, 'nonexistent')).toThrow('Spec not found');
  });

  it('listSpecs returns all created specs', () => {
    createSpecDir(tmpDir, 'feature one');
    createSpecDir(tmpDir, 'feature two');
    const specs = listSpecs(tmpDir);
    expect(specs).toHaveLength(2);
  });
});
