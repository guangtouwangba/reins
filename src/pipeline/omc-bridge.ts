import type { Plan, ExecutionResult, ReviewResult, ExecOpts } from './types.js';

// ---------------------------------------------------------------------------
// OMCBridge interface
// ---------------------------------------------------------------------------

export interface OMCBridge {
  ralplan(prompt: string): Promise<Plan>;
  executor(prompt: string, opts: ExecOpts): Promise<ExecutionResult>;
  ralph(prompt: string, maxIter: number): Promise<ReviewResult>;
}

// ---------------------------------------------------------------------------
// Phase 2 stub implementation — skips gracefully instead of throwing
// ---------------------------------------------------------------------------

export class StubOMCBridge implements OMCBridge {
  async ralplan(prompt: string): Promise<Plan> {
    console.log(`[omc-bridge stub] ralplan: ${prompt.slice(0, 200)}`);
    return { steps: [], files: [], verificationCases: [] };
  }

  async executor(prompt: string, _opts: ExecOpts): Promise<ExecutionResult> {
    console.log(`[omc-bridge stub] executor: ${prompt.slice(0, 200)}`);
    return { success: true, filesCreated: [], filesModified: [], output: 'stub' };
  }

  async ralph(prompt: string, _maxIter: number): Promise<ReviewResult> {
    console.log(`[omc-bridge stub] ralph: ${prompt.slice(0, 200)}`);
    return { success: true, iterations: 0, issues: [] };
  }
}

export default new StubOMCBridge();
