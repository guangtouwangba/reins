import { join } from 'node:path';
import { updateFeatureFrontmatter } from '../features/storage.js';
import type { Feature, FailureContext } from '../features/types.js';
import type { ShipConfig } from '../state/config.js';
import { buildImplementPrompt } from './prompt-builder.js';
import { writeAttemptLog } from './run-log.js';
import type {
  ClaudeRunOptions,
  ClaudeRunResult,
  FeatureRunResult,
  VerifyResult,
} from './types.js';
import type { DriftResult } from './drift-check.js';
import type { CommitResult, CommitStyle } from './commit.js';

/**
 * Injected browser-verify hook. Optional on the context because not
 * every test wants to exercise this layer — when missing, the runner
 * treats the layer as "no browser verify configured" (skipped).
 */
export type RunBrowserVerifyFn = (
  feature: Feature,
  projectRoot: string,
  runDir: string,
) => Promise<VerifyResult>;

/**
 * Dependencies injected into `runFeature`. Each field maps to a real
 * module at runtime; tests pass mocks to drive the state machine
 * without hitting git, subprocesses, or the filesystem.
 *
 * Split from the narrow per-call arguments because the same context
 * is reused across every feature in a ship run — wiring it up once at
 * the orchestrator level keeps `runFeature`'s signature flat.
 */
export interface RunFeatureContext {
  // Core deps — all optional so tests can provide only what they need.
  spawn: (prompt: string, opts: ClaudeRunOptions) => Promise<ClaudeRunResult>;
  runPreCommit: (projectRoot: string) => VerifyResult;
  runFeatureVerify: (projectRoot: string, timeoutMs?: number) => VerifyResult;
  /**
   * Browser verify layer. Optional — when undefined, the runner skips
   * the browser verify step entirely (treated as passed+skipped).
   */
  runBrowserVerify?: RunBrowserVerifyFn;
  checkScopeDrift: (projectRoot: string, scopeGlobs: string[] | undefined) => DriftResult;
  commitFeature: (
    cwd: string,
    feature: Feature,
    runId: string,
    attempts: number,
    style: CommitStyle,
    template?: string,
  ) => CommitResult;

  // Shape
  /** True when running inside a git worktree for a parallel step. */
  isParallel: boolean;
  /** Per-feature retry budget. Uses `feature.max_attempts` if set, else this. */
  maxAttempts: number;
  /** Ship config subset needed by runFeature. */
  config: Pick<ShipConfig, 'auto_commit' | 'implement_timeout_ms'>;
  /** Current run id (basename of `.reins/runs/<id>/`). */
  runId: string;
  /** Detected commit style for this ship run. */
  commitStyle: CommitStyle;
  /** Optional custom commit template. */
  commitTemplate?: string;
  /** Absolute path to the feature file on disk. */
  featurePath: string;
}

/**
 * Per-feature state machine. Loops up to `ctx.maxAttempts` times:
 *
 *   implement → scope drift → pre_commit → feature_verify → (auto)commit → done
 *
 * Any failure short-circuits back to the top with `previousFailure`
 * populated; the next implement attempt includes the failure in its
 * prompt via `buildImplementPrompt(..., previousFailure)`.
 *
 * In parallel mode (`ctx.isParallel = true`), scope drift is a hard
 * block — an out-of-scope file touched in a worktree pollutes the
 * rebase-back step for other features in the same parallel group. In
 * serial mode, drift is a warning only (logged to stderr, attempt
 * continues).
 *
 * Commits go through the project's own pre-commit hook (never
 * `--no-verify`). A hook rejection is treated as a verify failure and
 * retried with the hook's output fed back into the prompt.
 *
 * Returns a `FeatureRunResult` recording `status` (`done` or
 * `blocked`), `attempts`, `duration_ms`, optional `commit_sha`, and
 * (on `blocked`) the final `failure` that exhausted the budget.
 */
