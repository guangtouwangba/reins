import type { ReinsConfig } from '../state/config.js';
import type { EvalResult, ExitCondition } from './types.js';

// ---------------------------------------------------------------------------
// Exit condition evaluation
// ---------------------------------------------------------------------------

export function shouldExit(
  condition: ExitCondition,
  profile: string,
): { exit: boolean; reason: string } {
  // Max iterations always wins
  if (condition.iterationCount >= condition.maxIterations) {
    return { exit: true, reason: 'max iterations reached' };
  }

  switch (profile) {
    case 'relaxed':
      if (condition.L0_passed) {
        return { exit: true, reason: 'L0 passed (relaxed profile)' };
      }
      return { exit: false, reason: 'L0 not yet passed' };

    case 'default':
      if (condition.L0_passed && condition.L1_passed) {
        return { exit: true, reason: 'L0 and L1 passed (default profile)' };
      }
      return {
        exit: false,
        reason: `waiting for: ${!condition.L0_passed ? 'L0' : 'L1'}`,
      };

    case 'strict':
      if (
        condition.L0_passed &&
        condition.L1_passed &&
        condition.L2_passed &&
        condition.L4_confidence >= 80
      ) {
        return { exit: true, reason: 'L0+L1+L2+L4>=80 passed (strict profile)' };
      }
      return {
        exit: false,
        reason: `waiting for: ${[
          !condition.L0_passed && 'L0',
          !condition.L1_passed && 'L1',
          !condition.L2_passed && 'L2',
          condition.L4_confidence < 80 && `L4_confidence(${condition.L4_confidence}<80)`,
        ]
          .filter(Boolean)
          .join(', ')}`,
      };

    case 'fullstack':
      if (
        condition.L0_passed &&
        condition.L1_passed &&
        condition.L2_passed &&
        condition.L3_passed &&
        condition.L4_confidence >= 80
      ) {
        return { exit: true, reason: 'L0+L1+L2+L3+L4>=80 passed (fullstack profile)' };
      }
      return {
        exit: false,
        reason: `waiting for: ${[
          !condition.L0_passed && 'L0',
          !condition.L1_passed && 'L1',
          !condition.L2_passed && 'L2',
          !condition.L3_passed && 'L3',
          condition.L4_confidence < 80 && `L4_confidence(${condition.L4_confidence}<80)`,
        ]
          .filter(Boolean)
          .join(', ')}`,
      };

    default:
      // Unknown profile — treat as default
      if (condition.L0_passed && condition.L1_passed) {
        return { exit: true, reason: 'L0 and L1 passed (default fallback)' };
      }
      return { exit: false, reason: 'L0 or L1 not yet passed' };
  }
}

// ---------------------------------------------------------------------------
// Build exit condition from evaluation results
// ---------------------------------------------------------------------------

export function buildExitCondition(
  evalResult: EvalResult,
  iterationCount: number,
  config: ReinsConfig,
): ExitCondition {
  const profile = config.develop?.constraint_profile ?? 'default';
  const evalProfileConfig = config.evaluation?.profiles?.[profile];
  const maxIterations = evalProfileConfig?.max_iterations ?? 50;

  const L1_passed = evalResult.l1 !== null ? evalResult.l1.passed : true;
  const L2_passed = evalResult.l2 !== null ? evalResult.l2.passed : true;
  const L4_confidence = evalResult.l4 !== null ? evalResult.l4.confidence : 100;

  const L3_passed = evalResult.l3 !== null ? evalResult.l3.passed : true;

  return {
    L0_passed: evalResult.l0.passed,
    L1_passed,
    L2_passed,
    L3_passed,
    L4_confidence,
    iterationCount,
    maxIterations,
  };
}
