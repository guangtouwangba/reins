import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';

import {
  buildImplementPrompt,
  buildPlanningPrompt,
  buildSpecGenPrompt,
  buildDevServerDiscoveryPrompt,
  extractBrowserTestSection,
  tail,
} from './prompt-builder.js';
import type { Feature, FailureContext } from '../features/types.js';
import type { Constraint } from '../constraints/schema.js';

let tmp: string;

beforeEach(() => {
  tmp = join(tmpdir(), `reins-prompt-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmp, { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function fixture(overrides: Partial<Feature> = {}): Feature {
  return {
    id: '001-test',
    title: 'Test feature',
    status: 'todo',
    priority: 100,
    depends_on: [],
    created_at: '2026-04-07T10:00:00.000Z',
    updated_at: '2026-04-07T10:00:00.000Z',
    last_run_id: null,
    last_failure: null,
    body: '\n## What\nDo a thing.\n\n## Acceptance\n- [ ] works\n',
    ...overrides,
  };
}

function writeConstraintsFile(projectRoot: string, constraints: Constraint[]): void {
  const reinsDir = join(projectRoot, '.reins');
  mkdirSync(reinsDir, { recursive: true });
  const config = {
    version: 1,
    generated_at: new Date().toISOString(),
    project: { name: 'test', type: 'library' },
    stack: { primary_language: 'typescript', framework: 'none', test_framework: 'vitest', package_manager: 'pnpm' },
    constraints,
    pipeline: { pre_commit: [] },
  };
  writeFileSync(join(reinsDir, 'constraints.yaml'), yaml.dump(config), 'utf-8');
}

function c(id: string, severity: 'critical' | 'important' | 'helpful', rule: string): Constraint {
  return {
    id,
    rule,
    severity,
    scope: 'global',
    source: 'manual',
    enforcement: { soft: false, hook: false },
  };
}

// ---------------------------------------------------------------------------
// tail
// ---------------------------------------------------------------------------

describe('tail', () => {
  it('returns the last N lines when text is longer than N', () => {
    const text = '1\n2\n3\n4\n5';
    expect(tail(text, 2)).toBe('4\n5');
  });

  it('returns the full input when N >= line count', () => {
    const text = 'a\nb\nc';
    expect(tail(text, 5)).toBe(text);
    expect(tail(text, 3)).toBe(text);
  });

  it('returns empty string for empty input', () => {
    expect(tail('', 10)).toBe('');
  });

  it('returns empty string for N <= 0', () => {
    expect(tail('hello', 0)).toBe('');
    expect(tail('hello', -1)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// buildImplementPrompt
// ---------------------------------------------------------------------------

describe('buildImplementPrompt', () => {
  it('contains the feature title and body verbatim', () => {
    const feature = fixture({ title: 'Email login', body: '\n## What\nEmail + password.\n' });
    const prompt = buildImplementPrompt(feature, tmp);
    expect(prompt).toContain('Email login');
    expect(prompt).toContain('## What');
    expect(prompt).toContain('Email + password.');
  });

  it('includes critical and important constraints in a "Project constraints" section', () => {
    writeConstraintsFile(tmp, [
      c('db-alembic', 'critical', 'DB migrations via Alembic only'),
      c('no-raw-sql', 'important', 'No raw SQL queries'),
    ]);
    const prompt = buildImplementPrompt(fixture(), tmp);
    expect(prompt).toContain('Project constraints');
    expect(prompt).toContain('[critical] DB migrations via Alembic only');
    expect(prompt).toContain('[important] No raw SQL queries');
  });

  it('filters out helpful-severity constraints', () => {
    writeConstraintsFile(tmp, [
      c('db-alembic', 'critical', 'Critical rule'),
      c('nit', 'helpful', 'Nice-to-have rule — should not appear'),
    ]);
    const prompt = buildImplementPrompt(fixture(), tmp);
    expect(prompt).toContain('Critical rule');
    expect(prompt).not.toContain('Nice-to-have rule');
  });

  it('omits the Project constraints section entirely when no critical/important rules exist', () => {
    writeConstraintsFile(tmp, [c('nit', 'helpful', 'Only helpful')]);
    const prompt = buildImplementPrompt(fixture(), tmp);
    expect(prompt).not.toContain('Project constraints');
  });

  it('tolerates a missing constraints.yaml without throwing', () => {
    const prompt = buildImplementPrompt(fixture(), tmp);
    expect(prompt).toContain('Test feature');
    expect(prompt).not.toContain('Project constraints');
  });

  it('with previousFailure, includes stage, command, exit_code, and tail of output', () => {
    const failure: FailureContext = {
      stage: 'feature_verify',
      command: 'pnpm test',
      exit_code: 1,
      output: 'line1\nline2\nERROR: something broke\nline4',
    };
    const prompt = buildImplementPrompt(fixture(), tmp, failure);
    expect(prompt).toContain('Previous attempt failed');
    expect(prompt).toContain('Stage: feature_verify');
    expect(prompt).toContain('Command: `pnpm test`');
    expect(prompt).toContain('Exit code: 1');
    expect(prompt).toContain('ERROR: something broke');
  });

  it('retry path contains the "Do not weaken the tests" guard verbatim', () => {
    const failure: FailureContext = {
      stage: 'pre_commit',
      command: 'pnpm lint',
      exit_code: 1,
      output: 'lint error',
    };
    const prompt = buildImplementPrompt(fixture(), tmp, failure);
    expect(prompt).toContain('Fix the code so this command passes. Do not weaken the tests');
  });

  it('first-attempt prompt does NOT contain the weaken-tests guard', () => {
    const prompt = buildImplementPrompt(fixture(), tmp);
    expect(prompt).not.toContain('Do not weaken the tests');
  });

  it('ends with the "append to Notes section" footer referencing the feature file path', () => {
    const feature = fixture({ id: '042-payment-flow' });
    const prompt = buildImplementPrompt(feature, tmp);
    expect(prompt).toMatch(/When done/);
    expect(prompt).toContain('.reins/features/042-payment-flow.md');
    expect(prompt).toContain('## Notes');
  });

  it('truncates long failure output via tail(..., 100)', () => {
    const longLines: string[] = [];
    for (let i = 0; i < 200; i++) longLines.push(`line ${i}`);
    const failure: FailureContext = {
      stage: 'feature_verify',
      command: 'pnpm test',
      exit_code: 1,
      output: longLines.join('\n'),
    };
    const prompt = buildImplementPrompt(fixture(), tmp, failure);
    expect(prompt).toContain('line 199');
    expect(prompt).toContain('line 100'); // within the last 100
    expect(prompt).not.toContain('line 50'); // dropped
  });
});

// ---------------------------------------------------------------------------
// buildPlanningPrompt
// ---------------------------------------------------------------------------

describe('buildPlanningPrompt', () => {
  it('includes the JSON schema instructions', () => {
    const prompt = buildPlanningPrompt([fixture()], [], 3);
    expect(prompt).toContain('"steps"');
    expect(prompt).toContain('"mode"');
    expect(prompt).toContain('serial');
    expect(prompt).toContain('parallel');
    expect(prompt).toContain('"parallelism"');
    expect(prompt).toContain('"estimated_minutes"');
  });

  it('instructs the model to output JSON only (no markdown fences in the answer)', () => {
    const prompt = buildPlanningPrompt([fixture()], [], 3);
    expect(prompt).toMatch(/Return ONLY a JSON object/);
    expect(prompt).toMatch(/DO NOT output markdown fences/);
  });

  it('lists every input feature with id, title, depends_on, scope, body preview', () => {
    const features = [
      fixture({ id: '001-a', title: 'Feature A', depends_on: [], scope: ['src/a/**'] }),
      fixture({ id: '002-b', title: 'Feature B', depends_on: ['001-a'], scope: ['src/b/**'] }),
    ];
    const prompt = buildPlanningPrompt(features, [], 3);
    expect(prompt).toContain('001-a');
    expect(prompt).toContain('Feature A');
    expect(prompt).toContain('002-b');
    expect(prompt).toContain('Feature B');
    expect(prompt).toContain('src/a/**');
    expect(prompt).toContain('src/b/**');
    // body preview appears
    expect(prompt).toContain('Do a thing');
  });

  it('includes the depends_on respect rule', () => {
    const prompt = buildPlanningPrompt([fixture()], [], 3);
    expect(prompt).toMatch(/Respect depends_on/);
  });

  it('includes the parallelism cap with the provided value', () => {
    const prompt = buildPlanningPrompt([fixture()], [], 5);
    expect(prompt).toContain('parallelism must be <= 5');
  });

  it('includes the "every feature in exactly one step" invariant', () => {
    const prompt = buildPlanningPrompt([fixture()], [], 3);
    expect(prompt).toMatch(/exactly one step/);
  });

  it('includes the list of already-done features for dependency context', () => {
    const prompt = buildPlanningPrompt([fixture()], ['000-bootstrap', '001-done'], 3);
    expect(prompt).toContain('Already-done features');
    expect(prompt).toContain('000-bootstrap');
    expect(prompt).toContain('001-done');
  });

  it('truncates body preview to 500 chars', () => {
    const longBody = '\n' + 'x'.repeat(2000);
    const feature = fixture({ body: longBody });
    const prompt = buildPlanningPrompt([feature], [], 3);
    // full body should NOT appear
    expect(prompt).not.toContain('x'.repeat(1000));
  });
});

// ---------------------------------------------------------------------------
// extractBrowserTestSection
// ---------------------------------------------------------------------------

describe('extractBrowserTestSection', () => {
  it('extracts the content between "## Browser test" and the next heading', () => {
    const body = `
## What
A thing.

## Browser test
1. Go to /login
2. Click the button
3. Expect /dashboard

## Notes
afterwards
`;
    const content = extractBrowserTestSection(body);
    expect(content).toBe('1. Go to /login\n2. Click the button\n3. Expect /dashboard');
  });

  it('returns null when the section is absent', () => {
    const body = '\n## What\nJust a backend feature.\n';
    expect(extractBrowserTestSection(body)).toBeNull();
  });

  it('returns null when the section is empty', () => {
    const body = '\n## Browser test\n\n## Notes\nother\n';
    expect(extractBrowserTestSection(body)).toBeNull();
  });

  it('handles the section being the last thing in the body', () => {
    const body = '\n## What\nx\n\n## Browser test\nfinal step\n';
    expect(extractBrowserTestSection(body)).toBe('final step');
  });

  it('accepts ### Browser test (deeper heading)', () => {
    const body = '\n### Browser test\ndeep heading\n';
    expect(extractBrowserTestSection(body)).toBe('deep heading');
  });
});

// ---------------------------------------------------------------------------
// buildSpecGenPrompt
// ---------------------------------------------------------------------------

describe('buildSpecGenPrompt', () => {
  it('includes feature title, browser test section, and spec path', () => {
    const feature = fixture({
      id: '001-login',
      title: 'Login',
      body: '\n## Browser test\n1. Go to /login\n2. Sign in\n',
    });
    const prompt = buildSpecGenPrompt(feature, '/project/e2e/001-login.spec.ts');

    expect(prompt).toContain('Login');
    expect(prompt).toContain('/project/e2e/001-login.spec.ts');
    expect(prompt).toContain('1. Go to /login');
    expect(prompt).toContain('2. Sign in');
  });

  it('references the playwright config when provided', () => {
    const feature = fixture({
      body: '\n## Browser test\ntest\n',
    });
    const prompt = buildSpecGenPrompt(
      feature,
      '/project/spec.ts',
      'app/frontend/playwright.config.ts',
    );
    expect(prompt).toContain('app/frontend/playwright.config.ts');
  });

  it('omits the playwright config section when none provided', () => {
    const feature = fixture({ body: '\n## Browser test\ntest\n' });
    const prompt = buildSpecGenPrompt(feature, '/project/spec.ts');
    expect(prompt).not.toContain('Project Playwright config');
  });

  it('throws when the feature has no Browser test section', () => {
    const feature = fixture({ body: '\n## What\nbackend only\n' });
    expect(() => buildSpecGenPrompt(feature, '/project/spec.ts')).toThrow(/Browser test/);
  });

  it('instructs the model to use structured Playwright assertions', () => {
    const feature = fixture({ body: '\n## Browser test\nclick\n' });
    const prompt = buildSpecGenPrompt(feature, '/project/spec.ts');
    expect(prompt).toContain('structured Playwright assertions');
    expect(prompt).toContain('screenshot');
  });
});

// ---------------------------------------------------------------------------
// buildDevServerDiscoveryPrompt
// ---------------------------------------------------------------------------

describe('buildDevServerDiscoveryPrompt', () => {
  it('instructs the model to return ONLY a JSON object matching the schema', () => {
    const prompt = buildDevServerDiscoveryPrompt(tmp);
    expect(prompt).toContain('Return ONLY a JSON object');
    expect(prompt).toContain('"command"');
    expect(prompt).toContain('"wait_for_url"');
    expect(prompt).toContain('"timeout_ms"');
  });

  it('includes package.json scripts when present', () => {
    mkdirSync(tmp, { recursive: true });
    writeFileSync(
      join(tmp, 'package.json'),
      JSON.stringify({ name: 'x', scripts: { dev: 'next dev', build: 'next build' } }),
      'utf-8',
    );
    const prompt = buildDevServerDiscoveryPrompt(tmp);
    expect(prompt).toContain('next dev');
  });

  it('handles a project with no package.json gracefully', () => {
    const prompt = buildDevServerDiscoveryPrompt(tmp);
    expect(prompt).toContain('(no package.json)');
  });

  it('includes README first 2000 chars when present', () => {
    mkdirSync(tmp, { recursive: true });
    writeFileSync(join(tmp, 'README.md'), '# Title\n\nStart with `pnpm dev`.\n', 'utf-8');
    const prompt = buildDevServerDiscoveryPrompt(tmp);
    expect(prompt).toContain('pnpm dev');
  });

  it('includes the "return null if no dev server" rule', () => {
    const prompt = buildDevServerDiscoveryPrompt(tmp);
    expect(prompt).toMatch(/return `null`/);
  });
});
