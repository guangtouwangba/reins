import { execFile, execFileSync } from 'node:child_process';
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

// ---------------------------------------------------------------------------
// CLI-based implementation — delegates to `claude` (or custom command)
// ---------------------------------------------------------------------------

export class CliOMCBridge implements OMCBridge {
  private command: string;

  constructor(command = 'claude') {
    this.command = command;
  }

  private async invoke(prompt: string, timeout = 120_000): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      execFile(this.command, ['-p', prompt, '--output-format', 'text'], {
        maxBuffer: 10 * 1024 * 1024,
        timeout,
      }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`OMC call failed: ${error.message}${stderr ? '\n' + stderr : ''}`));
          return;
        }
        resolve(stdout.trim());
      });
    });
  }

  private parseJson<T>(raw: string, fallback: T): T {
    let cleaned = raw.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    }
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      return fallback;
    }
  }

  async ralplan(prompt: string): Promise<Plan> {
    const planPrompt = `You are a planning agent. Break this task into steps and identify files involved.

Task: ${prompt}

Respond with a JSON object:
{"steps": ["step1", "step2", ...], "files": ["file1.ts", ...], "verificationCases": ["test case 1", ...]}

Respond with ONLY the JSON, no markdown fences.`;

    try {
      const raw = await this.invoke(planPrompt);
      return this.parseJson<Plan>(raw, { steps: [], files: [], verificationCases: [] });
    } catch {
      return { steps: [], files: [], verificationCases: [] };
    }
  }

  async executor(prompt: string, opts: ExecOpts): Promise<ExecutionResult> {
    const execPrompt = `You are an execution agent. Implement the following task. List all files you would create or modify.

Task: ${prompt}

Respond with a JSON object:
{"success": true/false, "filesCreated": [...], "filesModified": [...], "output": "summary of what was done"}

Respond with ONLY the JSON, no markdown fences.`;

    try {
      const timeout = opts.timeout ?? 120_000;
      const raw = await this.invoke(execPrompt, timeout);
      return this.parseJson<ExecutionResult>(raw, { success: false, filesCreated: [], filesModified: [], output: 'parse error' });
    } catch (err) {
      return { success: false, filesCreated: [], filesModified: [], output: err instanceof Error ? err.message : String(err) };
    }
  }

  async ralph(prompt: string, maxIter: number): Promise<ReviewResult> {
    const reviewPrompt = `You are a code review agent. Review the implementation for this task and identify any issues.

Task: ${prompt}
Max iterations: ${maxIter}

Respond with a JSON object:
{"success": true/false, "iterations": <number>, "issues": ["issue1", ...]}

Respond with ONLY the JSON, no markdown fences.`;

    try {
      const raw = await this.invoke(reviewPrompt);
      return this.parseJson<ReviewResult>(raw, { success: false, iterations: 0, issues: ['parse error'] });
    } catch (err) {
      return { success: false, iterations: 0, issues: [err instanceof Error ? err.message : String(err)] };
    }
  }
}

// ---------------------------------------------------------------------------
// Smart singleton — auto-detects whether `claude` CLI is available
// ---------------------------------------------------------------------------

let _bridge: OMCBridge | null = null;

export function getOMCBridge(): OMCBridge {
  if (_bridge) return _bridge;
  try {
    execFileSync('which', ['claude'], { stdio: 'pipe', timeout: 5000 });
    _bridge = new CliOMCBridge();
  } catch {
    _bridge = new StubOMCBridge();
  }
  return _bridge;
}

export function setOMCBridge(bridge: OMCBridge | null): void {
  _bridge = bridge;
}

// Default export for backward compatibility (runner.ts imports as default)
// Use getOMCBridge() for smart CLI detection
export default new StubOMCBridge();
