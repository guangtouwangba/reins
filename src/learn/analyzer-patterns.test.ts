import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import { analyzeExecutions } from './analyzer.js';
import type { ExecutionObservation } from './observer.js';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `reins-analyzer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeObservation(overrides: Partial<ExecutionObservation>): ExecutionObservation {
  return {
    sessionId: `session-${Math.random().toString(36).slice(2)}`,
    taskDescription: 'test task',
    timestamp: new Date().toISOString(),
    duration: 10000,
    outcome: 'success',
    agentsUsed: [],
    toolsUsed: [],
    filesModified: [],
    testsRun: { total: 0, passed: 0, failed: 0 },
    errors: [],
    constraintViolations: [],
    learnings: [],
    ...overrides,
  };
}

function writeObservations(dir: string, observations: ExecutionObservation[]): void {
  const logsDir = join(dir, '.reins', 'logs', 'executions');
  mkdirSync(logsDir, { recursive: true });
  for (let i = 0; i < observations.length; i++) {
    writeFileSync(join(logsDir, `exec-2025-01-01-${i}.yaml`), yaml.dump(observations[i]), 'utf-8');
  }
}

let tmpDir: string;
beforeEach(() => { tmpDir = makeTmpDir(); });
afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

describe('efficient pattern detection', () => {
  it('returns empty patterns with <2 observations', async () => {
    writeObservations(tmpDir, [makeObservation({ duration: 5000 })]);
    const result = await analyzeExecutions(tmpDir);
    expect(result.patterns.efficientPatterns).toEqual([]);
  });

  it('detects tool usage patterns in fast vs slow sessions', async () => {
    const observations = [
      makeObservation({ duration: 2000, toolsUsed: [{ name: 'Grep', count: 5, errorRate: 0 }] }),
      makeObservation({ duration: 3000, toolsUsed: [{ name: 'Grep', count: 4, errorRate: 0 }] }),
      makeObservation({ duration: 15000, toolsUsed: [{ name: 'Grep', count: 1, errorRate: 0 }] }),
      makeObservation({ duration: 20000, toolsUsed: [{ name: 'Grep', count: 0, errorRate: 0 }] }),
    ];
    writeObservations(tmpDir, observations);
    const result = await analyzeExecutions(tmpDir);
    const grepPattern = result.patterns.efficientPatterns.find(p => p.pattern.includes('Grep'));
    expect(grepPattern).toBeDefined();
    expect(grepPattern!.speedup).toBeGreaterThan(1);
  });

  it('detects agent switch patterns', async () => {
    const observations = [
      makeObservation({ duration: 2000, agentsUsed: [{ name: 'executor', model: 'sonnet', duration: 1000, success: true }] }),
      makeObservation({ duration: 3000, agentsUsed: [{ name: 'executor', model: 'sonnet', duration: 2000, success: true }] }),
      makeObservation({
        duration: 20000,
        agentsUsed: [
          { name: 'planner', model: 'opus', duration: 5000, success: true },
          { name: 'executor', model: 'sonnet', duration: 5000, success: true },
          { name: 'reviewer', model: 'opus', duration: 5000, success: true },
        ],
      }),
      makeObservation({
        duration: 25000,
        agentsUsed: [
          { name: 'planner', model: 'opus', duration: 5000, success: true },
          { name: 'executor', model: 'sonnet', duration: 5000, success: true },
          { name: 'reviewer', model: 'opus', duration: 5000, success: true },
          { name: 'fixer', model: 'sonnet', duration: 5000, success: true },
        ],
      }),
    ];
    writeObservations(tmpDir, observations);
    const result = await analyzeExecutions(tmpDir);
    const switchPattern = result.patterns.efficientPatterns.find(p => p.pattern.includes('agent'));
    expect(switchPattern).toBeDefined();
  });

  it('no patterns when all sessions are similar speed', async () => {
    const observations = [
      makeObservation({ duration: 5000, toolsUsed: [{ name: 'Read', count: 3, errorRate: 0 }] }),
      makeObservation({ duration: 5100, toolsUsed: [{ name: 'Read', count: 3, errorRate: 0 }] }),
      makeObservation({ duration: 4900, toolsUsed: [{ name: 'Read', count: 3, errorRate: 0 }] }),
    ];
    writeObservations(tmpDir, observations);
    const result = await analyzeExecutions(tmpDir);
    expect(result.patterns.efficientPatterns).toEqual([]);
  });
});
