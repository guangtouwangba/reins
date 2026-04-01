import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { filterByProfile, injectConstraints } from './constraint-injector.js';
import { runQA } from './qa.js';
import { logExecution } from './execution-logger.js';
import type { Constraint } from '../constraints/schema.js';
import type { InjectionContext, ExecutionRecord } from './types.js';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `reins-pipeline-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// filterByProfile
// ---------------------------------------------------------------------------

const testConstraints: Constraint[] = [
  { id: 'c1', rule: 'No SQL', severity: 'critical', scope: 'global', source: 'auto', enforcement: { soft: false, hook: false } },
  { id: 'c2', rule: 'Use types', severity: 'important', scope: 'global', source: 'auto', enforcement: { soft: true, hook: false } },
  { id: 'c3', rule: 'Prefer const', severity: 'helpful', scope: 'global', source: 'auto', enforcement: { soft: true, hook: false } },
];

describe('filterByProfile', () => {
  it('all / strict returns all constraints', () => {
    expect(filterByProfile(testConstraints, 'all')).toHaveLength(3);
    expect(filterByProfile(testConstraints, 'strict')).toHaveLength(3);
  });

  it('relaxed returns only critical', () => {
    const result = filterByProfile(testConstraints, 'relaxed');
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('c1');
  });

  it('default returns critical + important', () => {
    const result = filterByProfile(testConstraints, 'default');
    expect(result).toHaveLength(2);
    const ids = result.map(c => c.id);
    expect(ids).toContain('c1');
    expect(ids).toContain('c2');
  });

  it('unknown profile falls back to critical+important', () => {
    const result = filterByProfile(testConstraints, 'custom-unknown');
    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// injectConstraints
// ---------------------------------------------------------------------------

describe('injectConstraints', () => {
  const ctx: InjectionContext = {
    profile: 'default',
    constraints: testConstraints,
    hooks: [],
    pipeline: { stages: ['HARNESS_INIT', 'EXECUTION', 'QA'], pre_commit: [], post_develop: [] },
  };

  it('output contains the task string', () => {
    const result = injectConstraints('Fix the auth bug', ctx);
    expect(result).toContain('Fix the auth bug');
  });

  it('output contains only constraints for the profile', () => {
    const result = injectConstraints('task', ctx);
    // default profile: c1 + c2 (not c3)
    expect(result).toContain('c1');
    expect(result).toContain('c2');
    expect(result).not.toContain('c3');
  });

  it('output contains the stage sequence', () => {
    const result = injectConstraints('task', ctx);
    expect(result).toContain('HARNESS_INIT');
    expect(result).toContain('EXECUTION');
    expect(result).toContain('QA');
  });

  it('output contains the Active Constraints section header', () => {
    const result = injectConstraints('task', ctx);
    expect(result).toContain('## Active Constraints');
  });

  it('output contains block-mode hooks section', () => {
    const result = injectConstraints('task', ctx);
    expect(result).toContain('## Active Block-Mode Hooks');
  });
});

// ---------------------------------------------------------------------------
// runQA
// ---------------------------------------------------------------------------

describe('runQA', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('returns passed:true with empty results when no commands configured', async () => {
    const qaConfig = { pre_commit: [], post_develop: [] };
    const result = await runQA(tmpDir, qaConfig);
    expect(result.passed).toBe(true);
    expect(result.results).toHaveLength(0);
  });

  it('passes when all commands succeed', async () => {
    const qaConfig = { pre_commit: ['echo ok'], post_develop: [] };
    const result = await runQA(tmpDir, qaConfig);
    expect(result.passed).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.success).toBe(true);
  });

  it('stops on first failure', async () => {
    const qaConfig = { pre_commit: ['exit 1'], post_develop: ['echo should-not-run'] };
    const result = await runQA(tmpDir, qaConfig);
    expect(result.passed).toBe(false);
    expect(result.results).toHaveLength(1);
  });

  it('runs both pre_commit and post_develop commands', async () => {
    const qaConfig = { pre_commit: ['echo pre'], post_develop: ['echo post'] };
    const result = await runQA(tmpDir, qaConfig);
    expect(result.passed).toBe(true);
    expect(result.results).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// logExecution
// ---------------------------------------------------------------------------

describe('logExecution', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  const makeRecord = (task: string): ExecutionRecord => ({
    id: 'test-id',
    task,
    profile: 'default',
    durationSeconds: 5,
    outcome: 'success',
    stages: {},
    constraintsChecked: 3,
    constraintsViolated: 0,
    violations: [],
  });

  it('writes a YAML log file', () => {
    const path = logExecution(tmpDir, makeRecord('first task'));
    expect(existsSync(path)).toBe(true);
    expect(path.endsWith('.yaml')).toBe(true);
  });

  it('assigns sequence numbers 001 and 002 for two calls', () => {
    const path1 = logExecution(tmpDir, makeRecord('task one'));
    const path2 = logExecution(tmpDir, makeRecord('task two'));
    expect(path1).toContain('-001.yaml');
    expect(path2).toContain('-002.yaml');
  });

  it('creates the logs directory if absent', () => {
    const logsDir = join(tmpDir, '.reins', 'logs', 'executions');
    expect(existsSync(logsDir)).toBe(false);
    logExecution(tmpDir, makeRecord('test'));
    expect(existsSync(logsDir)).toBe(true);
  });
});
