import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Feature } from '../features/types.js';
import { hasCycle } from '../features/resolver.js';
import type { ExecutionPlan, ExecutionStep, ClaudeRunOptions, ClaudeRunResult } from './types.js';
import { spawnClaudeHeadless as defaultSpawn } from './claude-spawn.js';
import { buildPlanningPrompt } from './prompt-builder.js';

/**
 * Injected dependencies for `planExecution`. Tests pass mock
 * implementations; runtime uses the defaults (real `claude -p` subprocess,
 * real filesystem).
 */
export interface PlanExecutionDeps {
  spawn?: (prompt: string, opts: ClaudeRunOptions) => Promise<ClaudeRunResult>;
  /** When false, skip the AI planner entirely and return a fallback plan. */
  plannerEnabled?: boolean;
  /** Override the planner spawn timeout (ms). Defaults to 120s. */
  plannerTimeoutMs?: number;
}

/**
 * Plan the execution order of a set of todo features.
 *
 * When the AI planner is enabled (default), this spawns a short
 * `claude -p` call whose prompt is built by `buildPlanningPrompt`. The
 * response is parsed as JSON, validated against the input feature set,
 * and any parallel step with overlapping scope globs is split into
 * serial sub-steps. On any failure (spawn error, invalid JSON, schema
 * mismatch, post-validation fail) we fall back to a plain topological
 * sort of features by `depends_on`, returning one serial step per
 * feature with `source: 'fallback'`.
 *
 * The planner also writes two artifacts to `runDir`:
 * - `planner-raw.log` — the full spawn output (stdout + stderr + exit)
 * - `plan.json` — the final `ExecutionPlan` actually executed
 *
 * Fallback is always available, so ship never depends on the planner
 * working correctly. The planner is an optimization — it lets ship run
 * independent features in parallel when the model can identify them.
 */
export async function planExecution(
  projectRoot: string,
  features: Feature[],
  maxParallelism: number,
  runDir: string,
  deps: PlanExecutionDeps = {},
): Promise<ExecutionPlan> {
  const plannerEnabled = deps.plannerEnabled ?? true;

  // Trivial cases: 0 or 1 features, or planner disabled.
  if (!plannerEnabled || features.length <= 1) {
    const plan = fallbackPlan(features, maxParallelism);
    writePlanArtifacts(runDir, plan);
    return plan;
  }

  // Reject cycles up-front — fallback can't recover from them either.
  if (hasCycle(features)) {
    throw new Error('planExecution: dependency cycle detected across todo features');
  }

  const prompt = buildPlanningPrompt(features, [], maxParallelism);
  const spawn = deps.spawn ?? defaultSpawn;

  let claudeResult: ClaudeRunResult;
  try {
    claudeResult = await spawn(prompt, {
      cwd: projectRoot,
      timeoutMs: deps.plannerTimeoutMs ?? 120_000,
      logDir: runDir,
    });
  } catch {
    const plan = fallbackPlan(features, maxParallelism);
    writePlanArtifacts(runDir, plan);
    return plan;
  }

  // Persist the raw planner output regardless of outcome.
  writeRawLog(runDir, claudeResult);

  if (claudeResult.exitCode !== 0) {
    const plan = fallbackPlan(features, maxParallelism);
    writePlanArtifacts(runDir, plan);
    return plan;
  }

  const parsed = parsePlanResponse(claudeResult.stdout);
  if (!parsed) {
    const plan = fallbackPlan(features, maxParallelism);
    writePlanArtifacts(runDir, plan);
    return plan;
  }

  const validated = validateAndNormalize(parsed, features, maxParallelism);
  if (!validated) {
    const plan = fallbackPlan(features, maxParallelism);
    writePlanArtifacts(runDir, plan);
    return plan;
  }

  writePlanArtifacts(runDir, validated);
  return validated;
}

// ---------------------------------------------------------------------------
// Fallback topological sort
// ---------------------------------------------------------------------------

/**
 * Fallback plan: one serial step per feature, ordered so every feature's
 * dependencies come first. Uses Kahn's algorithm for stability.
 *
 * Features with unknown `depends_on` ids are placed according to their
 * priority — the dependency is treated as satisfied. This matches the
 * semantics of `pickNextFeature`, which also tolerates unknown ids.
 */
