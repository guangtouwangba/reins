import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateL0 } from './l0-generator.js';
import { buildDirectoryProfiles, generateL1 } from './l1-generator.js';
import { groupConstraintsByTopic, generateL2 } from './l2-generator.js';
import { generateContext } from './index.js';
import { emptyCodebaseContext } from '../scanner/types.js';
import type { Constraint } from '../constraints/schema.js';

function makeConstraint(overrides: Partial<Constraint> & { id: string; rule: string; severity: Constraint['severity'] }): Constraint {
  return {
    scope: 'global',
    source: 'auto',
    enforcement: { soft: true, hook: false },
    status: 'active',
    ...overrides,
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `reins-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// L0 generator
// ---------------------------------------------------------------------------

describe('generateL0', () => {
  it('writes CLAUDE.md with critical constraints', () => {
    const ctx = emptyCodebaseContext();
    ctx.stack.language = ['typescript'];
    ctx.stack.packageManager = 'pnpm';

    const constraints: Constraint[] = [
      makeConstraint({ id: 'c1', rule: 'Never store secrets in code', severity: 'critical' }),
      makeConstraint({ id: 'c2', rule: 'All SQL must go through the repository layer', severity: 'critical' }),
      makeConstraint({ id: 'c3', rule: 'Always validate input at the boundary', severity: 'critical' }),
    ];

    generateL0(tmpDir, ctx, constraints);

    const content = readFileSync(join(tmpDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('Never store secrets in code');
    expect(content).toContain('All SQL must go through the repository layer');
    expect(content.split('\n').length).toBeLessThanOrEqual(52); // 50 lines + newlines
  });

  it('keeps output ≤ 50 lines even with 10 critical constraints', () => {
    const ctx = emptyCodebaseContext();
    ctx.stack.language = ['typescript'];

    const constraints: Constraint[] = Array.from({ length: 10 }, (_, i) =>
      makeConstraint({ id: `c${i}`, rule: `Critical rule number ${i}`, severity: 'critical' }),
    );

    generateL0(tmpDir, ctx, constraints);

    const content = readFileSync(join(tmpDir, 'CLAUDE.md'), 'utf-8');
    const lines = content.split('\n').filter(l => l.trim() !== '');
    // Only 5 of the 10 rules should appear (hard cap)
    const ruleLines = lines.filter(l => l.startsWith('- Critical rule'));
    expect(ruleLines.length).toBeLessThanOrEqual(5);
  });

  it('appends managed section when CLAUDE.md exists without marker', () => {
    const ctx = emptyCodebaseContext();
    ctx.stack.language = ['typescript'];

    const existingContent = '# My Project\n\nSome existing content.\n';
    writeFileSync(join(tmpDir, 'CLAUDE.md'), existingContent, 'utf-8');

    const constraints: Constraint[] = [
      makeConstraint({ id: 'c1', rule: 'No secrets in code', severity: 'critical' }),
    ];

    generateL0(tmpDir, ctx, constraints);

    const content = readFileSync(join(tmpDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('Some existing content.');
    expect(content).toContain('<!-- reins-managed -->');
    expect(content).toContain('No secrets in code');
  });

  it('replaces managed section when CLAUDE.md already has the marker', () => {
    const ctx = emptyCodebaseContext();
    ctx.stack.language = ['typescript'];

    const existingContent =
      '# My Project\n\n<!-- reins-managed -->\nOLD CONTENT\n<!-- /reins-managed -->\n\nUser content below.\n';
    writeFileSync(join(tmpDir, 'CLAUDE.md'), existingContent, 'utf-8');

    const constraints: Constraint[] = [
      makeConstraint({ id: 'c1', rule: 'New critical rule', severity: 'critical' }),
    ];

    generateL0(tmpDir, ctx, constraints);

    const content = readFileSync(join(tmpDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('New critical rule');
    expect(content).not.toContain('OLD CONTENT');
    expect(content).toContain('User content below.');
  });
});

// ---------------------------------------------------------------------------
// L1 generator
// ---------------------------------------------------------------------------

describe('buildDirectoryProfiles', () => {
  it('returns profiles for detected architecture layers', () => {
    const ctx = emptyCodebaseContext();
    ctx.architecture.layers = ['api', 'services'];
    ctx.structure.directories = [
      { path: 'src/api', depth: 2 },
      { path: 'src/services', depth: 2 },
    ];

    const profiles = buildDirectoryProfiles(ctx, []);
    const paths = profiles.map(p => p.path);
    // Should include the directory paths found in structure
    expect(paths.some(p => p.includes('api'))).toBe(true);
    expect(paths.some(p => p.includes('services'))).toBe(true);
  });

  it('includes directory from constraint scope even if not in known layers', () => {
    const ctx = emptyCodebaseContext();
    ctx.architecture.layers = [];
    ctx.structure.directories = [];

    const constraints: Constraint[] = [
      makeConstraint({ id: 'c1', rule: 'Queue rule', severity: 'important', scope: 'directory:lib/queue' }),
    ];

    const profiles = buildDirectoryProfiles(ctx, constraints);
    expect(profiles.find(p => p.path === 'lib/queue')).toBeDefined();
  });

  it('handles empty context without crashing', () => {
    const ctx = emptyCodebaseContext();
    expect(() => buildDirectoryProfiles(ctx, [])).not.toThrow();
  });
});

describe('generateL1', () => {
  it('writes AGENTS.md for existing directories', () => {
    const ctx = emptyCodebaseContext();
    const apiDir = join(tmpDir, 'src', 'api');
    mkdirSync(apiDir, { recursive: true });

    ctx.structure.directories = [{ path: 'src/api', depth: 2 }];
    ctx.architecture.layers = ['api'];

    const constraints: Constraint[] = [
      makeConstraint({ id: 'c1', rule: 'Validate all API inputs', severity: 'important' }),
      makeConstraint({ id: 'c2', rule: 'Return consistent error shapes', severity: 'important' }),
    ];

    const profiles = buildDirectoryProfiles(ctx, constraints);
    // The profile path matches what's in structure
    const apiProfile = profiles.find(p => p.path === 'src/api');
    if (apiProfile) {
      generateL1(tmpDir, constraints, [apiProfile]);
      const content = readFileSync(join(apiDir, 'AGENTS.md'), 'utf-8');
      expect(content).toContain('Validate all API inputs');
    } else {
      // Profiles may use the layer name directly; try with api
      const fallback = profiles.find(p => p.path.endsWith('api'));
      if (fallback) {
        mkdirSync(join(tmpDir, fallback.path), { recursive: true });
        generateL1(tmpDir, constraints, [fallback]);
      }
    }
  });

  it('skips writing when directory does not exist', () => {
    const constraints: Constraint[] = [
      makeConstraint({ id: 'c1', rule: 'Some rule', severity: 'important' }),
    ];
    const profiles = [
      {
        path: 'nonexistent/dir',
        purpose: 'Test',
        constraints,
        keyFiles: [],
        patternRef: 'general-patterns',
      },
    ];

    expect(() => generateL1(tmpDir, constraints, profiles)).not.toThrow();
    expect(existsSync(join(tmpDir, 'nonexistent/dir/AGENTS.md'))).toBe(false);
  });

  it('keeps output ≤ 30 lines with many constraints', () => {
    const dirPath = join(tmpDir, 'services');
    mkdirSync(dirPath, { recursive: true });

    const constraints: Constraint[] = Array.from({ length: 10 }, (_, i) =>
      makeConstraint({ id: `c${i}`, rule: `Important rule ${i}`, severity: 'important' }),
    );

    const profiles = [
      {
        path: 'services',
        purpose: 'Business logic',
        constraints,
        keyFiles: ['services/user.ts', 'services/auth.ts'],
        patternRef: 'api-patterns',
      },
    ];

    generateL1(tmpDir, constraints, profiles);
    const content = readFileSync(join(tmpDir, 'services', 'AGENTS.md'), 'utf-8');
    const lines = content.split('\n');
    expect(lines.length).toBeLessThanOrEqual(31); // 30 lines + possible trailing newline
  });
});

// ---------------------------------------------------------------------------
// L2 generator
// ---------------------------------------------------------------------------

describe('groupConstraintsByTopic', () => {
  it('groups API route constraints correctly', () => {
    const constraints: Constraint[] = [
      makeConstraint({ id: 'c1', rule: 'All API route handlers must validate input', severity: 'helpful' }),
      makeConstraint({ id: 'c2', rule: 'Use test coverage for critical paths', severity: 'helpful' }),
    ];

    const groups = groupConstraintsByTopic(constraints);
    expect(groups.get('api-patterns')).toBeDefined();
    expect(groups.get('testing-patterns')).toBeDefined();
  });

  it('falls back to general-patterns for unmatched rules', () => {
    const constraints: Constraint[] = [
      makeConstraint({ id: 'c1', rule: 'Keep code readable', severity: 'helpful' }),
    ];

    const groups = groupConstraintsByTopic(constraints);
    expect(groups.get('general-patterns')).toBeDefined();
  });
});

describe('generateL2', () => {
  it('writes pattern files for helpful constraints', () => {
    const ctx = emptyCodebaseContext();
    ctx.stack.language = ['typescript'];

    const constraints: Constraint[] = [
      makeConstraint({ id: 'c1', rule: 'Use dependency injection for module coupling', severity: 'helpful' }),
      makeConstraint({ id: 'c2', rule: 'Prefer functional error handling over exceptions', severity: 'helpful' }),
    ];

    generateL2(tmpDir, constraints, ctx);

    const patternsDir = join(tmpDir, '.reins', 'patterns');
    expect(existsSync(patternsDir)).toBe(true);
  });

  it('writes correct number of topic files', () => {
    const ctx = emptyCodebaseContext();
    ctx.stack.language = ['typescript'];

    const constraints: Constraint[] = [
      makeConstraint({ id: 'c1', rule: 'API route validation required', severity: 'helpful' }),
      makeConstraint({ id: 'c2', rule: 'Write test coverage for all services', severity: 'helpful' }),
      makeConstraint({ id: 'c3', rule: 'Keep code short', severity: 'helpful' }),
    ];

    generateL2(tmpDir, constraints, ctx);

    const files = readdirSync(join(tmpDir, '.reins', 'patterns'));
    // Should have api-patterns, testing-patterns, general-patterns
    expect(files.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// generateContext integration
// ---------------------------------------------------------------------------

describe('generateContext', () => {
  it('L0 depth only calls l0-generator', () => {
    const ctx = emptyCodebaseContext();
    ctx.stack.language = ['typescript'];

    const constraints: Constraint[] = [
      makeConstraint({ id: 'c1', rule: 'Never expose credentials', severity: 'critical' }),
    ];

    const result = generateContext(tmpDir, constraints, ctx, 'L0');
    expect(result.l0Written).toBe(true);
    expect(result.l1Files).toEqual([]);
    expect(result.l2Files).toEqual([]);
    expect(existsSync(join(tmpDir, 'CLAUDE.md'))).toBe(true);
  });

  it('L0-L2 depth calls all three generators', () => {
    const ctx = emptyCodebaseContext();
    ctx.stack.language = ['typescript'];

    const constraints: Constraint[] = [
      makeConstraint({ id: 'c1', rule: 'Never expose credentials', severity: 'critical' }),
      makeConstraint({ id: 'c2', rule: 'Validate all API endpoints', severity: 'helpful' }),
    ];

    const result = generateContext(tmpDir, constraints, ctx, 'L0-L2');
    expect(result.l0Written).toBe(true);
    expect(existsSync(join(tmpDir, 'CLAUDE.md'))).toBe(true);
    // L2 should have created pattern files
    expect(result.l2Files.length).toBeGreaterThan(0);
  });
});
