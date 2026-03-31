import { describe, it, expect } from 'vitest';
import { getProfile, filterConstraintsByProfile } from './profiles.js';
import { mergeConstraints } from './merger.js';
import type { Constraint, ConstraintsConfig } from './schema.js';

function makeConfig(profiles: Record<string, unknown> = {}): ConstraintsConfig {
  return {
    version: 1,
    generated_at: new Date().toISOString(),
    project: { name: 'test', type: 'app' },
    stack: { primary_language: 'typescript', framework: 'none', test_framework: 'vitest', package_manager: 'pnpm' },
    constraints: [],
    pipeline: {
      planning: 'ultrathink',
      execution: 'default',
      verification: { engine: 'reins', max_iterations: 3 },
      qa: true,
      pre_commit: [],
      post_develop: [],
    },
    profiles: profiles as ConstraintsConfig['profiles'],
  };
}

function makeConstraint(id: string, severity: 'critical' | 'important' | 'helpful', source: 'auto' | 'manual' | 'learned' = 'auto'): Constraint {
  return {
    id,
    rule: `Rule for ${id}`,
    severity,
    scope: 'global',
    source,
    enforcement: { soft: true, hook: false },
    status: 'active',
  };
}

const allConstraints: Constraint[] = [
  makeConstraint('c1', 'critical'),
  makeConstraint('c2', 'important'),
  makeConstraint('c3', 'helpful'),
];

describe('getProfile', () => {
  it('returns strict built-in profile', () => {
    const config = makeConfig();
    const profile = getProfile('strict', config);
    expect(profile.constraints).toBe('all');
  });

  it('returns default built-in profile', () => {
    const config = makeConfig();
    const profile = getProfile('default', config);
    expect(profile.constraints).toContain('critical');
    expect(profile.constraints).toContain('important');
  });

  it('returns relaxed built-in profile', () => {
    const config = makeConfig();
    const profile = getProfile('relaxed', config);
    expect(Array.isArray(profile.constraints)).toBe(true);
    expect((profile.constraints as string[]).includes('critical')).toBe(true);
    expect((profile.constraints as string[]).includes('important')).toBe(false);
  });

  it('returns ci built-in profile with json output_format', () => {
    const config = makeConfig();
    const profile = getProfile('ci', config);
    expect(profile.output_format).toBe('json');
  });

  it('falls back to default for unknown profile', () => {
    const config = makeConfig();
    const profile = getProfile('nonexistent', config);
    expect(profile.constraints).toContain('critical');
  });

  it('uses user-defined profile over built-in', () => {
    const config = makeConfig({
      strict: { constraints: ['critical'], hooks: [], pipeline: [] },
    });
    const profile = getProfile('strict', config);
    // User override: only critical
    expect(profile.constraints).toEqual(['critical']);
  });
});

describe('filterConstraintsByProfile', () => {
  it('strict profile returns all constraints', () => {
    const config = makeConfig();
    const result = filterConstraintsByProfile(allConstraints, 'strict', config);
    expect(result.length).toBe(3);
  });

  it('default profile returns critical + important', () => {
    const config = makeConfig();
    const result = filterConstraintsByProfile(allConstraints, 'default', config);
    expect(result.length).toBe(2);
    expect(result.every(c => c.severity !== 'helpful')).toBe(true);
  });

  it('relaxed profile returns only critical', () => {
    const config = makeConfig();
    const result = filterConstraintsByProfile(allConstraints, 'relaxed', config);
    expect(result.length).toBe(1);
    expect(result[0]!.severity).toBe('critical');
  });

  it('ci profile returns all (constraints: all)', () => {
    const config = makeConfig();
    const result = filterConstraintsByProfile(allConstraints, 'ci', config);
    expect(result.length).toBe(3);
  });
});

describe('mergeConstraints', () => {
  it('keeps manual constraints regardless of incoming', () => {
    const existing = [makeConstraint('m1', 'critical', 'manual')];
    const incoming: Constraint[] = [];
    const result = mergeConstraints(existing, incoming);
    expect(result.kept.length).toBe(1);
    expect(result.kept[0]!.id).toBe('m1');
    expect(result.deprecated.length).toBe(0);
  });

  it('keeps unchanged auto constraints', () => {
    const c = makeConstraint('a1', 'critical', 'auto');
    const result = mergeConstraints([c], [c]);
    expect(result.kept.length).toBe(1);
    expect(result.added.length).toBe(0);
    expect(result.deprecated.length).toBe(0);
  });

  it('marks missing auto constraint as deprecated', () => {
    const existing = [makeConstraint('old', 'important', 'auto')];
    const incoming: Constraint[] = [];
    const result = mergeConstraints(existing, incoming);
    expect(result.deprecated.length).toBe(1);
    expect(result.deprecated[0]!.status).toBe('deprecated');
  });

  it('adds new incoming constraint as draft', () => {
    const incoming = [makeConstraint('new1', 'helpful', 'auto')];
    const result = mergeConstraints([], incoming);
    expect(result.added.length).toBe(1);
    expect(result.added[0]!.status).toBe('draft');
    expect(result.added[0]!.source).toBe('auto');
  });

  it('detects conflict when rule text differs', () => {
    const existing: Constraint = { ...makeConstraint('c1', 'critical', 'auto'), rule: 'Old rule text' };
    const incoming: Constraint = { ...makeConstraint('c1', 'critical', 'auto'), rule: 'New rule text' };
    const result = mergeConstraints([existing], [incoming]);
    expect(result.conflicts.length).toBe(1);
    expect(result.conflicts[0]!.existing.id).toBe('c1');
  });

  it('does not conflict manual constraints', () => {
    const existing: Constraint = { ...makeConstraint('m1', 'critical', 'manual'), rule: 'Old rule' };
    const incoming: Constraint = { ...makeConstraint('m1', 'critical', 'auto'), rule: 'New rule' };
    const result = mergeConstraints([existing], [incoming]);
    expect(result.conflicts.length).toBe(0);
    expect(result.kept.some(k => k.id === 'm1')).toBe(true);
  });

  it('handles complex merge scenario', () => {
    const existing: Constraint[] = [
      makeConstraint('manual1', 'critical', 'manual'),
      makeConstraint('auto1', 'important', 'auto'),
      makeConstraint('going-away', 'helpful', 'auto'),
      { ...makeConstraint('conflict1', 'critical', 'auto'), rule: 'Old rule' },
    ];
    const incoming: Constraint[] = [
      makeConstraint('manual1', 'critical', 'auto'), // manual source wins
      makeConstraint('auto1', 'important', 'auto'),  // unchanged → kept
      makeConstraint('new1', 'helpful', 'auto'),     // new → added
      { ...makeConstraint('conflict1', 'critical', 'auto'), rule: 'New rule' }, // conflict
      // going-away is absent → deprecated
    ];

    const result = mergeConstraints(existing, incoming);
    expect(result.kept.some(k => k.id === 'manual1')).toBe(true);
    expect(result.kept.some(k => k.id === 'auto1')).toBe(true);
    expect(result.added.some(a => a.id === 'new1')).toBe(true);
    expect(result.deprecated.some(d => d.id === 'going-away')).toBe(true);
    expect(result.conflicts.some(c => c.existing.id === 'conflict1')).toBe(true);
  });
});
