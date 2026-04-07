import { execSync } from 'node:child_process';
import { minimatch } from 'minimatch';

/**
 * Result of a scope drift check. The ship runner logs `touchedFiles` as
 * info, and inspects `outOfScope` to decide whether to warn (serial) or
 * block (parallel).
 *
 * Empty arrays are returned on any error (git missing, not a repo, etc.)
 * — drift checking is a safety-net, not a critical path. If it can't
 * run, ship continues.
 */
export interface DriftResult {
  touchedFiles: string[];
  outOfScope: string[];
}

/**
 * Run `git status --porcelain` and classify each touched file against the
 * feature's declared `scope` globs.
 *
 * When `scopeGlobs` is undefined or empty, no drift is reported — the
 * feature didn't opt in to scope checking, so every change is considered
 * in-scope.
 *
 * Matching uses `minimatch` with `dot: true` so patterns like `src/**`
 * also match files under hidden directories if the user insists.
 */
export function checkScopeDrift(
  projectRoot: string,
  scopeGlobs: string[] | undefined,
): DriftResult {
  if (!scopeGlobs || scopeGlobs.length === 0) {
    return { touchedFiles: [], outOfScope: [] };
  }

  const touchedFiles = gitStatusPorcelain(projectRoot);
  if (touchedFiles.length === 0) {
    return { touchedFiles: [], outOfScope: [] };
  }

  const outOfScope = touchedFiles.filter(file =>
    !scopeGlobs.some(glob => minimatch(file, glob, { dot: true })),
  );

  return { touchedFiles, outOfScope };
}

/**
 * Parse `git status --porcelain` output into a list of file paths. The
 * porcelain v1 format is `XY path`, where `XY` is two status chars and
 * `path` is the rest of the line (with renames shown as `orig -> new`).
 *
 * For drift purposes we care about the currently-touched file, so on a
 * rename we return the destination. On any git failure we return an
 * empty array — caller interprets that as "no drift detected".
 */
function gitStatusPorcelain(projectRoot: string): string[] {
  let output: string;
  try {
    // `-uall` (aka --untracked-files=all) expands untracked directories to
    // their individual files. Without it git reports `dir/` which we can't
    // match against file globs like `src/**`.
    output = execSync('git status --porcelain -uall', {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
    });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const rawLine of output.split('\n')) {
    if (rawLine.length < 4) continue;
    // porcelain v1: columns 0-1 are status, column 2 is space, rest is path
    const path = rawLine.slice(3);
    if (!path) continue;

    // Rename: "orig -> new" — take the destination
    const arrowIdx = path.indexOf(' -> ');
    const cleaned = arrowIdx === -1 ? path : path.slice(arrowIdx + 4);

    // Strip quoting that git sometimes applies to non-ASCII paths
    const unquoted = cleaned.startsWith('"') && cleaned.endsWith('"')
      ? cleaned.slice(1, -1)
      : cleaned;

    files.push(unquoted);
  }
  return files;
}
