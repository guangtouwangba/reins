import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Feature } from '../features/types.js';
import type { BrowserVerifyConfig } from '../constraints/schema.js';
import type { ClaudeRunOptions, ClaudeRunResult } from './types.js';
import { buildSpecGenPrompt, extractBrowserTestSection } from './prompt-builder.js';

/**
 * Outcome of a spec-generation attempt. `action` tells the caller what
 * actually happened; `specPath` is the resolved absolute path to the
 * spec file (whether or not it now exists). `reason` is populated for
 * skipped/failed actions so the browser verify runner can surface why.
 */
export interface SpecGenResult {
  action: 'reused' | 'generated' | 'skipped' | 'failed';
  specPath: string;
  reason?: string;
}

export interface EnsureFeatureSpecDeps {
  spawn?: (prompt: string, opts: ClaudeRunOptions) => Promise<ClaudeRunResult>;
  timeoutMs?: number;
}

/**
 * Ensure a Playwright spec file exists for the given feature.
 *
 * Idempotent in two ways:
 * 1. If a file already exists at `<spec_dir>/<feature-id>.spec.ts`, we
 *    reuse it — spec gen is a one-time cost per feature, and editing
 *    a generated spec by hand is a legitimate user action we should
 *    respect.
 * 2. If the feature has no `## Browser test` section at all, we skip
 *    (not fail). The caller — `runBrowserVerify` — treats skip as
 *    "browser verify isn't applicable to this feature".
 *
 * Generation path: spawn claude with `buildSpecGenPrompt`, then verify
 * the file actually exists on disk. A successful exit code doesn't
 * prove the file was written — models sometimes reason about writing
 * without actually emitting the Edit/Write tool call.
 */
export async function ensureFeatureSpec(
  feature: Feature,
  projectRoot: string,
  browserVerifyConfig: BrowserVerifyConfig,
  runDir: string,
  deps: EnsureFeatureSpecDeps = {},
): Promise<SpecGenResult> {
  const specPath = resolveSpecPath(feature, projectRoot, browserVerifyConfig);

  if (existsSync(specPath)) {
    return { action: 'reused', specPath };
  }

  const browserTest = extractBrowserTestSection(feature.body);
  if (browserTest === null) {
    return {
      action: 'skipped',
      specPath,
      reason: `Feature ${feature.id} has no "## Browser test" section`,
    };
  }

  // Ensure the spec_dir exists so claude has somewhere to write.
  try {
    mkdirSync(dirname(specPath), { recursive: true });
  } catch (err) {
    return {
      action: 'failed',
      specPath,
      reason: `Could not create spec dir: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Detect an existing playwright config so the prompt can reference it.
  const playwrightConfigPath = findPlaywrightConfig(projectRoot);

  const prompt = buildSpecGenPrompt(feature, specPath, playwrightConfigPath);

  const { spawnClaudeHeadless } = await import('./claude-spawn.js');
  const spawnFn = deps.spawn ?? spawnClaudeHeadless;

  let result: ClaudeRunResult;
  try {
    result = await spawnFn(prompt, {
      cwd: projectRoot,
      timeoutMs: deps.timeoutMs ?? 300_000,
      logDir: runDir,
    });
  } catch (err) {
    return {
      action: 'failed',
      specPath,
      reason: `spec-gen spawn error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (result.exitCode !== 0) {
    return {
      action: 'failed',
      specPath,
      reason: `spec-gen claude exited ${result.exitCode}: ${result.stderr.slice(-500)}`,
    };
  }

  // The critical check: the model may exit 0 without actually writing
  // the file (reasoned about the task but didn't call a write tool).
  if (!existsSync(specPath)) {
    return {
      action: 'failed',
      specPath,
      reason: `spec-gen claude exited 0 but no file was written at ${specPath}`,
    };
  }

  return { action: 'generated', specPath };
}

/**
 * Compute the absolute path where a feature's Playwright spec should
 * live. Uses `<browserVerifyConfig.spec_dir>/<feature-id>.spec.ts`
 * relative to the project root.
 */
function resolveSpecPath(
  feature: Feature,
  projectRoot: string,
  config: BrowserVerifyConfig,
): string {
  return join(projectRoot, config.spec_dir, `${feature.id}.spec.ts`);
}

/**
 * Look for a Playwright config at common locations. Returns a
 * project-relative path string when found, or `undefined` when the
 * project has no Playwright config (in which case the prompt still
 * works, it just can't reference conventions).
 */
function findPlaywrightConfig(projectRoot: string): string | undefined {
  const candidates = [
    'playwright.config.ts',
    'playwright.config.js',
    'playwright.config.mjs',
    'app/frontend/playwright.config.ts',
    'frontend/playwright.config.ts',
    'packages/web/playwright.config.ts',
  ];
  for (const candidate of candidates) {
    if (existsSync(join(projectRoot, candidate))) return candidate;
  }
  return undefined;
}
