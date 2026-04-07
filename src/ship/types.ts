import type { FailureContext } from '../features/types.js';

/**
 * A single step in an execution plan. The planner emits a sequence of
 * steps that the ship orchestrator walks in order. `serial` steps run
 * their features one at a time; `parallel` steps run them concurrently
 * via `pLimit`, each in its own worktree.
 */
export interface ExecutionStep {
  mode: 'serial' | 'parallel';
  /** Feature ids to run in this step. Each id appears in exactly one step across the whole plan. */
  features: string[];
  /** One-sentence justification from the planner (or the fallback). */
  reason: string;
}

/**
 * The output of `planExecution` — the scheduled order of todo features
 * annotated with serial/parallel mode. `source` distinguishes the two
 * provenance paths so logs and errors can attribute decisions correctly.
 */
export interface ExecutionPlan {
  steps: ExecutionStep[];
  /** Hard cap on concurrent features within any parallel step. */
  parallelism: number;
  /** Rough walltime estimate (best-effort). */
  estimated_minutes: number;
  /** `ai` when the planner spawn succeeded; `fallback` otherwise. */
  source: 'ai' | 'fallback';
}

/**
 * Structured result returned by the three-layer verify chain
 * (`pre_commit` → `feature_verify` → `browser_verify`). Each layer
 * short-circuits on first failure and reports the failing command.
 *
 * `skipped: true` means the layer had nothing configured to run — this is
 * a legitimate "pass by default" outcome, not an error.
 */
export interface VerifyResult {
  passed: boolean;
  /** True when the layer had no commands configured; ship treats as pass. */
  skipped?: boolean;
  /** Populated when `passed: false`. */
  failure?: {
    command: string;
    exit_code: number;
    output: string;
  };
}

/**
 * Top-level per-run summary written to `.reins/runs/<iso>/run.json` at
 * the end of a ship invocation. Kept shallow so humans can grep it.
 */
export interface RunSummary {
  /** ISO timestamp basename of this run's directory (matches dir name). */
  id: string;
  /** ISO timestamp when ship started. */
  started_at: string;
  /** ISO timestamp when ship finished (or aborted). */
  finished_at: string;
  /** Total walltime in ms. */
  duration_ms: number;
  /** Per-feature results in execution order. */
  features: FeatureRunResult[];
  /** Aggregate counts across all features in this run. */
  totals: {
    done: number;
    blocked: number;
    duration_ms: number;
    token_usage?: { input: number; output: number };
  };
  /**
   * The execution plan used by this run. Populated on `--dry-run` so the
   * user can read `run.json` and see what would have executed. Omitted on
   * live runs to avoid duplicating `plan.json` in the same directory.
   */
  plan?: ExecutionPlan;
}

/**
 * Per-feature outcome recorded in `RunSummary.features`. Emitted whether
 * the feature finished successfully or was blocked.
 */
export interface FeatureRunResult {
  id: string;
  status: 'done' | 'blocked';
  attempts: number;
  duration_ms: number;
  /** Git commit sha created by the auto-commit step, if enabled and successful. */
  commit_sha?: string;
  token_usage?: { input: number; output: number };
  /** When `status === 'blocked'`, the failure that exhausted the attempt budget. */
  failure?: FailureContext;
}

/**
 * Options passed to `spawnClaudeHeadless`. Keeps the call site small and
 * makes testing easier (inject a fake binary + args to drive the wrapper
 * with a stand-in process, without mocking `node:child_process`).
 */
export interface ClaudeRunOptions {
  cwd: string;
  /** Hard cap on wall time per call. Default: 10 min. */
  timeoutMs: number;
  /** Extra env vars merged with the parent process env. */
  env?: Record<string, string>;
  /** Propagates Ctrl+C from the ship runner down to the child. */
  signal?: AbortSignal;
  /** Directory where per-attempt log files are written. */
  logDir: string;
  /**
   * Executable to invoke. Defaults to `'claude'`. Tests pass a stand-in
   * (e.g. `/bin/sh`) together with `buildArgs` to exercise the wrapper
   * without depending on a real Claude Code install.
   */
  binary?: string;
  /**
   * Argument builder. Defaults to `(prompt) => ['-p', prompt]`. Tests use
   * this together with `binary` to drive arbitrary commands through the
   * same spawn/timeout/log machinery.
   */
  buildArgs?: (prompt: string) => string[];
}

/**
 * Result of a single `claude -p` subprocess invocation. `exit_code === 0`
 * means the turn completed — it does NOT imply the feature is done. That
 * determination belongs to the verify layer.
 */
export interface ClaudeRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** True when ship killed the child because `timeoutMs` expired. */
  timedOut: boolean;
  /** Best-effort parse from the stdout tail; `undefined` when unparseable. */
  tokenUsage?: { input: number; output: number };
}
