import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Handle returned by `createWorktree`. Carries enough state for the
 * ship runner to invoke `rebaseAndMerge` and `removeWorktree` later
 * without the caller having to remember paths or sha values.
 */
export interface WorktreeHandle {
  featureId: string;
  /** Absolute path to the worktree checkout. */
  path: string;
  /** Internal branch name (e.g. `reins/feature-001-add-login`). */
  branchName: string;
  /** SHA the worktree was branched from. */
  baseCommit: string;
}

/**
 * Result of merging a worktree's tip back onto the main checkout.
 * Conflicts are surfaced as structured data rather than thrown, so the
 * ship runner can mark the feature `blocked` and keep the worktree for
 * user inspection.
 */
export type RebaseResult =
  | { success: true; sha: string }
  | { success: false; conflict: string };

/**
 * Create a git worktree for a feature and return its handle.
 *
 * Layout:
 *   .reins/wt/<featureId>/       — the worktree checkout
 *   refs/heads/reins/feature-<id> — internal branch
 *
 * The worktree is branched from the current HEAD of `projectRoot`. If
 * the branch already exists (stale from a previous run), we use
 * `--force` to reuse the name — the worktree path is fresh because
 * `removeWorktree` cleans up on exit.
 */
export function createWorktree(projectRoot: string, featureId: string): WorktreeHandle {
  const wtRel = join('.reins', 'wt', featureId);
  const wtAbs = resolve(projectRoot, wtRel);
  const branchName = `reins/feature-${featureId}`;

  const baseCommit = execSync('git rev-parse HEAD', {
    cwd: projectRoot,
    encoding: 'utf-8',
  }).trim();

  // If an old worktree at the same path exists, remove it first — leftover
  // worktrees from crashed runs block `git worktree add`.
  if (existsSync(wtAbs)) {
    try {
      execSync(`git worktree remove --force ${JSON.stringify(wtRel)}`, {
        cwd: projectRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      // ignore — add will error loudly below if this was a real problem
    }
  }

  // Use `-B` to (re)create the branch pointing at HEAD. Idempotent across
  // reruns without needing a separate branch existence check.
  execSync(
    `git worktree add -B ${JSON.stringify(branchName)} ${JSON.stringify(wtRel)} HEAD`,
    { cwd: projectRoot, stdio: ['ignore', 'pipe', 'pipe'] },
  );

  return { featureId, path: wtAbs, branchName, baseCommit };
}

/**
 * Cherry-pick the worktree's tip commit onto `projectRoot`'s current
 * branch. We use cherry-pick (not rebase) because a worktree typically
 * holds exactly one reins-generated commit per feature — cherry-pick's
 * conflict semantics are simpler and we don't need to rewrite history.
 *
 * On conflict, aborts the cherry-pick so the main checkout is left
 * clean, and returns the conflict message for the caller to surface to
 * the user. The worktree is NOT removed — the user may want to inspect
 * the failing state.
 *
 * Returns `{ success: false, conflict: string }` on any git error
 * (conflict, missing commit, wrong branch, etc.) rather than throwing.
 */
export function rebaseAndMerge(projectRoot: string, handle: WorktreeHandle): RebaseResult {
  // The worktree's tip commit
  let tipSha: string;
  try {
    tipSha = execSync(`git rev-parse ${JSON.stringify(handle.branchName)}`, {
      cwd: projectRoot,
      encoding: 'utf-8',
    }).trim();
  } catch (err) {
    return { success: false, conflict: formatErr('rev-parse', err) };
  }

  // If the worktree never committed anything (i.e. tip === baseCommit),
  // there's nothing to merge back. Signal success with the base sha so
  // the caller can keep moving.
  if (tipSha === handle.baseCommit) {
    return { success: true, sha: handle.baseCommit };
  }

  try {
    execSync(`git cherry-pick ${JSON.stringify(tipSha)}`, {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const newHead = execSync('git rev-parse HEAD', {
      cwd: projectRoot,
      encoding: 'utf-8',
    }).trim();
    return { success: true, sha: newHead };
  } catch (err) {
    const conflictMsg = formatErr('cherry-pick', err);
    // Always try to abort so the main checkout isn't left mid-cherry-pick.
    try {
      execSync('git cherry-pick --abort', {
        cwd: projectRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      // Best effort — if there's no cherry-pick in progress, --abort itself errors.
    }
    return { success: false, conflict: conflictMsg };
  }
}

/**
 * Remove the worktree directory. With `force=true` uses `--force` to
 * wipe uncommitted changes; otherwise git refuses if the worktree is
 * dirty (which is the safer default for successful merges).
 *
 * Does not delete the branch ref. That's intentional — if the worktree
 * is being kept for inspection, the branch should stay reachable.
 */
export function removeWorktree(
  projectRoot: string,
  handle: WorktreeHandle,
  force: boolean,
): void {
  const wtRel = join('.reins', 'wt', handle.featureId);
  const cmd = force
    ? `git worktree remove --force ${JSON.stringify(wtRel)}`
    : `git worktree remove ${JSON.stringify(wtRel)}`;
  try {
    execSync(cmd, { cwd: projectRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    // Non-fatal: if the worktree is already gone or refuses removal, the
    // caller can fall back to manual cleanup. We don't want a cleanup
    // failure to abort the ship run.
  }
}

function formatErr(action: string, err: unknown): string {
  const e = err as NodeJS.ErrnoException & { stdout?: unknown; stderr?: unknown };
  const stdout = typeof e.stdout === 'string' ? e.stdout : '';
  const stderr = typeof e.stderr === 'string' ? e.stderr : '';
  const combined = `${stdout}\n${stderr}`.trim() || e.message || 'unknown error';
  return `git ${action}: ${combined.slice(0, 2000)}`;
}
