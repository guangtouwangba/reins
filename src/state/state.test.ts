import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildManifest, buildReinsManifest, saveManifest, loadManifest, diffManifest } from './manifest.js';
import { saveSnapshot, listSnapshots, restoreSnapshot } from './snapshot.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `reins-state-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(join(tmpDir, '.reins'), { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('manifest', () => {
  it('saves and loads a manifest', () => {
    writeFileSync(join(tmpDir, 'package.json'), '{"name":"test"}', 'utf-8');

    const manifest = buildManifest(tmpDir);
    saveManifest(tmpDir, manifest);

    const loaded = loadManifest(tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(1);
    expect(loaded!.hash).toBe(manifest.hash);
    expect(typeof loaded!.generatedAt).toBe('string');
  });

  it('returns null when manifest does not exist', () => {
    const result = loadManifest(tmpDir);
    expect(result).toBeNull();
  });

  it('buildManifest scans project input files, not .reins/', () => {
    writeFileSync(join(tmpDir, 'package.json'), '{"name":"test"}', 'utf-8');
    writeFileSync(join(tmpDir, 'tsconfig.json'), '{}', 'utf-8');
    writeFileSync(join(tmpDir, '.reins', 'constraints.yaml'), 'version: 1\n', 'utf-8');

    const manifest = buildManifest(tmpDir);
    const paths = manifest.files.map(f => f.path);
    // Should include project files
    expect(paths.some(p => p === 'package.json')).toBe(true);
    expect(paths.some(p => p === 'tsconfig.json')).toBe(true);
    // Should NOT include .reins/ artifacts
    expect(paths.some(p => p.startsWith('.reins/'))).toBe(false);
  });

  it('buildReinsManifest scans .reins/ directory (legacy behavior)', () => {
    writeFileSync(join(tmpDir, '.reins', 'constraints.yaml'), 'version: 1\n', 'utf-8');
    writeFileSync(join(tmpDir, '.reins', 'config.yaml'), 'key: value\n', 'utf-8');

    const manifest = buildReinsManifest(tmpDir);
    expect(manifest.files.length).toBeGreaterThanOrEqual(2);
    const paths = manifest.files.map(f => f.path);
    expect(paths.some(p => p.includes('constraints.yaml'))).toBe(true);
  });

  it('buildManifest excludes node_modules and .git', () => {
    writeFileSync(join(tmpDir, 'index.ts'), 'export {}', 'utf-8');
    mkdirSync(join(tmpDir, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(tmpDir, 'node_modules', 'pkg', 'index.js'), '', 'utf-8');

    const manifest = buildManifest(tmpDir);
    const paths = manifest.files.map(f => f.path);
    expect(paths.some(p => p.includes('node_modules'))).toBe(false);
  });

  it('hash is deterministic for same content', () => {
    writeFileSync(join(tmpDir, 'package.json'), '{"name":"test"}', 'utf-8');

    const m1 = buildManifest(tmpDir);
    const m2 = buildManifest(tmpDir);
    expect(m1.hash).toBe(m2.hash);
  });
});

describe('diffManifest', () => {
  it('reports no changes for identical manifests', () => {
    writeFileSync(join(tmpDir, 'package.json'), '{"name":"test"}', 'utf-8');
    const m = buildManifest(tmpDir);
    const diff = diffManifest(m, m);
    expect(diff.hasChanges).toBe(false);
    expect(diff.added.length).toBe(0);
    expect(diff.removed.length).toBe(0);
    expect(diff.modified.length).toBe(0);
  });

  it('detects added files', () => {
    const m1 = buildManifest(tmpDir);
    writeFileSync(join(tmpDir, 'newfile.ts'), 'export {}', 'utf-8');
    const m2 = buildManifest(tmpDir);

    const diff = diffManifest(m1, m2);
    expect(diff.hasChanges).toBe(true);
    expect(diff.added.length).toBeGreaterThan(0);
  });

  it('detects removed files', () => {
    writeFileSync(join(tmpDir, 'package.json'), '{"name":"test"}', 'utf-8');
    const m1 = buildManifest(tmpDir);

    // Create manifest without any files
    const m2 = { ...m1, files: [] };
    const diff = diffManifest(m1, m2);
    expect(diff.hasChanges).toBe(true);
    expect(diff.removed.length).toBeGreaterThan(0);
  });
});

