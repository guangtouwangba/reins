import type { Constraint, Severity } from '../constraints/schema.js';
import type { HookConfig } from '../hooks/types.js';

export type Profile = 'default' | 'strict' | 'relaxed' | 'fullstack' | string;

export interface PipelineOpts {
  profile: Profile;
  skipStages?: string[];
  onStageChange?: (stage: string, status: 'start' | 'complete' | 'skip' | 'fail') => void;
}

export interface StageResult {
  success: boolean;
  duration: number;
  output: string;
  error?: string;
  skipped?: boolean;
}

export interface StageLog {
  success: boolean;
  durationMs: number;
  output: string;
  error?: string;
  skipped?: boolean;
}

export interface PipelineResult {
  success: boolean;
  failedStage?: string;
  error?: string;
  logPath: string;
  durationMs: number;
  stages: Record<string, StageResult>;
}

export interface CommandResult {
  command: string;
  success: boolean;
  output: string;
  error: string;
  durationMs: number;
}

export interface QAResult {
  passed: boolean;
  results: CommandResult[];
}

export interface Plan {
  steps: string[];
  files: string[];
  verificationCases: string[];
}

export interface ExecutionResult {
  success: boolean;
  filesCreated: string[];
  filesModified: string[];
  output: string;
}

export interface ReviewResult {
  success: boolean;
  iterations: number;
  issues: string[];
}

export interface ExecOpts {
  maxRetries?: number;
  timeout?: number;
}

export interface InjectionContext {
  profile: Profile;
  constraints: Constraint[];
  hooks: HookConfig[];
  pipeline: {
    stages: string[];
    pre_commit: string[];
    post_develop: string[];
  };
}

export interface ExecutionRecord {
  id: string;
  task: string;
  profile: string;
  durationSeconds: number;
  outcome: 'success' | 'failure' | 'skipped';
  stages: Record<string, StageLog>;
  constraintsChecked: number;
  constraintsViolated: number;
  violations: string[];
}
