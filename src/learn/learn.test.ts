import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createObservation,
  recordAgentUsage,
  recordToolUsage,
  recordError,
  recordViolation,
  finalizeObservation,
  saveObservation,
  loadObservations,
} from './observer.js';
import { scoreSkillCandidate } from './scorer.js';
import { analyzeExecutions } from './analyzer.js';
import { executeActions } from './learner.js';
import { applyAction, appendChangelog } from './constraint-updater.js';
import type { ExecutionObservation } from './observer.js';
import type { Action } from './analyzer.js';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `reins-learn-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = makeTmpDir();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Observer
// ---------------------------------------------------------------------------

describe('observer', () => {
  it('createObservation returns correctly shaped object', () => {
    const obs = createObservation('sess-001', 'implement auth');
    expect(obs.sessionId).toBe('sess-001');
    expect(obs.taskDescription).toBe('implement auth');
    expect(obs.outcome).toBe('success');
    expect(obs.agentsUsed).toEqual([]);
    expect(obs.toolsUsed).toEqual([]);
    expect(obs.errors).toEqual([]);
    expect(obs.constraintViolations).toEqual([]);
    expect(obs.learnings).toEqual([]);
  });

  it('recordAgentUsage adds new agent', () => {
    const obs = createObservation('s1', 'task');
    recordAgentUsage(obs, { name: 'executor', model: 'sonnet', duration: 1000, success: true });
    expect(obs.agentsUsed.length).toBe(1);
    expect(obs.agentsUsed[0]!.name).toBe('executor');
  });

  it('recordAgentUsage accumulates duration for same agent', () => {
    const obs = createObservation('s1', 'task');
    recordAgentUsage(obs, { name: 'executor', model: 'sonnet', duration: 1000, success: true });
    recordAgentUsage(obs, { name: 'executor', model: 'sonnet', duration: 500, success: true });
    expect(obs.agentsUsed.length).toBe(1);
    expect(obs.agentsUsed[0]!.duration).toBe(1500);
  });

  it('recordToolUsage adds new tool', () => {
    const obs = createObservation('s1', 'task');
    recordToolUsage(obs, { name: 'Read', count: 5, errorRate: 0 });
    expect(obs.toolsUsed.length).toBe(1);
    expect(obs.toolsUsed[0]!.count).toBe(5);
  });

  it('recordError appends to errors array', () => {
    const obs = createObservation('s1', 'task');
    recordError(obs, { type: 'TypeError', message: 'Cannot read property' });
    expect(obs.errors.length).toBe(1);
    expect(obs.errors[0]!.type).toBe('TypeError');
  });

  it('recordViolation appends to constraintViolations', () => {
    const obs = createObservation('s1', 'task');
    recordViolation(obs, { rule: 'no-console', file: 'src/index.ts', description: 'console.log found' });
    expect(obs.constraintViolations.length).toBe(1);
  });

  it('finalizeObservation sets outcome and duration', () => {
    const obs = createObservation('s1', 'task');
    finalizeObservation(obs, 'failure');
    expect(obs.outcome).toBe('failure');
    expect(obs.duration).toBeGreaterThanOrEqual(0);
  });

  it('saveObservation writes yaml file', () => {
    const obs = createObservation('sess-abc', 'test task');
    saveObservation(tmpDir, obs);
    const dir = join(tmpDir, '.reins', 'logs', 'executions');
    expect(existsSync(dir)).toBe(true);
    const files = require('node:fs').readdirSync(dir) as string[];
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^exec-.*\.yaml$/);
  });

  it('loadObservations returns saved observations', () => {
    const obs = createObservation('sess-xyz', 'my task');
    saveObservation(tmpDir, obs);
    const loaded = loadObservations(tmpDir);
    expect(loaded.length).toBe(1);
    expect(loaded[0]!.sessionId).toBe('sess-xyz');
  });

  it('loadObservations returns empty array when directory absent', () => {
    const loaded = loadObservations(tmpDir);
    expect(loaded).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Scorer
// ---------------------------------------------------------------------------

describe('scorer', () => {
  it('returns base score 50 for minimal content with trigger', () => {
    // Has trigger (+0 for -25 penalty avoided), content < 50 chars (-20), no errors, no files
    // base 50, -20 short = 30; with trigger, no -25 → 30
    const score = scoreSkillCandidate({ content: 'short text', triggerPattern: 'when X' });
    expect(score).toBeLessThan(50);
  });

  it('penalizes missing trigger pattern', () => {
    const withTrigger = scoreSkillCandidate({
      content: 'A detailed skill content that is over 100 characters long and provides good information about error handling.',
      triggerPattern: 'when error occurs',
    });
    const withoutTrigger = scoreSkillCandidate({
      content: 'A detailed skill content that is over 100 characters long and provides good information about error handling.',
    });
    expect(withTrigger).toBeGreaterThan(withoutTrigger);
  });

  it('bonuses file paths', () => {
    const withFiles = scoreSkillCandidate({
      content: 'Use src/lib/utils.ts for utility functions. This is a detailed description.',
      triggerPattern: 'utility',
    });
    const withoutFiles = scoreSkillCandidate({
      content: 'Use utility functions in the codebase. This is a detailed description.',
      triggerPattern: 'utility',
    });
    expect(withFiles).toBeGreaterThan(withoutFiles);
  });

  it('bonuses error keywords', () => {
    const score = scoreSkillCandidate({
      content: 'This is a workaround for a broken error that causes a regression. The fix involves avoiding the root cause.',
      triggerPattern: 'regression fix',
    });
    expect(score).toBeGreaterThan(60);
  });

  it('penalizes generic phrases', () => {
    const generic = scoreSkillCandidate({
      content: 'try again if something goes wrong and check docs for more information about this error.',
      triggerPattern: 'error',
    });
    const specific = scoreSkillCandidate({
      content: 'When build fails due to missing env variable, set NEXT_PUBLIC_API_URL in .env.local file.',
      triggerPattern: 'build error',
    });
    expect(specific).toBeGreaterThan(generic);
  });

  it('bonuses repeat count', () => {
    const once = scoreSkillCandidate({ content: 'skill content here', triggerPattern: 'trigger', repeatCount: 0 });
    const thrice = scoreSkillCandidate({ content: 'skill content here', triggerPattern: 'trigger', repeatCount: 3 });
    expect(thrice).toBeGreaterThan(once);
  });

  it('caps repeat bonus at 30', () => {
    const many = scoreSkillCandidate({ content: 'skill content here', triggerPattern: 'trigger', repeatCount: 100 });
    const few = scoreSkillCandidate({ content: 'skill content here', triggerPattern: 'trigger', repeatCount: 3 });
    expect(many - few).toBeLessThanOrEqual(30);
  });

  it('returns 0 minimum', () => {
    const score = scoreSkillCandidate({ content: 'try again' });
    expect(score).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Analyzer
// ---------------------------------------------------------------------------

describe('analyzeExecutions', () => {
  it('returns empty analysis when no observations', async () => {
    const result = await analyzeExecutions(tmpDir);
    expect(result.metrics.successRate).toBe(0);
    expect(result.patterns.recurringErrors).toEqual([]);
    expect(result.suggestedActions).toEqual([]);
  });

  it('computes success rate from observations', async () => {
    const obs1 = createObservation('s1', 'task1');
    finalizeObservation(obs1, 'success');
    saveObservation(tmpDir, obs1);

    const obs2 = createObservation('s2', 'task2');
    finalizeObservation(obs2, 'failure');
    saveObservation(tmpDir, obs2);

    const result = await analyzeExecutions(tmpDir);
    expect(result.metrics.successRate).toBe(50);
  });

  it('detects recurring errors after 3+ occurrences', async () => {
    for (let i = 0; i < 4; i++) {
      const obs = createObservation(`s${i}`, `task${i}`);
      recordError(obs, { type: 'TypeError', message: 'Cannot read property x of undefined' });
      saveObservation(tmpDir, obs);
    }

    const result = await analyzeExecutions(tmpDir);
    expect(result.patterns.recurringErrors.length).toBeGreaterThan(0);
    expect(result.patterns.recurringErrors[0]!.frequency).toBeGreaterThanOrEqual(3);
  });

  it('suggests add_constraint for recurring errors', async () => {
    for (let i = 0; i < 3; i++) {
      const obs = createObservation(`sess${i}`, 'task');
      recordError(obs, { type: 'Error', message: 'missing null check causes crash' });
      saveObservation(tmpDir, obs);
    }
    const result = await analyzeExecutions(tmpDir);
    const addActions = result.suggestedActions.filter(a => a.type === 'add_constraint');
    expect(addActions.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Learner
// ---------------------------------------------------------------------------

describe('executeActions', () => {
  it('auto-applies high confidence actions (>85)', async () => {
    // Write a constraints.yaml so applyAction has something to work with
    mkdirSync(join(tmpDir, '.reins'), { recursive: true });

    const actions: Action[] = [
      { type: 'add_constraint', rule: 'no-direct-db-access', severity: 'error', confidence: 90 },
    ];
    const results = await executeActions(tmpDir, actions);
    expect(results[0]!.disposition).toBe('auto_applied');
  });

  it('suggests medium confidence actions (60-85)', async () => {
    const actions: Action[] = [
      { type: 'add_constraint', rule: 'prefer-async-await', severity: 'warning', confidence: 70 },
    ];
    const results = await executeActions(tmpDir, actions);
    expect(results[0]!.disposition).toBe('suggested');
    const pendingPath = join(tmpDir, '.reins', 'logs', 'pending-actions.yaml');
    expect(existsSync(pendingPath)).toBe(true);
  });

  it('logs low confidence actions (<60)', async () => {
    const actions: Action[] = [
      { type: 'add_constraint', rule: 'maybe-rule', severity: 'info', confidence: 40 },
    ];
    const results = await executeActions(tmpDir, actions);
    expect(results[0]!.disposition).toBe('logged');
    const lowPath = join(tmpDir, '.reins', 'logs', 'low-confidence.yaml');
    expect(existsSync(lowPath)).toBe(true);
  });

  it('returns empty array for empty actions', async () => {
    const results = await executeActions(tmpDir, []);
    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Constraint Updater
// ---------------------------------------------------------------------------

describe('constraint-updater', () => {
  it('applyAction add_constraint creates constraints.yaml if absent', () => {
    const action: Action = { type: 'add_constraint', rule: 'no-eval', severity: 'error', confidence: 90 };
    applyAction(tmpDir, action);
    const constraintsPath = join(tmpDir, '.reins', 'constraints.yaml');
    expect(existsSync(constraintsPath)).toBe(true);
    const content = readFileSync(constraintsPath, 'utf-8');
    expect(content).toContain('no-eval');
  });

  it('applyAction remove_constraint marks rule as deprecated', () => {
    // Create initial constraints file
    mkdirSync(join(tmpDir, '.reins'), { recursive: true });
    const yaml_content = 'version: 1\nrules:\n  - id: old-rule\n    rule: old-pattern\n    severity: warning\n';
    require('node:fs').writeFileSync(join(tmpDir, '.reins', 'constraints.yaml'), yaml_content, 'utf-8');

    const action: Action = { type: 'remove_constraint', rule: 'old-pattern', reason: 'no longer needed', confidence: 88 };
    applyAction(tmpDir, action);

    const content = readFileSync(join(tmpDir, '.reins', 'constraints.yaml'), 'utf-8');
    expect(content).toContain('deprecated');
  });

  it('appendChangelog writes changelog file', () => {
    const action: Action = { type: 'add_constraint', rule: 'test-rule', severity: 'error', confidence: 90 };
    appendChangelog(tmpDir, action, 'before', 'after');
    const changelogPath = join(tmpDir, '.reins', 'logs', 'constraint-changelog.yaml');
    expect(existsSync(changelogPath)).toBe(true);
  });

  it('applyAction create_skill writes to auto dir', () => {
    const action: Action = { type: 'create_skill', content: 'name: test-skill\ncontent: do something', confidence: 90 };
    applyAction(tmpDir, action);
    const autoDir = join(tmpDir, '.reins', 'skills', 'auto');
    expect(existsSync(autoDir)).toBe(true);
    const files = require('node:fs').readdirSync(autoDir) as string[];
    expect(files.length).toBeGreaterThan(0);
  });
});
