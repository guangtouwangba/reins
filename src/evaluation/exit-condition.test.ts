import { describe, it, expect } from 'vitest';
import { shouldExit, buildExitCondition } from './exit-condition.js';
import type { ExitCondition, EvalResult } from './types.js';

function makeCondition(overrides?: Partial<ExitCondition>): ExitCondition {
  return {
    L0_passed: true,
    L1_passed: true,
    L2_passed: true,
    L3_passed: true,
    L4_confidence: 90,
    iterationCount: 0,
    maxIterations: 50,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// shouldExit
// ---------------------------------------------------------------------------

describe('shouldExit', () => {
  it('exits when max iterations reached regardless of profile', () => {
    const cond = makeCondition({ iterationCount: 50, maxIterations: 50, L0_passed: false });
    expect(shouldExit(cond, 'relaxed').exit).toBe(true);
    expect(shouldExit(cond, 'default').exit).toBe(true);
    expect(shouldExit(cond, 'strict').exit).toBe(true);
    expect(shouldExit(cond, 'fullstack').exit).toBe(true);
  });

  describe('relaxed profile', () => {
    it('exits when L0 passes', () => {
      const result = shouldExit(makeCondition({ L0_passed: true }), 'relaxed');
      expect(result.exit).toBe(true);
    });

    it('does not exit when L0 fails', () => {
      const result = shouldExit(makeCondition({ L0_passed: false }), 'relaxed');
      expect(result.exit).toBe(false);
    });
  });

  describe('default profile', () => {
    it('exits when L0 and L1 pass', () => {
      const result = shouldExit(makeCondition({ L0_passed: true, L1_passed: true }), 'default');
      expect(result.exit).toBe(true);
    });

    it('does not exit when L0 passes but L1 fails', () => {
      const result = shouldExit(makeCondition({ L0_passed: true, L1_passed: false }), 'default');
      expect(result.exit).toBe(false);
    });

    it('does not exit when L0 fails', () => {
      const result = shouldExit(makeCondition({ L0_passed: false, L1_passed: true }), 'default');
      expect(result.exit).toBe(false);
    });
  });

  describe('strict profile', () => {
    it('exits when L0+L1+L2 pass and L4>=80', () => {
      const result = shouldExit(makeCondition({ L4_confidence: 85 }), 'strict');
      expect(result.exit).toBe(true);
    });

    it('does not exit when L4 confidence too low', () => {
      const result = shouldExit(makeCondition({ L4_confidence: 70 }), 'strict');
      expect(result.exit).toBe(false);
      expect(result.reason).toContain('L4_confidence');
    });

    it('does not exit when L2 fails', () => {
      const result = shouldExit(makeCondition({ L2_passed: false }), 'strict');
      expect(result.exit).toBe(false);
    });
  });

  describe('fullstack profile', () => {
    it('exits when all layers pass and L4>=80', () => {
      const result = shouldExit(makeCondition(), 'fullstack');
      expect(result.exit).toBe(true);
    });

    it('does not exit when L3 fails', () => {
      const result = shouldExit(makeCondition({ L3_passed: false }), 'fullstack');
      expect(result.exit).toBe(false);
      expect(result.reason).toContain('L3');
    });
  });

  describe('unknown profile', () => {
    it('falls back to default behavior', () => {
      const result = shouldExit(makeCondition({ L0_passed: true, L1_passed: true }), 'custom-profile');
      expect(result.exit).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// buildExitCondition
// ---------------------------------------------------------------------------

describe('buildExitCondition', () => {
  const baseEval: EvalResult = {
    l0: { passed: true, commands: [], detectedPackageManager: 'pnpm' },
    l1: { passed: true, checks: [] },
    l2: null,
    l3: null,
    l4: null,
  };

  it('builds condition from eval result', () => {
    const cond = buildExitCondition(baseEval, 3, {} as any);
    expect(cond.L0_passed).toBe(true);
    expect(cond.L1_passed).toBe(true);
    expect(cond.iterationCount).toBe(3);
  });

  it('defaults L2/L3/L4 to passing when null', () => {
    const cond = buildExitCondition(baseEval, 0, {} as any);
    expect(cond.L2_passed).toBe(true);
    expect(cond.L3_passed).toBe(true);
    expect(cond.L4_confidence).toBe(100);
  });

  it('uses actual L4 confidence when present', () => {
    const evalWithL4: EvalResult = {
      ...baseEval,
      l4: { confidence: 65, completeness: 'partial', issues: [], suggestions: [] },
    };
    const cond = buildExitCondition(evalWithL4, 0, {} as any);
    expect(cond.L4_confidence).toBe(65);
  });

  it('uses config maxIterations', () => {
    const config = { evaluation: { profiles: { default: { max_iterations: 10 } } } } as any;
    const cond = buildExitCondition(baseEval, 0, config);
    expect(cond.maxIterations).toBe(10);
  });

  it('defaults maxIterations to 50', () => {
    const cond = buildExitCondition(baseEval, 0, {} as any);
    expect(cond.maxIterations).toBe(50);
  });
});
