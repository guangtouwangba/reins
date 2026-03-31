import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { classifyConstraint } from './classifier.js';
import { loadTemplates, inferConstraints, generateConstraints } from './generator.js';
import { emptyCodebaseContext } from '../scanner/types.js';
import type { Constraint } from './schema.js';

// ---------------------------------------------------------------------------
// classifier
// ---------------------------------------------------------------------------

describe('classifyConstraint', () => {
  it('classifies SQL/database rules as critical', () => {
    const c = { id: 'x', rule: 'Never write raw SQL queries', scope: 'global' as const, source: 'auto' as const, enforcement: { soft: false, hook: false } };
    expect(classifyConstraint(c)).toBe('critical');
  });

  it('classifies security/secret rules as critical', () => {
    const c = { id: 'x', rule: 'Do not commit secret tokens to source control', scope: 'global' as const, source: 'auto' as const, enforcement: { soft: false, hook: false } };
    expect(classifyConstraint(c)).toBe('critical');
  });

  it('classifies architecture/service rules as important', () => {
    const c = { id: 'x', rule: 'Business logic belongs in the service layer only', scope: 'global' as const, source: 'auto' as const, enforcement: { soft: true, hook: false } };
    expect(classifyConstraint(c)).toBe('important');
  });

  it('classifies naming/convention rules as important', () => {
    const c = { id: 'x', rule: 'Follow camelCase naming convention for variables', scope: 'global' as const, source: 'auto' as const, enforcement: { soft: true, hook: false } };
    expect(classifyConstraint(c)).toBe('important');
  });

  it('classifies prefer/example rules as helpful', () => {
    const c = { id: 'x', rule: 'Prefer functional components as a reference example', scope: 'global' as const, source: 'auto' as const, enforcement: { soft: true, hook: false } };
    expect(classifyConstraint(c)).toBe('helpful');
  });

  it('defaults to helpful when no pattern matches', () => {
    const c = { id: 'x', rule: 'Keep line length under 120 characters', scope: 'global' as const, source: 'auto' as const, enforcement: { soft: true, hook: false } };
    expect(classifyConstraint(c)).toBe('helpful');
  });

  it('upgrades helpful to critical when hook is true', () => {
    const c = { id: 'x', rule: 'Keep things tidy', scope: 'global' as const, source: 'auto' as const, enforcement: { soft: true, hook: true } };
    // no pattern match → default helpful → hook upgrades to critical
    expect(classifyConstraint(c)).toBe('critical');
  });

  it('never returns helpful when enforcement.hook is true', () => {
    const c = { id: 'x', rule: 'Prefer const over let as a helpful reminder', scope: 'global' as const, source: 'auto' as const, enforcement: { soft: true, hook: true } };
    const result = classifyConstraint(c);
    expect(result).not.toBe('helpful');
  });
});

// ---------------------------------------------------------------------------
// template loader
// ---------------------------------------------------------------------------

describe('loadTemplates', () => {
  it('loads TypeScript templates without error', () => {
    const ctx = emptyCodebaseContext();
    const constraints = loadTemplates(['typescript'], ctx);
    expect(constraints.length).toBeGreaterThan(0);
    for (const c of constraints) {
      expect(c.id).toBeTruthy();
      expect(c.rule).toBeTruthy();
      expect(['critical', 'important', 'helpful']).toContain(c.severity);
    }
  });

  it('filters out ts-strict when typeCheck is true', () => {
    const ctx = emptyCodebaseContext();
    ctx.existingRules.typeCheck = true;
    const constraints = loadTemplates(['typescript'], ctx);
    expect(constraints.find(c => c.id === 'ts-strict')).toBeUndefined();
  });

  it('includes ts-strict when typeCheck is false', () => {
    const ctx = emptyCodebaseContext();
    ctx.existingRules.typeCheck = false;
    const constraints = loadTemplates(['typescript'], ctx);
    expect(constraints.find(c => c.id === 'ts-strict')).toBeDefined();
  });

  it('returns empty array for unknown language', () => {
    const ctx = emptyCodebaseContext();
    const constraints = loadTemplates(['cobol'], ctx);
    expect(constraints).toEqual([]);
  });

  it('loads python templates', () => {
    const ctx = emptyCodebaseContext();
    const constraints = loadTemplates(['python'], ctx);
    expect(constraints.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// YAML template files parse correctly
// ---------------------------------------------------------------------------

describe('template YAML files', () => {
  const langs = ['typescript', 'python', 'go', 'rust', 'java'];
  const templatesDir = join(import.meta.dirname, 'templates');

  for (const lang of langs) {
    it(`${lang}.yaml parses without error and has ≥2 constraints`, () => {
      const raw = readFileSync(join(templatesDir, `${lang}.yaml`), 'utf-8');
      const parsed = yaml.load(raw) as { constraints: Array<{ id: string; rule: string; severity: string }> };
      expect(parsed).toBeTruthy();
      expect(Array.isArray(parsed.constraints)).toBe(true);
      expect(parsed.constraints.length).toBeGreaterThanOrEqual(2);
      for (const c of parsed.constraints) {
        expect(c.id).toBeTruthy();
        expect(c.rule).toBeTruthy();
        expect(['critical', 'important', 'helpful']).toContain(c.severity);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// inferConstraints
// ---------------------------------------------------------------------------

describe('inferConstraints', () => {
  it('adds repository constraint when repository layer is present', () => {
    const ctx = emptyCodebaseContext();
    ctx.architecture.layers = ['api', 'service', 'repository'];
    const constraints = inferConstraints(ctx);
    expect(constraints.find(c => c.id === 'infer-repository-layer')).toBeDefined();
  });

  it('does not add repository constraint when layer is absent', () => {
    const ctx = emptyCodebaseContext();
    ctx.architecture.layers = ['api', 'service'];
    const constraints = inferConstraints(ctx);
    expect(constraints.find(c => c.id === 'infer-repository-layer')).toBeUndefined();
  });

  it('adds test-location constraint when testing.pattern is set', () => {
    const ctx = emptyCodebaseContext();
    ctx.testing.pattern = '*.test.ts';
    const constraints = inferConstraints(ctx);
    expect(constraints.find(c => c.id === 'infer-test-location')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// generateConstraints (integration)
// ---------------------------------------------------------------------------

describe('generateConstraints', () => {
  it('returns no duplicate ids', () => {
    const ctx = emptyCodebaseContext();
    ctx.stack.language = ['typescript'];
    ctx.architecture.layers = ['api', 'service', 'repository'];
    ctx.testing.pattern = '*.test.ts';

    const constraints = generateConstraints(ctx, '/tmp');
    const ids = constraints.map(c => c.id);
    const unique = new Set(ids);
    expect(ids.length).toBe(unique.size);
  });

  it('all returned constraints have required fields', () => {
    const ctx = emptyCodebaseContext();
    ctx.stack.language = ['typescript'];

    const constraints = generateConstraints(ctx, '/tmp');
    for (const c of constraints) {
      expect(c.id).toBeTruthy();
      expect(c.rule).toBeTruthy();
      expect(['critical', 'important', 'helpful']).toContain(c.severity);
      expect(c.scope).toBeTruthy();
      expect(c.source).toBeTruthy();
    }
  });
});
