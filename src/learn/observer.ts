import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentUsage {
  name: string;
  model: string;
  duration: number;
  success: boolean;
}

export interface ToolUsage {
  name: string;
  count: number;
  errorRate: number;
}

export interface ErrorRecord {
  type: string;
  message: string;
  file?: string;
  resolution?: string;
}

export interface ConstraintViolation {
  rule: string;
  file: string;
  description: string;
}

export interface TestsRun {
  total: number;
  passed: number;
  failed: number;
}

export interface ExecutionObservation {
  sessionId: string;
  taskDescription: string;
  timestamp: string;
  duration: number;
  outcome: 'success' | 'partial' | 'failure';
  agentsUsed: AgentUsage[];
  toolsUsed: ToolUsage[];
  filesModified: string[];
  testsRun: TestsRun;
  errors: ErrorRecord[];
  constraintViolations: ConstraintViolation[];
  learnings: string[];
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createObservation(sessionId: string, task: string): ExecutionObservation {
  return {
    sessionId,
    taskDescription: task,
    timestamp: new Date().toISOString(),
    duration: 0,
    outcome: 'success',
    agentsUsed: [],
    toolsUsed: [],
    filesModified: [],
    testsRun: { total: 0, passed: 0, failed: 0 },
    errors: [],
    constraintViolations: [],
    learnings: [],
  };
}

// ---------------------------------------------------------------------------
// Mutation helpers
// ---------------------------------------------------------------------------

export function recordAgentUsage(obs: ExecutionObservation, agent: AgentUsage): void {
  const existing = obs.agentsUsed.find(a => a.name === agent.name);
  if (existing) {
    existing.duration += agent.duration;
    existing.success = existing.success && agent.success;
  } else {
    obs.agentsUsed.push({ ...agent });
  }
}

export function recordToolUsage(obs: ExecutionObservation, tool: ToolUsage): void {
  const existing = obs.toolsUsed.find(t => t.name === tool.name);
  if (existing) {
    const totalCalls = existing.count + tool.count;
    existing.errorRate =
      (existing.errorRate * existing.count + tool.errorRate * tool.count) / totalCalls;
    existing.count = totalCalls;
  } else {
    obs.toolsUsed.push({ ...tool });
  }
}

export function recordError(obs: ExecutionObservation, error: ErrorRecord): void {
  obs.errors.push({ ...error });
}

export function recordViolation(obs: ExecutionObservation, violation: ConstraintViolation): void {
  obs.constraintViolations.push({ ...violation });
}

export function finalizeObservation(
  obs: ExecutionObservation,
  outcome: ExecutionObservation['outcome'],
): void {
  obs.outcome = outcome;
  obs.duration = Date.now() - new Date(obs.timestamp).getTime();
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export function saveObservation(projectRoot: string, obs: ExecutionObservation): void {
  const dir = join(projectRoot, '.reins', 'logs', 'executions');
  mkdirSync(dir, { recursive: true });

  const datePart = obs.timestamp.split('T')[0] ?? new Date().toISOString().split('T')[0];
  const safeName = obs.sessionId.replace(/[^a-z0-9-]/gi, '-').slice(0, 40);
  const filename = `exec-${datePart}-${safeName}.yaml`;
  const filePath = join(dir, filename);

  const content = yaml.dump(obs, { lineWidth: 120, quotingType: '"' });
  writeFileSync(filePath, content, 'utf-8');
}

// ---------------------------------------------------------------------------
// Loader (used by analyzer)
// ---------------------------------------------------------------------------

export function loadObservations(projectRoot: string): ExecutionObservation[] {
  const dir = join(projectRoot, '.reins', 'logs', 'executions');
  if (!existsSync(dir)) return [];

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  const observations: ExecutionObservation[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.yaml') && !entry.endsWith('.yml')) continue;
    try {
      const raw = readFileSync(join(dir, entry), 'utf-8');
      const parsed = yaml.load(raw) as ExecutionObservation | null;
      if (parsed && typeof parsed === 'object' && parsed.sessionId) {
        observations.push(parsed);
      }
    } catch {
      // skip unparseable
    }
  }

  return observations;
}