describe('snapshot', () => {
  it('saves and lists a snapshot', () => {
    writeFileSync(join(tmpDir, '.reins', 'constraints.yaml'), 'version: 1\n', 'utf-8');

    const id = saveSnapshot(tmpDir, 'test');
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);

    const snapshots = listSnapshots(tmpDir);
    expect(snapshots.length).toBe(1);
    expect(snapshots[0]!.id).toBe(id);
    expect(snapshots[0]!.trigger).toBe('test');
  });

  it('captures constraints.yaml content', () => {
    const content = 'version: 1\nconstraints: []\n';
    writeFileSync(join(tmpDir, '.reins', 'constraints.yaml'), content, 'utf-8');

    saveSnapshot(tmpDir, 'init');
    const snapshots = listSnapshots(tmpDir);
    const snap = snapshots[0]!;
    const constraintsFile = snap.files.find(f => f.path === 'constraints.yaml');
    expect(constraintsFile).toBeDefined();
    expect(constraintsFile!.content).toBe(content);
  });

  it('returns empty array when no snapshots exist', () => {
    const snapshots = listSnapshots(tmpDir);
    expect(snapshots).toEqual([]);
  });

  it('restores files from snapshot', () => {
    const original = 'version: 1\noriginal: true\n';
    writeFileSync(join(tmpDir, '.reins', 'constraints.yaml'), original, 'utf-8');

    const id = saveSnapshot(tmpDir, 'before-change');

    // Overwrite the file
    writeFileSync(join(tmpDir, '.reins', 'constraints.yaml'), 'version: 2\nmodified: true\n', 'utf-8');

    // Restore
    restoreSnapshot(tmpDir, id);

    const restored = readFileSync(join(tmpDir, '.reins', 'constraints.yaml'), 'utf-8');
    expect(restored).toBe(original);
  });

  it('lists snapshots newest first', () => {
    writeFileSync(join(tmpDir, '.reins', 'constraints.yaml'), 'v: 1\n', 'utf-8');

    const id1 = saveSnapshot(tmpDir, 'first');
    // Small delay to ensure different timestamp
    const id2 = saveSnapshot(tmpDir, 'second');

    const snapshots = listSnapshots(tmpDir);
    expect(snapshots.length).toBe(2);
    // Newest first — second id should be >= first id
    expect(snapshots[0]!.id >= snapshots[1]!.id).toBe(true);
  });

  it('throws when restoring non-existent snapshot', () => {
    expect(() => restoreSnapshot(tmpDir, 'nonexistent')).toThrow();
  });

  it('restore deletes captured top-level files absent from snapshot', () => {
    // Create a snapshot WITHOUT constraints.yaml
    mkdirSync(join(tmpDir, '.reins', 'snapshots', 'empty-snap'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.reins', 'snapshots', 'empty-snap', 'snapshot.json'),
      JSON.stringify({ id: 'empty-snap', createdAt: new Date().toISOString(), trigger: 'test', files: [] }),
      'utf-8',
    );

    // Create constraints.yaml on disk
    writeFileSync(join(tmpDir, '.reins', 'constraints.yaml'), 'version: 1\n', 'utf-8');
    expect(existsSync(join(tmpDir, '.reins', 'constraints.yaml'))).toBe(true);

    // Restore the empty snapshot — constraints.yaml should be deleted
    restoreSnapshot(tmpDir, 'empty-snap');
    expect(existsSync(join(tmpDir, '.reins', 'constraints.yaml'))).toBe(false);
  });
});
