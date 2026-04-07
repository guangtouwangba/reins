import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { loadAllFeatures } from '../features/index.js';
import type { Feature } from '../features/types.js';
import { loadConfig, getDefaultConfig, type ShipConfig } from '../state/config.js';
import { planExecution, type PlanExecutionDeps } from './planner.js';
import { pLimit } from './concurrency.js';
import { createRunDir, writeRunSummary } from './run-log.js';
import { runPreCommit, runFeatureVerify } from './verify.js';
import { checkScopeDrift } from './drift-check.js';
import { spawnClaudeHeadless } from './claude-spawn.js';
import { detectCommitStyle, commitFeature, type CommitStyle } from './commit.js';
import { runBrowserVerify } from './browser-verify.js';
import {
  createWorktree,
  rebaseAndMerge,
  removeWorktree,
  type WorktreeHandle,
} from './worktree.js';
import { runFeature, type RunFeatureContext } from './runner.js';
import type {
  ExecutionPlan,
  ExecutionStep,
  FeatureRunResult,
  RunSummary,
} from './types.js';

export interface RunShipOptions {
  /** Only run features with these ids. */
  only?: string[];
  /** Plan only, do not spawn claude or run verify. */
  dryRun?: boolean;
  /** Override ship.default_max_attempts for this run. */
  maxAttempts?: number;
  /** Override ship.max_parallelism for this run. */
  maxParallelism?: number;
  /** Skip the auto-commit step even when config.ship.auto_commit is true. */
  noCommit?: boolean;
  /** Dependency injection for tests (mocks the whole runner surface). */
  deps?: Partial<RunShipDeps>;
}

/**
 * All external side-effect entry points the orchestrator uses. Each
 * maps to a real module at runtime; tests pass mocks to drive the
 * orchestrator's state machine without touching git, claude, or the
 * project verify pipeline.
 */
export interface RunShipDeps {
  loadFeatures: (projectRoot: string) => Feature[];
  planExecution: typeof planExecution;
  runFeature: typeof runFeature;
  detectCommitStyle: typeof detectCommitStyle;
  createWorktree: typeof createWorktree;
  rebaseAndMerge: typeof rebaseAndMerge;
  removeWorktree: typeof removeWorktree;
  /** Allow tests to bypass the planner entirely. */
  plannerDeps?: PlanExecutionDeps;
  /**
   * Spawn override threaded into each feature's context. When provided,
   * integration tests can exercise the REAL `runFeature` state machine
   * against a mock `claude -p` subprocess without stubbing runFeature
   * wholesale. Defaults to `spawnClaudeHeadless` at runtime.
   */
  spawn?: (
    prompt: string,
    opts: import('./types.js').ClaudeRunOptions,
  ) => Promise<import('./types.js').ClaudeRunResult>;
}

function defaultDeps(): RunShipDeps {
  return {
    loadFeatures: loadAllFeatures,
    planExecution,
    runFeature,
    detectCommitStyle,
    createWorktree,
    rebaseAndMerge,
    removeWorktree,
  };
}

/**
 * Top-level `reins ship` entry point. Walks the feature queue through
 * plan → serial/parallel dispatch → commit → next step. Pauses the run
 * when any step produces a blocked feature (the next step may depend
 * on the blocked one, and we'd rather stop cleanly than cascade).
 *
 * Acquires `.reins/runs/.lock` with the run id so concurrent ship
 * invocations don't stomp on each other. Installs a SIGINT handler
 * that writes a partial run.json and releases the lock before exiting.
 */
