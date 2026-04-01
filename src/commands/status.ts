import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import type { Constraint, ConstraintsConfig } from '../constraints/schema.js';

interface ViolationRecord {
  constraint_id: string;
  triggered_at: string;
  [key: string]: unknown;
}

interface ConstraintStatus {
  id: string;
  rule: string;
  severity: string;
  violations: { count: number; trend: 'up' | 'down' | 'stable' };
  hookStatus: 'active' | 'disabled' | 'none';
  lastTriggered: string | null;
}

interface StatusReport {
  generatedAt: string;
  constraints: ConstraintStatus[];
  summary: { critical: number; important: number; helpful: number; violations_7d: number };
  suggestions: string[];
}

function parseSince(since: string | undefined): Date {
  if (!since) {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d;
  }
  const match = since.match(/^(\d+)d$/);
  if (match?.[1]) {
    const d = new Date();
    d.setDate(d.getDate() - parseInt(match[1], 10));
    return d;
  }
  return new Date(0);
}

function readViolations(projectRoot: string, since: Date): ViolationRecord[] {
  const logsDir = join(projectRoot, '.reins', 'logs');
  const violations: ViolationRecord[] = [];

  if (!existsSync(logsDir)) return violations;

  function walkDir(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      if (entry.endsWith('.jsonl')) {
        try {
          const lines = readFileSync(fullPath, 'utf-8').split('\n').filter(Boolean);
          for (const line of lines) {
            try {
              const record = JSON.parse(line) as ViolationRecord;
              if (record.triggered_at) {
                const t = new Date(record.triggered_at);
                if (t >= since) violations.push(record);
              }
            } catch { /* skip */ }
          }
        } catch { /* skip */ }
      } else if (entry.endsWith('.yaml')) {
        try {
          const raw = readFileSync(fullPath, 'utf-8');
          const record = yaml.load(raw) as ViolationRecord;
          if (record?.triggered_at) {
            const t = new Date(record.triggered_at);
            if (t >= since) violations.push(record);
          }
        } catch { /* skip */ }
      } else {
        try {
          const stat = statSync(fullPath);
          if (stat.isDirectory()) walkDir(fullPath);
        } catch { /* skip */ }
      }
    }
  }

  walkDir(logsDir);
  return violations;
}

function computeTrend(violations: ViolationRecord[], id: string, since: Date): 'up' | 'down' | 'stable' {
  const relevant = violations.filter(v => v.constraint_id === id);
  if (relevant.length < 2) return 'stable';

  const midpoint = new Date((since.getTime() + Date.now()) / 2);
  const firstHalf = relevant.filter(v => new Date(v.triggered_at) < midpoint).length;
  const secondHalf = relevant.filter(v => new Date(v.triggered_at) >= midpoint).length;

  if (secondHalf > firstHalf * 1.2) return 'up';
  if (firstHalf > secondHalf * 1.2) return 'down';
  return 'stable';
}

function buildReport(
  constraints: Constraint[],
  violations: ViolationRecord[],
  since: Date,
  filter: string | undefined,
): StatusReport {
  let filtered = constraints;
  if (filter) {
    filtered = constraints.filter(c => c.severity === filter);
  }

  const sinceWeekAgo = new Date();
  sinceWeekAgo.setDate(sinceWeekAgo.getDate() - 7);

  const constraintStatuses: ConstraintStatus[] = filtered.map(c => {
    const cViolations = violations.filter(v => v.constraint_id === c.id);
    const lastViolation = cViolations.sort((a, b) =>
      new Date(b.triggered_at).getTime() - new Date(a.triggered_at).getTime()
    )[0];

    let hookStatus: 'active' | 'disabled' | 'none' = 'none';
    if (c.enforcement.hook) {
      hookStatus = c.enforcement.hook_mode === 'off' ? 'disabled' : 'active';
    }

    return {
      id: c.id,
      rule: c.rule,
      severity: c.severity,
      violations: { count: cViolations.length, trend: computeTrend(violations, c.id, since) },
      hookStatus,
      lastTriggered: lastViolation?.triggered_at ?? null,
    };
  });

  const critical = constraints.filter(c => c.severity === 'critical').length;
  const important = constraints.filter(c => c.severity === 'important').length;
  const helpful = constraints.filter(c => c.severity === 'helpful').length;
  const violations_7d = violations.filter(v => new Date(v.triggered_at) >= sinceWeekAgo).length;

  const suggestions: string[] = [];
  for (const cs of constraintStatuses) {
    if (cs.violations.count === 0) {
      suggestions.push(`${cs.id}: zero violations in this period`);
    } else if (cs.violations.count > 10 * 7) {
      suggestions.push(`${cs.id}: high violation rate (${cs.violations.count}) — a hook may help enforcement`);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    constraints: constraintStatuses,
    summary: { critical, important, helpful, violations_7d },
    suggestions,
  };
}

function formatHuman(report: StatusReport): string {
  const lines: string[] = [];
  const s = report.summary;
  lines.push(`Reins Status — ${new Date(report.generatedAt).toLocaleString()}`);
  lines.push('');
  lines.push(`Constraints: ${s.critical} critical, ${s.important} important, ${s.helpful} helpful`);
  lines.push(`Violations (7d): ${s.violations_7d}`);
  lines.push('');

  if (report.constraints.length === 0) {
    lines.push('No constraints found.');
  } else {
    for (const c of report.constraints) {
      const trend = c.violations.trend === 'up' ? '↑' : c.violations.trend === 'down' ? '↓' : '→';
      const hook = c.hookStatus === 'active' ? '[hook]' : c.hookStatus === 'disabled' ? '[hook:off]' : '';
      lines.push(`  ${c.severity.padEnd(10)} ${c.id.padEnd(30)} violations:${c.violations.count} ${trend}  ${hook}`);
    }
  }

  if (report.suggestions.length > 0) {
    lines.push('');
    lines.push('Suggestions:');
    for (const s of report.suggestions) {
      lines.push(`  • ${s}`);
    }
  }

  return lines.join('\n');
}

export async function runStatus(options: { filter?: string; format?: string; since?: string }): Promise<void> {
  const projectRoot = process.cwd();
  const constraintsPath = join(projectRoot, '.reins', 'constraints.yaml');

  if (!existsSync(constraintsPath)) {
    console.log('No constraints configured yet.');
    console.log('');
    console.log('Get started:');
    console.log('  reins init    — scan your project and generate constraints');
    return;
  }

  const raw = readFileSync(constraintsPath, 'utf-8');
  const config = yaml.load(raw) as ConstraintsConfig;
  const constraints: Constraint[] = config.constraints ?? [];

  const since = parseSince(options.since);
  const violations = readViolations(projectRoot, since);
  const report = buildReport(constraints, violations, since, options.filter);

  if (options.format === 'json') {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatHuman(report));
  }
}