function fallbackPlan(features: Feature[], _maxParallelism: number): ExecutionPlan {
  const ordered = topologicalSort(features);
  const steps: ExecutionStep[] = ordered.map(f => ({
    mode: 'serial',
    features: [f.id],
    reason: 'fallback (planner disabled or failed)',
  }));
  return {
    steps,
    // Fallback is always strictly serial — one feature per step means
    // parallelism is meaningless and we force it to 1 for clarity.
    parallelism: 1,
    estimated_minutes: 0,
    source: 'fallback',
  };
}

function topologicalSort(features: Feature[]): Feature[] {
  const byId = new Map(features.map(f => [f.id, f]));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const f of features) {
    inDegree.set(f.id, 0);
    adj.set(f.id, []);
  }
  for (const f of features) {
    for (const dep of f.depends_on) {
      if (!byId.has(dep)) continue;
      adj.get(dep)!.push(f.id);
      inDegree.set(f.id, (inDegree.get(f.id) ?? 0) + 1);
    }
  }

  // Seed the queue with zero-in-degree nodes, sorted by priority then created_at.
  const ready: Feature[] = features
    .filter(f => (inDegree.get(f.id) ?? 0) === 0)
    .sort(prioritySort);

  const result: Feature[] = [];
  while (ready.length > 0) {
    const next = ready.shift()!;
    result.push(next);
    for (const child of adj.get(next.id) ?? []) {
      const d = (inDegree.get(child) ?? 0) - 1;
      inDegree.set(child, d);
      if (d === 0) {
        const feature = byId.get(child);
        if (feature) {
          ready.push(feature);
          ready.sort(prioritySort);
        }
      }
    }
  }

  // planExecution() calls hasCycle() before reaching this function, so
  // a cycle-induced short result is unreachable here. If that invariant
  // ever changes, update the caller — don't silently paper over it.
  return result;
}

function prioritySort(a: Feature, b: Feature): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.created_at.localeCompare(b.created_at);
}

// ---------------------------------------------------------------------------
// AI response parsing + validation
// ---------------------------------------------------------------------------

interface ParsedPlan {
  steps: ExecutionStep[];
  parallelism: number;
  estimated_minutes: number;
}

/**
 * Lenient JSON extraction from a model response. Accepts a raw JSON
 * object or one wrapped in ```json ... ``` fences (models often ignore
 * "no fences" instructions). Returns null on any failure.
 */
function parsePlanResponse(stdout: string): ParsedPlan | null {
  if (!stdout) return null;
  const candidate = extractJson(stdout);
  if (!candidate) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;

  const stepsRaw = obj['steps'];
  const parallelism = obj['parallelism'];
  const estimated = obj['estimated_minutes'];

  if (!Array.isArray(stepsRaw)) return null;
  if (typeof parallelism !== 'number' || !Number.isFinite(parallelism)) return null;

  const steps: ExecutionStep[] = [];
  for (const rawStep of stepsRaw) {
    if (!rawStep || typeof rawStep !== 'object') return null;
    const s = rawStep as Record<string, unknown>;
    const mode = s['mode'];
    const featuresArr = s['features'];
    const reason = s['reason'];
    if (mode !== 'serial' && mode !== 'parallel') return null;
    if (!Array.isArray(featuresArr)) return null;
    const featureIds = featuresArr.filter((x): x is string => typeof x === 'string');
    if (featureIds.length !== featuresArr.length) return null;
    steps.push({
      mode,
      features: featureIds,
      reason: typeof reason === 'string' ? reason : '',
    });
  }

  return {
    steps,
    parallelism,
    estimated_minutes: typeof estimated === 'number' && Number.isFinite(estimated) ? estimated : 0,
  };
}

