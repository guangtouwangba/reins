import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import type { ConstraintsConfig } from '../constraints/schema.js';

let tmpDir: string;
let consoleSpy: ReturnType<typeof vi.spyOn>;
let cwdSpy: ReturnType<typeof vi.spyOn>;

function makeConstraintsYaml(constraints: unknown[]): string {
  const config: Partial<ConstraintsConfig> = {
    version: 1,
    generated_at: new Date().toISOString(),
    project: { name: 'test', type: 'app' },
    stack: { primary_language: 'typescript', framework: 'none', test_framework: 'vitest', package_manager: 'pnpm' },
    constraints: constraints as ConstraintsConfig['constraints'],
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
  return yaml.dump(config);
}

beforeEach(() => {
  tmpDir = join(tmpdir(), `reins-status-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(join(tmpDir, '.reins'), { recursive: true });

  consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  consoleSpy.mockRestore();
  cwdSpy.mockRestore();
});

describe('runStatus', () => {
  it('prints message when no constraints.yaml exists', async () => {
    const { runStatus } = await import('./status.js');
    await runStatus({});
    const output = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
    expect(output).toContain('reins init');
  });

  it('prints constraint summary with counts', async () => {
    const constraints = [
      { id: 'c1', rule: 'Rule 1', severity: 'critical', scope: 'global', source: 'auto', enforcement: { soft: true, hook: false }, status: 'active' },
      { id: 'c2', rule: 'Rule 2', severity: 'important', scope: 'global', source: 'auto', enforcement: { soft: true, hook: false }, status: 'active' },
      { id: 'c3', rule: 'Rule 3', severity: 'helpful', scope: 'global', source: 'auto', enforcement: { soft: true, hook: false }, status: 'active' },
    ];
    writeFileSync(join(tmpDir, '.reins', 'constraints.yaml'), makeConstraintsYaml(constraints), 'utf-8');

    const { runStatus } = await import('./status.js');
    await runStatus({});

    const output = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
    expect(output).toContain('1 critical');
    expect(output).toContain('1 important');
    expect(output).toContain('1 helpful');
  });

  it('outputs JSON when format is json', async () => {
    const constraints = [
      { id: 'c1', rule: 'Rule 1', severity: 'critical', scope: 'global', source: 'auto', enforcement: { soft: true, hook: false }, status: 'active' },
    ];
    writeFileSync(join(tmpDir, '.reins', 'constraints.yaml'), makeConstraintsYaml(constraints), 'utf-8');

    const { runStatus } = await import('./status.js');
    await runStatus({ format: 'json' });

    const allOutput = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
    let parsed: unknown;
    expect(() => { parsed = JSON.parse(allOutput); }).not.toThrow();
    expect((parsed as { summary: unknown }).summary).toBeDefined();
  });

  it('uses observational language for zero-violation suggestions', async () => {
    const constraints = [
      { id: 'c1', rule: 'Rule 1', severity: 'critical', scope: 'global', source: 'auto', enforcement: { soft: true, hook: false }, status: 'active' },
    ];
    writeFileSync(join(tmpDir, '.reins', 'constraints.yaml'), makeConstraintsYaml(constraints), 'utf-8');

    const { runStatus } = await import('./status.js');
    await runStatus({});

    const output = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
    // Should NOT contain "Consider relaxing" language
    expect(output).not.toContain('Consider relaxing');
    // Zero-violation note should use observational language
    if (output.includes('c1')) {
      expect(output).not.toContain('Consider');
    }
  });

  it('filters by severity when --filter is provided', async () => {
    const constraints = [
      { id: 'c1', rule: 'Rule 1', severity: 'critical', scope: 'global', source: 'auto', enforcement: { soft: true, hook: false }, status: 'active' },
      { id: 'c2', rule: 'Rule 2', severity: 'helpful', scope: 'global', source: 'auto', enforcement: { soft: true, hook: false }, status: 'active' },
    ];
    writeFileSync(join(tmpDir, '.reins', 'constraints.yaml'), makeConstraintsYaml(constraints), 'utf-8');

    const { runStatus } = await import('./status.js');
    await runStatus({ filter: 'critical' });

    const output = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
    expect(output).toContain('c1');
    expect(output).not.toContain('c2');
  });
});
