import { execSync } from 'node:child_process';
import type { Feature } from '../features/types.js';

/**
 * How the ship runner formats commit subject lines. Chosen per-ship via
 * `detectCommitStyle` (reads the project's existing `git log`) unless
 * the user overrides it in `.reins/config.yaml` under `ship.commit_style`.
 *
 * - `conventional` — `feat: <title>` + blank line + reins footer
 * - `free`         — `<title>`       + blank line + reins footer
 * - `custom`       — user-supplied template with `{title}`, `{id}`,
 *                    `{run_id}`, `{attempts}` placeholders
 */
export type CommitStyle = 'conventional' | 'free' | 'custom';

/** Override type accepted from `.reins/config.yaml`. `auto` triggers detection. */
export type CommitStyleOverride = 'auto' | CommitStyle;

export type CommitResult =
  | { success: true; sha: string }
  | { success: false; hookOutput: string };

/**
 * Conventional Commits v1 subject-line pattern, anchored to the start of
 * the line after the sha prefix is stripped.
 */
const CONVENTIONAL_RE =
  /^(feat|fix|chore|docs|refactor|test|style|perf|build|ci|revert)(\([^)]+\))?!?: /;

/**
 * Detect the commit style to use for this run.
 *
 * - `override !== 'auto'` → return it verbatim. User wins.
 * - `override === 'auto'` → read `git log --oneline -20` and return
 *   `conventional` if ≥80% of the lines match Conventional Commits;
 *   otherwise `free`.
 *
 * A repo with no commits (or an unreadable log) returns `free` — it's
 * the conservative choice since a `feat:` prefix on an empty history
 * doesn't establish a convention.
 */
export function detectCommitStyle(projectRoot: string, override: CommitStyleOverride): CommitStyle {
  if (override !== 'auto') return override;

  let log: string;
  try {
    log = execSync('git log --oneline -20', {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    return 'free';
  }

  const lines = log
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return 'free';

  // Each line is "<sha> <subject>". Strip the sha before matching.
  const matched = lines.filter(line => {
    const spaceIdx = line.indexOf(' ');
    const subject = spaceIdx === -1 ? line : line.slice(spaceIdx + 1);
    return CONVENTIONAL_RE.test(subject);
  }).length;

  return matched / lines.length >= 0.8 ? 'conventional' : 'free';
}

/**
 * Build the full commit message for a feature. Subject line is
 * determined by `style`; body contains the reins footer so commits can
 * be traced back to their originating run directory.
 *
 * The reins footer uses trailer-style `Key: value` lines. It's parseable
 * by `git interpret-trailers` and doesn't interfere with hooks that
 * scan for conventional prefixes.
 */
export function buildCommitMessage(
  feature: Feature,
  runId: string,
  attempts: number,
  style: CommitStyle,
  template?: string,
): string {
  if (style === 'custom' && template) {
    return template
      .replaceAll('{title}', feature.title)
      .replaceAll('{id}', feature.id)
      .replaceAll('{run_id}', runId)
      .replaceAll('{attempts}', String(attempts));
  }

  const subject = style === 'conventional' ? `feat: ${feature.title}` : feature.title;
  const footer = [
    '',
    '',
    `Reins-feature-id: ${feature.id}`,
    `Reins-run-id: ${runId}`,
    `Reins-attempts: ${attempts}`,
  ].join('\n');
  return subject + footer;
}

/**
 * Stage all changes in `cwd` and create a commit. Runs through the
 * project's own pre-commit hook — we never pass `--no-verify`. If the
 * hook rejects the commit (non-zero exit), we capture its output and
 * return a structured failure so the ship runner can feed it back into
 * the next implement attempt.
 *
 * Cases handled:
 * - Clean commit      → `{ success: true, sha }`
 * - Nothing to commit → `{ success: false, hookOutput }` with a clear message
 * - Hook rejection    → `{ success: false, hookOutput }` with the hook's output
 *
 * Does NOT push. Does NOT create a PR. The caller decides what to do
 * with the new sha.
 */
export function commitFeature(
  cwd: string,
  feature: Feature,
  runId: string,
  attempts: number,
  style: CommitStyle,
  template?: string,
): CommitResult {
  // Stage everything. `git add -A` picks up new, modified, and deleted files.
  try {
    execSync('git add -A', { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    return { success: false, hookOutput: formatGitErr('add', err) };
  }

  // Early exit if there's literally nothing to commit — git commit would
  // error with "nothing to commit, working tree clean" and we'd return a
  // misleading failure. Treat this as a failure so the ship runner knows
  // Claude Code didn't actually change anything.
  let porcelain = '';
  try {
    porcelain = execSync('git status --porcelain', {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    // Fall through — if status fails, let git commit produce the error
  }
  if (porcelain === '') {
    return {
      success: false,
      hookOutput:
        'Nothing to commit — `git status --porcelain` is empty. The implement step did not produce any changes to stage.',
    };
  }

  const message = buildCommitMessage(feature, runId, attempts, style, template);

  try {
    // Pass the message via env var + `-F -` pipe to avoid shell escaping
    // headaches with multi-line messages.
    execSync('git commit -F -', {
      cwd,
      input: message,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    return { success: false, hookOutput: formatGitErr('commit', err) };
  }

  try {
    const sha = execSync('git rev-parse HEAD', {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return { success: true, sha };
  } catch (err) {
    return { success: false, hookOutput: formatGitErr('rev-parse', err) };
  }
}

function formatGitErr(action: string, err: unknown): string {
  const e = err as NodeJS.ErrnoException & { stdout?: unknown; stderr?: unknown };
  const stdout = typeof e.stdout === 'string' ? e.stdout : '';
  const stderr = typeof e.stderr === 'string' ? e.stderr : '';
  const combined = `${stdout}\n${stderr}`.trim() || e.message || 'unknown error';
  return `git ${action}: ${combined.slice(-4000)}`;
}