function extractJson(text: string): string | null {
  // Try fenced block first.
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n```/i.exec(text);
  if (fenced && fenced[1]) return fenced[1].trim();

  // Otherwise find the first `{` and take everything through the matching `}`.
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Validate the parsed plan against the input feature set and enforce the
 * schedule invariants. Returns `null` on any violation so the caller
 * falls back cleanly.
 *
 * Checks:
 * 1. Every input feature appears in exactly one step.
 * 2. No step references an unknown feature id.
 * 3. Dependencies come before dependents in the step order.
 * 4. Within each parallel step, no two features have overlapping `scope`
 *    globs — overlapping pairs get split into consecutive serial steps.
 * 5. `parallelism` is clamped to `[1, maxParallelism]`.
 */
function validateAndNormalize(
  parsed: ParsedPlan,
  features: Feature[],
  maxParallelism: number,
): ExecutionPlan | null {
  const inputIds = new Set(features.map(f => f.id));
  const seen = new Set<string>();

  // Invariant 1 + 2: exact-once coverage, no unknown ids.
  for (const step of parsed.steps) {
    for (const id of step.features) {
      if (!inputIds.has(id)) return null;
      if (seen.has(id)) return null;
      seen.add(id);
    }
  }
  if (seen.size !== inputIds.size) return null;

  // Invariant 3: depends_on order.
  const position = new Map<string, number>();
  parsed.steps.forEach((step, idx) => {
    for (const id of step.features) position.set(id, idx);
  });
  for (const f of features) {
    const myPos = position.get(f.id);
    if (myPos === undefined) return null;
    for (const dep of f.depends_on) {
      if (!inputIds.has(dep)) continue;
      const depPos = position.get(dep);
      if (depPos === undefined || depPos >= myPos) return null;
    }
  }

  // Invariant 4: scope overlap within parallel steps → split.
  const byId = new Map(features.map(f => [f.id, f]));
  const splitSteps: ExecutionStep[] = [];
  for (const step of parsed.steps) {
    if (step.mode === 'serial' || step.features.length <= 1) {
      splitSteps.push(step);
      continue;
    }
    const safeGroups = splitByScopeOverlap(step.features, byId);
    if (safeGroups.length === 1) {
      splitSteps.push(step);
    } else {
      for (const group of safeGroups) {
        splitSteps.push({
          mode: group.length === 1 ? 'serial' : 'parallel',
          features: group,
          reason: step.reason + ' (split: scope overlap)',
        });
      }
    }
  }

  // Invariant 5: clamp parallelism.
  const parallelism = Math.max(1, Math.min(parsed.parallelism, maxParallelism));

  return {
    steps: splitSteps,
    parallelism,
    estimated_minutes: parsed.estimated_minutes,
    source: 'ai',
  };
}

/**
 * Partition a parallel step's features into subsets where no two
 * features in the same subset have overlapping scope globs. Uses a
 * simple greedy algorithm: walk features in order, place each in the
 * first subset with no conflict.
 *
 * Two scopes conflict when one is a prefix (after stripping trailing
 * glob wildcards) of the other. This is a conservative overestimate
 * that won't miss real conflicts but may split unnecessarily — that's
 * the right trade-off because a split is cheap but a missed conflict
 * causes a rebase failure.
 */
function splitByScopeOverlap(
  featureIds: string[],
  byId: Map<string, Feature>,
): string[][] {
  const groups: string[][] = [];

  for (const id of featureIds) {
    const feature = byId.get(id);
    const myGlobs = feature?.scope ?? [];

    let placed = false;
    for (const group of groups) {
      const conflict = group.some(otherId => {
        const other = byId.get(otherId);
        const otherGlobs = other?.scope ?? [];
        return globSetsOverlap(myGlobs, otherGlobs);
      });
      if (!conflict) {
        group.push(id);
        placed = true;
        break;
      }
    }
    if (!placed) groups.push([id]);
  }
  return groups;
}

function globSetsOverlap(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) {
    // An unscoped feature can touch anything — treat as overlapping with
    // every other feature to be safe.
    return true;
  }
  for (const ga of a) {
    const pa = stripGlobTail(ga);
    for (const gb of b) {
      const pb = stripGlobTail(gb);
      if (pa.startsWith(pb) || pb.startsWith(pa)) return true;
    }
  }
  return false;
}

function stripGlobTail(glob: string): string {
  // Cut at the first wildcard character. Keep the path separator before it.
  const idx = glob.search(/[*?[]/);
  if (idx === -1) return glob;
  return glob.slice(0, idx);
}

// ---------------------------------------------------------------------------
// Artifact writing
// ---------------------------------------------------------------------------

function writePlanArtifacts(runDir: string, plan: ExecutionPlan): void {
  try {
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'plan.json'), JSON.stringify(plan, null, 2), 'utf-8');
  } catch {
    // Logging failure must not kill the planner.
  }
}

function writeRawLog(runDir: string, result: ClaudeRunResult): void {
  try {
    mkdirSync(runDir, { recursive: true });
    const lines: string[] = [
      `EXIT: ${result.exitCode}`,
      `DURATION_MS: ${result.durationMs}`,
      `TIMED_OUT: ${result.timedOut}`,
      '',
      '--- STDOUT ---',
      result.stdout,
      '',
      '--- STDERR ---',
      result.stderr,
    ];
    writeFileSync(join(runDir, 'planner-raw.log'), lines.join('\n'), 'utf-8');
  } catch {
    // Non-fatal.
  }
}
