import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  parseFeatureFile,
  writeFeature,
  updateFeatureFrontmatter,
  loadAllFeatures,
  pickNextFeature,
  hasCycle,
  FEATURE_STATUSES,
} from './index.js';
import type { Feature } from './index.js';

let tmp: string;

beforeEach(() => {
  tmp = join(tmpdir(), `reins-features-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmp, { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function fixtureFeature(overrides: Partial<Feature> = {}): Feature {
  return {
    id: 'test-feature',
    title: 'Test feature',
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

// ---------------------------------------------------------------------------
// parseFeatureFile
// ---------------------------------------------------------------------------

describe('parseFeatureFile', () => {
  it('returns a valid Feature for a well-formed file', () => {
    const path = join(tmp, '001-test.md');
    writeFileSync(
      path,
      `---
id: 001-test
title: Login feature
status: todo
priority: 5
depends_on:
  - 000-bootstrap
max_attempts: 4
scope:
  - src/auth/**
created_at: "2026-04-01T00:00:00.000Z"
updated_at: "2026-04-01T00:00:00.000Z"
last_run_id: null
last_failure: null
---

## What
Email + password login.
`,
      'utf-8',
    );

    const feature = parseFeatureFile(path);
    expect(feature).not.toBeNull();
    expect(feature?.id).toBe('001-test');
    expect(feature?.title).toBe('Login feature');
    expect(feature?.status).toBe('todo');
    expect(feature?.priority).toBe(5);
    expect(feature?.depends_on).toEqual(['000-bootstrap']);
    expect(feature?.max_attempts).toBe(4);
    expect(feature?.scope).toEqual(['src/auth/**']);
    expect(feature?.created_at).toBe('2026-04-01T00:00:00.000Z');
    expect(feature?.last_run_id).toBeNull();
    expect(feature?.last_failure).toBeNull();
    expect(feature?.body).toContain('Email + password login.');
  });

  it('returns null for a file missing the required status field', () => {
    const path = join(tmp, 'no-status.md');
    writeFileSync(
      path,
      `---
id: no-status
title: No status field
---

body
`,
      'utf-8',
    );
    expect(parseFeatureFile(path)).toBeNull();
  });

  it('returns null for an invalid status enum value', () => {
    const path = join(tmp, 'bad-status.md');
    writeFileSync(
      path,
      `---
id: bad-status
title: Bad status
status: maybe-later
---

body
`,
      'utf-8',
    );
    expect(parseFeatureFile(path)).toBeNull();
  });

  it('tolerates and ignores extra unknown frontmatter fields', () => {
    const path = join(tmp, 'extra-fields.md');
    writeFileSync(
      path,
      `---
id: extra
title: Has extras
status: draft
banana_color: yellow
some_future_field:
  nested: value
---

body
`,
      'utf-8',
    );
    const f = parseFeatureFile(path);
    expect(f).not.toBeNull();
    expect(f?.id).toBe('extra');
    expect(f?.status).toBe('draft');
  });

  it('returns null for a file without frontmatter delimiters', () => {
    const path = join(tmp, 'plain.md');
    writeFileSync(path, 'This is just a plain markdown file.\nNo frontmatter.\n', 'utf-8');
    expect(parseFeatureFile(path)).toBeNull();
  });

  it('returns null when the frontmatter is not a mapping', () => {
    const path = join(tmp, 'not-mapping.md');
    writeFileSync(path, `---\n- one\n- two\n---\nbody\n`, 'utf-8');
    expect(parseFeatureFile(path)).toBeNull();
  });

  it('defaults priority to 100 when omitted', () => {
    const path = join(tmp, 'no-priority.md');
    writeFileSync(
      path,
      `---
id: np
title: No Priority
status: todo
---

body
`,
      'utf-8',
    );
    const f = parseFeatureFile(path);
    expect(f?.priority).toBe(100);
  });

  it('defaults depends_on to [] when omitted', () => {
    const path = join(tmp, 'no-deps.md');
    writeFileSync(
      path,
      `---
id: nd
title: No Deps
status: todo
---

body
`,
      'utf-8',
    );
    const f = parseFeatureFile(path);
    expect(f?.depends_on).toEqual([]);
  });

  it('exposes all 7 statuses via FEATURE_STATUSES', () => {
    expect(FEATURE_STATUSES).toEqual([
      'draft',
      'todo',
      'in-progress',
      'implemented',
      'verified',
      'done',
      'blocked',
    ]);
  });
});

// ---------------------------------------------------------------------------
// writeFeature + round-trip
// ---------------------------------------------------------------------------

describe('writeFeature', () => {
  it('round-trips through parseFeatureFile', () => {
    const path = join(tmp, 'round-trip.md');
    const feature = fixtureFeature({
      id: 'rt',
      title: 'Round trip',
      status: 'todo',
      priority: 3,
      depends_on: ['bootstrap'],
      scope: ['src/**'],
      max_attempts: 5,
      body: '\n## What\nA round-trip test.\n',
    });

    writeFeature(path, feature);
    const parsed = parseFeatureFile(path);

    expect(parsed).not.toBeNull();
    expect(parsed?.id).toBe(feature.id);
    expect(parsed?.title).toBe(feature.title);
    expect(parsed?.status).toBe(feature.status);
    expect(parsed?.priority).toBe(feature.priority);
    expect(parsed?.depends_on).toEqual(feature.depends_on);
    expect(parsed?.scope).toEqual(feature.scope);
    expect(parsed?.max_attempts).toBe(feature.max_attempts);
    expect(parsed?.body).toBe(feature.body);
  });
});

// ---------------------------------------------------------------------------
// updateFeatureFrontmatter — byte-preservation of body
// ---------------------------------------------------------------------------

describe('updateFeatureFrontmatter', () => {
  /** Extract the body bytes by locating the closing `---` delimiter. */
  function extractBody(raw: string): string {
    const closeMarker = raw.indexOf('\n---', 3);
    if (closeMarker === -1) throw new Error('malformed fixture');
    return raw.slice(closeMarker + '\n---'.length);
  }

  it('changes a frontmatter field and preserves body bytes byte-for-byte', () => {
    const path = join(tmp, 'byte-preserve.md');
    const feature = fixtureFeature({
      id: 'bp',
      title: 'Byte preserve',
      body: '\n## What\n\nA body with *markdown*, `code`,\nand multiple paragraphs.\n\n- bullet 1\n- bullet 2\n',
    });
    writeFeature(path, feature);

    const before = readFileSync(path, 'utf-8');
    const bodyBefore = extractBody(before);

    updateFeatureFrontmatter(path, { status: 'in-progress' });

    const after = readFileSync(path, 'utf-8');
    const bodyAfter = extractBody(after);

    expect(bodyAfter).toBe(bodyBefore);
    // Also verify parsed status reflects the change
    const reparsed = parseFeatureFile(path);
    expect(reparsed?.status).toBe('in-progress');
  });

  it('automatically bumps the updated_at timestamp', async () => {
    const path = join(tmp, 'bump.md');
    writeFeature(path, fixtureFeature({ id: 'bump', updated_at: '2020-01-01T00:00:00.000Z' }));

    // Wait 1ms so the new ISO string differs
    await new Promise(r => setTimeout(r, 2));

    updateFeatureFrontmatter(path, { status: 'todo' });
    const f = parseFeatureFile(path);
    expect(f?.updated_at).not.toBe('2020-01-01T00:00:00.000Z');
    expect(Date.parse(f?.updated_at ?? '')).toBeGreaterThan(Date.parse('2020-01-01T00:00:00.000Z'));
  });

  it('throws for a missing file', () => {
    expect(() => updateFeatureFrontmatter(join(tmp, 'nope.md'), { status: 'todo' })).toThrow(/not found/);
  });

  it('throws for a file without frontmatter delimiters', () => {
    const path = join(tmp, 'plain.md');
    writeFileSync(path, 'no frontmatter here\n', 'utf-8');
    expect(() => updateFeatureFrontmatter(path, { status: 'todo' })).toThrow(/frontmatter/);
  });
});

// ---------------------------------------------------------------------------
// loadAllFeatures
// ---------------------------------------------------------------------------

describe('loadAllFeatures', () => {
  it('returns parsed features from .reins/features/, skipping invalid files', () => {
    const featuresDir = join(tmp, '.reins', 'features');
    mkdirSync(featuresDir, { recursive: true });

    writeFeature(join(featuresDir, '001-a.md'), fixtureFeature({ id: '001-a', title: 'A' }));
    writeFeature(join(featuresDir, '002-b.md'), fixtureFeature({ id: '002-b', title: 'B' }));
    // Invalid: missing status
    writeFileSync(join(featuresDir, '003-bad.md'), `---\nid: bad\ntitle: Bad\n---\nbody\n`, 'utf-8');
    // Non-markdown file — should be ignored
    writeFileSync(join(featuresDir, 'README.txt'), 'ignore me', 'utf-8');

    const features = loadAllFeatures(tmp);
    expect(features.map(f => f.id).sort()).toEqual(['001-a', '002-b']);
  });

  it('returns [] when .reins/features/ does not exist', () => {
    expect(loadAllFeatures(tmp)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// pickNextFeature
// ---------------------------------------------------------------------------

describe('pickNextFeature', () => {
  it('returns the lowest-priority todo feature with all deps satisfied', () => {
    const features: Feature[] = [
      fixtureFeature({ id: 'a', status: 'done' }),
      fixtureFeature({ id: 'b', status: 'todo', priority: 5, depends_on: ['a'], created_at: '2026-01-01T00:00:00Z' }),
      fixtureFeature({ id: 'c', status: 'todo', priority: 10, depends_on: ['a'], created_at: '2026-01-01T00:00:00Z' }),
      fixtureFeature({ id: 'd', status: 'todo', priority: 5, depends_on: ['a'], created_at: '2026-02-01T00:00:00Z' }),
    ];
    const next = pickNextFeature(features);
    // b and d tie on priority; b wins by earlier created_at
    expect(next?.id).toBe('b');
  });

  it('returns null when all todo features are blocked by unfinished deps', () => {
    const features: Feature[] = [
      fixtureFeature({ id: 'a', status: 'todo' }),
      fixtureFeature({ id: 'b', status: 'todo', depends_on: ['a'] }),
      fixtureFeature({ id: 'c', status: 'todo', depends_on: ['a', 'b'] }),
    ];
    // None have deps satisfied ('a' has no deps, so 'a' should be ready)
    const next = pickNextFeature(features);
    expect(next?.id).toBe('a');
  });

  it('returns null when every todo has an unmet dependency', () => {
    const features: Feature[] = [
      fixtureFeature({ id: 'x', status: 'todo', depends_on: ['missing'] }),
    ];
    expect(pickNextFeature(features)).toBeNull();
  });

  it('returns null when no features are in todo', () => {
    const features: Feature[] = [
      fixtureFeature({ id: 'a', status: 'done' }),
      fixtureFeature({ id: 'b', status: 'draft' }),
    ];
    expect(pickNextFeature(features)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// hasCycle
// ---------------------------------------------------------------------------

describe('hasCycle', () => {
  it('detects a direct A->B->A cycle', () => {
    const features: Feature[] = [
      fixtureFeature({ id: 'a', depends_on: ['b'] }),
      fixtureFeature({ id: 'b', depends_on: ['a'] }),
    ];
    expect(hasCycle(features)).toBe(true);
  });

  it('detects a transitive A->B->C->A cycle', () => {
    const features: Feature[] = [
      fixtureFeature({ id: 'a', depends_on: ['b'] }),
      fixtureFeature({ id: 'b', depends_on: ['c'] }),
      fixtureFeature({ id: 'c', depends_on: ['a'] }),
    ];
    expect(hasCycle(features)).toBe(true);
  });

  it('detects a self-loop', () => {
    const features: Feature[] = [
      fixtureFeature({ id: 'a', depends_on: ['a'] }),
    ];
    expect(hasCycle(features)).toBe(true);
  });

  it('returns false for a valid DAG', () => {
    const features: Feature[] = [
      fixtureFeature({ id: 'a', depends_on: [] }),
      fixtureFeature({ id: 'b', depends_on: ['a'] }),
      fixtureFeature({ id: 'c', depends_on: ['a', 'b'] }),
      fixtureFeature({ id: 'd', depends_on: ['c'] }),
    ];
    expect(hasCycle(features)).toBe(false);
  });

  it('returns false when depends_on references unknown ids', () => {
    const features: Feature[] = [
      fixtureFeature({ id: 'a', depends_on: ['ghost'] }),
    ];
    expect(hasCycle(features)).toBe(false);
  });
});
