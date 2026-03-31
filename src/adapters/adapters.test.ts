import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runAdapters } from './base-adapter.js';
import { ClaudeMdAdapter } from './claude-md.js';
import { CursorRulesAdapter } from './cursor-rules.js';
import { CopilotInstructionsAdapter } from './copilot-instructions.js';
import { WindsurfRulesAdapter } from './windsurf-rules.js';
import { AgentsMdAdapter } from './agents-md.js';
import { DEFAULT_ADAPTERS } from './index.js';
import { emptyCodebaseContext } from '../scanner/types.js';
import type { Constraint, ConstraintsConfig } from '../constraints/schema.js';

function makeConstraint(overrides: Partial<Constraint> & { id: string; rule: string; severity: Constraint['severity'] }): Constraint {
  return {
    scope: 'global',
    source: 'auto',
    enforcement: { soft: true, hook: false },
    status: 'active',
    ...overrides,
  };
}

function makeConfig(name = 'test-project'): ConstraintsConfig {
  return {
    version: 1,
    generated_at: new Date().toISOString(),
    project: { name, type: 'application' },
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
    profiles: {},
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `reins-adapter-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// DEFAULT_ADAPTERS
// ---------------------------------------------------------------------------

describe('DEFAULT_ADAPTERS', () => {
  it('has 5 adapters', () => {
    expect(DEFAULT_ADAPTERS.length).toBe(5);
  });

  it('each adapter has a non-empty name and outputPath', () => {
    for (const adapter of DEFAULT_ADAPTERS) {
      expect(adapter.name).toBeTruthy();
      expect(adapter.outputPath).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// runAdapters (base-adapter orchestrator)
// ---------------------------------------------------------------------------

describe('runAdapters', () => {
  it('writes file to correct path', () => {
    const ctx = emptyCodebaseContext();
    const config = makeConfig();
    const mockAdapter = {
      name: 'mock',
      outputPath: 'mock-output.txt',
      generate: () => 'hello world',
    };

    const results = runAdapters(tmpDir, [], ctx, config, [mockAdapter]);
    expect(results[0]?.written).toBe(true);
    expect(existsSync(join(tmpDir, 'mock-output.txt'))).toBe(true);
    expect(readFileSync(join(tmpDir, 'mock-output.txt'), 'utf-8')).toBe('hello world');
  });

  it('skips write when content is identical (idempotency)', () => {
    const ctx = emptyCodebaseContext();
    const config = makeConfig();
    const content = 'identical content';
    writeFileSync(join(tmpDir, 'mock-output.txt'), content, 'utf-8');

    const mockAdapter = {
      name: 'mock',
      outputPath: 'mock-output.txt',
      generate: () => content,
    };

    const results = runAdapters(tmpDir, [], ctx, config, [mockAdapter]);
    expect(results[0]?.skipped).toBe(true);
    expect(results[0]?.written).toBe(false);
  });

  it('creates parent directories automatically', () => {
    const ctx = emptyCodebaseContext();
    const config = makeConfig();
    const mockAdapter = {
      name: 'mock',
      outputPath: '.github/deep/nested/file.md',
      generate: () => 'nested content',
    };

    runAdapters(tmpDir, [], ctx, config, [mockAdapter]);
    expect(existsSync(join(tmpDir, '.github/deep/nested/file.md'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CursorRulesAdapter
// ---------------------------------------------------------------------------

describe('CursorRulesAdapter', () => {
  it('generates output with correct severity sections in order', () => {
    const ctx = emptyCodebaseContext();
    const config = makeConfig();
    const constraints: Constraint[] = [
      makeConstraint({ id: 'c1', rule: 'No secrets in code', severity: 'critical' }),
      makeConstraint({ id: 'c2', rule: 'Use service layer', severity: 'important' }),
      makeConstraint({ id: 'c3', rule: 'Prefer functional style', severity: 'helpful' }),
    ];

    const output = CursorRulesAdapter.generate(constraints, ctx, config);
    expect(output).toContain('## Critical');
    expect(output).toContain('## Important');
    expect(output).toContain('## Helpful');
    expect(output).toContain('No secrets in code');
    expect(output).toContain('Use service layer');
    expect(output).toContain('Prefer functional style');

    // Critical appears before important in the output
    const critIdx = output.indexOf('## Critical');
    const impIdx = output.indexOf('## Important');
    expect(critIdx).toBeLessThan(impIdx);
  });
});

// ---------------------------------------------------------------------------
// CopilotInstructionsAdapter
// ---------------------------------------------------------------------------

describe('CopilotInstructionsAdapter', () => {
  it('generates output with all three section headers', () => {
    const ctx = emptyCodebaseContext();
    ctx.stack.language = ['typescript'];
    const config = makeConfig();
    const constraints: Constraint[] = [
      makeConstraint({ id: 'c1', rule: 'Never store credentials', severity: 'critical' }),
      makeConstraint({ id: 'c2', rule: 'Enforce service boundaries', severity: 'important' }),
      makeConstraint({ id: 'c3', rule: 'Use const by preference', severity: 'helpful' }),
    ];

    const output = CopilotInstructionsAdapter.generate(constraints, ctx, config);
    expect(output).toContain('## Critical Rules');
    expect(output).toContain('## Important Rules');
    expect(output).toContain('## Helpful Guidelines');
    expect(output).toContain('.reins/constraints.yaml');
  });
});

// ---------------------------------------------------------------------------
// WindsurfRulesAdapter
// ---------------------------------------------------------------------------

describe('WindsurfRulesAdapter', () => {
  it('generates output with correct severity tags', () => {
    const ctx = emptyCodebaseContext();
    const config = makeConfig();
    const constraints: Constraint[] = [
      makeConstraint({ id: 'c1', rule: 'Block SQL injection', severity: 'critical' }),
      makeConstraint({ id: 'c2', rule: 'Respect layer boundaries', severity: 'important' }),
      makeConstraint({ id: 'c3', rule: 'Use functional style', severity: 'helpful' }),
    ];

    const output = WindsurfRulesAdapter.generate(constraints, ctx, config);
    expect(output).toContain('[REQUIRED]');
    expect(output).toContain('[IMPORTANT]');
    expect(output).toContain('[GUIDELINE]');

    // Critical appears before helpful
    const reqIdx = output.indexOf('[REQUIRED]');
    const guideIdx = output.indexOf('[GUIDELINE]');
    expect(reqIdx).toBeLessThan(guideIdx);
  });
});

// ---------------------------------------------------------------------------
// ClaudeMdAdapter
// ---------------------------------------------------------------------------

describe('ClaudeMdAdapter', () => {
  it('generates output ≤ 50 lines with 3 critical constraints', () => {
    const ctx = emptyCodebaseContext();
    ctx.stack.language = ['typescript'];
    ctx.stack.packageManager = 'pnpm';
    const config = makeConfig();
    const constraints: Constraint[] = [
      makeConstraint({ id: 'c1', rule: 'Never expose API keys', severity: 'critical' }),
      makeConstraint({ id: 'c2', rule: 'Use repository for DB access', severity: 'critical' }),
      makeConstraint({ id: 'c3', rule: 'Validate all external input', severity: 'critical' }),
    ];

    const output = ClaudeMdAdapter.generate(constraints, ctx, config);
    const lines = output.split('\n');
    expect(lines.length).toBeLessThanOrEqual(51);
    expect(output).toContain('Never expose API keys');
    expect(output).toContain('Use repository for DB access');
    expect(output).toContain('Validate all external input');
  });
});

// ---------------------------------------------------------------------------
// AgentsMdAdapter
// ---------------------------------------------------------------------------

describe('AgentsMdAdapter', () => {
  it('generate() returns only important constraints', () => {
    const ctx = emptyCodebaseContext();
    const config = makeConfig();
    const constraints: Constraint[] = [
      makeConstraint({ id: 'c1', rule: 'Critical security rule', severity: 'critical' }),
      makeConstraint({ id: 'c2', rule: 'Important architecture rule', severity: 'important' }),
      makeConstraint({ id: 'c3', rule: 'Helpful style tip', severity: 'helpful' }),
    ];

    const output = AgentsMdAdapter.generate(constraints, ctx, config);
    expect(output).toContain('Important architecture rule');
    expect(output).not.toContain('Critical security rule');
    expect(output).not.toContain('Helpful style tip');
  });
});
