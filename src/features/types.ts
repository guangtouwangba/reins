/**
 * Feature queue types for `reins ship`.
 *
 * Features live as markdown files with YAML frontmatter under
 * `.reins/features/<id>.md`. The frontmatter stores the state the ship runner
 * reads and updates (`status`, `last_run_id`, `last_failure`); the body is
 * the human-written intent, acceptance criteria, and notes.
 *
 * This module only defines the in-memory shapes. Persistence is split into
 * `parser.ts` (read) and `storage.ts` (write) so the body is always preserved
 * byte-for-byte when only frontmatter fields change.
 */

/**
 * State machine for a feature's lifecycle.
 *
 * - `draft`       — author is still writing; ship does not pick it up.
 * - `todo`        — ready for ship to work on.
 * - `in-progress` — ship runner is actively implementing this feature.
 * - `implemented` — code written, verify not yet run (transient).
 * - `verified`    — verify passed, commit not yet run (transient).
 * - `done`        — verify passed and (if enabled) commit succeeded.
 * - `blocked`     — max_attempts exhausted or fatal error; `last_failure` set.
 */
export type FeatureStatus =
  | 'draft'
  | 'todo'
  | 'in-progress'
  | 'implemented'
  | 'verified'
  | 'done'
  | 'blocked';

export const FEATURE_STATUSES: readonly FeatureStatus[] = [
  'draft',
  'todo',
  'in-progress',
  'implemented',
  'verified',
  'done',
  'blocked',
] as const;

/**
 * Captured context from a failed ship attempt. Recorded on the feature
 * frontmatter when the feature transitions to `blocked`, and carried in
 * memory on the retry path inside the ship runner so it can be fed back to
 * the next `claude -p` call as failure feedback.
 */
export interface FailureContext {
  /** Which layer of the ship loop failed. */
  stage: 'claude' | 'scope-drift' | 'pre_commit' | 'feature_verify' | 'browser_verify' | 'commit' | 'rebase';
  /** The exact shell command (or spawn invocation) that failed. */
  command: string;
  /** Non-zero exit code captured from the failing subprocess. */
  exit_code: number;
  /** Combined stdout + stderr output from the failing command. */
  output: string;
  /**
   * Short tail of the output suitable for persisting in the feature's
   * frontmatter. Kept bounded so the YAML doesn't balloon.
   */
  trace_tail?: string;
}

/**
 * A feature as represented in memory. Mirrors the on-disk YAML frontmatter
 * plus the markdown body. Persistence helpers live in `parser.ts` and
 * `storage.ts`.
 */
export interface Feature {
  /**
   * Kebab-case identifier, unique across `.reins/features/`. Matches the
   * filename (without the `.md` extension) for traceability.
   */
  id: string;

  /** Short human-readable title. Used in logs and commit messages. */
  title: string;

  /** Current lifecycle state. Updated exclusively via `updateFeatureFrontmatter`. */
  status: FeatureStatus;

  /**
   * Lower values = higher priority. Ties broken by `created_at`.
   * Defaults to 100 when the frontmatter omits the field.
   */
  priority: number;

  /**
   * List of feature ids this feature waits for. A feature cannot be picked
   * up by ship until every id in this list has status `done`. Cycles are
   * rejected by `hasCycle`.
   */
  depends_on: string[];

  /**
   * Per-feature override of `ShipConfig.default_max_attempts`. When unset,
   * ship uses the global default.
   */
  max_attempts?: number;

  /**
   * Glob patterns describing which files this feature is allowed to touch.
   * Used by `checkScopeDrift`: in serial mode out-of-scope changes log a
   * warning; in parallel mode they block (drift would pollute other
   * worktrees' rebase).
   */
  scope?: string[];

  /** ISO 8601 timestamp of feature creation. */
  created_at: string;

  /** ISO 8601 timestamp of the last frontmatter update. Auto-bumped on write. */
  updated_at: string;

  /**
   * Basename of the last `.reins/runs/<id>/` directory that processed this
   * feature, or `null` if the feature has never been run by ship.
   */
  last_run_id: string | null;

  /**
   * Populated when the feature was last marked `blocked`. Cleared when the
   * user manually returns the feature to `todo` and it ships successfully.
   */
  last_failure: FailureContext | null;

  /**
   * Markdown body — everything after the frontmatter block. Preserved
   * byte-for-byte by `updateFeatureFrontmatter`.
   */
  body: string;
}

/** Type guard for `FeatureStatus`. */
export function isFeatureStatus(value: unknown): value is FeatureStatus {
  return typeof value === 'string' && (FEATURE_STATUSES as readonly string[]).includes(value);
}
