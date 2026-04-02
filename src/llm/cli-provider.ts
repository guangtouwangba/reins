import { execFile, execFileSync } from 'node:child_process';
import type { LLMProvider, LLMCompletionOpts } from './provider.js';

// ---------------------------------------------------------------------------
// CliLLMProvider — shells out to `claude` CLI
// ---------------------------------------------------------------------------

export class CliLLMProvider implements LLMProvider {
  private command: string;

  constructor(command = 'claude') {
    this.command = command;
  }

  async complete(prompt: string, opts?: LLMCompletionOpts): Promise<string> {
    const args = ['-p', prompt, '--output-format', 'text'];
    if (opts?.model) {
      args.push('--model', opts.model);
    }
    if (opts?.maxTokens) {
      args.push('--max-tokens', String(opts.maxTokens));
    }

    return new Promise<string>((resolve, reject) => {
      execFile(this.command, args, {
        maxBuffer: 10 * 1024 * 1024,
        timeout: 120_000,
      }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`LLM call failed: ${error.message}${stderr ? `\n${stderr}` : ''}`));
          return;
        }
        resolve(stdout.trim());
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Detection helper
// ---------------------------------------------------------------------------

export function isClaudeCliAvailable(): boolean {
  try {
    execFileSync('which', ['claude'], { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
