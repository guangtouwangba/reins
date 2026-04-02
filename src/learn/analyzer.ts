import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { loadObservations } from './observer.js';
import type { ExecutionObservation } from './observer.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Metrics {
  avgDuration: number;
  successRate: number;
  avgRetries: number;
}

export interface RecurringError {
  error: string;
  frequency: number;
  suggestedConstraint: string;
}

export interface IgnoredConstraint {
  rule: string;
  violationRate: number;
  suggestion: 'strengthen' | 'remove';
}

export interface EfficientPattern {
  pattern: string;
  speedup: number;
}

export interface Patterns {
  recurringErrors: RecurringError[];
  ignoredConstraints: IgnoredConstraint[];
  efficientPatterns: EfficientPattern[];
}

export type Action =
  | { type: 'add_constraint'; rule: string; severity: string; confidence: number }
  | { type: 'remove_constraint'; rule: string; reason: string; confidence: number }
  | { type: 'create_skill'; content: string; confidence: number }
  | { type: 'add_hook'; constraintId: string; confidence: number };

export interface AnalysisResult {
  metrics: Metrics;
  patterns: Patterns;
  suggestedActions: Action[];
}

// ---------------------------------------------------------------------------
// detectEfficientPatterns
// ---------------------------------------------------------------------------

function detectEfficientPatterns(observations: ExecutionObservation[]): EfficientPattern[] {
  if (observations.length < 2) return [];

  // Split observations into fast and slow groups by median duration
  const sorted = [...observations].sort((a, b) => a.duration - b.duration);
  const median = sorted[Math.floor(sorted.length / 2)]!.duration;

  const fast = observations.filter(o => o.duration <= median && o.outcome === 'success');
  const slow = observations.filter(o => o.duration > median);

  if (fast.length === 0 || slow.length === 0) return [];

  // Count tool usage frequency in fast vs slow groups
  const fastToolCounts = new Map<string, number>();
  const slowToolCounts = new Map<string, number>();

  for (const obs of fast) {
    for (const tool of obs.toolsUsed) {
      fastToolCounts.set(tool.name, (fastToolCounts.get(tool.name) ?? 0) + tool.count);
    }
  }
  for (const obs of slow) {
    for (const tool of obs.toolsUsed) {
      slowToolCounts.set(tool.name, (slowToolCounts.get(tool.name) ?? 0) + tool.count);
    }
  }

  const patterns: EfficientPattern[] = [];

  // Tools used more in fast sessions (normalized per session)
  for (const [tool, fastCount] of fastToolCounts) {
    const slowCount = slowToolCounts.get(tool) ?? 0;
    const fastRate = fastCount / fast.length;
    const slowRate = slowCount / slow.length;

    if (fastRate > slowRate * 1.5 && fastRate >= 2) {
      patterns.push({
        pattern: `Tool "${tool}" correlates with faster completions (${fastRate.toFixed(1)}/session vs ${slowRate.toFixed(1)}/session)`,
        speedup: fastRate / Math.max(slowRate, 0.1),
      });
    }
  }

  // Fast sessions with fewer agent switches
  const avgFastAgents = fast.reduce((s, o) => s + o.agentsUsed.length, 0) / fast.length;
  const avgSlowAgents = slow.reduce((s, o) => s + o.agentsUsed.length, 0) / slow.length;

  if (avgSlowAgents > avgFastAgents * 1.5 && avgSlowAgents >= 2) {
    patterns.push({
      pattern: `Fewer agent switches correlate with speed (fast: ${avgFastAgents.toFixed(1)}, slow: ${avgSlowAgents.toFixed(1)})`,
      speedup: avgSlowAgents / Math.max(avgFastAgents, 0.1),
    });
  }

  return patterns;
}

// ---------------------------------------------------------------------------
// analyzeExecutions
// ---------------------------------------------------------------------------