export async function runShip(
  projectRoot: string,
  opts: RunShipOptions = {},
): Promise<RunSummary> {
  const deps = { ...defaultDeps(), ...(opts.deps ?? {}) };
  const reinsConfig = loadConfig(projectRoot);
  const defaults = getDefaultConfig().ship!;
  const shipConfig: ShipConfig = { ...defaults, ...(reinsConfig.ship ?? {}) };

  // Apply CLI overrides
  if (opts.maxAttempts !== undefined) shipConfig.default_max_attempts = opts.maxAttempts;
  if (opts.maxParallelism !== undefined) {
    shipConfig.max_parallelism = opts.maxParallelism;
    // --parallel 1 forces serial mode (planner off, no worktrees)
    if (opts.maxParallelism === 1) shipConfig.planner_enabled = false;
  }
  if (opts.noCommit) shipConfig.auto_commit = false;

  const runDir = createRunDir(projectRoot);
  const runId = basename(runDir);

  // Lock acquisition — must be atomic. `flag: 'wx'` makes writeFileSync
  // fail with EEXIST when the lock already exists, avoiding the TOCTOU
  // race between `existsSync` and `writeFileSync`.
  const lockPath = join(projectRoot, '.reins', 'runs', '.lock');
  mkdirSync(join(projectRoot, '.reins', 'runs'), { recursive: true });
  try {
    writeFileSync(lockPath, `${process.pid} ${runId}`, { encoding: 'utf-8', flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      const existing = safeRead(lockPath);
      throw new Error(
        `Another reins ship run is in progress (${existing}). ` +
        `If you're sure nothing is running, delete ${lockPath} and try again.`,
      );
    }
    throw err;
  }

  // Results accumulator lives outside the try block so the SIGINT
  // handler can flush a partial run.json on interruption.
  const startedAt = new Date();
  const results: FeatureRunResult[] = [];
  let aborted = false;

  const onSigint = (): void => {
    aborted = true;
    // Persist what we have so far so the user can inspect the partial run.
    try {
      writeRunSummary(runDir, buildSummary(runId, startedAt, results));
    } catch { /* non-fatal */ }
    try { rmSync(lockPath, { force: true }); } catch { /* ignore */ }
  };
  process.on('SIGINT', onSigint);

  try {
    // Load features
    const allFeatures = deps.loadFeatures(projectRoot);
    let todoFeatures = allFeatures.filter(f => f.status === 'todo');
    if (opts.only && opts.only.length > 0) {
      const onlySet = new Set(opts.only);
      todoFeatures = todoFeatures.filter(f => onlySet.has(f.id));
    }

    if (todoFeatures.length === 0) {
      const summary = emptySummary(runId, startedAt);
      writeRunSummary(runDir, summary);
      return summary;
    }

    // Plan
    const plan = await deps.planExecution(
      projectRoot,
      todoFeatures,
      shipConfig.max_parallelism,
      runDir,
      { ...(deps.plannerDeps ?? {}), plannerEnabled: shipConfig.planner_enabled },
    );

    if (opts.dryRun) {
      // No features run; the plan itself is the artifact of interest
      // and has already been persisted to <runDir>/plan.json by the
      // planner. Attach the plan to the summary so run.json is useful
      // to consumers inspecting a dry-run archaeologically.
      const summary: RunSummary = {
        ...buildSummary(runId, startedAt, []),
        plan,
      };
      writeRunSummary(runDir, summary);
      return summary;
    }

    // Detect commit style once per run
    const commitStyle: CommitStyle = deps.detectCommitStyle(
      projectRoot,
      shipConfig.commit_style,
    );

    const featureById = new Map(allFeatures.map(f => [f.id, f]));

    // Walk plan steps
    for (const step of plan.steps) {
      if (aborted) break;

      const stepResults = await runStep(
        step,
        featureById,
        projectRoot,
        runDir,
        runId,
        shipConfig,
        commitStyle,
        deps,
      );
      results.push(...stepResults);

      // Pause ship when any feature in this step was blocked. Subsequent
      // steps may depend on the blocked work, and silently racing past
      // them leaves a confusing partial state.
      if (stepResults.some(r => r.status === 'blocked')) break;
    }

    const summary = buildSummary(runId, startedAt, results);
    writeRunSummary(runDir, summary);
    return summary;
  } finally {
    process.removeListener('SIGINT', onSigint);
    try { rmSync(lockPath, { force: true }); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Step dispatch
// ---------------------------------------------------------------------------

async function runStep(
  step: ExecutionStep,
  featureById: Map<string, Feature>,
  projectRoot: string,
  runDir: string,
  runId: string,
  shipConfig: ShipConfig,
  commitStyle: CommitStyle,
  deps: RunShipDeps,
): Promise<FeatureRunResult[]> {
  if (step.mode === 'serial') {
    return runSerialStep(step, featureById, projectRoot, runDir, runId, shipConfig, commitStyle, deps);
  }
  return runParallelStep(step, featureById, projectRoot, runDir, runId, shipConfig, commitStyle, deps);
}

async function runSerialStep(
  step: ExecutionStep,
  featureById: Map<string, Feature>,
  projectRoot: string,
  runDir: string,
  runId: string,
  shipConfig: ShipConfig,
  commitStyle: CommitStyle,
  deps: RunShipDeps,
): Promise<FeatureRunResult[]> {
  const results: FeatureRunResult[] = [];
  for (const id of step.features) {
    const feature = featureById.get(id);
    if (!feature) continue;
    const ctx: RunFeatureContext = buildContext(
      runId,
      shipConfig,
      commitStyle,
      false, // isParallel
      featurePathFor(projectRoot, id),
      deps.spawn,
    );
    const result = await deps.runFeature(feature, projectRoot, projectRoot, runDir, ctx);
    results.push(result);
    if (result.status === 'blocked') break; // step-level short-circuit
  }
  return results;
}

async function runParallelStep(
  step: ExecutionStep,
  featureById: Map<string, Feature>,
  projectRoot: string,
  runDir: string,
  runId: string,
  shipConfig: ShipConfig,
  commitStyle: CommitStyle,
  deps: RunShipDeps,
): Promise<FeatureRunResult[]> {
  // Create a worktree per feature
  const handles: Array<{ feature: Feature; handle: WorktreeHandle }> = [];
  for (const id of step.features) {
    const feature = featureById.get(id);
    if (!feature) continue;
    const handle = deps.createWorktree(projectRoot, id);
    handles.push({ feature, handle });
  }

  // Run features in parallel, capped at ship.max_parallelism
  const tasks = handles.map(({ feature, handle }) => async (): Promise<FeatureRunResult> => {
    const ctx = buildContext(
      runId,
      shipConfig,
      commitStyle,
      true, // isParallel
      featurePathFor(projectRoot, feature.id),
      deps.spawn,
    );
    return deps.runFeature(feature, handle.path, projectRoot, runDir, ctx);
  });

  const results = await pLimit(shipConfig.max_parallelism, tasks);

  // Rebase successful features back onto the main branch
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const entry = handles[i];
    if (!result || !entry) continue;

    if (result.status === 'done') {
      const rebase = deps.rebaseAndMerge(projectRoot, entry.handle);
      if (!rebase.success) {
        // Convert the done result into blocked. Drop `commit_sha`
        // explicitly — the worktree's commit didn't land on the main
        // branch, so reporting it would mislead the user.
        const { commit_sha: _commitSha, ...rest } = result;
        void _commitSha;
        results[i] = {
          ...rest,
          status: 'blocked',
          failure: {
            stage: 'rebase',
            command: 'git cherry-pick',
            exit_code: 1,
            output: rebase.conflict,
          },
        };
        console.warn(
          `[reins ship] ${entry.feature.id} blocked at rebase; worktree preserved at ${entry.handle.path}`,
        );
      } else {
        deps.removeWorktree(projectRoot, entry.handle, false);
      }
    } else {
      // Blocked feature — leave the worktree in place for user inspection.
      console.warn(
        `[reins ship] ${entry.feature.id} blocked; worktree preserved at ${entry.handle.path}`,
      );
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Context + helpers
// ---------------------------------------------------------------------------

function buildContext(
  runId: string,
  shipConfig: ShipConfig,
  commitStyle: CommitStyle,
  isParallel: boolean,
  featurePath: string,
  spawnOverride?: RunShipDeps['spawn'],
): RunFeatureContext {
  const ctx: RunFeatureContext = {
    spawn: spawnOverride ?? spawnClaudeHeadless,
    runPreCommit,
    runFeatureVerify: (cwd: string, timeoutMs?: number) =>
      runFeatureVerify(cwd, timeoutMs ?? shipConfig.feature_verify_timeout_ms),
    runBrowserVerify: (feature, projectRoot, runDir) =>
      runBrowserVerify(feature, projectRoot, runDir),
    checkScopeDrift,
    commitFeature,
    isParallel,
    maxAttempts: shipConfig.default_max_attempts,
    config: {
      auto_commit: shipConfig.auto_commit,
      implement_timeout_ms: shipConfig.implement_timeout_ms,
    },
    runId,
    commitStyle,
    featurePath,
  };
  if (shipConfig.commit_custom_template !== undefined) {
    ctx.commitTemplate = shipConfig.commit_custom_template;
  }
  return ctx;
}

function featurePathFor(projectRoot: string, featureId: string): string {
  return join(projectRoot, '.reins', 'features', `${featureId}.md`);
}

function safeRead(path: string): string {
  try { return readFileSync(path, 'utf-8'); }
  catch { return '<unreadable>'; }
}

function buildSummary(
  runId: string,
  startedAt: Date,
  results: FeatureRunResult[],
): RunSummary {
  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  return {
    id: runId,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: durationMs,
    features: results,
    totals: {
      done: results.filter(r => r.status === 'done').length,
      blocked: results.filter(r => r.status === 'blocked').length,
      duration_ms: durationMs,
    },
  };
}

function emptySummary(runId: string, startedAt: Date): RunSummary {
  return buildSummary(runId, startedAt, []);
}
