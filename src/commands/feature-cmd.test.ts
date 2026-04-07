import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  runFeatureList,
  runFeatureShow,
  runFeatureNew,
  runFeatureStatus,
  runFeatureSetStatus,
  runFeatureNext,
  runFeature,
} from './feature-cmd.js';
import { writeFeature, parseFeatureFile } from '../features/index.js';
import type { Feature } from '../features/index.js';

let tmp: string;
let logs: string[];
let errors: string[];
let savedExitCode: typeof process.exitCode;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmp = join(tmpdir(), `reins-feature-cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmp, { recursive: true });
  mkdirSync(join(tmp, '.reins', 'features'), { recursive: true });

  logs = [];
  errors = [];

  logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(a => String(a)).join(' '));
  });
  errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map(a => String(a)).join(' '));
  });

  // Snapshot and reset process.exitCode
  savedExitCode = process.exitCode;
  process.exitCode = 0;
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
  rmSync(tmp, { recursive: true, force: true });
  process.exitCode = savedExitCode ?? 0;
});

function fixture(overrides: Partial<Feature> = {}): Feature {
  return {
    id: 'test',
    title: 'Test',
    status: 'todo',
    priority: 100,
    depends_on: [],
    created_at: '2026-04-07T10:00:00.000Z',
    updated_at: '2026-04-07T10:00:00.000Z',
    last_run_id: null,
    last_failure: null,
    body: '\n## What\nDo a thing.\n',
    ...overrides,
  };
}

function write(id: string, overrides: Partial<Feature> = {}): void {
  writeFeature(
    join(tmp, '.reins', 'features', `${id}.md`),
    fixture({ id, title: `Title for ${id}`, ...overrides }),
  );
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe('runFeatureList', () => {
  it('prints id, title, status, priority for each feature', () => {
    write('001-a', { priority: 5, status: 'todo' });
    write('002-b', { priority: 3, status: 'draft' });

    runFeatureList(tmp);
    const out = logs.join('\n');

    expect(out).toContain('001-a');
    expect(out).toContain('002-b');
    expect(out).toContain('Title for 001-a');
    expect(out).toContain('todo');
    expect(out).toContain('draft');
  });

  it('prints a friendly message when the queue is empty', () => {
    runFeatureList(tmp);
    const out = logs.join('\n');
    expect(out).toContain('No features in queue');
  });
});

// ---------------------------------------------------------------------------
// new
// ---------------------------------------------------------------------------

describe('runFeatureNew', () => {
  it('creates a new feature file with status=draft', () => {
    runFeatureNew(tmp, '001-test', { title: 'New feature', force: false });

    const path = join(tmp, '.reins', 'features', '001-test.md');
    expect(existsSync(path)).toBe(true);

    const feature = parseFeatureFile(path);
    expect(feature?.id).toBe('001-test');
    expect(feature?.title).toBe('New feature');
    expect(feature?.status).toBe('draft');
    expect(feature?.priority).toBe(100);
    expect(feature?.depends_on).toEqual([]);
    expect(feature?.body).toContain('## Acceptance');
  });

  it('refuses to overwrite an existing feature without --force', () => {
    write('001-test');
    runFeatureNew(tmp, '001-test', { force: false });

    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toMatch(/already exists/);
  });

  it('overwrites when --force is given', () => {
    write('001-test', { title: 'Original' });
    runFeatureNew(tmp, '001-test', { title: 'Replacement', force: true });

    const f = parseFeatureFile(join(tmp, '.reins', 'features', '001-test.md'));
    expect(f?.title).toBe('Replacement');
    expect(f?.status).toBe('draft');
  });

  it('rejects a feature id containing ".." (path traversal)', () => {
    runFeatureNew(tmp, '../escape', { force: false });
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toMatch(/cannot contain/i);
  });

  it('rejects a feature id starting with "-" (git flag injection)', () => {
    runFeatureNew(tmp, '-force', { force: false });
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toMatch(/invalid feature id/i);
  });

  it('rejects a feature id containing a slash (path traversal)', () => {
    runFeatureNew(tmp, 'nested/path', { force: false });
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toMatch(/invalid feature id/i);
  });

  it('rejects a feature id with spaces or shell metacharacters', () => {
    runFeatureNew(tmp, 'bad id', { force: false });
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toMatch(/invalid feature id/i);
  });

  it('accepts a feature id with letters, digits, dots, underscores, and dashes', () => {
    runFeatureNew(tmp, '001-test.v2_final', { title: 'OK', force: false });
    expect(process.exitCode).toBe(0);
    expect(existsSync(join(tmp, '.reins', 'features', '001-test.v2_final.md'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// set-status
// ---------------------------------------------------------------------------

describe('runFeatureSetStatus', () => {
  it('atomically updates status without touching the body', () => {
    write('001-test', { status: 'draft', body: '\n## Original body\nUnchanged.\n' });

    const path = join(tmp, '.reins', 'features', '001-test.md');
    const before = readFileSync(path, 'utf-8');
    const bodyBefore = before.slice(before.indexOf('\n---', 3) + 4);

    runFeatureSetStatus(tmp, '001-test', 'todo');

    const after = readFileSync(path, 'utf-8');
    const bodyAfter = after.slice(after.indexOf('\n---', 3) + 4);

    expect(bodyAfter).toBe(bodyBefore);
    const f = parseFeatureFile(path);
    expect(f?.status).toBe('todo');
  });

  it('rejects an invalid status value with a clear error', () => {
    write('001-test');
    runFeatureSetStatus(tmp, '001-test', 'bogus');

    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toMatch(/invalid status/i);
  });

  it('errors when the feature does not exist', () => {
    runFeatureSetStatus(tmp, 'nope', 'todo');
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toMatch(/not found/i);
  });
});

// ---------------------------------------------------------------------------
// show
// ---------------------------------------------------------------------------

describe('runFeatureShow', () => {
  it('prints feature frontmatter and body', () => {
    write('001-test', {
      title: 'Showable',
      status: 'todo',
      priority: 2,
      depends_on: ['bootstrap'],
      body: '\n## What\nSomething observable.\n',
    });

    runFeatureShow(tmp, '001-test');
    const out = logs.join('\n');

    expect(out).toContain('001-test');
    expect(out).toContain('Showable');
    expect(out).toContain('todo');
    expect(out).toContain('bootstrap');
    expect(out).toContain('Something observable.');
  });

  it('exits with code 1 on unknown id', () => {
    runFeatureShow(tmp, 'missing');
    expect(process.exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

describe('runFeatureStatus', () => {
  it('exits 1 with an error for a missing feature (text mode)', () => {
    runFeatureStatus(tmp, 'missing', false);
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toMatch(/not found/i);
  });

  it('emits a parseable JSON object with the status field when --json', () => {
    write('001-test', { status: 'in-progress' });
    runFeatureStatus(tmp, '001-test', true);
    const out = logs.join('\n');
    const parsed = JSON.parse(out);
    expect(parsed.id).toBe('001-test');
    expect(parsed.status).toBe('in-progress');
  });

  it('emits a JSON error object for a missing feature when --json', () => {
    runFeatureStatus(tmp, 'missing', true);
    const out = logs.join('\n');
    const parsed = JSON.parse(out);
    expect(parsed.error).toBe('not_found');
  });

  it('prints just the status string in text mode', () => {
    write('001-test', { status: 'todo' });
    runFeatureStatus(tmp, '001-test', false);
    expect(logs.join('\n').trim()).toBe('todo');
  });
});

// ---------------------------------------------------------------------------
// next
// ---------------------------------------------------------------------------

describe('runFeatureNext', () => {
  it('prints the next feature id', () => {
    write('001-a', { status: 'todo', priority: 5 });
    write('002-b', { status: 'todo', priority: 10 });
    runFeatureNext(tmp);
    expect(logs.join('\n').trim()).toBe('001-a');
  });

  it('prints empty string when nothing is ready', () => {
    write('001-a', { status: 'done' });
    runFeatureNext(tmp);
    expect(logs.join('\n').trim()).toBe('');
  });
});

// ---------------------------------------------------------------------------
// runFeature dispatch
// ---------------------------------------------------------------------------

describe('runFeature (dispatch)', () => {
  it('routes list action', async () => {
    write('001-a');
    // Temporarily override cwd
    const cwd = process.cwd();
    process.chdir(tmp);
    try {
      await runFeature('list', []);
    } finally {
      process.chdir(cwd);
    }
    expect(logs.join('\n')).toContain('001-a');
  });

  it('prints usage on unknown action', async () => {
    await runFeature('bogus', []);
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toMatch(/Unknown action/);
  });

  it('prints usage on missing action', async () => {
    await runFeature(undefined, []);
    expect(errors.join('\n')).toMatch(/Usage/);
  });

  it('rejects new without an id', async () => {
    await runFeature('new', []);
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toMatch(/Usage: reins feature new/);
  });

  it('rejects set-status without id and status', async () => {
    await runFeature('set-status', ['001-test']);
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toMatch(/Usage: reins feature set-status/);
  });
});
