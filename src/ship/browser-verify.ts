import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import type { Feature } from '../features/types.js';
import type {
  BrowserVerifyConfig,
  ConstraintsConfig,
  DevServerConfig,
} from '../constraints/schema.js';
import type { VerifyResult } from './types.js';
import type { SpecGenResult } from './spec-gen.js';
import { ensureFeatureSpec } from './spec-gen.js';
import {
  startDevServer,
  waitForUrl,
  discoverDevServer,
  type DevServerHandle,
  type FetchLike,
} from './dev-server.js';
import { extractBrowserTestSection } from './prompt-builder.js';

/**
 * Dependencies for `runBrowserVerify`. Every moving part is injectable
 * so the unit tests can run without real subprocesses, a real dev
 * server, or real claude calls.
 */
export interface BrowserVerifyDeps {
  ensureFeatureSpec?: typeof ensureFeatureSpec;
  startDevServer?: typeof startDevServer;
  waitForUrl?: typeof waitForUrl;
  discoverDevServer?: typeof discoverDevServer;
  /** Runs the Playwright command. Defaults to execSync. */
  runCommand?: (command: string, cwd: string, timeoutMs: number) => RunCommandResult;
  /** Injectable fetch for waitForUrl's poll loop. */
  fetch?: FetchLike;
}

export type RunCommandResult =
  | { passed: true }
  | { passed: false; exit_code: number; output: string };

/**
 * Orchestrate the browser verification layer for a single feature
 * attempt. This runs AFTER `runFeatureVerify` has passed, just before
 * the commit step in the ship runner's state machine.
 *
 * Skip conditions (return `{ passed: true, skipped: true }`):
 * - `pipeline.browser_verify` is not configured in constraints.yaml
 * - The feature body has no `## Browser test` section
 * - Dev server discovery fails AND no dev_server is configured (v1
 *   treats browser verify as best-effort — an unreachable dev server
 *   should not block a feature whose unit tests passed)
 *
 * Failure conditions (return `{ passed: false, failure: {...} }`):
 * - Spec generation fails (claude exited 0 but no file written)
 * - Dev server fails to respond at `wait_for_url` within timeout
 * - The Playwright command exits non-zero
 *
 * The dev server is always killed in a finally block, whether the
 * verification passed, failed, or threw.
 */
export async function runBrowserVerify(
  feature: Feature,
  projectRoot: string,
  runDir: string,
  deps: BrowserVerifyDeps = {},
): Promise<VerifyResult> {
  // -- Phase 1: config + skip checks --------------------------------------
  const browserVerifyConfig = loadBrowserVerifyConfig(projectRoot);
  if (!browserVerifyConfig) {
    return { passed: true, skipped: true };
  }
  if (extractBrowserTestSection(feature.body) === null) {
    return { passed: true, skipped: true };
  }

  // -- Phase 2: spec generation -------------------------------------------
  const ensureSpec = deps.ensureFeatureSpec ?? ensureFeatureSpec;
  const specResult: SpecGenResult = await ensureSpec(
    feature,
    projectRoot,
    browserVerifyConfig,
    runDir,
  );

  if (specResult.action === 'skipped') {
    // This path implies the feature body actually does have a browser
    // test section (we checked) but spec-gen returned skipped anyway —
    // a config mismatch. Surface as skipped, not failure, so it doesn't
    // block the run.
    return { passed: true, skipped: true };
  }
  if (specResult.action === 'failed') {
    return {
      passed: false,
      failure: {
        command: 'spec generation',
        exit_code: 1,
        output: specResult.reason ?? 'spec generation failed',
      },
    };
  }
  // action === 'reused' or 'generated' — continue

  // -- Phase 3: ensure dev server config ----------------------------------
  let devServerConfig: DevServerConfig | null = browserVerifyConfig.dev_server ?? null;
  if (!devServerConfig) {
    const discover = deps.discoverDevServer ?? discoverDevServer;
    devServerConfig = await discover(projectRoot, runDir);
  }
  if (!devServerConfig) {
    // v1 treats discovery failure as a skip: the unit tests passed,
    // browser verify is best-effort, don't block the feature.
    return { passed: true, skipped: true };
  }

  // -- Phase 4: run the verify with server lifecycle guard ----------------
  const startFn = deps.startDevServer ?? startDevServer;
  const waitFn = deps.waitForUrl ?? waitForUrl;
  const runCmdFn = deps.runCommand ?? defaultRunCommand;

  let handle: DevServerHandle | null = null;
  try {
    handle = startFn(devServerConfig, projectRoot);

    const ready = await waitFn(
      devServerConfig.wait_for_url,
      devServerConfig.timeout_ms,
      { fetch: deps.fetch },
    );
    if (!ready) {
      return {
        passed: false,
        failure: {
          command: `wait ${devServerConfig.wait_for_url}`,
          exit_code: 1,
          output: `Dev server did not respond at ${devServerConfig.wait_for_url} within ${devServerConfig.timeout_ms}ms`,
        },
      };
    }

    const cmdResult = runCmdFn(browserVerifyConfig.command, projectRoot, 600_000);
    if (cmdResult.passed) {
      return { passed: true };
    }
    return {
      passed: false,
      failure: {
        command: browserVerifyConfig.command,
        exit_code: cmdResult.exit_code,
        output: cmdResult.output,
      },
    };
  } finally {
    // Explicitly swallow any error from stop() so it can't shadow the
    // original verify result. `handle.stop()` is already defensive, but
    // belt-and-suspenders: a cleanup failure must never surface as the
    // run's outcome.
    if (handle) {
      try { handle.stop(); } catch { /* non-fatal */ }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Load `pipeline.browser_verify` from constraints.yaml. Returns `null`
 * when the file is missing, unreadable, or has no `browser_verify`
 * field — the ship runner's browser verify layer treats all three the
 * same (skip, not fail).
 */
function loadBrowserVerifyConfig(projectRoot: string): BrowserVerifyConfig | null {
  const path = join(projectRoot, '.reins', 'constraints.yaml');
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = yaml.load(raw) as ConstraintsConfig | null;
    return parsed?.pipeline?.browser_verify ?? null;
  } catch {
    return null;
  }
}

/**
 * Default command runner for Phase 4 — shells out via execSync with
 * the project root as cwd. Captures combined stdout + stderr and
 * truncates to the last 4000 characters so retry prompts stay bounded.
 */
function defaultRunCommand(command: string, cwd: string, timeoutMs: number): RunCommandResult {
  try {
    execSync(command, {
      cwd,
      encoding: 'utf-8',
      timeout: timeoutMs,
      stdio: 'pipe',
      shell: '/bin/sh',
    });
    return { passed: true };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      stdout?: unknown;
      stderr?: unknown;
      status?: number | null;
    };
    const stdout = typeof e.stdout === 'string' ? e.stdout : '';
    const stderr = typeof e.stderr === 'string' ? e.stderr : '';
    const combined = `${stdout}\n${stderr}`.trim() || e.message || 'unknown error';
    return {
      passed: false,
      exit_code: typeof e.status === 'number' ? e.status : 1,
      output: combined.slice(-4000),
    };
  }
}