export async function runFeature(
  feature: Feature,
  cwd: string,
  projectRoot: string,
  runDir: string,
  ctx: RunFeatureContext,
): Promise<FeatureRunResult> {
  const startedAt = Date.now();
  const maxAttempts = feature.max_attempts ?? ctx.maxAttempts;

  // Transition to in-progress. The ship orchestrator already picked this
  // feature, but runFeature owns the transition because it may be called
  // directly by /reins-ship-here or tests.
  safeUpdateFrontmatter(ctx.featurePath, { status: 'in-progress', last_run_id: ctx.runId });

  let previousFailure: FailureContext | undefined;
  let attempts = 0;
  let commitSha: string | undefined;

  while (attempts < maxAttempts) {
    attempts += 1;
    const attemptLog: Record<string, string> = {};

    // -- 1. Implement step --------------------------------------------------
    const prompt = buildImplementPrompt(feature, projectRoot, previousFailure);
    attemptLog['implement-prompt.md'] = prompt;

    let claudeResult: ClaudeRunResult;
    try {
      claudeResult = await ctx.spawn(prompt, {
        cwd,
        timeoutMs: ctx.config.implement_timeout_ms,
        logDir: join(runDir, feature.id, `attempt-${attempts}`),
      });
    } catch (err) {
      previousFailure = {
        stage: 'claude',
        command: 'claude -p <prompt>',
        exit_code: -1,
        output: err instanceof Error ? err.message : String(err),
      };
      writeAttemptLog(runDir, feature.id, attempts, {
        ...attemptLog,
        'failure.txt': JSON.stringify(previousFailure, null, 2),
      });
      continue;
    }

    attemptLog['claude-stdout.log'] = claudeResult.stdout;
    attemptLog['claude-stderr.log'] = claudeResult.stderr;

    if (claudeResult.exitCode !== 0 || claudeResult.timedOut) {
      previousFailure = {
        stage: 'claude',
        command: 'claude -p <prompt>',
        exit_code: claudeResult.exitCode,
        output: claudeResult.timedOut
          ? `Timed out after ${claudeResult.durationMs}ms`
          : `${claudeResult.stdout}\n${claudeResult.stderr}`.trim(),
      };
      writeAttemptLog(runDir, feature.id, attempts, {
        ...attemptLog,
        'failure.txt': JSON.stringify(previousFailure, null, 2),
      });
      continue;
    }

    // -- 2. Scope drift check ----------------------------------------------
    const drift = ctx.checkScopeDrift(cwd, feature.scope);
    attemptLog['scope-drift.txt'] = JSON.stringify(drift, null, 2);

    if (drift.outOfScope.length > 0) {
      if (ctx.isParallel) {
        previousFailure = {
          stage: 'scope-drift',
          command: 'git status --porcelain',
          exit_code: 1,
          output: `Out-of-scope files touched (parallel mode is strict): ${drift.outOfScope.join(', ')}`,
        };
        writeAttemptLog(runDir, feature.id, attempts, {
          ...attemptLog,
          'failure.txt': JSON.stringify(previousFailure, null, 2),
        });
        continue;
      } else {
        console.warn(
          `[reins ship] ${feature.id}: ${drift.outOfScope.length} out-of-scope file(s) touched: ${drift.outOfScope.join(', ')}`,
        );
      }
    }

    // -- 3. pre_commit ------------------------------------------------------
    const preCommit = ctx.runPreCommit(cwd);
    attemptLog['pre-commit-result.json'] = JSON.stringify(preCommit, null, 2);

    if (!preCommit.passed) {
      previousFailure = {
        stage: 'pre_commit',
        command: preCommit.failure?.command ?? 'pre_commit',
        exit_code: preCommit.failure?.exit_code ?? 1,
        output: preCommit.failure?.output ?? '',
      };
      writeAttemptLog(runDir, feature.id, attempts, {
        ...attemptLog,
        'failure.txt': JSON.stringify(previousFailure, null, 2),
      });
      continue;
    }

    // -- 4. feature_verify --------------------------------------------------
    const featureVerify = ctx.runFeatureVerify(cwd);
    attemptLog['feature-verify-result.json'] = JSON.stringify(featureVerify, null, 2);

    if (!featureVerify.passed) {
      previousFailure = {
        stage: 'feature_verify',
        command: featureVerify.failure?.command ?? 'feature_verify',
        exit_code: featureVerify.failure?.exit_code ?? 1,
        output: featureVerify.failure?.output ?? '',
      };
      writeAttemptLog(runDir, feature.id, attempts, {
        ...attemptLog,
        'failure.txt': JSON.stringify(previousFailure, null, 2),
      });
      continue;
    }

    // -- 4b. browser_verify -------------------------------------------------
    // Only runs when ctx.runBrowserVerify is provided. Skipped results
    // (browser_verify not configured, no Browser test section, dev
    // server discovery failed) are treated as passed — browser verify
    // is best-effort in v1 and should never block a feature whose unit
    // tests passed. True failures (spec-gen broken, playwright test
    // red, wait_for_url timeout) still count as feature failures and
    // trigger a retry with the failure fed back to claude.
    if (ctx.runBrowserVerify) {
      const browserVerify = await ctx.runBrowserVerify(feature, cwd, runDir);
      attemptLog['browser-verify-result.json'] = JSON.stringify(browserVerify, null, 2);

      if (!browserVerify.passed) {
        previousFailure = {
          stage: 'browser_verify',
          command: browserVerify.failure?.command ?? 'browser_verify',
          exit_code: browserVerify.failure?.exit_code ?? 1,
          output: browserVerify.failure?.output ?? '',
        };
        writeAttemptLog(runDir, feature.id, attempts, {
          ...attemptLog,
          'failure.txt': JSON.stringify(previousFailure, null, 2),
        });
        continue;
      }
    }

    // -- 5. commit ----------------------------------------------------------
    if (ctx.config.auto_commit) {
      const commitResult = ctx.commitFeature(
        cwd,
        feature,
        ctx.runId,
        attempts,
        ctx.commitStyle,
        ctx.commitTemplate,
      );
      attemptLog['commit-result.json'] = JSON.stringify(commitResult, null, 2);

      if (!commitResult.success) {
        previousFailure = {
          stage: 'commit',
          command: 'git commit',
          exit_code: 1,
          output: commitResult.hookOutput,
        };
        writeAttemptLog(runDir, feature.id, attempts, {
          ...attemptLog,
          'failure.txt': JSON.stringify(previousFailure, null, 2),
        });
        continue;
      }
      commitSha = commitResult.sha;
    }

    // -- 6. done ------------------------------------------------------------
    writeAttemptLog(runDir, feature.id, attempts, attemptLog);
    safeUpdateFrontmatter(ctx.featurePath, {
      status: 'done',
      last_failure: null,
    });
    return {
      id: feature.id,
      status: 'done',
      attempts,
      duration_ms: Date.now() - startedAt,
      ...(commitSha ? { commit_sha: commitSha } : {}),
    };
  }

  // -- exhausted ------------------------------------------------------------
  safeUpdateFrontmatter(ctx.featurePath, {
    status: 'blocked',
    last_failure: previousFailure ?? null,
  });
  return {
    id: feature.id,
    status: 'blocked',
    attempts,
    duration_ms: Date.now() - startedAt,
    ...(previousFailure ? { failure: previousFailure } : {}),
  };
}

/**
 * Update a feature's frontmatter without letting a filesystem error
 * abort the ship run. The runner's happy path depends on the update
 * succeeding, but a crash here (e.g. disk full, permissions) should
 * surface as a log warning and NOT take the whole run down — the
 * feature's on-disk state may be inconsistent but the run result is
 * still returned to the orchestrator.
 */
function safeUpdateFrontmatter(path: string, patch: Record<string, unknown>): void {
  try {
    updateFeatureFrontmatter(path, patch);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[reins ship] failed to update ${path}: ${msg}`);
  }
}
