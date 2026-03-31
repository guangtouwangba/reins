export interface CommandResult {
  name: 'lint' | 'typecheck' | 'test';
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  skipped: boolean;
}

export interface L0Result {
  passed: boolean;
  commands: CommandResult[];
  detectedPackageManager: string;
}

export interface CheckResult {
  name: string;
  passed: boolean;
  output: string;
  durationMs: number;
}

export interface CoverageCheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

export interface L1Result {
  passed: boolean;
  checks: CoverageCheckResult[];
}

export interface L2CaseResult {
  id: string;
  passed: boolean;
  actualStatus: number | null;
  expectedStatus: number;
  error?: string;
}

export interface L2Result {
  passed: boolean;
  skipped: boolean;
  casesTotal: number;
  casesPassed: number;
  casesFailed: L2CaseResult[];
}

export interface L3StepResult {
  stepId: string;
  passed: boolean;
  error?: string;
}

export interface L3Result {
  passed: boolean;
  skipped: boolean;
  total: number;
  passedCount: number;
  failedCount: number;
  results: L3StepResult[];
  screenshots: string[];
}

export interface L4Result {
  confidence: number;
  completeness: string;
  issues: string[];
  suggestions: string[];
}

export interface EvalResult {
  l0: L0Result;
  l1: L1Result | null;
  l2: L2Result | null;
  l3: L3Result | null;
  l4: L4Result | null;
}

export interface ExitCondition {
  L0_passed: boolean;
  L1_passed: boolean;
  L2_passed: boolean;
  L3_passed: boolean;
  L4_confidence: number;
  iterationCount: number;
  maxIterations: number;
}

export interface DetectedCommands {
  packageManager: string;
  lint: { command: string | null; scriptKey: string | null };
  typecheck: { command: string | null; scriptKey: string | null };
  test: { command: string | null; scriptKey: string | null };
}
