import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunSummary } from './types.js';

/**
 * Create a fresh run directory under `<projectRoot>/.reins/runs/<iso>/`.
 *
 * The ISO timestamp is sanitized for filesystem safety (`:` → `-`,
 * milliseconds preserved with `.` → `-`) so it's safe on macOS, Linux,
 * and Windows. Two ship invocations within the same millisecond would
 * still collide; appending a 4-char random suffix avoids that.
 *
 * Returns the absolute directory path for the caller to use as `logDir`
 * for subsequent logging.
 */
export function createRunDir(projectRoot: string): string {
  const iso = new Date().toISOString();
  const safe = iso.replace(/:/g, '-').replace(/\./g, '-');
  const suffix = Math.random().toString(36).slice(2, 6);
  const runDir = join(projectRoot, '.reins', 'runs', `${safe}-${suffix}`);
  mkdirSync(runDir, { recursive: true });
  return runDir;
}

/**
 * Write a single attempt's artifacts under
 * `<runDir>/<featureId>/attempt-<n>/`.
 *
 * `artifacts` is a flat `filename → content` map. Values are written
 * verbatim (strings → UTF-8, Buffer → raw). Filenames should not contain
 * slashes — the helper is flat by design.
 *
 * Creates the directory tree if it doesn't exist. Never throws on a
 * logging error — the ship runner's real work must not depend on log
 * writes succeeding.
 */
export function writeAttemptLog(
  runDir: string,
  featureId: string,
  attemptNum: number,
  artifacts: Record<string, string>,
): void {
  try {
    const attemptDir = join(runDir, featureId, `attempt-${attemptNum}`);
    mkdirSync(attemptDir, { recursive: true });
    for (const [filename, content] of Object.entries(artifacts)) {
      writeFileSync(join(attemptDir, filename), content, 'utf-8');
    }
  } catch {
    // Non-fatal: logging failure should not abort ship.
  }
}

/**
 * Serialize the top-level `RunSummary` to `<runDir>/run.json`. Written at
 * the end of `runShip` (and on graceful SIGINT) so the user can inspect
 * what happened even on abort.
 *
 * Never throws. If the write fails, the in-memory result is still
 * returned to the caller — run logs are a debugging aid, not a source of
 * truth.
 */
export function writeRunSummary(runDir: string, summary: RunSummary): void {
  try {
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, 'run.json'),
      JSON.stringify(summary, null, 2),
      'utf-8',
    );
  } catch {
    // Non-fatal.
  }
}
