import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import type { ConstraintsConfig } from '../constraints/schema.js';
import type { VerifyResult } from './types.js';

/**
 * Load `pipeline.pre_commit` and `pipeline.feature_verify` from
 * `.reins/constraints.yaml`. Kept module-private so callers can't bypass
 * the "return [] on any failure" contract — broken YAML must not crash
 * the ship runner.
 */
function loadPipelineConfig(projectRoot: string): {
  pre_commit: string[];
  feature_verify: string[];
} {
  const path = join(projectRoot, '.reins', 'constraints.yaml');
  if (!existsSync(path)) return { pre_commit: [], feature_verify: [] };
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = yaml.load(raw) as ConstraintsConfig | null;
    return {
      pre_commit: parsed?.pipeline?.pre_commit ?? [],
      feature_verify: parsed?.pipeline?.feature_verify ?? [],
    };
  } catch {
    return { pre_commit: [], feature_verify: [] };
  }
}

interface RunCommandsOptions {
  cwd: string;
  timeoutMs: number;
}

/**
 * Run a list of shell commands sequentially, stopping at the first failure
 * and returning a structured `VerifyResult`. Never throws.
 *
 * Output is truncated to the last 4000 characters per-command to keep
 * attempt log files bounded and to keep retry prompts sub-token-budget.
 */
function runCommands(commands: string[], opts: RunCommandsOptions): VerifyResult {
  if (commands.length === 0) {
    return { passed: true, skipped: true };
  }

  for (const cmd of commands) {
    const result = runOne(cmd, opts);
    if (!result.passed) return result;
  }
  return { passed: true };
}

function runOne(cmd: string, opts: RunCommandsOptions): VerifyResult {
  try {
    execSync(cmd, {
      cwd: opts.cwd,
      encoding: 'utf-8',
      timeout: opts.timeoutMs,
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
      failure: {
        command: cmd,
        exit_code: typeof e.status === 'number' ? e.status : 1,
        output: combined.slice(-4000),
      },
    };
  }
}

/**
 * Fast verification layer run every ship attempt BEFORE `runFeatureVerify`.
 *
 * Identical commands to what `gate-stop` runs per Claude Code turn. The
 * overlap is intentional: catching lint errors here skips the expensive
 * feature_verify call, and catching them in gate-stop skips an entire
 * ship retry cycle.
 */
export function runPreCommit(projectRoot: string): VerifyResult {
  const { pre_commit } = loadPipelineConfig(projectRoot);
  return runCommands(pre_commit, { cwd: projectRoot, timeoutMs: 60_000 });
}

/**
 * Slower verification layer run once per feature attempt after pre_commit
 * passes. Unit tests, contract tests, integration tests belong here.
 *
 * Unlike `runPreCommit`, the timeout is generous (10 min) to accommodate
 * test suites. Still short-circuits on first failing command.
 */
export function runFeatureVerify(projectRoot: string, timeoutMs = 600_000): VerifyResult {
  const { feature_verify } = loadPipelineConfig(projectRoot);
  return runCommands(feature_verify, { cwd: projectRoot, timeoutMs });
}
