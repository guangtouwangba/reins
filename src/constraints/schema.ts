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
   * Populated by the user via the /reins-setup slash command after init.
   */
  pre_commit: string[];
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
