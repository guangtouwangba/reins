import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { startService, stopService } from './environment-manager.js';
import type { EnvironmentStartConfig, ServiceHandle } from './environment-manager.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VerificationCase {
  id: string;
  description: string;
  method: string;
  path: string;
  expect: { status: number };
  passes: boolean;
}

interface VerificationEnvironment {
  start: {
    command: string;
    port: number;
    health_check: string;
    startup_timeout: number;
    env_file?: string;
  };
  dependencies?: Array<{ name: string; check: string; setup?: string }>;
}

export interface VerificationRecipe {
  environment: VerificationEnvironment;
  cases: VerificationCase[];
}

export interface CaseResult {
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
  casesFailed: CaseResult[];
  environmentLog: string[];
}

// ---------------------------------------------------------------------------
// Recipe loader
// ---------------------------------------------------------------------------

export function loadVerificationRecipe(projectRoot: string): VerificationRecipe | null {
  const recipePath = join(projectRoot, '.reins', 'verification.yaml');
  if (!existsSync(recipePath)) return null;

  try {
    const content = readFileSync(recipePath, 'utf-8');
    const parsed = yaml.load(content) as VerificationRecipe | null;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Case execution (stubbed HTTP calls)
// ---------------------------------------------------------------------------

async function runCase(
  baseUrl: string,
  c: VerificationCase,
  environmentLog: string[],
): Promise<CaseResult> {
  const url = `${baseUrl}${c.path}`;
  environmentLog.push(`[case:${c.id}] ${c.method} ${url} expect=${c.expect.status}`);

  // Stub: actual HTTP calls are stubbed for now — the structure and flow are the implementation target
  // In production this would perform a real fetch/curl call
  try {
    const response = await fetch(url, {
      method: c.method.toUpperCase(),
      signal: AbortSignal.timeout(10_000),
    });
    const passed = response.status === c.expect.status;
    environmentLog.push(`[case:${c.id}] actual=${response.status} passed=${passed}`);
    return {
      id: c.id,
      passed,
      actualStatus: response.status,
      expectedStatus: c.expect.status,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    environmentLog.push(`[case:${c.id}] error: ${error}`);
    return {
      id: c.id,
      passed: false,
      actualStatus: null,
      expectedStatus: c.expect.status,
      error,
    };
  }
}

// ---------------------------------------------------------------------------
// L2 entry point
// ---------------------------------------------------------------------------

export async function runL2Integration(
  projectRoot: string,
  recipe: VerificationRecipe,
): Promise<L2Result> {
  const environmentLog: string[] = [];
  const envConfig = recipe.environment;
  const cases = recipe.cases ?? [];

  const startConfig: EnvironmentStartConfig = {
    command: envConfig.start.command,
    port: envConfig.start.port,
    health_check: envConfig.start.health_check,
    startup_timeout: envConfig.start.startup_timeout ?? 30,
  };

  const baseUrl = `http://localhost:${envConfig.start.port}`;

  environmentLog.push(`starting service: ${startConfig.command}`);

  let handle: ServiceHandle | null = null;
  const caseResults: CaseResult[] = [];

  try {
    handle = await startService(startConfig);
    if (!handle) {
      environmentLog.push('service failed to start or health check timed out');
      return {
        passed: false,
        skipped: false,
        casesTotal: cases.length,
        casesPassed: 0,
        casesFailed: cases.map(c => ({
          id: c.id,
          passed: false,
          actualStatus: null,
          expectedStatus: c.expect.status,
          error: 'service did not start',
        })),
        environmentLog,
      };
    }

    environmentLog.push(`service healthy at ${startConfig.health_check}`);

    for (const c of cases) {
      const result = await runCase(baseUrl, c, environmentLog);
      caseResults.push(result);
    }
  } finally {
    if (handle) {
      stopService(handle);
      environmentLog.push('service stopped');
    }
  }

  const failed = caseResults.filter(r => !r.passed);
  return {
    passed: failed.length === 0,
    skipped: false,
    casesTotal: cases.length,
    casesPassed: caseResults.filter(r => r.passed).length,
    casesFailed: failed,
    environmentLog,
  };
}
