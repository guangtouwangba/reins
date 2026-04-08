export type Severity = 'critical' | 'important' | 'helpful';
export type ConstraintScope = 'global' | `directory:${string}`;
export type ConstraintSource = 'auto' | 'manual' | 'learned';
export type HookType = 'post_edit' | 'pre_bash' | 'pre_complete' | 'context_inject';
export type HookMode = 'block' | 'warn' | 'off';

export interface ConstraintEnforcement {
  soft: boolean;
  hook: boolean;
  hook_type?: HookType;
  hook_mode?: HookMode;
  hook_check?: string;
  ast_pattern?: string;
}

export interface Constraint {
  id: string;
  rule: string;
  severity: Severity;
  scope: ConstraintScope;
  source: ConstraintSource;
  enforcement: ConstraintEnforcement;
  status?: 'active' | 'draft' | 'deprecated';
}

export interface PipelineConfig {
  /**
   * Shell commands the gate-stop hook runs verbatim with cwd = repo root.
   * If any command exits non-zero, the Stop hook blocks the turn.
   * Populated by the user via the /reins:setup slash command after init.
   * Runs at EVERY Claude Code turn — keep it sub-60s (lint, typecheck).
   */
  pre_commit: string[];

  /**
   * Shell commands `reins ship` runs ONCE per feature after the implement
   * step succeeds, as a second verification layer. Unlike `pre_commit`,
   * these are allowed to be slower (minutes) — unit tests, integration
   * tests, contract tests belong here. Unused by the gate system.
   *
   * Empty/undefined means ship skips this layer with a warning.
   */
  feature_verify?: string[];

  /**
   * Playwright-based browser verification run per feature (after
   * `feature_verify` passes). Currently consumed by `reins ship` v2 only;
   * v1 schema-declares it but skips at runtime. See
   * `openspec/changes/2026-04-07-feature-ship/design.md` §5.
   */
  browser_verify?: BrowserVerifyConfig;
}

export interface BrowserVerifyConfig {
  /** Shell command that runs Playwright (e.g. `cd app/frontend && pnpm playwright test`). */
  command: string;
  /**
   * Directory where ship writes auto-generated Playwright specs (v2).
   * Relative to the repo root.
   */
  spec_dir: string;
  /**
   * Dev server lifecycle. Optional — when omitted, v2 ship asks Claude
   * Code to discover the command and persists it back here on success.
   */
  dev_server?: DevServerConfig;
}

export interface DevServerConfig {
  /** Shell command to start the dev server (backgrounded by ship). */
  command: string;
  /** URL ship polls until the server responds with a 2xx/3xx status. */
  wait_for_url: string;
  /** How long to wait for `wait_for_url` before giving up (ms). */
  timeout_ms: number;
  /** Signal used to stop the server at end of ship. Defaults to SIGTERM. */
  kill_signal?: 'SIGINT' | 'SIGTERM' | 'SIGKILL';
}

export interface ConstraintsConfig {
  version: number;
  generated_at: string;
  project: { name: string; type: string };
  stack: {
    primary_language: string;
    framework: string;
    test_framework: string;
    package_manager: string;
  };
  constraints: Constraint[];
  pipeline: PipelineConfig;
}
