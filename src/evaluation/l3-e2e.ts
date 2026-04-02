import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface E2EStep {
  id: string;
  action: 'navigate' | 'click' | 'upload' | 'screenshot' | 'assert';
  url?: string;
  selector?: string;
  file?: string;
  expect?: { selector?: string; visible?: boolean; timeout?: number };
}

export interface E2ECase {
  task: string;
  type: 'e2e';
  tool: string;
  steps: E2EStep[];
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

// ---------------------------------------------------------------------------
// Case loader
// ---------------------------------------------------------------------------

export function loadE2ECases(projectRoot: string): E2ECase[] {
  const casesDir = join(projectRoot, '.reins', 'verification-cases');
  if (!existsSync(casesDir)) return [];

  let entries: string[];
  try {
    entries = readdirSync(casesDir);
  } catch {
    return [];
  }

  const cases: E2ECase[] = [];

  for (const entry of entries) {
    if (!entry.endsWith('-e2e.yaml') && !entry.endsWith('-e2e.yml')) continue;

    const filePath = join(casesDir, entry);
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const parsed = yaml.load(raw) as E2ECase | null;
      if (parsed && parsed.type === 'e2e' && Array.isArray(parsed.steps)) {
        cases.push(parsed);
      }
    } catch {
      // skip unparseable files
    }
  }

  return cases;
}

// ---------------------------------------------------------------------------
// Skipped result helper
// ---------------------------------------------------------------------------

function buildSkippedResult(cases: E2ECase[]): L3Result {
  const allSteps = cases.flatMap(c => c.steps);
  return {
    passed: true,
    skipped: true,
    total: allSteps.length,
    passedCount: 0,
    failedCount: 0,
    results: allSteps.map(s => ({ stepId: s.id, passed: false, error: 'skipped' })),
    screenshots: [],
  };
}

// ---------------------------------------------------------------------------
// L3 E2E runner
// ---------------------------------------------------------------------------

export async function runL3E2E(
  projectRoot: string,
  cases: E2ECase[],
): Promise<L3Result> {
  if (cases.length === 0) {
    return {
      passed: true,
      skipped: true,
      total: 0,
      passedCount: 0,
      failedCount: 0,
      results: [],
      screenshots: [],
    };
  }

  // Check if Playwright is available at runtime (not a compile-time dependency)
  let playwrightAvailable = false;
  try {
    const dynamicImport = new Function('m', 'return import(m)') as (m: string) => Promise<unknown>;
    await dynamicImport('playwright');
    playwrightAvailable = true;
  } catch {
    // Playwright not installed — return skipped result
  }

  if (!playwrightAvailable) {
    return buildSkippedResult(cases);
  }

  // Full Playwright execution path (requires playwright to be installed)
  // The structure is complete; actual calls are gated on playwright being available above.
  const allResults: L3StepResult[] = [];
  const screenshots: string[] = [];

  for (const e2eCase of cases) {
    const caseResults = await runE2ECase(projectRoot, e2eCase, screenshots);
    allResults.push(...caseResults);
  }

  const failedCount = allResults.filter(r => !r.passed).length;
  const passedCount = allResults.filter(r => r.passed).length;

  return {
    passed: failedCount === 0,
    skipped: false,
    total: allResults.length,
    passedCount,
    failedCount,
    results: allResults,
    screenshots,
  };
}

// ---------------------------------------------------------------------------
// Single case runner (only reached when Playwright is available)
// ---------------------------------------------------------------------------

async function runE2ECase(
  _projectRoot: string,
  e2eCase: E2ECase,
  screenshots: string[],
): Promise<L3StepResult[]> {
  const results: L3StepResult[] = [];

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const pw = await (new Function('m', 'return import(m)')('playwright') as Promise<any>);
  const { chromium } = pw;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    for (const step of e2eCase.steps) {
      results.push(await dispatchStep(step, screenshots, page));
    }
  } finally {
    await browser.close();
  }

  return results;
}

async function dispatchStep(
  step: E2EStep,
  screenshots: string[],
  page: any,
): Promise<L3StepResult> {
  switch (step.action) {
    case 'navigate':
      try {
        await page.goto(step.url ?? '');
        return { stepId: step.id, passed: true };
      } catch (err: any) {
        return { stepId: step.id, passed: false, error: err.message };
      }

    case 'click':
      try {
        await page.click(step.selector ?? '');
        return { stepId: step.id, passed: true };
      } catch (err: any) {
        return { stepId: step.id, passed: false, error: err.message };
      }

    case 'upload':
      try {
        if (step.selector && step.file) await page.setInputFiles(step.selector, step.file);
        return { stepId: step.id, passed: true };
      } catch (err: any) {
        return { stepId: step.id, passed: false, error: err.message };
      }

    case 'screenshot':
      try {
        const path = join(tmpdir(), `reins-e2e-${step.id}-${Date.now()}.png`);
        await page.screenshot({ path });
        screenshots.push(path);
        return { stepId: step.id, passed: true };
      } catch (err: any) {
        return { stepId: step.id, passed: false, error: err.message };
      }

    case 'assert':
      try {
        const sel = step.expect?.selector ?? '';
        await page.waitForSelector(sel, {
          state: step.expect?.visible ? 'visible' : 'attached',
          timeout: step.expect?.timeout ?? 5000,
        });
        return { stepId: step.id, passed: true };
      } catch (err: any) {
        return { stepId: step.id, passed: false, error: err.message };
      }

    default:
      return { stepId: step.id, passed: false, error: `unknown action: ${String((step as E2EStep).action)}` };
  }
}
