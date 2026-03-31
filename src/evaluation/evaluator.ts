import { runL0Static } from './l0-static.js';
import { runL1Coverage } from './l1-coverage.js';
import { loadVerificationRecipe, runL2Integration } from './l2-integration.js';
import { loadE2ECases, runL3E2E } from './l3-e2e.js';
import { runL4Semantic } from './l4-semantic.js';
import type { EvalResult } from './types.js';

export type { EvalResult };

export async function evaluate(projectRoot: string, profile: string): Promise<EvalResult> {
  const l0 = await runL0Static(projectRoot);

  // L1: coverage gate
  const l1Result = await runL1Coverage(projectRoot);
  const l1 = { passed: l1Result.passed, checks: l1Result.checks };

  // L2: integration verify (only if verification.yaml exists)
  let l2: EvalResult['l2'] = null;
  const recipe = loadVerificationRecipe(projectRoot);
  if (recipe) {
    const l2Result = await runL2Integration(projectRoot, recipe);
    l2 = {
      passed: l2Result.passed,
      skipped: l2Result.skipped,
      casesTotal: l2Result.casesTotal,
      casesPassed: l2Result.casesPassed,
      casesFailed: l2Result.casesFailed,
    };
  }

  // L3: E2E (only for fullstack profile)
  let l3: EvalResult['l3'] = null;
  if (profile === 'fullstack') {
    const e2eCases = loadE2ECases(projectRoot);
    const l3Result = await runL3E2E(projectRoot, e2eCases);
    l3 = {
      passed: l3Result.passed,
      skipped: l3Result.skipped,
      total: l3Result.total,
      passedCount: l3Result.passedCount,
      failedCount: l3Result.failedCount,
      results: l3Result.results,
      screenshots: l3Result.screenshots,
    };
  }

  // L4: semantic review (always for strict profile, stubbed)
  let l4: EvalResult['l4'] = null;
  if (profile === 'strict' || profile === 'fullstack') {
    const l4Result = await runL4Semantic(
      '',
      [],
      {
        l0Passed: l0.passed,
        l1Passed: l1Result.passed,
        l2Passed: l2 ? l2.passed : true,
      },
    );
    l4 = {
      confidence: l4Result.confidence,
      completeness: l4Result.completeness,
      issues: l4Result.issues,
      suggestions: l4Result.suggestions,
    };
  }

  return { l0, l1, l2, l3, l4 };
}
