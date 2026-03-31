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
  planning: string;
  execution: string;
  verification: { engine: string; max_iterations: number };
  qa: boolean;
  pre_commit: string[];
  post_develop: string[];
}

export interface ProfileConfig {
  constraints: 'all' | Severity[];
  hooks: 'all' | Severity[];
  pipeline: string[];
  output_format?: string;
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
  profiles: Record<string, ProfileConfig>;
}
