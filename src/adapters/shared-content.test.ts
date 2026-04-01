import { describe, it, expect } from 'vitest';
import { buildSharedContent } from './shared-content.js';
import { emptyCodebaseContext, emptyCommandMap } from '../scanner/types.js';
import type { Constraint, ConstraintsConfig } from '../constraints/schema.js';

function makeConfig(): ConstraintsConfig {
  return {
    version: 1,
    generated_at: '',
    project: { name: 'test-project', type: 'app' },
    stack: { primary_language: 'typescript', framework: 'none', test_framework: 'vitest', package_manager: 'pnpm' },
    constraints: [],
    pipeline: { planning: '', execution: '', verification: { engine: '', max_iterations: 0 }, qa: true, pre_commit: [], post_develop: [] },
    profiles: {},
  };
}

function makeConstraint(id: string, severity: 'critical' | 'important' | 'helpful'): Constraint {
  return { id, rule: `Rule for ${id}`, severity, scope: 'global', source: 'auto', enforcement: { soft: true, hook: false } };
}

describe('buildSharedContent', () => {
  it('groups constraints by severity correctly', () => {
    const constraints = [
      makeConstraint('c1', 'critical'),
      makeConstraint('c2', 'important'),
      makeConstraint('c3', 'helpful'),
    ];
    const content = buildSharedContent(constraints, emptyCodebaseContext(), makeConfig());
    expect(content.criticalRules).toHaveLength(1);
    expect(content.importantRules).toHaveLength(1);
    expect(content.helpfulRules).toHaveLength(1);
    expect(content.constraintCount).toEqual({ critical: 1, important: 1, helpful: 1 });
  });

  it('returns empty arrays with no constraints', () => {
    const content = buildSharedContent([], emptyCodebaseContext(), makeConfig());
    expect(content.criticalRules).toHaveLength(0);
    expect(content.importantRules).toHaveLength(0);
    expect(content.helpfulRules).toHaveLength(0);
  });

  it('builds commands block from context.commands', () => {
    const ctx = emptyCodebaseContext();
    ctx.commands = {
      ...emptyCommandMap(),
      build: { command: 'pnpm run build', source: 'script', confidence: 1.0 },
      test: { command: 'pnpm run test', source: 'script', confidence: 1.0 },
      lint: { command: 'pnpm run lint', source: 'user', confidence: 1.0 },
    };
    const content = buildSharedContent([], ctx, makeConfig());
    expect(content.commandsBlock).toContain('pnpm run build');
    expect(content.commandsBlock).toContain('pnpm run test');
    expect(content.commandsBlock).toContain('(declared)');
  });

  it('produces project summary from stack info', () => {
    const ctx = emptyCodebaseContext();
    ctx.stack.framework = ['React'];
    ctx.stack.language = ['TypeScript'];
    ctx.stack.packageManager = 'pnpm';
    const content = buildSharedContent([], ctx, makeConfig());
    expect(content.projectSummary).toContain('React');
    expect(content.projectSummary).toContain('TypeScript');
    expect(content.projectSummary).toContain('pnpm');
  });
});