export async function analyzeExecutions(projectRoot: string): Promise<AnalysisResult> {
  const observations = loadObservations(projectRoot);

  if (observations.length === 0) {
    return {
      metrics: { avgDuration: 0, successRate: 0, avgRetries: 0 },
      patterns: { recurringErrors: [], ignoredConstraints: [], efficientPatterns: [] },
      suggestedActions: [],
    };
  }

  // Metrics
  const totalDuration = observations.reduce((sum, o) => sum + o.duration, 0);
  const avgDuration = totalDuration / observations.length;
  const successCount = observations.filter(o => o.outcome === 'success').length;
  const successRate = (successCount / observations.length) * 100;
  const avgRetries = 0; // retries not tracked in current observation schema

  // Recurring errors: count by error message, threshold >= 3
  const errorCounts = new Map<string, number>();
  for (const obs of observations) {
    for (const err of obs.errors) {
      const key = err.message;
      errorCounts.set(key, (errorCounts.get(key) ?? 0) + 1);
    }
  }

  const recurringErrors: RecurringError[] = [];
  for (const [errorMsg, freq] of errorCounts.entries()) {
    if (freq >= 3) {
      recurringErrors.push({
        error: errorMsg,
        frequency: freq,
        suggestedConstraint: `Prevent recurring error: ${errorMsg.slice(0, 80)}`,
      });
    }
  }

  // Ignored constraints: rules violated >= 50% of sessions with violations
  const violationCounts = new Map<string, number>();
  let sessionsWithViolations = 0;
  for (const obs of observations) {
    if (obs.constraintViolations.length > 0) {
      sessionsWithViolations++;
      for (const v of obs.constraintViolations) {
        violationCounts.set(v.rule, (violationCounts.get(v.rule) ?? 0) + 1);
      }
    }
  }

  const ignoredConstraints: IgnoredConstraint[] = [];
  if (sessionsWithViolations > 0) {
    for (const [rule, count] of violationCounts.entries()) {
      const violationRate = count / observations.length;
      if (violationRate >= 0.5) {
        ignoredConstraints.push({
          rule,
          violationRate,
          suggestion: violationRate >= 0.8 ? 'remove' : 'strengthen',
        });
      }
    }
  }

  const efficientPatterns = detectEfficientPatterns(observations);

  // Build suggested actions from patterns
  const suggestedActions: Action[] = [];

  for (const re of recurringErrors) {
    const confidence = Math.min(95, 60 + re.frequency * 5);
    suggestedActions.push({
      type: 'add_constraint',
      rule: re.suggestedConstraint,
      severity: 'warning',
      confidence,
    });
  }

  for (const ic of ignoredConstraints) {
    if (ic.suggestion === 'remove') {
      suggestedActions.push({
        type: 'remove_constraint',
        rule: ic.rule,
        reason: `Violated ${Math.round(ic.violationRate * 100)}% of sessions`,
        confidence: Math.min(90, 60 + ic.violationRate * 30),
      });
    }
  }

  // Weekly report
  maybeWriteWeeklyReport(projectRoot, { metrics: { avgDuration, successRate, avgRetries }, patterns: { recurringErrors, ignoredConstraints, efficientPatterns } }, observations);

  return {
    metrics: { avgDuration, successRate, avgRetries },
    patterns: { recurringErrors, ignoredConstraints, efficientPatterns },
    suggestedActions,
  };
}

// ---------------------------------------------------------------------------
// Weekly report aggregator
// ---------------------------------------------------------------------------

function getISOWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function maybeWriteWeeklyReport(
  projectRoot: string,
  result: { metrics: Metrics; patterns: Patterns },
  observations: ExecutionObservation[],
): void {
  const now = new Date();
  const weekKey = getISOWeek(now);
  const reportsDir = join(projectRoot, '.reins', 'reports');
  const reportPath = join(reportsDir, `weekly-${weekKey}.yaml`);

  if (existsSync(reportPath)) return;

  mkdirSync(reportsDir, { recursive: true });

  const report = {
    period: weekKey,
    generated: now.toISOString(),
    summary: {
      total_tasks: observations.length,
      success_rate: result.metrics.successRate,
      avg_duration: result.metrics.avgDuration,
    },
    top_violations: result.patterns.ignoredConstraints.slice(0, 5).map(ic => ({
      rule: ic.rule,
      violation_rate: ic.violationRate,
    })),
    recurring_errors: result.patterns.recurringErrors.slice(0, 5).map(re => ({
      error: re.error,
      frequency: re.frequency,
    })),
  };

  try {
    writeFileSync(reportPath, yaml.dump(report, { lineWidth: 120 }), 'utf-8');
  } catch {
    // best-effort
  }
}
